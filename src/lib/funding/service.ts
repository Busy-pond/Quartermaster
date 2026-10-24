/**
 * Money in and refunds (Day 13).
 *
 * - Dues: a PayPal catalog product + monthly plan; members subscribe on /join.
 *   Each completed sale is credited to the standing Operations budget.
 * - Sponsor invoices: the agent DRAFTS; only the treasurer can send (it asks
 *   someone for money). A paid invoice is credited to the budget it names.
 * - Refunds: treasurer-only, idempotent, from a paid trust receipt.
 *
 * Every credit is keyed by PayPal's transaction id (unique), so the webhook and
 * the polling fallback can both deliver it and it still counts once.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { money } from "@/lib/format";
import { audit, getMandate, getPayment } from "@/lib/purchases";
import { assertApprover } from "@/lib/auth/roles";
import {
  createCatalogProduct,
  createInvoiceDraft,
  createMonthlyPlan,
  getInvoice,
  getSubscription,
  listSubscriptionTransactions,
  refundCapture,
  sendInvoice,
} from "@/lib/paypal/client";
import { invoiceCredit, transactionCredit, type Credit } from "./events";

type MemberRow = typeof schema.members.$inferSelect;
type MandateRow = typeof schema.mandates.$inferSelect;
type InvoiceRow = typeof schema.invoices.$inferSelect;

export const DEFAULT_DUES_CENTS = 1000; // $10 a month

// ---------------------------------------------------------------- budgets and credits

/** The standing operations budget (policy 1.1): the active mandate not tied to an event. */
export async function operationsMandate(orgId: string): Promise<MandateRow | undefined> {
  return db().query.mandates.findFirst({ where: and(eq(schema.mandates.orgId, orgId), eq(schema.mandates.status, "active"), isNull(schema.mandates.eventId)) });
}

/** Creates the Operations mandate if the org has none (for databases seeded before Day 13). */
export async function ensureOperationsMandate(orgId: string): Promise<MandateRow> {
  const existing = await operationsMandate(orgId);
  if (existing) return existing;
  const treasurer = await db().query.members.findFirst({ where: and(eq(schema.members.orgId, orgId), eq(schema.members.role, "treasurer")) });
  if (!treasurer) throw new Error("The org has no treasurer to sign the Operations mandate");
  const [m] = await db()
    .insert(schema.mandates)
    .values({
      orgId,
      eventId: null,
      title: "Operations — standing budget",
      status: "active",
      currency: "USD",
      capCents: 10000,
      perItemAutoLimitCents: 5000,
      perOrderAutoLimitCents: 10000,
      categories: ["supplies", "safety", "food", "printing", "transport"],
      vendorAllowlist: [],
      startsAt: new Date("2026-10-01T00:00:00Z"),
      expiresAt: new Date("2027-06-30T00:00:00Z"),
      approverIds: [treasurer.id],
      signedBy: treasurer.id,
      signedAt: new Date(),
    })
    .returning();
  return m;
}

/** Credits money in, once per PayPal id. Returns true only the first time. */
export async function credit(args: { orgId: string; mandateId: string; source: "dues" | "invoice"; credit: Credit; note: string; actor: "webhook" | "system" }) {
  const inserted = await db()
    .insert(schema.funding)
    .values({ orgId: args.orgId, mandateId: args.mandateId, source: args.source, paypalId: args.credit.paypalId, reference: args.credit.reference, amountCents: args.credit.amountCents, currency: args.credit.currency, note: args.note })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return false;
  await audit({
    orgId: args.orgId,
    traceId: `funding-${args.mandateId}`,
    paymentId: inserted[0].id,
    actor: args.actor,
    type: `funding.${args.source}`,
    message: `${money(args.credit.amountCents, args.credit.currency)} ${args.note}`,
    payload: args.credit,
  });
  return true;
}

// ---------------------------------------------------------------- dues (Subscriptions)

const duesKey = (orgId: string) => `paypal:dues:${orgId}`;

export interface DuesPlan {
  productId: string;
  planId: string;
  amountCents: number;
  currency: string;
}

export async function duesPlan(orgId: string): Promise<DuesPlan | null> {
  const row = await db().query.apiCache.findFirst({ where: eq(schema.apiCache.key, duesKey(orgId)) });
  return (row?.value as DuesPlan | undefined) ?? null;
}

/** One-time setup (npm run setup:dues): PayPal product + monthly plan, and the Operations budget they fund. */
export async function setupDues(orgId: string, amountCents = DEFAULT_DUES_CENTS): Promise<DuesPlan> {
  await ensureOperationsMandate(orgId);
  const existing = await duesPlan(orgId);
  if (existing) return existing;
  const org = await db().query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) });
  const product = await createCatalogProduct({ name: `${org?.name ?? "Team"} membership`, description: "Monthly member dues; they fund the standing operations budget.", requestId: `dues-product-${orgId}` });
  const plan = await createMonthlyPlan({ productId: product.id, name: "Member dues (monthly)", amountCents, currency: "USD", requestId: `dues-plan-${orgId}-${amountCents}` });
  const value: DuesPlan = { productId: product.id, planId: plan.id, amountCents, currency: "USD" };
  await db().insert(schema.apiCache).values({ key: duesKey(orgId), value }).onConflictDoUpdate({ target: schema.apiCache.key, set: { value } });
  return value;
}

/** After the member approves in PayPal: check with PayPal (never trust the browser), store, then pick up any payment. */
export async function recordSubscription(member: MemberRow, subscriptionId: string) {
  const plan = await duesPlan(member.orgId);
  if (!plan) throw new Error("Dues aren't set up yet — run npm run setup:dues");
  const sub = await getSubscription(subscriptionId);
  if (sub.plan_id !== plan.planId) throw new Error("That subscription isn't for this team's dues plan");
  if (!["APPROVED", "ACTIVE"].includes(sub.status)) throw new Error(`The subscription is ${sub.status}`);
  await db()
    .insert(schema.subscriptions)
    .values({ id: sub.id, orgId: member.orgId, memberId: member.id, planId: sub.plan_id, status: sub.status })
    .onConflictDoUpdate({ target: schema.subscriptions.id, set: { status: sub.status, updatedAt: new Date() } });
  await audit({ orgId: member.orgId, traceId: `subscription-${sub.id}`, actor: "human", type: "subscription.recorded", message: `${member.name} subscribed to member dues (${sub.status})`, payload: { subscriptionId: sub.id } });
  return { status: sub.status, credited: await syncSubscription(sub.id) };
}

/** Polling fallback for PAYMENT.SALE.COMPLETED: credits completed dues payments of the last 35 days. */
export async function syncSubscription(subscriptionId: string): Promise<number> {
  const row = await db().query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, subscriptionId) });
  if (!row) return 0;
  const ops = await ensureOperationsMandate(row.orgId);
  const now = new Date();
  const { transactions = [] } = await listSubscriptionTransactions(subscriptionId, new Date(now.getTime() - 35 * 86_400_000), now);
  let added = 0;
  for (const t of transactions) {
    const c = transactionCredit(subscriptionId, t);
    if (c && (await credit({ orgId: row.orgId, mandateId: ops.id, source: "dues", credit: c, note: "member dues, credited to the Operations budget", actor: "system" }))) added++;
  }
  return added;
}

export async function setSubscriptionStatus(subscriptionId: string, status: string) {
  await db().update(schema.subscriptions).set({ status, updatedAt: new Date() }).where(eq(schema.subscriptions.id, subscriptionId));
}

export async function creditSale(c: Credit, actor: "webhook" | "system") {
  const sub = c.reference ? await db().query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, c.reference) }) : undefined;
  if (!sub) return false;
  const ops = await ensureOperationsMandate(sub.orgId);
  return credit({ orgId: sub.orgId, mandateId: ops.id, source: "dues", credit: c, note: "member dues, credited to the Operations budget", actor });
}

// ---------------------------------------------------------------- sponsor invoices (Invoicing)

/** The agent's tool calls this. It only creates a DRAFT; nothing is sent. */
export async function draftSponsorInvoice(args: { orgId: string; createdBy: string; traceId: string; sponsorEmail: string; sponsorName?: string | null; amountCents: number; note: string; mandateId?: string | null }) {
  const mandate = args.mandateId ? await getMandate(args.mandateId) : await ensureOperationsMandate(args.orgId);
  if (!mandate || mandate.orgId !== args.orgId) throw new Error("Unknown budget for this invoice");
  const [row] = await db()
    .insert(schema.invoices)
    .values({ orgId: args.orgId, mandateId: mandate.id, sponsorEmail: args.sponsorEmail, sponsorName: args.sponsorName ?? null, amountCents: args.amountCents, currency: mandate.currency, note: args.note, status: "CREATING", createdBy: args.createdBy, traceId: args.traceId })
    .returning();
  try {
    const inv = await createInvoiceDraft({ sponsorEmail: args.sponsorEmail, sponsorName: args.sponsorName, amountCents: args.amountCents, currency: mandate.currency, note: args.note, reference: `Quartermaster ${row.id}`, requestId: `invoice-${row.id}` });
    const [updated] = await db().update(schema.invoices).set({ paypalInvoiceId: inv.id, status: inv.status, updatedAt: new Date() }).where(eq(schema.invoices.id, row.id)).returning();
    await audit({ orgId: args.orgId, traceId: args.traceId, paymentId: row.id, actor: "agent", type: "invoice.drafted", message: `Drafted a ${money(args.amountCents, mandate.currency)} sponsor invoice to ${args.sponsorEmail} (PayPal ${inv.id}); waiting for the treasurer to send it`, payload: { invoiceId: inv.id } });
    return { row: updated, mandate };
  } catch (e) {
    await db().update(schema.invoices).set({ status: "FAILED", updatedAt: new Date() }).where(eq(schema.invoices.id, row.id));
    throw e;
  }
}

async function requireTreasurer(orgId: string, mandateId: string, member: MemberRow) {
  const m = await getMandate(mandateId);
  assertApprover(m && m.orgId === orgId ? m : null, member);
}

/** The treasurer's click: this is what actually asks the sponsor for money. */
export async function sendSponsorInvoice(id: string, member: MemberRow): Promise<InvoiceRow> {
  const row = await db().query.invoices.findFirst({ where: eq(schema.invoices.id, id) });
  if (!row?.paypalInvoiceId) throw new Error("Invoice not found");
  await requireTreasurer(row.orgId, row.mandateId, member);
  if (row.status !== "DRAFT") return row;
  await sendInvoice(row.paypalInvoiceId, `invoice-send-${row.id}`);
  const inv = await getInvoice(row.paypalInvoiceId);
  const [updated] = await db()
    .update(schema.invoices)
    .set({ status: inv.status, recipientUrl: inv.detail?.metadata?.recipient_view_url ?? null, sentBy: member.id, sentAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.invoices.id, row.id))
    .returning();
  await audit({ orgId: row.orgId, traceId: row.traceId, paymentId: row.id, actor: "human", type: "invoice.sent", message: `${member.name} sent the ${money(row.amountCents, row.currency)} invoice to ${row.sponsorEmail}` });
  return updated;
}

/** Webhook (INVOICING.INVOICE.*) and the invoice page's "check status" both end here. */
export async function syncInvoice(paypalInvoiceId: string, actor: "webhook" | "system"): Promise<InvoiceRow | null> {
  const row = await db().query.invoices.findFirst({ where: eq(schema.invoices.paypalInvoiceId, paypalInvoiceId) });
  if (!row) return null;
  const inv = await getInvoice(paypalInvoiceId);
  const c = invoiceCredit(inv);
  if (c) await credit({ orgId: row.orgId, mandateId: row.mandateId, source: "invoice", credit: c, note: `sponsorship from ${row.sponsorName ?? row.sponsorEmail} (invoice paid)`, actor });
  if (inv.status === row.status) return row;
  const [updated] = await db().update(schema.invoices).set({ status: inv.status, updatedAt: new Date() }).where(eq(schema.invoices.id, row.id)).returning();
  return updated;
}

// ---------------------------------------------------------------- refunds

/** Treasurer-only refund of a captured purchase. The idempotency key makes a double click harmless. */
export async function refundPayment(paymentId: string, member: MemberRow, reason: string) {
  const p = await getPayment(paymentId);
  if (!p) throw new Error("Payment not found");
  await requireTreasurer(p.orgId, p.mandateId, member);
  if (p.status === "refunded") return { status: "refunded" as const, refundId: null };
  if (p.status !== "captured" || !p.paypalCaptureId) throw new Error(`Only paid purchases can be refunded (this one is ${p.status})`);
  const note = reason.trim().slice(0, 200) || "Refunded by the treasurer";
  const r = await refundCapture(p.paypalCaptureId, `refund-${p.id}`, note);
  if (r.status === "COMPLETED" || r.status === "PENDING") {
    await db().update(schema.payments).set({ status: "refunded", updatedAt: new Date() }).where(eq(schema.payments.id, p.id));
  }
  await audit({ orgId: p.orgId, traceId: p.traceId, paymentId: p.id, actor: "human", type: "payment.refund_requested", message: `${member.name} refunded ${money(p.totalCents, p.currency)}: ${note} (PayPal refund ${r.id}, ${r.status})`, payload: r });
  return { status: r.status, refundId: r.id };
}
