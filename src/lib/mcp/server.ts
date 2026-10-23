/**
 * Quartermaster as an MCP server (Day 14): any outside AI agent can search,
 * dry-run and REQUEST purchases, read trust receipts and submit receipts, and
 * stays governed by the same mandate engine. Nothing here can pay.
 *
 * The purchase tools call the chat agent's own tool implementations
 * (buildTools), so the rules, price lookups and audit trail are identical.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db, schema } from "@/lib/db";
import { buildTools, mandateSummaries } from "@/lib/agent/tools";
import { getPayment, getMandate, recentAudit } from "@/lib/purchases";
import { submitReimbursement } from "@/lib/reimbursements/service";
import { search } from "@/lib/integrations/search";

export interface McpContext {
  orgId: string;
  keyId: string;
  keyName: string;
  agentMemberId: string; // the "External agent" member this key acts as
  appUrl: string;
}

type Json = Record<string, unknown>;
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
const CALL = { toolCallId: "mcp", messages: [] };

/** One purchase request groups an agent's searches and proposals, like one chat does. */
async function requestFor(ctx: McpContext, requestId: string | undefined, text: string) {
  if (requestId) {
    const r = await db().query.purchaseRequests.findFirst({ where: and(eq(schema.purchaseRequests.id, requestId), eq(schema.purchaseRequests.orgId, ctx.orgId)) });
    if (!r) throw new Error("Unknown requestId — start with search_products, which returns one");
    return r;
  }
  const [r] = await db()
    .insert(schema.purchaseRequests)
    .values({ orgId: ctx.orgId, memberId: ctx.agentMemberId, text: `[${ctx.keyName} via MCP] ${text}`.slice(0, 2000) })
    .returning();
  return r;
}

const agentTools = (ctx: McpContext, r: { id: string; traceId: string }) =>
  buildTools({ orgId: ctx.orgId, memberId: ctx.agentMemberId, requestId: r.id, traceId: r.traceId, appUrl: ctx.appUrl });

const OrderItems = z
  .array(
    z.object({
      optionId: z.string().describe("optionId from search_products"),
      listings: z.number().int().positive().describe("how many LISTINGS to buy (a 'pack of 24' counts as 1)"),
      category: z.string().describe("one of the mandate's categories"),
    }),
  )
  .min(1);

export function buildMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: "quartermaster", version: "1.0.0" }, { instructions: "Purchasing for a volunteer team, inside spending mandates a treasurer signed. You can search, dry-run and REQUEST purchases; you cannot pay. Start with list_mandates." });

  server.registerTool(
    "list_mandates",
    { title: "List spending mandates", description: "The team's active spending mandates: budget left, auto-approve limits, allowed categories, expiry.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => ok(await mandateSummaries(ctx.orgId)),
  );

  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description: "Search retailers for one product type. Returns options with optionIds and price per unit, plus a requestId: pass it to check_purchase and request_purchase.",
      inputSchema: { query: z.string().min(2), maxListingPriceDollars: z.number().positive().optional(), requestId: z.string().optional().describe("reuse to group several searches into one request") },
    },
    async ({ query, maxListingPriceDollars, requestId }) => {
      const r = await requestFor(ctx, requestId, query);
      const out = (await agentTools(ctx, r).searchProducts.execute!({ query, maxListingPriceDollars }, CALL)) as Json;
      return ok({ requestId: r.id, ...out });
    },
  );

  server.registerTool(
    "check_purchase",
    {
      title: "Dry-run a purchase",
      description: "Checks an order against the mandate without saving anything (allow / needs_approval / deny, with the rule). Items must come from ONE vendor.",
      inputSchema: { requestId: z.string(), mandateId: z.string(), items: OrderItems, requesterBudgetDollars: z.number().positive().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ requestId, mandateId, items, requesterBudgetDollars }) => {
      const r = await requestFor(ctx, requestId, "");
      return ok(await agentTools(ctx, r).checkPurchase.execute!({ mandateId, items, requesterBudgetDollars }, CALL));
    },
  );

  server.registerTool(
    "request_purchase",
    {
      title: "Request a purchase",
      description:
        "Records a purchase proposal from ONE vendor. The mandate engine decides: allow (pre-approved, a person still clicks pay), needs_approval (the treasurer is notified) or deny (blocked, recorded). This never pays.",
      inputSchema: { requestId: z.string(), mandateId: z.string(), items: OrderItems, consideredOptionIds: z.array(z.string()), rationale: z.string().min(5).max(600) },
    },
    async ({ requestId, mandateId, items, consideredOptionIds, rationale }) => {
      const r = await requestFor(ctx, requestId, "");
      return ok(await agentTools(ctx, r).proposePurchase.execute!({ mandateId, items, consideredOptionIds, rationale: `${rationale} (requested by ${ctx.keyName} via MCP)` }, CALL));
    },
  );

  server.registerTool(
    "search_policy",
    { title: "Search the spending policy", description: "Returns the most relevant numbered policy clauses for a question.", inputSchema: { query: z.string().min(3) }, annotations: { readOnlyHint: true } },
    async ({ query }) => ok(await search().searchPolicy(ctx.orgId, query, 3)),
  );

  server.registerTool(
    "get_trust_receipt",
    { title: "Get a trust receipt", description: "What was asked, the options compared, the mandate rules applied, PayPal ids and the timeline for one payment.", inputSchema: { paymentId: z.string() }, annotations: { readOnlyHint: true } },
    async ({ paymentId }) => {
      const p = await getPayment(paymentId);
      if (!p || p.orgId !== ctx.orgId) return fail("No payment with that id in this team");
      const [mandate, timeline] = await Promise.all([getMandate(p.mandateId), recentAudit(p.traceId)]);
      return ok({
        paymentId: p.id,
        status: p.status,
        vendor: p.vendor,
        totalDollars: p.totalCents / 100,
        mandate: mandate?.title,
        decision: { outcome: p.decision.outcome, clause: p.decision.clause, message: p.decision.message, reasons: p.decision.reasons },
        lines: p.lines,
        optionsConsidered: p.optionsConsidered?.map((o) => ({ title: o.title, vendor: o.vendor, priceDollars: o.priceCents / 100 })),
        paypal: { orderId: p.paypalOrderId, captureId: p.paypalCaptureId },
        timeline: timeline.filter((e) => !e.paymentId || e.paymentId === p.id).map((e) => ({ at: e.createdAt, actor: e.actor, message: e.message })),
        receiptUrl: `${ctx.appUrl}/receipts/${p.id}`,
      });
    },
  );

  server.registerTool(
    "submit_reimbursement",
    {
      title: "Submit a receipt for reimbursement",
      description: "Submits a receipt photo on behalf of a volunteer. Gemini reads it; duplicate and mandate checks run; the treasurer approves before PayPal pays the volunteer.",
      inputSchema: {
        volunteerEmail: z.string().email().describe("the volunteer who paid, as registered in the team"),
        mandateId: z.string(),
        imageBase64: z.string().min(100).describe("the receipt photo, base64 (no data: prefix)"),
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        note: z.string().max(500).optional(),
      },
    },
    async ({ volunteerEmail, mandateId, imageBase64, mediaType, note }) => {
      const volunteer = await db().query.members.findFirst({ where: and(eq(schema.members.orgId, ctx.orgId), eq(schema.members.email, volunteerEmail.toLowerCase())) });
      if (!volunteer) return fail("No volunteer with that email in this team");
      const row = await submitReimbursement({ member: volunteer, mandateId, imageDataUrl: `data:${mediaType};base64,${imageBase64}`, note: `${note ?? ""} (submitted by ${ctx.keyName} via MCP)`.trim() });
      return ok({ reimbursementId: row.id, status: row.status, rejectedReason: row.rejectedReason, reviewUrl: `${ctx.appUrl}/reimbursements/${row.id}` });
    },
  );

  return server;
}
