import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { requireTreasurer } from "@/lib/session";
import { InsightsQuery } from "@/lib/api/schemas";
import { loadDashboard } from "@/lib/dashboard/load";
import { blockedAttempts, mandateHealth, overBudgetShare, pendingReimbursements, spendByEvent } from "@/lib/dashboard/insights";

/**
 * Read-only figures for the AG Studio Treasurer agent's tools (Day 18), from the same
 * ledger the mandate engine checks. Money is in integer cents.
 */
export const GET = handle(async (req: Request) => {
  const me = await requireTreasurer();
  const q = InsightsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const now = new Date();
  const data = await loadDashboard(me.orgId, now);
  const result = (() => {
    switch (q.view) {
      case "spend_by_event":
        return spendByEvent(data.envelopes);
      case "over_budget_share":
        return overBudgetShare(data.envelopes, q.threshold);
      case "pending_reimbursements":
        return pendingReimbursements(data.reimbursements, now);
      case "blocked_attempts":
        return blockedAttempts(data.decided, now, q.days);
      case "mandate_health":
        return mandateHealth(data.decided);
    }
  })();
  return NextResponse.json({ view: q.view, asOf: now.toISOString(), source: "live ledger", result });
});
