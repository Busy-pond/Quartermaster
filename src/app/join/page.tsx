import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentMember, demoOrg } from "@/lib/session";
import { duesPlan, operationsMandate } from "@/lib/funding/service";
import { mandateUsage } from "@/lib/purchases";
import { money } from "@/lib/format";
import { BudgetBar } from "@/components/budget-bar";
import { DuesButton } from "@/components/dues-button";

export const dynamic = "force-dynamic";

/** Day 13: member dues through PayPal Subscriptions; each payment funds the Operations budget. */
export default async function JoinPage() {
  const org = await demoOrg();
  if (!org) return <p className="text-muted">Demo org not found — run <code>npm run db:seed</code>.</p>;
  const [me, plan, ops] = await Promise.all([currentMember(), duesPlan(org.id), operationsMandate(org.id)]);
  const usage = ops ? await mandateUsage(ops) : null;
  const mine = me ? await db().query.subscriptions.findFirst({ where: and(eq(schema.subscriptions.memberId, me.id), eq(schema.subscriptions.status, "ACTIVE")) }) : undefined;
  // The same loader serves sandbox and live; the client id decides which.
  const sdkBase = "https://www.paypal.com/sdk/js";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="label">{org.name}</p>
        <h1 className="mt-1 text-2xl font-semibold">Member dues</h1>
        <p className="mt-1 text-muted">Dues pay for the things no single event covers. Every payment goes straight into the Operations budget, which the agent can only spend inside its mandate.</p>
      </div>

      {ops && usage && (
        <section className="slip p-5">
          <p className="label">{ops.title}</p>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums">
            {money(usage.remainingCents, ops.currency)} <span className="text-base font-medium text-muted">left</span>
          </p>
          <div className="mt-2">
            <BudgetBar capCents={usage.capCents} spentCents={usage.spentCents} committedCents={usage.committedCents} currency={ops.currency} />
          </div>
          {usage.fundedCents > 0 && <p className="mt-2 text-sm text-ok">+{money(usage.fundedCents, ops.currency)} raised from dues and sponsors so far</p>}
        </section>
      )}

      <section className="card p-5">
        {!plan ? (
          <p className="text-sm text-muted">
            Dues aren&apos;t set up yet. Run <code>npm run setup:dues</code> once to create the PayPal plan.
          </p>
        ) : !me ? (
          <p className="text-sm text-muted">Sign in as a volunteer on the home page to subscribe.</p>
        ) : mine ? (
          <p className="text-sm">You&apos;re subscribed ({money(plan.amountCents, plan.currency)} a month). Thank you!</p>
        ) : (
          <>
            <p className="font-medium">{money(plan.amountCents, plan.currency)} a month, cancel any time in PayPal</p>
            <p className="mb-4 mt-1 text-sm text-muted">Sandbox: pay with a sandbox personal account.</p>
            <DuesButton clientId={process.env.PAYPAL_CLIENT_ID ?? ""} planId={plan.planId} sdkBase={sdkBase} />
          </>
        )}
      </section>
    </div>
  );
}
