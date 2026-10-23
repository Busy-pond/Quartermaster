import { describe, expect, it } from "vitest";
import { signApproval, verifyApproval } from "./token";

const SECRET = "test-secret-0123456789";
const now = new Date("2026-10-23T12:00:00Z");
const claims = { kind: "payment" as const, id: "pay-1", approverId: "mem-treasurer" };

describe("approval tokens", () => {
  it("round-trips", () => {
    const r = verifyApproval(signApproval(claims, SECRET, now), SECRET, now);
    expect(r).toEqual({ ok: true, claims: { ...claims, exp: now.getTime() + 72 * 3600_000 } });
  });

  it("expires", () => {
    const t = signApproval(claims, SECRET, now, 1000);
    expect(verifyApproval(t, SECRET, new Date(now.getTime() + 2000))).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects another secret", () => {
    expect(verifyApproval(signApproval(claims, SECRET, now), "another-secret-012345", now)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an edited body (pointing the link at another payment)", () => {
    const [, sig] = signApproval(claims, SECRET, now).split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, id: "pay-2", exp: now.getTime() + 1e9 })).toString("base64url");
    expect(verifyApproval(`${forged}.${sig}`, SECRET, now)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects malformed tokens", () => {
    expect(verifyApproval("abc", SECRET, now).ok).toBe(false);
    expect(verifyApproval("a.b.c", SECRET, now).ok).toBe(false);
    expect(verifyApproval("", SECRET, now).ok).toBe(false);
  });

  it("refuses a short secret", () => {
    expect(() => signApproval(claims, "short", now)).toThrow(/APP_SECRET/);
  });
});
