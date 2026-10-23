import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { createApiKey } from "@/lib/mcp/auth";

const Body = z.object({ name: z.string().max(60).default("") });

/** Treasurer creates an MCP API key; the key is returned once and never stored in plain text. */
export const POST = handle(async (req: Request) => {
  const me = await requireMember();
  const { name } = Body.parse(await req.json().catch(() => ({})));
  return NextResponse.json(await createApiKey(me, name));
});
