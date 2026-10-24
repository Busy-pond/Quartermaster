/**
 * Admin routes (Day 20) are guarded by APP_SECRET, sent as `Authorization: Bearer <secret>`.
 * Pure: the caller passes the header and the configured secret. Refuses when the secret is
 * unset or too short, so a missing env var can never leave the route open.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export type AdminCheck = { ok: true } | { ok: false; status: 401 | 503; error: string };

const digest = (s: string) => createHash("sha256").update(s).digest();

export function checkAdminSecret(authorization: string | null, secret: string | undefined): AdminCheck {
  if (!secret || secret.length < 16) return { ok: false, status: 503, error: "Admin routes are off: APP_SECRET is not set (16+ characters)" };
  const given = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  // Compare fixed-length digests, so neither the length nor the content leaks through timing.
  if (!given || !timingSafeEqual(digest(given), digest(secret))) return { ok: false, status: 401, error: "Wrong or missing admin secret" };
  return { ok: true };
}
