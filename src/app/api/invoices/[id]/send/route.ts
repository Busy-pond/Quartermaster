import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { sendSponsorInvoice } from "@/lib/funding/service";

/** The treasurer's click that actually sends a sponsor invoice (it asks someone for money). */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  const row = await sendSponsorInvoice(id, me);
  return NextResponse.json({ status: row.status, recipientUrl: row.recipientUrl });
});
