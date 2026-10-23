import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentMember } from "@/lib/session";
import { getMandate, recentAudit } from "@/lib/purchases";
import { dateTime, money } from "@/lib/format";
import { InvoiceActions } from "@/components/money-actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Draft, not sent", cls: "bg-warn-soft text-warn" },
  SENT: { label: "Sent, waiting for payment", cls: "bg-brand-soft text-brand" },
  PAID: { label: "Paid", cls: "bg-ok-soft text-ok" },
  MARKED_AS_PAID: { label: "Paid", cls: "bg-ok-soft text-ok" },
  CANCELLED: { label: "Cancelled", cls: "bg-paper text-muted" },
  FAILED: { label: "Couldn't be created", cls: "bg-bad-soft text-bad" },
};

/** Day 13: a sponsor invoice the agent drafted. Only the treasurer can send it. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await db().query.invoices.findFirst({ where: eq(schema.invoices.id, id) });
  if (!inv) notFound();
  const [mandate, me, timeline, requester] = await Promise.all([
    getMandate(inv.mandateId),
    currentMember(),
    recentAudit(inv.traceId),
    db().query.members.findFirst({ where: eq(schema.members.id, inv.createdBy) }),
  ]);
  const canSend = !!me && !!mandate?.approverIds.includes(me.id);
  const st = STATUS[inv.status] ?? { label: inv.status, cls: "bg-paper text-muted" };
  const events = timeline.filter((e) => e.paymentId === inv.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Sponsor invoice</p>
          <h1 className="mt-1 text-4xl font-bold tabular-nums">{money(inv.amountCents, inv.currency)}</h1>
          <p className="mt-1 text-muted">
            To {inv.sponsorName ? `${inv.sponsorName} (${inv.sponsorEmail})` : inv.sponsorEmail}, for “{mandate?.title}”
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${st.cls}`}>{st.label}</span>
      </div>

      <section className="slip space-y-3 p-5">
        <p className="label">Note to the sponsor</p>
        <p>{inv.note}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted">Drafted for</dt>
          <dd>{requester?.name ?? "—"} (by the agent)</dd>
          <dt className="text-muted">PayPal invoice</dt>
          <dd className="font-mono">{inv.paypalInvoiceId ?? "—"}</dd>
          {inv.sentAt && (
            <>
              <dt className="text-muted">Sent</dt>
              <dd>{dateTime(inv.sentAt)}</dd>
            </>
          )}
        </dl>
        {inv.recipientUrl && (
          <a href={inv.recipientUrl} target="_blank" rel="noreferrer" className="text-sm underline">
            The sponsor&apos;s view of the invoice (sandbox)
          </a>
        )}
      </section>

      <InvoiceActions id={inv.id} status={inv.status} canSend={canSend} />

      <section className="card p-5">
        <p className="label">Timeline</p>
        <ol className="mt-3 space-y-3 border-l border-line pl-4 text-sm">
          {events.map((e) => (
            <li key={e.id}>
              <p>{e.message}</p>
              <p className="text-xs text-muted">{dateTime(e.createdAt)}</p>
            </li>
          ))}
          {events.length === 0 && <li className="text-muted">No events yet.</li>}
        </ol>
      </section>
    </div>
  );
}
