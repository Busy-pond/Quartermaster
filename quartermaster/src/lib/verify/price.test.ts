import { describe, expect, it } from "vitest";
import { ageLabel, comparePrice, verifiableUrl } from "./price";

describe("comparePrice", () => {
  it("keeps the stored price within 2%", () => {
    const c = comparePrice(8900, 9050);
    expect(c.status).toBe("match");
    expect(c.useCents).toBe(8900);
    expect(c.diffPct).toBe(1.7);
  });
  it("uses the live price when it moved more than 2%", () => {
    const c = comparePrice(8900, 9500);
    expect(c.status).toBe("changed");
    expect(c.useCents).toBe(9500);
    expect(c.message).toMatch(/95\.00 instead of 89\.00 \(\+6\.7%\)/);
  });
  it("also uses a lower live price", () => {
    expect(comparePrice(1000, 900)).toMatchObject({ status: "changed", useCents: 900, diffPct: -10 });
  });
  it("treats exactly 2% as a match", () => expect(comparePrice(10000, 10200).status).toBe("match"));
  it("falls back to the stored price when nothing was read", () => {
    expect(comparePrice(8900, null)).toMatchObject({ status: "unknown", useCents: 8900 });
    expect(comparePrice(8900, 0)).toMatchObject({ status: "unknown", useCents: 8900 });
  });
});

describe("ageLabel", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  it("labels minutes, hours and days", () => {
    expect(ageLabel("2026-10-23T11:59:50Z", now)).toBe("just now");
    expect(ageLabel("2026-10-23T11:20:00Z", now)).toBe("40 min ago");
    expect(ageLabel("2026-10-23T09:00:00Z", now)).toBe("3 h ago");
    expect(ageLabel("2026-10-20T12:00:00Z", now)).toBe("3 days ago");
  });
});

describe("verifiableUrl", () => {
  it("accepts retailer pages", () => expect(verifiableUrl("https://www.uline.com/Product/Detail/S-1234")).toBe("https://www.uline.com/Product/Detail/S-1234"));
  it("rejects empty, local and non-http links", () => {
    expect(verifiableUrl(null)).toBeNull();
    expect(verifiableUrl("http://localhost:3000/x")).toBeNull();
    expect(verifiableUrl("http://192.168.1.4/")).toBeNull();
    expect(verifiableUrl("file:///etc/passwd")).toBeNull();
    expect(verifiableUrl("https://sample.example/p")).toBeNull();
    expect(verifiableUrl("not a url")).toBeNull();
  });
});
