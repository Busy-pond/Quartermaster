import { NextResponse } from "next/server";
import { KeyBody } from "@/lib/api/schemas";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { createApiKey } from "@/lib/mcp/auth";

const Body = KeyBody;

/** Treasurer creates an MCP API key; the key is returned once and never stored in plain text. */
export const POST = handle(async (req: Request) => {
  const me = await requireMember();
  const { name } = Body.parse(await req.json().catch(() => ({})));
  return NextResponse.json(await createApiKey(me, name));
});
