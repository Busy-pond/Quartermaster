import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentMember } from "@/lib/session";
import { getMandate, mandateUsage, recentAudit } from "@/lib/purchases";
import { getReimbursement, payeeFor } from "@/lib/reimbursements/service";
import { REIMBURSEMENT_STATUS, reimbursementStamp } from "@/lib/reimbursements/labels";
import { RECEIPT_CHECKS, type CheckState } from "@/lib/reimbursements/receipt";
import { dateTime, money } from "@/lib/format";
import { DecisionPanel } from "@/components/decision";
import { BudgetBar } from "@/components/budget-bar";
import { Stamp } from "@/components/stamp";
import { RoleButton } from "@/components/role-switch";
import { ReimbursementActions } from "@/components/reimbursement-actions";

export const dynamic = "force-dynamic";

const ACTOR: Record<string, string> = { agent: "Gemini", human: "Person", webhook: "PayPal", system: "System" };

function CheckMark({ state }: { state: CheckState }) {
  const color = state === "pass" ? "var(--color-ok)" : state === "fail" ? "var(--color-bad)" : "var(--color-warn)";
  return (
    <svg className="mt-px shrink-0" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="8" fill="none" stroke={color} strokeOpacity="0.25" />
      {state === "pass" && <path d="M5 9.5l2.6 2.5L13 6.5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {state === "fail" && <path d="M6 6l6 6M12 6l-6 6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />}
      {state === "warn" && <path d="M9 5v5M9 12.8v.2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

export default async function ReimbursementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [r, me] = await Promise.all([getReimbursement(id), currentMember()]);
  if (!r) notFound();
  const [mandate, member, timeline] = await Promise.all([
    r.mandateId ? getMandate(r.mandateId) : undefined,
    db().query.members.findFirst({ where: eq(schema.members.id, r.memberId) }),
    recentAudit(r.traceId),
  ]);
  const approver = r.approvedBy ? await db().query.members.findFirst({ where: eq(schema.members.id, r.approvedBy) }) : null;
  const usage = mandate ? await mandateUsage(mandate) : null;
  const isApprover = !!me && !!mandate?.approverIds.includes(me.id);
  const status = REIMBURSEMENT_STATUS[r.status];
  const stamp = reimbursementStamp(r.status);
  const currency = r.currency ?? "USD";
  const amount = money(r.totalCents ?? 0, currency);
  const payee = (member && payeeFor(member)) || r.payeeEmail || null;  const receipt = r.extracted;
  const waiting = r.status === "needs_approval";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Reimbursement</p>
          <h1 className="mt-1 text-4xl font-bold tabular-nums">{amount}</h1>
          <p className="mt-1 text-muted">
            For {member?.name ?? "a volunteer"}, receipt from {r.merchant || "an unknown merchant"}
            {mandate && <>, under “{mandate.title}”</>}
          </p>
        </div>
        {stamp ? <Stamp kind={stamp} size="lg" className="mt-2 shrink-0" /> : <span className={`rounded-full px-3 py-1 text-sm font-medium ${status.cls}`}>{status.label}</span>}
      </div>

      {r.status === "rejected" && r.rejectedReason && (
        <p className="card border-bad/30! bg-bad-soft p-4 text-sm text-bad">
          <span className="font-medium">Rejected.</span> {r.rejectedReason}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="card p-4">
          <p className="label mb-3">The photo</p>
          {r.receiptImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.receiptImage} alt={`Receipt from ${r.merchant ?? "a store"}`} className="max-h-[560px] w-full rounded-md bg-paper object-contain" />
          ) : (
            <p className="text-sm text-muted">No photo.</p>
          )}
        </section>

        <section className="card p-5">
          <p className="label">{receipt?.source === "manual" ? "Details typed in by the volunteer" : "What Gemini read"}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Store</dt>
            <dd>{r.merchant || "—"}</dd>
            <dt className="text-muted">Date</dt>
            <dd>{r.receiptDate ?? "—"}</dd>
            <dt className="text-muted">Total</dt>
            <dd className="amount font-medium">{amount}</dd>
            {receipt?.taxCents != null && (
              <>
                <dt className="text-muted">Tax</dt>
                <dd className="amount">{money(receipt.taxCents, currency)}</dd>
              </>
            )}
            {receipt?.source === "gemini" && (
              <>
                <dt className="text-muted">Confidence</dt>
                <dd>{receipt.confidence}</dd>
              </>
            )}
          </dl>
          {receipt && receipt.items.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <tbody>
                {receipt.items.map((i, n) => (
                  <tr key={n} className="border-t border-line">
                    <td className="py-1.5 pr-2">
                      {i.quantity > 1 && <span className="text-muted">{i.quantity}× </span>}
                      {i.description}
                    </td>
                    <td className="py-1.5 text-muted">{i.category}</td>
                    <td className="amount py-1.5 text-right">{money(i.lineTotalCents, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {receipt?.notes && <p className="mt-3 text-sm text-muted">Note from the reader: {receipt.notes}</p>}
          {r.note && <p className="mt-3 text-sm italic text-muted">“{r.note}” — {member?.name}</p>}
        </section>
      </div>

      <section className="slip p-5">
        <p className="label mb-3">Receipt checks</p>
        <ol className="space-y-1.5 text-sm" aria-label="Receipt checks">
          {(r.checks ?? []).map((c) => (
            <li key={c.id} className="flex items-start gap-2.5">
              <CheckMark state={c.state} />
              <span className="w-8 shrink-0 text-xs leading-[18px] text-muted tabular-nums">{c.id}</span>
              <span className={c.state === "pass" ? "" : c.state === "fail" ? "font-medium text-bad" : "font-medium text-warn"}>
                {RECEIPT_CHECKS[c.id]}
                {c.message && <span className="block font-normal text-muted">{c.message}</span>}
                {c.id === "R3" && r.duplicateOf && c.state !== "pass" && (
                  <Link href={`/reimbursements/${r.duplicateOf}`} className="block font-normal underline">
                    Open the earlier receipt
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ol>

        {r.decision && (
          <div className="mt-5 border-t border-dashed border-line pt-4">
            <p className="label mb-3">Mandate rules</p>
            <DecisionPanel decision={r.decision} />
            <p className="mt-3 text-xs text-muted">Policy 5.2: every reimbursement is paid only after the treasurer approves, even when all rules pass.</p>
          </div>
        )}

        {mandate && usage && (
          <div className="mt-5 border-t border-dashed border-line pt-4">
            <p className="label mb-2">What this does to the budget</p>
            <BudgetBar capCents={usage.capCents} spentCents={usage.spentCents} committedCents={usage.committedCents} orderCents={waiting ? (r.totalCents ?? 0) : 0} currency={mandate.currency} />
          </div>
        )}
      </section>

      <section className="card p-5">
        {isApprover || r.status === "approved" || r.status === "paid" ? (
          <ReimbursementActions id={r.id} status={r.status} isApprover={isApprover} amount={amount} payee={payee} seconds={r.paidAt ? Math.round((r.paidAt.getTime() - r.createdAt.getTime()) / 1000) : null} />
        ) : waiting ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Submitted. The treasurer approves reimbursements, then PayPal pays you back.</p>
            <RoleButton role="treasurer" label="Switch to treasurer to approve" next={`/reimbursements/${r.id}`} className="btn-ghost" />
          </div>
        ) : (
          <p className="text-sm text-muted">{status.label}.</p>
        )}
        {(r.status === "rejected" || r.status === "paid") && !isApprover && (
          <Link href="/reimburse" className="btn-ghost mt-4">
            Submit another receipt
          </Link>
        )}
      </section>

      <section className="card p-5">
        <p className="label">PayPal</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted">Paid to</dt>
          <dd>{payee ?? "—"}</dd>
          <dt className="text-muted">Payout batch</dt>
          <dd className="font-mono">{r.payoutBatchId ?? "—"}</dd>
          <dt className="text-muted">Payout item</dt>
          <dd className="font-mono">{r.payoutItemId ?? "—"}</dd>
          <dt className="text-muted">Approved by</dt>
          <dd>{approver ? `${approver.name}, ${dateTime(r.approvedAt!)}` : "—"}</dd>
          <dt className="text-muted">Paid</dt>
          <dd>{r.paidAt ? `${dateTime(r.paidAt)} (${Math.round((r.paidAt.getTime() - r.createdAt.getTime()) / 1000)} s after submitting)` : "—"}</dd>
          <dt className="text-muted">Trace ID</dt>
          <dd className="font-mono text-xs leading-5">{r.traceId}</dd>
        </dl>
      </section>

      <section className="card p-5">
        <p className="label">Timeline</p>
        <ol className="mt-3 space-y-3 border-l border-line pl-4 text-sm">
          {timeline.map((e) => (
            <li key={e.id}>
              <p>
                <span className="font-medium">{ACTOR[e.actor]}</span> · {e.message}
              </p>
              <p className="text-xs text-muted">{dateTime(e.createdAt)}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
