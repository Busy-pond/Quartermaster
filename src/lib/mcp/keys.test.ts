import { describe, expect, it } from "vitest";
import { generateKey, hashKey, parseBearer } from "./keys";

describe("MCP API keys", () => {
  it("generates distinct keys whose hash matches", () => {
    const a = generateKey();
    const b = generateKey();
    expect(a.key).not.toBe(b.key);
    expect(a.key).toMatch(/^qm_live_[A-Za-z0-9_-]{32}$/);
    expect(hashKey(a.key)).toBe(a.hash);
    expect(a.hint).toMatch(/^qm_live_.{4}….{4}$/);
  });
  it("reads a bearer header or a bare key", () => {
    const { key } = generateKey();
    expect(parseBearer(`Bearer ${key}`)).toBe(key);
    expect(parseBearer(`bearer   ${key}`)).toBe(key);
    expect(parseBearer(key)).toBe(key);
  });
  it("rejects anything else", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("Bearer abc")).toBeNull();
    expect(parseBearer("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearer(`Bearer qm_live_${"x".repeat(32)} extra`)).toBeNull();
  });
});
