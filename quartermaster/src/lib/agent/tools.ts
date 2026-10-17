/**
 * The agent's tools. Note what is NOT here: no tool can pay. The agent can
 * search, read rules, dry-run a purchase and propose; the mandate engine
 * decides; a human or a mandate-checked job executes the PayPal call.
 *
 * Prices are never taken from the model: checkPurchase and proposePurchase
 * look them up from the options this request actually retrieved, so the LLM
 * cannot invent a price.
 */
import { tool } from "ai";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { searchProducts } from "@/lib/integrations/channel3";
import { mandateUsage, previewPurchase, proposePurchase } from "@/lib/purchases";
import { SPENDING_POLICY } from "@/lib/policy";
import { CLAUSES, type Decision } from "@/lib/mandates/engine";
import { unitsPerListing } from "@/lib/units";

export interface AgentContext {
  orgId: string;
  memberId: string;
  requestId: string;
  traceId: string;
  appUrl: string;
}

const dollars = (cents: number) => Math.round(cents) / 100;

const OrderInput = z.object({
  mandateId: z.string(),
  items: z
    .array(
      z.object({
        optionId: z.string().describe("optionId from searchProducts"),
        listings: z.number().int().positive().describe("how many LISTINGS to buy (a 'pack of 24' listing counts as 1)"),
        category: z.string().describe("one of the mandate's categories"),
      }),
    )
    .min(1)
    .describe("items from ONE vendor"),
});

type OptionRow = typeof schema.productOptions.$inferSelect;

/** Looks up chosen options for this request and checks they share one vendor. */
async function resolve(ctx: AgentContext, items: z.infer<typeof OrderInput>["items"], extraIds: string[] = []) {
  const ids = [...new Set([...items.map((i) => i.optionId), ...extraIds])];
  const opts = await db()
    .select()
    .from(schema.productOptions)
    .where(and(eq(schema.productOptions.requestId, ctx.requestId), inArray(schema.productOptions.id, ids)));
  const byId = new Map<string, OptionRow>(opts.map((o) => [o.id, o]));
  const missing = items.filter((i) => !byId.has(i.optionId)).map((i) => i.optionId);
  if (missing.length) return { error: `Unknown optionId(s) ${missing.join(", ")} — use ids returned by searchProducts in this conversation.` } as const;
  const chosen = items.map((i) => ({ ...i, option: byId.get(i.optionId)! }));
  const vendors = [...new Set(chosen.map((c) => c.option.vendor))];
  if (vendors.length > 1)
    return { error: `One order = one vendor. Got ${vendors.join(", ")}. Check and propose each vendor's items as a separate order.` } as const;
  return {
    byId,
    vendor: vendors[0],
    currency: chosen[0].option.currency,
    lines: chosen.map((c) => ({ description: c.option.title, category: c.category, unitPriceCents: c.option.priceCents, quantity: c.listings })),
    units: chosen.map((c) => ({ title: c.option.title, units: c.listings * unitsPerListing(c.option.title) })),
  } as const;
}

function explain(decision: Decision) {
  return {
    outcome: decision.outcome,
    clause: decision.clause,
    clauseName: decision.clause in CLAUSES ? CLAUSES[decision.clause as keyof typeof CLAUSES] : "All rules passed",
    message: decision.message,
    reasons: decision.reasons,
    remainingAfterDollars: dollars(decision.remainingAfterCents),
  };
}

/** Active mandates with remaining budget. The chat route puts this in the system prompt so the agent doesn't spend a model call fetching it. */
export async function mandateSummaries(orgId: string) {
  const rows = await db().query.mandates.findMany({ where: and(eq(schema.mandates.orgId, orgId), eq(schema.mandates.status, "active")) });
  const evs = await db().query.events.findMany({ where: eq(schema.events.orgId, orgId) });
  return Promise.all(
    rows.map(async (m) => {
      const u = await mandateUsage(m);
      return {
        mandateId: m.id,
        title: m.title,
        event: evs.find((e) => e.id === m.eventId)?.name ?? null,
        eventDate: evs.find((e) => e.id === m.eventId)?.startsAt.toISOString() ?? null,
        currency: m.currency,
        capDollars: dollars(m.capCents),
        remainingDollars: dollars(u.remainingCents),
        perItemAutoLimitDollars: dollars(m.perItemAutoLimitCents),
        perOrderAutoLimitDollars: dollars(m.perOrderAutoLimitCents),
        categories: m.categories,
        expiresAt: m.expiresAt.toISOString(),
      };
    }),
  );
}

export function buildTools(ctx: AgentContext) {
  return {
    listMandates: tool({
      description: "Re-read the org's active spending mandates and remaining budgets. They are already in your instructions; only call this to refresh after a proposal.",
      inputSchema: z.object({}),
      execute: () => mandateSummaries(ctx.orgId),
    }),

    readPolicy: tool({
      description: "Read the org's spending policy (categories, quote rules, delivery rules). It is already in your instructions; you rarely need this.",
      inputSchema: z.object({}),
      execute: async () => ({ policy: SPENDING_POLICY }),
    }),

    searchProducts: tool({
      description:
        "Search retailers for one product type. Each option shows its listing price, how many units one listing contains, and the price per unit — compare on price per unit.",
      inputSchema: z.object({
        query: z.string().min(2).describe("e.g. 'reusable water bottle'"),
        maxListingPriceDollars: z.number().positive().optional(),
      }),
      execute: async ({ query, maxListingPriceDollars }) => {
        const r = await searchProducts(query, { maxPrice: maxListingPriceDollars, limit: 5 });
        if (r.products.length === 0) return { source: r.source, note: r.note ?? "No products found", options: [] };
        const saved = await db()
          .insert(schema.productOptions)
          .values(
            r.products.map((p) => ({
              requestId: ctx.requestId,
              source: p.source,
              externalId: p.id,
              title: p.title,
              imageUrl: p.imageUrl,
              url: p.url,
              vendor: p.vendor,
              priceCents: p.priceCents,
              currency: p.currency,
              availability: p.availability,
            })),
          )
          .returning();
        return {
          source: r.source,
          note: r.note,
          options: saved.map((o) => {
            const per = unitsPerListing(o.title);
            return {
              optionId: o.id,
              title: o.title,
              vendor: o.vendor,
              priceDollars: dollars(o.priceCents),
              unitsPerListing: per,
              pricePerUnitDollars: Math.round(o.priceCents / per) / 100,
              currency: o.currency,
              availability: o.availability,
              imageUrl: o.imageUrl,
              url: o.url,
            };
          }),
        };
      },
    }),

    checkPurchase: tool({
      description:
        "DRY RUN: checks an order against the mandate (and the requester's own budget, if they gave one) without saving anything. Use it to find an order that fits before proposing. Call as often as needed.",
      inputSchema: OrderInput.extend({
        requesterBudgetDollars: z.number().positive().optional().describe("the budget the member stated, e.g. 'under $300' -> 300"),
      }),
      execute: async ({ mandateId, items, requesterBudgetDollars }) => {
        const r = await resolve(ctx, items);
        if ("error" in r) return { error: r.error };
        const { totalCents, decision, remainingBeforeCents } = await previewPurchase({ orgId: ctx.orgId, mandateId, vendor: r.vendor, currency: r.currency, lines: r.lines });
        const overBudget = requesterBudgetDollars != null && totalCents > Math.round(requesterBudgetDollars * 100);
        return {
          vendor: r.vendor,
          totalDollars: dollars(totalCents),
          unitsYouGet: r.units,
          mandateRemainingBeforeDollars: dollars(remainingBeforeCents),
          withinRequesterBudget: requesterBudgetDollars == null ? null : !overBudget,
          ...explain(decision),
          advice:
            decision.outcome === "deny"
              ? "Do not propose this. Reduce quantities or pick cheaper options, then check again — or tell the member it cannot fit."
              : overBudget
                ? "This passes the mandate but is over the member's own budget. Find a cheaper fit, or ask the member before proposing."
                : "OK to propose.",
        };
      },
    }),

    proposePurchase: tool({
      description:
        "Propose ONE order from ONE vendor. Call checkPurchase first and only propose orders it said are OK. The mandate engine records allow / needs_approval / deny. This does not pay; it returns an approval link.",
      inputSchema: OrderInput.extend({
        consideredOptionIds: z.array(z.string()).describe("every optionId you compared for these items, including the chosen ones"),
        rationale: z.string().describe("1-3 sentences: why these items, quantities and this vendor (mention price per unit)"),
      }),
      execute: async ({ mandateId, items, consideredOptionIds, rationale }) => {
        const r = await resolve(ctx, items, consideredOptionIds);
        if ("error" in r) return { error: r.error };
        const { payment, decision, remainingBeforeCents, capCents } = await proposePurchase({
          orgId: ctx.orgId,
          mandateId,
          requestId: ctx.requestId,
          traceId: ctx.traceId,
          vendor: r.vendor,
          currency: r.currency,
          rationale,
          lines: r.lines,
          optionsConsidered: consideredOptionIds
            .map((id) => r.byId.get(id))
            .filter((o): o is OptionRow => o !== undefined)
            .map((o) => ({ title: o.title, vendor: o.vendor, priceCents: o.priceCents, url: o.url })),
        });
        return {
          paymentId: payment.id,
          totalDollars: dollars(payment.totalCents),
          vendor: payment.vendor,
          capDollars: dollars(capCents),
          remainingBeforeDollars: dollars(remainingBeforeCents),
          lines: payment.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceDollars: dollars(l.unitPriceCents) })),
          ...explain(decision),
          approvalUrl: decision.outcome === "deny" ? null : `${ctx.appUrl}/approve/${payment.id}`,
          receiptUrl: `${ctx.appUrl}/receipts/${payment.id}`,
        };
      },
    }),
  };
}
