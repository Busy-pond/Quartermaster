/**
 * Loads the treasurer dashboard's figures for one org. Shared by /treasurer (both the
 * AG Grid Community page and the AG Studio one) and GET /api/treasurer/insights, so a
 * figure the Studio agent quotes is the figure on screen.
 */
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ReimbursementStatus } from "@/lib/db/schema";
import { envelopes, exceptionsOverTime, spendByCategory, type Envelope, type LedgerRow } from "./aggregate";
import { awaitsTreasurer, type DecidedRow } from "./insights";

export interface PaymentGridRow {
  id: string;
  date: string;
  items: string;
  vendor: string;
  mandateId: string;
  mandate: string;
  amountCents: number;
  currency: string;
  status: string;
  clause: string;
  orderId: string | null;
  captureId: string | null;
}

export interface ReimbursementGridRow {
  id: string;
  date: string;
  volunteer: string;
  merchant: string;
  receiptDate: string | null;
  mandateId: string | null;
  mandate: string;
  amountCents: number;
  currency: string;
  status: ReimbursementStatus;
  note: string | null;
}

export interface DashboardData {
  envelopes: Envelope[];
  payments: PaymentGridRow[];
  reimbursements: ReimbursementGridRow[];
  byCategory: { category: string; spentCents: number; committedCents: number }[];
  exceptions: { day: string; blocked: number; refunded: number; refundedCents: number }[];
  decided: DecidedRow[];
  /** Purchases and receipts waiting on the treasurer (awaitsTreasurer), counted once for every view. */
  awaitingTreasurer: number;
}

export async function loadDashboard(orgId: string, now = new Date()): Promise<DashboardData> {
  const [mandates, events, payments, reimbursements, members] = await Promise.all([
    db().query.mandates.findMany({ where: eq(schema.mandates.orgId, orgId) }),
    db().query.events.findMany({ where: eq(schema.events.orgId, orgId) }),
    db().select().from(schema.payments).where(eq(schema.payments.orgId, orgId)).orderBy(desc(schema.payments.createdAt)).limit(500),
    db()
      .select({
        id: schema.reimbursements.id,
        memberId: schema.reimbursements.memberId,
        mandateId: schema.reimbursements.mandateId,
        merchant: schema.reimbursements.merchant,
        receiptDate: schema.reimbursements.receiptDate,
        totalCents: schema.reimbursements.totalCents,
        currency: schema.reimbursements.currency,
        status: schema.reimbursements.status,
        lines: schema.reimbursements.lines,
        decision: schema.reimbursements.decision,
        duplicateOf: schema.reimbursements.duplicateOf,
        rejectedReason: schema.reimbursements.rejectedReason,
        createdAt: schema.reimbursements.createdAt,
      })
      .from(schema.reimbursements)
      .where(eq(schema.reimbursements.orgId, orgId))
      .orderBy(desc(schema.reimbursements.createdAt))
      .limit(500),
    db().query.members.findMany({ where: eq(schema.members.orgId, orgId) }),
  ]);
  // Dues and sponsor money raise a budget on top of the cap the treasurer signed (Day 13).
  const fundingRows = await db()
    .select({ mandateId: schema.funding.mandateId, total: sql<number>`sum(${schema.funding.amountCents})::int` })
    .from(schema.funding)
    .where(eq(schema.funding.orgId, orgId))
    .groupBy(schema.funding.mandateId);
  const fundedOf = (id: string) => Number(fundingRows.find((f) => f.mandateId === id)?.total ?? 0);

  const ledger: LedgerRow[] = [
    ...payments.map((p) => ({ kind: "purchase" as const, mandateId: p.mandateId, status: p.status, totalCents: p.totalCents, lines: p.lines, createdAt: p.createdAt })),
    ...reimbursements.map((r) => ({ kind: "reimbursement" as const, mandateId: r.mandateId, status: r.status, totalCents: r.totalCents ?? 0, lines: r.lines ?? [], createdAt: r.createdAt })),
  ];
  const eventOf = (id: string | null) => events.find((e) => e.id === id)?.name ?? null;
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "A volunteer";
  const titleOf = (id: string | null) => mandates.find((m) => m.id === id)?.title ?? "—";
  const itemsOf = (lines: { quantity: number; description: string }[]) => lines.map((l) => `${l.quantity}× ${l.description}`).join(", ");

  const decided: DecidedRow[] = [
    ...payments.map((p) => ({ kind: "purchase" as const, id: p.id, mandateId: p.mandateId, mandate: titleOf(p.mandateId), label: itemsOf(p.lines), status: p.status, totalCents: p.totalCents, decision: p.decision, createdAt: p.createdAt })),
    ...reimbursements.map((r) => ({ kind: "reimbursement" as const, id: r.id, mandateId: r.mandateId, mandate: titleOf(r.mandateId), label: r.merchant ?? "Receipt", status: r.status, totalCents: r.totalCents ?? 0, decision: r.decision, createdAt: r.createdAt })),
  ];

  return {
    envelopes: envelopes(
      mandates.map((m) => ({ id: m.id, title: m.title, capCents: m.capCents + fundedOf(m.id), event: eventOf(m.eventId) })),
      ledger,
    ),
    payments: payments.map((p) => ({
      id: p.id,
      date: p.createdAt.toISOString(),
      items: itemsOf(p.lines),
      vendor: p.vendor,
      mandateId: p.mandateId,
      mandate: titleOf(p.mandateId),
      amountCents: p.totalCents,
      currency: p.currency,
      status: p.status,
      clause: p.decision.clause,
      orderId: p.paypalOrderId,
      captureId: p.paypalCaptureId,
    })),
    reimbursements: reimbursements.map((r) => ({
      id: r.id,
      date: r.createdAt.toISOString(),
      volunteer: nameOf(r.memberId),
      merchant: r.merchant ?? "Receipt",
      receiptDate: r.receiptDate,
      mandateId: r.mandateId,
      mandate: titleOf(r.mandateId),
      amountCents: r.totalCents ?? 0,
      currency: r.currency ?? "USD",
      status: r.status,
      note: r.status === "rejected" ? r.rejectedReason : r.duplicateOf ? "Possible duplicate" : null,
    })),
    byCategory: spendByCategory(ledger),
    exceptions: exceptionsOverTime(ledger, now, 14),
    decided,
    awaitingTreasurer: decided.filter(awaitsTreasurer).length,
  };
}
