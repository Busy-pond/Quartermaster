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
import { CLAUSES, type Decision } from "@/lib/mandates/engine";
import { search } from "@/lib/integrations/search";
import { loadVerifications, verifyOptions } from "@/lib/verify/options";
import { flags } from "@/lib/flags";
import { notifyLater } from "@/lib/approvals/notify";
import { draftSponsorInvoice } from "@/lib/funding/service";
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
  // A KERNEL live check (verifyProducts) replaces the search price when the retailer's price moved more than 2%.
  const verified = await loadVerifications(ids);
  const priceOf = (o: OptionRow) => verified.get(o.id)?.useCents ?? o.priceCents;
  const missing = items.filter((i) => !byId.has(i.optionId)).map((i) => i.optionId);
  if (missing.length) return { error: `Unknown optionId(s) ${missing.join(", ")} — use ids returned by searchProducts in this conversation.` } as const;
  const chosen = items.map((i) => ({ ...i, option: byId.get(i.optionId)! }));
  const vendors = [...new Set(chosen.map((c) => c.option.vendor))];
  if (vendors.length > 1)
    return { error: `One order = one vendor. Got ${vendors.join(", ")}. Check and propose each vendor's items as a separate order.` } as const;
  return {
    byId,
    verified,
    vendor: vendors[0],
    currency: chosen[0].option.currency,
    lines: chosen.map((c) => ({ description: c.option.title, category: c.category, unitPriceCents: priceOf(c.option), quantity: c.listings })),
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
        capDollars: dollars(u.capCents),
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
  const tools = {
    listMandates: tool({
      description: "Re-read the org's active spending mandates and remaining budgets. They are already in your instructions; only call this to refresh after a proposal.",
      inputSchema: z.object({}),
      execute: () => mandateSummaries(ctx.orgId),
    }),

    searchPolicy: tool({
      description:
        "Search the org's spending policy by meaning. Returns the most relevant numbered clauses (e.g. 3.3) with their text. Cite the clause number you rely on.",
      inputSchema: z.object({ query: z.string().min(3).describe("a question or topic, e.g. 'do we need two quotes for a $300 order?'") }),
      execute: async ({ query }) => {
        const r = await search().searchPolicy(ctx.orgId, query, 3);
        return { source: r.source, clauses: r.hits.map((h) => ({ clause: h.clause, section: h.section, text: h.text, relevance: h.score })) };
      },
    }),

    purchaseHistory: tool({
      description:
        "Search the org's past purchases and reimbursed receipts by meaning: vendor, items, price per unit, date and status (refunded = it went wrong). Use it to reuse a vendor that worked or avoid one that was refunded.",
      inputSchema: z.object({ query: z.string().min(2).describe("what is being bought, e.g. 'trash bags'") }),
      execute: async ({ query }) => {
        const r = await search().purchaseHistory(ctx.orgId, query, 5);
        return {
          source: r.source,
          past: r.hits.map((h) => ({
            kind: h.kind,
            vendor: h.vendor,
            date: h.date,
            status: h.status,
            totalDollars: dollars(h.totalCents),
            items: h.items.map((i) => ({ description: i.description, quantity: i.quantity, pricePerUnitDollars: Math.round(i.unitPriceCents / unitsPerListing(i.description)) / 100 })),
            relevance: h.score,
          })),
        };
      },
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

    verifyProducts: tool({
      description:
        "Opens the buy pages of up to 2 options in a KERNEL cloud browser and reads the live price, stock and delivery. Call it on the options you are about to choose, before checkPurchase. If the live price moved more than 2%, checkPurchase and proposePurchase use the live price automatically.",
      inputSchema: z.object({ optionIds: z.array(z.string()).min(1).max(2) }),
      execute: async ({ optionIds }) => {
        const opts = await db()
          .select()
          .from(schema.productOptions)
          .where(and(eq(schema.productOptions.requestId, ctx.requestId), inArray(schema.productOptions.id, optionIds)));
        if (opts.length === 0) return { error: "Unknown optionIds — use ids returned by searchProducts in this conversation." };
        const v = await verifyOptions(opts);
        return {
          checks: opts.map((o) => {
            const x = v.get(o.id)!;
            return {
              optionId: o.id,
              title: o.title,
              status: x.status,
              searchPriceDollars: dollars(x.storedCents),
              livePriceDollars: x.liveCents == null ? null : dollars(x.liveCents),
              priceUsedDollars: dollars(x.useCents),
              inStock: x.inStock,
              delivery: x.deliveryText,
              verifiedAt: x.verifiedAt,
              source: x.source,
              message: x.message,
            };
          }),
        };
      },
    }),

    createSponsorInvoice: tool({
      description:
        "Drafts a PayPal invoice asking a sponsor for money. It is NOT sent: the treasurer reviews and sends it from the link returned. Use only when the member asks to invoice or request money from a sponsor.",
      inputSchema: z.object({
        sponsorEmail: z.string().email(),
        sponsorName: z.string().max(140).optional(),
        amountDollars: z.number().positive().max(10_000),
        note: z.string().min(5).max(1000).describe("what the sponsorship pays for, in one or two sentences"),
        mandateId: z.string().optional().describe("the budget the money should go to; omit for the Operations budget"),
      }),
      execute: async ({ sponsorEmail, sponsorName, amountDollars, note, mandateId }) => {
        const { row, mandate } = await draftSponsorInvoice({ orgId: ctx.orgId, createdBy: ctx.memberId, traceId: ctx.traceId, sponsorEmail, sponsorName, amountCents: Math.round(amountDollars * 100), note, mandateId });
        return { status: row.status, amountDollars: dollars(row.amountCents), sponsorEmail, budget: mandate.title, reviewUrl: `${ctx.appUrl}/invoices/${row.id}`, nextStep: "The treasurer must open the review link and send it. Say so; don't claim it was sent." };
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
        rationale: z.string().describe("1-3 sentences: why these items, quantities and this vendor (mention price per unit), citing the policy clause relied on, e.g. 'per policy 3.3'"),
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
            .map((o) => ({ title: o.title, vendor: o.vendor, priceCents: o.priceCents, url: o.url, verification: r.verified.get(o.id) ?? null })),
        });
        if (decision.outcome === "needs_approval") {
          const m = await db().query.mandates.findFirst({ where: eq(schema.mandates.id, mandateId) });
          const requester = await db().query.members.findFirst({ where: eq(schema.members.id, ctx.memberId) });
          if (m?.approverIds[0])
            await notifyLater({
              kind: "payment",
              id: payment.id,
              orgId: ctx.orgId,
              traceId: ctx.traceId,
              approverId: m.approverIds[0],
              title: `${payment.lines.map((l) => `${l.quantity}× ${l.description}`).join(", ")} from ${payment.vendor}`,
              amountCents: payment.totalCents,
              currency: payment.currency,
              reason: `${decision.clause}: ${decision.message}`,
              requestedBy: requester?.name ?? "A volunteer",
              appUrl: ctx.appUrl,
            });
        }
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
  // Live verification costs a model step, so the agent only gets it when KERNEL is on.
  if (flags.kernel()) return tools;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { verifyProducts, ...withoutVerify } = tools;
  return withoutVerify;
}
