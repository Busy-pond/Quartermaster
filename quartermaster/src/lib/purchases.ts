/**
 * Purchase service: proposal -> mandate decision -> PayPal order -> capture.
 *
 * The agent can only call proposePurchase(). Paying needs a human click on the
 * approval page (or, once vaulting is enabled, a job that re-checks the mandate).
 * The mandate is re-evaluated right before money moves, so a mandate that was
 * revoked or exhausted after the proposal still blocks the payment.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { evaluate, SPLIT_WINDOW_MS, type Decision, type Ledger, type Mandate, type ProposalLine } from "@/lib/mandates/engine";
import { captureIdOf, captureOrder, createOrder } from "@/lib/paypal/client";

type MandateRow = typeof schema.mandates.$inferSelect;
type PaymentRow = typeof schema.payments.$inferSelect;

export function toEngineMandate(m: MandateRow): Mandate {
  return {
    id: m.id,
    status: m.status,
    currency: m.currency,
    capCents: m.capCents,
    perItemAutoLimitCents: m.perItemAutoLimitCents,
    perOrderAutoLimitCents: m.perOrderAutoLimitCents,
    categories: m.categories,
    vendorAllowlist: m.vendorAllowlist,
    startsAt: m.startsAt ? m.startsAt.toISOString() : null,
    expiresAt: m.expiresAt.toISOString(),
    approverIds: m.approverIds,
  };
}

/** Money already spent or committed under a mandate (optionally ignoring one payment). */
export async function loadLedger(mandateId: string, now: Date, excludePaymentId?: string): Promise<Ledger> {
  const conds = [eq(schema.payments.mandateId, mandateId), inArray(schema.payments.status, ["captured", "approved"])];
  if (excludePaymentId) conds.push(ne(schema.payments.id, excludePaymentId));
  const rows = await db()
    .select()
    .from(schema.payments)
    .where(and(...conds))
    .orderBy(desc(schema.payments.createdAt));
  const windowStart = new Date(now.getTime() - SPLIT_WINDOW_MS);
  return {
    spentCents: rows.filter((r) => r.status === "captured").reduce((s, r) => s + r.totalCents, 0),
    committedCents: rows.filter((r) => r.status === "approved").reduce((s, r) => s + r.totalCents, 0),
    recent: rows
      .filter((r) => r.createdAt >= windowStart)
      .flatMap((r) => [...new Set(r.lines.map((l) => l.category))].map((category) => ({
        vendor: r.vendor,
        category,
        totalCents: r.totalCents,
        createdAt: r.createdAt.toISOString(),
      }))),
  };
}

export async function audit(e: {
  orgId: string;
  traceId: string;
  paymentId?: string | null;
  actor: "agent" | "human" | "webhook" | "system";
  type: string;
  message: string;
  payload?: unknown;
}) {
  await db().insert(schema.auditEvents).values({ ...e, paymentId: e.paymentId ?? null, payload: e.payload ?? null });
}

export async function getMandate(id: string) {
  return db().query.mandates.findFirst({ where: eq(schema.mandates.id, id) });
}

export interface ProposeInput {
  orgId: string;
  mandateId: string;
  requestId: string | null;
  traceId: string;
  vendor: string;
  currency: string;
  lines: ProposalLine[];
  rationale: string;
  optionsConsidered?: { title: string; vendor: string; priceCents: number; url?: string | null }[];
}

/** Runs the mandate engine without saving anything — the agent's dry run. */
export async function previewPurchase(input: Pick<ProposeInput, "orgId" | "mandateId" | "vendor" | "currency" | "lines">) {
  const mandateRow = await getMandate(input.mandateId);
  if (!mandateRow || mandateRow.orgId !== input.orgId) throw new Error(`Unknown mandate ${input.mandateId}`);
  const now = new Date();
  const totalCents = input.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const proposal = { vendor: input.vendor.trim().toLowerCase(), currency: input.currency, totalCents, lines: input.lines };
  const ledger = await loadLedger(mandateRow.id, now);
  const decision = evaluate(toEngineMandate(mandateRow), proposal, ledger, now);
  const remainingBeforeCents = mandateRow.capCents - ledger.spentCents - ledger.committedCents;
  return { mandateRow, proposal, totalCents, decision, remainingBeforeCents };
}

export async function proposePurchase(
  input: ProposeInput,
): Promise<{ payment: PaymentRow; decision: Decision; remainingBeforeCents: number; capCents: number }> {
  const { mandateRow, proposal, totalCents, decision, remainingBeforeCents } = await previewPurchase(input);

  const status = decision.outcome === "deny" ? "denied" : decision.outcome === "needs_approval" ? "needs_approval" : "approved";
  const [payment] = await db()
    .insert(schema.payments)
    .values({
      orgId: input.orgId,
      requestId: input.requestId,
      mandateId: mandateRow.id,
      vendor: proposal.vendor,
      currency: input.currency,
      totalCents,
      lines: input.lines,
      optionsConsidered: input.optionsConsidered ?? null,
      rationale: input.rationale,
      decision,
      status,
      traceId: input.traceId,
    })
    .returning();

  await audit({
    orgId: input.orgId,
    traceId: input.traceId,
    paymentId: payment.id,
    actor: "agent",
    type: "proposal.decided",
    message: `Mandate engine: ${decision.outcome} (${decision.clause}) — ${decision.message}`,
    payload: decision,
  });
  return { payment, decision, remainingBeforeCents, capCents: mandateRow.capCents };
}

export async function getPayment(id: string) {
  return db().query.payments.findFirst({ where: eq(schema.payments.id, id) });
}

/** Re-checks the mandate right before money moves. Human approval clears approval reasons, never denials. */
async function recheck(p: PaymentRow): Promise<Decision> {
  const m = await getMandate(p.mandateId);
  if (!m) throw new Error("Mandate disappeared");
  const now = new Date();
  return evaluate(
    toEngineMandate(m),
    { vendor: p.vendor, currency: p.currency, totalCents: p.totalCents, lines: p.lines },
    await loadLedger(m.id, now, p.id),
    now,
  );
}

async function payeeFor(orgId: string, vendor: string): Promise<string | null> {
  const v = await db().query.vendors.findFirst({ where: and(eq(schema.vendors.orgId, orgId), eq(schema.vendors.domain, vendor)) });
  return v?.payeeEmail ?? process.env.SANDBOX_PAYEE_EMAIL ?? null;
}

/** Called by the approval page's PayPal button (createOrder). */
export async function createOrderForPayment(paymentId: string, approverId: string) {
  const p = await getPayment(paymentId);
  if (!p) throw new Error("Payment not found");
  if (!["needs_approval", "approved"].includes(p.status)) throw new Error(`Payment is ${p.status}`);
  const m = await getMandate(p.mandateId);
  if (!m?.approverIds.includes(approverId)) throw new Error("You are not an approver on this mandate");

  const decision = await recheck(p);
  if (decision.outcome === "deny") {
    await db().update(schema.payments).set({ status: "denied", decision, updatedAt: new Date() }).where(eq(schema.payments.id, p.id));
    await audit({ orgId: p.orgId, traceId: p.traceId, paymentId: p.id, actor: "system", type: "payment.blocked", message: `Blocked at payment time: ${decision.clause} — ${decision.message}`, payload: decision });
    throw new Error(`Blocked by mandate ${decision.clause}: ${decision.message}`);
  }

  const order = await createOrder({
    currency: p.currency,
    items: p.lines.map((l) => ({ name: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents })),
    payeeEmail: await payeeFor(p.orgId, p.vendor),
    description: `Quartermaster purchase from ${p.vendor}`,
    customId: p.id,
    requestId: `order-${p.id}`,
  });
  await db().update(schema.payments).set({ paypalOrderId: order.id, updatedAt: new Date() }).where(eq(schema.payments.id, p.id));
  await audit({ orgId: p.orgId, traceId: p.traceId, paymentId: p.id, actor: "human", type: "paypal.order.created", message: `PayPal order ${order.id} created`, payload: { orderId: order.id } });
  return order;
}

/** Called after the approver approves in the PayPal popup (onApprove). */
export async function capturePayment(paymentId: string, orderId: string, approverId: string) {
  const p = await getPayment(paymentId);
  if (!p) throw new Error("Payment not found");
  if (p.paypalOrderId !== orderId) throw new Error("Order does not belong to this payment");
  if (p.status === "captured") return p; // idempotent

  const decision = await recheck(p);
  if (decision.outcome === "deny") throw new Error(`Blocked by mandate ${decision.clause}: ${decision.message}`);

  const order = await captureOrder(orderId, `capture-${p.id}`);
  const captureId = captureIdOf(order);
  const ok = order.status === "COMPLETED";
  const [updated] = await db()
    .update(schema.payments)
    .set({
      status: ok ? "captured" : "failed",
      paypalCaptureId: captureId,
      approvedBy: approverId,
      approvedAt: new Date(),
      capturedAt: ok ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.payments.id, p.id))
    .returning();
  await audit({
    orgId: p.orgId,
    traceId: p.traceId,
    paymentId: p.id,
    actor: "human",
    type: ok ? "payment.captured" : "payment.failed",
    message: ok ? `Captured ${captureId}` : `Capture returned ${order.status}`,
    payload: { orderId, captureId, status: order.status },
  });
  return updated;
}

/** Mandate usage for dashboards and the agent. */
export async function mandateUsage(m: MandateRow) {
  const ledger = await loadLedger(m.id, new Date());
  return {
    spentCents: ledger.spentCents,
    committedCents: ledger.committedCents,
    remainingCents: m.capCents - ledger.spentCents - ledger.committedCents,
  };
}

export async function recentAudit(traceId: string) {
  return db().select().from(schema.auditEvents).where(eq(schema.auditEvents.traceId, traceId)).orderBy(schema.auditEvents.createdAt);
}

