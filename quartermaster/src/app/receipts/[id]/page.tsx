import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getMandate, getPayment, recentAudit } from "@/lib/purchases";
import { dateTime, money, STATUS_STYLE } from "@/lib/format";
import { DecisionPanel } from "@/components/decision";
import { Stamp, stampFor } from "@/components/stamp";
import { storedCheck } from "@/lib/integrations/kernel";
import { ageLabel } from "@/lib/verify/price";

const ACTOR: Record<string, string> = { agent: "Agent", human: "Person", webhook: "PayPal", system: "System" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPayment(id);
  if (!p) notFound();
  const [mandate, timeline] = await Promise.all([getMandate(p.mandateId), recentAudit(p.traceId)]);
  const request = p.requestId ? await db().query.purchaseRequests.findFirst({ where: eq(schema.purchaseRequests.id, p.requestId) }) : null;
  const [requester, approver] = await Promise.all([
    request ? db().query.members.findFirst({ where: eq(schema.members.id, request.memberId) }) : null,
    p.approvedBy ? db().query.members.findFirst({ where: eq(schema.members.id, p.approvedBy) }) : null,
  ]);
  const status = STATUS_STYLE[p.status];
  // Screenshots of KERNEL live checks, for the options that were verified
  const shots = new Map(
    await Promise.all(
      (p.optionsConsidered ?? [])
        .map((o) => o.verification?.checkKey)
        .filter((k): k is string => !!k)
        .map(async (k) => [k, (await storedCheck(k))?.screenshot ?? null] as const),
    ),
  );
  const events = timeline.filter((e) => !e.paymentId || e.paymentId === p.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Trust receipt</p>
          <h1 className="mt-1 text-4xl font-bold tabular-nums">{money(p.totalCents, p.currency)}</h1>
          <p className="mt-1 text-muted">
            From {p.vendor}, under “{mandate?.title}”
          </p>
        </div>
        {stampFor(p.status) ? (
          <Stamp kind={stampFor(p.status)!} size="lg" className="mt-2 shrink-0" />
        ) : (
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${status.cls}`}>{status.label}</span>
        )}
      </div>

      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <p className="label">Asked by</p>
          <p className="mt-1">{requester?.name ?? "—"}</p>
          {request && <p className="mt-1 text-sm italic text-muted">“{request.text}”</p>}
        </div>
        <div>
          <p className="label">Approved by</p>
          <p className="mt-1">
            {approver?.name ??
              (p.status === "approved" ? "Mandate (pre-approved)" : p.status === "denied" ? "Not approved — blocked before reaching a person" : p.status === "needs_approval" ? "Waiting for the treasurer" : "—")}
          </p>
          {p.approvedAt && <p className="text-sm text-muted">{dateTime(p.approvedAt)}</p>}
        </div>
        <div className="sm:col-span-2">
          <p className="label">Why this purchase</p>
          <p className="mt-1 text-sm">{p.rationale ?? "—"}</p>
        </div>
      </section>

      {p.optionsConsidered && p.optionsConsidered.length > 0 && (
        <section className="card p-5">
          <p className="label">Options the agent compared</p>
          <ul className="mt-3 divide-y divide-line text-sm">
            {p.optionsConsidered.map((o, i) => {
              const chosen = p.lines.some((l) => l.description === o.title);
              return (
                <li key={i} className="py-2">
                  <div className="flex justify-between gap-3">
                    <span className={chosen ? "font-medium" : "text-muted"}>
                      {chosen && "✓ "}
                      {o.title} <span className="text-muted">· {o.vendor}</span>
                    </span>
                    <span className="amount">{money(o.priceCents, p.currency)}</span>
                  </div>
                  {o.verification && o.verification.status !== "unverified" && (
                    <div className="mt-2 flex gap-3 rounded-lg bg-paper p-2">
                      {o.verification.checkKey && shots.get(o.verification.checkKey) && (
                        <a href={o.url ?? undefined} target="_blank" rel="noreferrer" className="shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={shots.get(o.verification.checkKey)!} alt={`Screenshot of the ${o.vendor} page`} className="h-20 w-32 rounded border border-line object-cover object-top" />
                        </a>
                      )}
                      <div className="text-xs">
                        <p className={o.verification.status === "changed" ? "font-medium text-warn" : "text-ink"}>
                          Live check: {o.verification.liveCents != null ? money(o.verification.liveCents, p.currency) : "price not readable"}
                          {o.verification.status === "changed" && " (price changed; the live price was used)"}
                          {o.verification.inStock === false && " · out of stock"}
                        </p>
                        {o.verification.deliveryText && <p className="text-muted">{o.verification.deliveryText}</p>}
                        {o.verification.verifiedAt && (
                          <p className="text-muted">
                            Verified {dateTime(o.verification.verifiedAt)} by KERNEL{o.verification.source === "cache" ? ` (cached, ${ageLabel(o.verification.verifiedAt, p.createdAt)} when proposed)` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {o.verification?.status === "unverified" && <p className="mt-1 text-xs text-muted">{o.verification.message}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="slip p-5">
        <p className="label mb-3">Mandate rules applied</p>
        <DecisionPanel decision={p.decision} />
      </section>

      <section className="card p-5">
        <p className="label">PayPal</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted">Order ID</dt>
          <dd className="font-mono">{p.paypalOrderId ?? "—"}</dd>
          <dt className="text-muted">Capture ID</dt>
          <dd className="font-mono">{p.paypalCaptureId ?? "—"}</dd>
          <dt className="text-muted">Captured</dt>
          <dd>{p.capturedAt ? dateTime(p.capturedAt) : "—"}</dd>
          <dt className="text-muted">Trace ID</dt>
          <dd className="font-mono text-xs leading-5">{p.traceId}</dd>
        </dl>
      </section>

      <section className="card p-5">
        <p className="label">Timeline</p>
        <ol className="mt-3 space-y-3 border-l border-line pl-4 text-sm">
          {events.map((e) => (
            <li key={e.id}>
              <p>
                <span className="font-medium">{ACTOR[e.actor]}</span> · {e.message}
              </p>
              <p className="text-xs text-muted">{dateTime(e.createdAt)}</p>
            </li>
          ))}
          {events.length === 0 && <li className="text-muted">No events yet.</li>}
        </ol>
      </section>

      {(p.status === "needs_approval" || p.status === "approved") && (
        <Link href={`/approve/${p.id}`} className="btn-primary">
          Go to approval
        </Link>
      )}
    </div>
  );
}
