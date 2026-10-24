import { NextResponse } from "next/server";
import { createOrderForPayment } from "@/lib/purchases";
import { requireMember } from "@/lib/session";
import { handle } from "@/lib/http";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  const order = await createOrderForPayment(id, me);
  return NextResponse.json({ id: order.id });
});
