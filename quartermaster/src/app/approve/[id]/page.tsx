import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentMember } from "@/lib/session";
import { getMandate, getPayment, mandateUsage } from "@/lib/purchases";
import { money, STATUS_STYLE } from "@/lib/format";
import { DecisionPanel } from "@/components/decision";
import { PayPalButton } from "@/components/paypal-button";
import { RoleButton } from "@/components/role-switch";
import { BudgetBar } from "@/components/budget-bar";
import { Stamp, stampFor } from "@/components/stamp";

export default async function ApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPayment(id);
  if (!p) notFound();
  const [mandate, me] = await Promise.all([getMandate(p.mandateId), currentMember()]);
  if (!mandate) notFound();
  const usage = await mandateUsage(mandate);
  const request = p.requestId ? await db().query.purchaseRequests.findFirst({ where: eq(schema.purchaseRequests.id, p.requestId) }) : null;
  const requester = request ? await db().query.members.findFirst({ where: eq(schema.members.id, request.memberId) }) : null;
  const isApprover = !!me && mandate.approverIds.includes(me.id);
  const status = STATUS_STYLE[p.status];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label">Payment approval</p>
          <h1 className="mt-1 text-4xl font-bold tabular-nums">{money(p.totalCents, p.currency)}</h1>
          <p className="mt-1 text-muted">
            From {p.vendor}, requested by {requester?.name ?? "the agent"} under “{mandate.title}”
          </p>
        </div>
        {stampFor(p.status) && <Stamp kind={stampFor(p.status)!} size="md" className="mt-2 shrink-0" />}
      </div>

      {request && <blockquote className="card p-4 text-sm italic text-muted">“{request.text}”</blockquote>}

      <section className="card p-5">
        <p className="label">Items</p>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {p.lines.map((l, i) => (
              <tr key={i} className="border-t border-line first:border-0">
                <td className="py-2">{l.description}</td>
                <td className="py-2 text-muted">{l.category}</td>
                <td className="amount py-2 text-right text-muted">
                  {l.quantity} × {money(l.unitPriceCents, p.currency)}
                </td>
                <td className="amount py-2 text-right font-medium">{money(l.unitPriceCents * l.quantity, p.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {p.rationale && <p className="mt-3 text-sm text-muted">Agent’s reasoning: {p.rationale}</p>}
      </section>

      <section className="slip p-5">
        <p className="label mb-3">Mandate check</p>
        <DecisionPanel decision={p.decision} />
        <div className="mt-5 border-t border-dashed border-line pt-4">
          <p className="label mb-2">What this order does to the budget</p>
          <BudgetBar
            capCents={usage.capCents}
            spentCents={usage.spentCents}
            committedCents={usage.committedCents}
            orderCents={p.status === "needs_approval" || p.status === "denied" ? p.totalCents : 0}
            currency={mandate.currency}
          />
        </div>
      </section>

      <section className="card p-5">
        {p.status === "captured" || p.status === "refunded" ? (
          <div className="flex items-center justify-between">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.label}</span>
            <Link href={`/receipts/${p.id}`} className="btn-ghost">
              View trust receipt
            </Link>
          </div>
        ) : p.status === "denied" || p.status === "failed" ? (
          <p className="text-sm text-bad">This payment cannot proceed: {p.decision.message}</p>
        ) : isApprover ? (
          <>
            <p className="mb-3 text-sm text-muted">
              {p.status === "approved"
                ? "Pre-approved by the mandate. Pay with the org’s PayPal account to complete it."
                : "Review the items and the rule that needs you, then approve and pay with PayPal."}{" "}
              The mandate is checked again right before the money moves.
            </p>
            <PayPalButton paymentId={p.id} label={`Approve & pay ${money(p.totalCents, p.currency)}`} />
          </>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Only the mandate’s approver (the treasurer) can pay this. Waiting for approval.</p>
            <RoleButton role="treasurer" label="Switch to treasurer to approve" next={`/approve/${p.id}`} className="btn-ghost" />
          </div>
        )}
      </section>
    </div>
  );
}
