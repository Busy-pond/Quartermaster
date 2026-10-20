import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentMember, demoOrg } from "@/lib/session";
import { mandateUsage } from "@/lib/purchases";
import { listReimbursements } from "@/lib/reimbursements/service";
import { money, shortDate } from "@/lib/format";
import { RoleButton } from "@/components/role-switch";
import { ReceiptUpload } from "@/components/receipt-upload";
import { REIMBURSEMENT_STATUS } from "@/lib/reimbursements/labels";

export const dynamic = "force-dynamic";

export default async function ReimbursePage() {
  const [me, org] = await Promise.all([currentMember(), demoOrg()]);
  if (!org) return <p className="text-muted">Demo org not found — run <code>npm run db:seed</code>.</p>;

  const header = (
    <div>
      <p className="label">Snap to reimburse</p>
      <h1 className="mt-1 text-2xl font-semibold">Paid out of pocket? Get it back.</h1>
      <p className="mt-1 max-w-2xl text-muted">
        Photograph the receipt. Gemini reads it, the app checks it against the mandate and for duplicates, and once the treasurer approves, PayPal pays you back.
      </p>
    </div>
  );

  if (!me)
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {header}
        <RoleButton role="member" label="Try it as a volunteer" next="/reimburse" />
      </div>
    );

  const [mandates, events, mine] = await Promise.all([
    db().query.mandates.findMany({ where: and(eq(schema.mandates.orgId, org.id), eq(schema.mandates.status, "active")) }),
    db().query.events.findMany({ where: eq(schema.events.orgId, org.id) }),
    listReimbursements(org.id, 50).then((rows) => rows.filter((r) => r.memberId === me.id).slice(0, 8)),
  ]);
  const usage = await Promise.all(mandates.map(mandateUsage));
  const choices = mandates.map((m, i) => ({
    id: m.id,
    title: m.title,
    event: events.find((e) => e.id === m.eventId)?.name ?? null,
    categories: m.categories,
    remaining: money(usage[i].remainingCents, m.currency),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {header}
      {choices.length ? <ReceiptUpload mandates={choices} /> : <p className="text-muted">There are no active mandates to reimburse from.</p>}

      {mine.length > 0 && (
        <section>
          <h2 className="font-medium">Your receipts</h2>
          <div className="card mt-3 divide-y divide-line">
            {mine.map((r) => {
              const st = REIMBURSEMENT_STATUS[r.status];
              return (
                <Link key={r.id} href={`/reimbursements/${r.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-paper">
                  <span>
                    <span className="font-medium">{r.merchant || "Receipt"}</span>
                    <span className="block text-sm text-muted">{r.receiptDate ?? shortDate(r.createdAt)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    <span className="amount font-semibold">{money(r.totalCents ?? 0, r.currency ?? "USD")}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
