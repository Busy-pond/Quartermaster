import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { demoOrg } from "@/lib/session";
import { mandateUsage } from "@/lib/purchases";
import { money, shortDate, STATUS_STYLE } from "@/lib/format";
import { BudgetBar } from "@/components/budget-bar";
import { listReimbursements } from "@/lib/reimbursements/service";
import { REIMBURSEMENT_STATUS } from "@/lib/reimbursements/labels";

const LINK_PROBLEM: Record<string, string> = {
  expired: "That approval link has expired (links last 72 hours). The request is still listed below.",
  bad_signature: "That approval link isn't valid. Switch to the treasurer and use the list below.",
  malformed: "That approval link isn't valid. Switch to the treasurer and use the list below.",
};

export default async function MandatesPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { link } = await searchParams;
  const org = await demoOrg();
  if (!org) return <p className="text-muted">Demo org not found — run <code>npm run db:seed</code>.</p>;

  const [mandates, events, payments, reimbursements, members] = await Promise.all([
    db().query.mandates.findMany({ where: eq(schema.mandates.orgId, org.id) }),
    db().query.events.findMany({ where: eq(schema.events.orgId, org.id) }),
    db().select().from(schema.payments).where(eq(schema.payments.orgId, org.id)).orderBy(desc(schema.payments.createdAt)).limit(25),
    listReimbursements(org.id, 15),
    db().query.members.findMany({ where: eq(schema.members.orgId, org.id) }),
  ]);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "A volunteer";
  const pendingReimbursements = reimbursements.filter((r) => r.status === "needs_approval" || r.status === "failed");
  const usage = await Promise.all(mandates.map(mandateUsage));
  const pending = payments.filter((p) => p.status === "needs_approval" || p.status === "approved");

  return (
    <div className="space-y-8">
      {link && LINK_PROBLEM[link] && <p className="card border-warn/40 bg-warn-soft p-3 text-sm text-warn">{LINK_PROBLEM[link]}</p>}
      <div>
        <p className="label">{org.name}</p>
        <h1 className="mt-1 text-2xl font-semibold">Spending mandates</h1>
        <p className="mt-1 text-muted">The agent can only spend inside these. Each rule is enforced in code before any PayPal call.</p>
      </div>

      {pending.length + pendingReimbursements.length > 0 && (
        <section>
          <h2 className="font-medium">Waiting for you ({pending.length + pendingReimbursements.length})</h2>
          <div className="mt-3 space-y-2">
            {pendingReimbursements.map((r) => (
              <Link key={r.id} href={`/reimbursements/${r.id}`} className="card flex items-center justify-between gap-3 p-4 hover:bg-paper">
                <span>
                  <span className="font-medium">Reimburse {nameOf(r.memberId)}: receipt from {r.merchant || "a store"}</span>
                  <span className="block text-sm text-muted">{r.status === "failed" ? "Payout failed, try again" : `Snap-to-reimburse · ${r.receiptDate ?? shortDate(r.createdAt)}`}</span>
                </span>
                <span className="amount shrink-0 font-semibold">{money(r.totalCents ?? 0, r.currency ?? "USD")}</span>
              </Link>
            ))}
            {pending.map((p) => (
              <Link key={p.id} href={`/approve/${p.id}`} className="card flex items-center justify-between gap-3 p-4 hover:bg-paper">
                <span>
                  <span className="font-medium">{p.lines.map((l) => `${l.quantity}× ${l.description}`).join(", ")}</span>
                  <span className="block text-sm text-muted">
                    {p.vendor} · {p.decision.clause} {p.decision.outcome === "allow" ? "pre-approved" : p.decision.message}
                  </span>
                </span>
                <span className="amount shrink-0 font-semibold">{money(p.totalCents, p.currency)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        {mandates.length === 0 && <p className="card p-4 text-sm text-muted md:col-span-2">No mandates yet. Run <code>npm run db:seed</code> to create the demo team’s budgets.</p>}
        {mandates.map((m, i) => {
          const u = usage[i];
          const ev = events.find((e) => e.id === m.eventId);
          return (
            <div key={m.id} className="slip p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold">{m.title}</h2>
                  {ev && (
                    <p className="text-sm text-muted">
                      For {ev.name} on {shortDate(ev.startsAt)}
                    </p>
                  )}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.status === "active" ? "bg-ok-soft text-ok" : "bg-paper text-muted"}`}>{m.status}</span>
              </div>
              <p className="mt-4 font-display text-3xl font-bold tabular-nums">
                {money(u.remainingCents, m.currency)} <span className="text-base font-medium text-muted">left</span>
              </p>
              <div className="mt-2">
                <BudgetBar capCents={u.capCents} spentCents={u.spentCents} committedCents={u.committedCents} currency={m.currency} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
                {u.fundedCents > 0 && (
                  <>
                    <dt className="text-muted">Raised (dues, sponsors)</dt>
                    <dd className="amount text-right text-ok">+{money(u.fundedCents, m.currency)}</dd>
                  </>
                )}
                <dt className="text-muted">Auto-approve per item</dt>
                <dd className="amount text-right">{money(m.perItemAutoLimitCents, m.currency)}</dd>
                <dt className="text-muted">Auto-approve per order</dt>
                <dd className="amount text-right">{money(m.perOrderAutoLimitCents, m.currency)}</dd>
                <dt className="text-muted">Categories</dt>
                <dd className="text-right">{m.categories.join(", ")}</dd>
                <dt className="text-muted">Expires</dt>
                <dd className="text-right">{shortDate(m.expiresAt)}</dd>
              </dl>
            </div>
          );
        })}
      </section>

      {reimbursements.length > 0 && (
        <section>
          <h2 className="font-medium">Recent reimbursements</h2>
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="px-4 py-2 font-medium">Volunteer</th>
                  <th className="px-4 py-2 font-medium">Receipt</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {reimbursements.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted">
                      No receipts yet. Volunteers send them from the Reimburse page.
                    </td>
                  </tr>
                )}
                {reimbursements.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-2">{nameOf(r.memberId)}</td>
                    <td className="px-4 py-2">
                      <Link href={`/reimbursements/${r.id}`} className="hover:underline">
                        {r.merchant || "Receipt"}
                      </Link>
                      <span className="text-muted"> · {r.receiptDate ?? shortDate(r.createdAt)}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REIMBURSEMENT_STATUS[r.status].cls}`}>{REIMBURSEMENT_STATUS[r.status].label}</span>
                    </td>
                    <td className="amount px-4 py-2 text-right">{money(r.totalCents ?? 0, r.currency ?? "USD")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="font-medium">Recent payments</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-4 py-2 font-medium">Items</th>
                <th className="px-4 py-2 font-medium">Vendor</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted">
                    No payments yet. Ask for something on the Request page and it will show up here.
                  </td>
                </tr>
              )}
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link href={`/receipts/${p.id}`} className="hover:underline">
                      {p.lines.map((l) => l.description).join(", ")}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted">{p.vendor}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status].cls}`}>{STATUS_STYLE[p.status].label}</span>
                  </td>
                  <td className="amount px-4 py-2 text-right">{money(p.totalCents, p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
