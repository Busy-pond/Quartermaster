/**
 * Signed, expiring approval links for notifications sent outside the app
 * (Slack, email). The token names the payment and the approver and is signed
 * with APP_SECRET (HMAC-SHA256), so it can't be forged or edited. It only
 * signs the approver in and opens the approval page; paying still needs the
 * PayPal click and passes the mandate re-check. No I/O here.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const APPROVAL_LINK_TTL_MS = 72 * 3600_000;

export interface ApprovalClaims {
  kind: "payment" | "reimbursement";
  id: string;
  approverId: string;
  exp: number; // ms since epoch
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function signApproval(c: Omit<ApprovalClaims, "exp">, secret: string, now: Date, ttlMs = APPROVAL_LINK_TTL_MS): string {
  if (secret.length < 16) throw new Error("APP_SECRET must be at least 16 characters");
  const body = b64(JSON.stringify({ ...c, exp: now.getTime() + ttlMs }));
  return `${body}.${sign(body, secret)}`;
}

export type VerifyResult = { ok: true; claims: ApprovalClaims } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyApproval(token: string, secret: string, now: Date): VerifyResult {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  let claims: ApprovalClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || (claims.kind !== "payment" && claims.kind !== "reimbursement") || typeof claims.id !== "string" || typeof claims.approverId !== "string" || typeof claims.exp !== "number")
    return { ok: false, reason: "malformed" };
  if (claims.exp < now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
