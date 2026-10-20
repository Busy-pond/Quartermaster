import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { rejectReimbursement } from "@/lib/reimbursements/service";

const Body = z.object({ reason: z.string().max(300).default("") });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  const { reason } = Body.parse(await req.json().catch(() => ({})));
  const r = await rejectReimbursement(id, me, reason);
  return NextResponse.json({ status: r.status });
});
