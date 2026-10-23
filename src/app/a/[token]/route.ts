/**
 * Signed approval link from Slack or email: /a/<token>.
 * A valid token signs the named approver in and opens the approval page.
 * It grants nothing else: paying still needs the PayPal click, and the
 * mandate is re-checked before money moves.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";
import { verifyApproval } from "@/lib/approvals/token";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const origin = new URL(req.url).origin;
  const secret = process.env.APP_SECRET;
  const r = secret ? verifyApproval(token, secret, new Date()) : ({ ok: false, reason: "bad_signature" } as const);
  if (!r.ok) return NextResponse.redirect(`${origin}/mandates?link=${r.reason}`);

  const member = await db().query.members.findFirst({ where: eq(schema.members.id, r.claims.approverId) });
  if (!member || member.role !== "treasurer") return NextResponse.redirect(`${origin}/mandates?link=bad_signature`);

  const page = r.claims.kind === "payment" ? `/approve/${r.claims.id}` : `/reimbursements/${r.claims.id}`;
  const res = NextResponse.redirect(`${origin}${page}`);
  res.cookies.set(SESSION_COOKIE, member.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
