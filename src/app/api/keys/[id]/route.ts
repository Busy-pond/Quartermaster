import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { revokeApiKey } from "@/lib/mcp/auth";

export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  await revokeApiKey(me, id);
  return NextResponse.json({ ok: true });
});
