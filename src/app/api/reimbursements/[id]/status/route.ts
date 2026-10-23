import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { getReimbursement, syncPayout } from "@/lib/reimbursements/service";

export const dynamic = "force-dynamic";

/** Polled by the page while a payout is in flight. Asks PayPal directly, so it works even without the webhook. */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  let r = await getReimbursement(id);
  if (!r || r.orgId !== me.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (r.status === "approved") {
    try {
      r = await syncPayout(r);
    } catch (e) {
      console.error("Payout status check failed", e);
    }
  }
  return NextResponse.json({
    status: r.status,
    payoutStatus: r.payoutStatus,
    payoutBatchId: r.payoutBatchId,
    paidAt: r.paidAt,
    seconds: r.paidAt ? Math.round((r.paidAt.getTime() - r.createdAt.getTime()) / 1000) : null,
  });
});
