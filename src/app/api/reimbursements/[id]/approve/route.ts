import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { approveReimbursement } from "@/lib/reimbursements/service";

/** Treasurer approves; the mandate is re-checked and the PayPal Payout is sent. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  const r = await approveReimbursement(id, me);
  return NextResponse.json({ status: r.status, payoutBatchId: r.payoutBatchId, payoutStatus: r.payoutStatus });
});
