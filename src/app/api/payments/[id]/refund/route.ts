import { NextResponse } from "next/server";
import { RefundBody } from "@/lib/api/schemas";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { refundPayment } from "@/lib/funding/service";

const Body = RefundBody;

/** Treasurer-only refund of a paid purchase (idempotency key refund-<payment id>). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  const { reason } = Body.parse(await req.json().catch(() => ({})));
  return NextResponse.json(await refundPayment(id, me, reason));
});
