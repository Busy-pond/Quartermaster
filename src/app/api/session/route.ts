import { NextResponse } from "next/server";
import { SessionBody } from "@/lib/api/schemas";
import { memberForRole, SESSION_COOKIE } from "@/lib/session";
import { friendlyDbError } from "@/lib/http";

const Body = SessionBody;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "role must be member or treasurer" }, { status: 400 });

  const result = await memberForRole(parsed.data.role).then(
    (member) => ({ member, error: null }),
    (error: unknown) => ({ member: null, error }),
  );
  if (result.error) {
    console.error(result.error);
    return NextResponse.json({ error: friendlyDbError(result.error) }, { status: 503 });
  }
  const member = result.member;
  if (!member) return NextResponse.json({ error: "Demo org not found — run npm run db:seed" }, { status: 500 });

  const res = NextResponse.json({ member: { id: member.id, name: member.name, role: member.role } });
  res.cookies.set(SESSION_COOKIE, member.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
