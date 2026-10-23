/**
 * Per-org API keys for the MCP server (Day 14). Only a SHA-256 hash is stored;
 * the key is shown once when it's created. Format: qm_live_<32 random chars>.
 */
import { createHash, randomBytes } from "node:crypto";

export const KEY_PREFIX = "qm_live_";

export function generateKey(): { key: string; hash: string; hint: string } {
  const key = KEY_PREFIX + randomBytes(24).toString("base64url");
  return { key, hash: hashKey(key), hint: `${key.slice(0, KEY_PREFIX.length + 4)}…${key.slice(-4)}` };
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Reads "Authorization: Bearer qm_live_..." (or a bare key). Null if absent or not our format. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = header.trim().match(/^(?:Bearer\s+)?(qm_live_[A-Za-z0-9_-]{20,})$/i);
  return m ? m[1] : null;
}
