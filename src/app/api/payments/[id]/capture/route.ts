import { NextResponse } from "next/server";
import { CaptureBody } from "@/lib/api/schemas";
import { capturePayment } from "@/lib/purchases";
import { requireMember } from "@/lib/session";
import { handle } from "@/lib/http";

const Body = CaptureBody;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  const { orderId } = Body.parse(await req.json());
  const payment = await capturePayment(id, orderId, me.id);
  return NextResponse.json({ status: payment.status, captureId: payment.paypalCaptureId });
});
