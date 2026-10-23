import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentMember, demoOrg } from "@/lib/session";
import { envelopes, exceptionsOverTime, spendByCategory, type LedgerRow } from "@/lib/dashboard/aggregate";
import { TreasurerDashboard, type PaymentGridRow, type ReimbursementGridRow } from "@/components/treasurer-dashboard";

export const dynamic = "force-dynamic";

/** Day 12: the treasurer's dashboard on AG Grid Community + AG Charts Community. Stays as the fallback once AG Studio arrives. */
export default async function TreasurerPage() {
  const org = await demoOrg();
  if (!org) return <p className="text-muted">Demo org not found — run <code>npm run db:seed</code>.</p>;
  const me = await currentMember();

  const [mandates, events, payments, reimbursements, members] = await Promise.all([
    db().query.mandates.findMany({ where: eq(schema.mandates.orgId, org.id) }),
    db().query.events.findMany({ where: eq(schema.events.orgId, org.id) }),
    db().select().from(schema.payments).where(eq(schema.payments.orgId, org.id)).orderBy(desc(schema.payments.createdAt)).limit(500),
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
        duplicateOf: schema.reimbursements.duplicateOf,
        rejectedReason: schema.reimbursements.rejectedReason,
        createdAt: schema.reimbursements.createdAt,
      })
      .from(schema.reimbursements)
      .where(eq(schema.reimbursements.orgId, org.id))
      .orderBy(desc(schema.reimbursements.createdAt))
      .limit(500),
    db().query.members.findMany({ where: eq(schema.members.orgId, org.id) }),
  ]);
  // Dues and sponsor money raise a budget on top of the cap the treasurer signed (Day 13).
  const fundingRows = await db()
    .select({ mandateId: schema.funding.mandateId, total: sql<number>`sum(${schema.funding.amountCents})::int` })
    .from(schema.funding)
    .where(eq(schema.funding.orgId, org.id))
    .groupBy(schema.funding.mandateId);
  const fundedOf = (id: string) => Number(fundingRows.find((f) => f.mandateId === id)?.total ?? 0);

  const ledger: LedgerRow[] = [
    ...payments.map((p) => ({ kind: "purchase" as const, mandateId: p.mandateId, status: p.status, totalCents: p.totalCents, lines: p.lines, createdAt: p.createdAt })),
    ...reimbursements.map((r) => ({ kind: "reimbursement" as const, mandateId: r.mandateId, status: r.status, totalCents: r.totalCents ?? 0, lines: r.lines ?? [], createdAt: r.createdAt })),
  ];
  const eventOf = (id: string | null) => events.find((e) => e.id === id)?.name ?? null;
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "A volunteer";
  const titleOf = (id: string | null) => mandates.find((m) => m.id === id)?.title ?? "—";

  const paymentRows: PaymentGridRow[] = payments.map((p) => ({
    id: p.id,
    date: p.createdAt.toISOString(),
    items: p.lines.map((l) => `${l.quantity}× ${l.description}`).join(", "),
    vendor: p.vendor,
    mandate: titleOf(p.mandateId),
    amountCents: p.totalCents,
    currency: p.currency,
    status: p.status,
    clause: p.decision.clause,
    orderId: p.paypalOrderId,
    captureId: p.paypalCaptureId,
  }));
  const reimbursementRows: ReimbursementGridRow[] = reimbursements.map((r) => ({
    id: r.id,
    date: r.createdAt.toISOString(),
    volunteer: nameOf(r.memberId),
    merchant: r.merchant ?? "Receipt",
    receiptDate: r.receiptDate,
    mandate: titleOf(r.mandateId),
    amountCents: r.totalCents ?? 0,
    currency: r.currency ?? "USD",
    status: r.status,
    note: r.status === "rejected" ? r.rejectedReason : r.duplicateOf ? "Possible duplicate" : null,
  }));

  return (
    <TreasurerDashboard
      orgName={org.name}
      isTreasurer={me?.role === "treasurer"}
      envelopes={envelopes(
        mandates.map((m) => ({ id: m.id, title: m.title, capCents: m.capCents + fundedOf(m.id), event: eventOf(m.eventId) })),
        ledger,
      )}
      payments={paymentRows}
      reimbursements={reimbursementRows}
      byCategory={spendByCategory(ledger)}
      exceptions={exceptionsOverTime(ledger, new Date(), 14)}
    />
  );
}
