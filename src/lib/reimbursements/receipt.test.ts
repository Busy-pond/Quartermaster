import { describe, expect, it } from "vitest";
import { evaluate, type Mandate } from "@/lib/mandates/engine";
import { duplicateScore, merchantKey, receiptChecks, receiptVendor, toCents, toProposal, type DuplicateResult, type ExtractedReceipt } from "./receipt";

const receipt = (over: Partial<ExtractedReceipt> = {}): ExtractedReceipt => ({
  isReceipt: true,
  merchant: "The Home Depot #4521",
  merchantDomain: "homedepot.com",
  date: "2026-10-18",
  currency: "USD",
  items: [
    { description: "Work gloves, 6 pairs", quantity: 2, lineTotalCents: 2598, category: "safety" },
    { description: "Contractor trash bags", quantity: 1, lineTotalCents: 1497, category: "supplies" },
  ],
  taxCents: 287,
  totalCents: 4382,
  confidence: "high",
  notes: null,
  source: "gemini",
  ...over,
});

const mandate: Mandate = {
  id: "m1",
  status: "active",
  currency: "USD",
  capCents: 60000,
  perItemAutoLimitCents: 15000,
  perOrderAutoLimitCents: 25000,
  categories: ["supplies", "safety"],
  vendorAllowlist: [],
  startsAt: "2026-10-01T00:00:00Z",
  expiresAt: "2026-12-10T00:00:00Z",
  approverIds: ["t"],
};
const now = new Date("2026-10-20T10:00:00Z");
const noDup: DuplicateResult = { score: 0, matchId: null, reason: null };

describe("toCents", () => {
  it("rounds without float drift", () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(null)).toBe(0);
  });
});

describe("merchantKey and receiptVendor", () => {
  it("drops store numbers and punctuation", () => {
    expect(merchantKey("The Home Depot #4521")).toBe("the home depot");
    expect(merchantKey("WALMART Store #12, Inc.")).toBe("walmart");
  });
  it("prefers the domain, else slugs the name", () => {
    expect(receiptVendor({ merchant: "x", merchantDomain: "https://www.HomeDepot.com/store" })).toBe("homedepot.com");
    expect(receiptVendor({ merchant: "Raj General Stores", merchantDomain: null })).toBe("raj-general-stores");
    expect(receiptVendor({ merchant: "", merchantDomain: "not a domain" })).toBe("unknown-merchant");
  });
});

describe("toProposal", () => {
  it("adds a tax line so the lines sum to the total", () => {
    const p = toProposal(receipt(), "supplies");
    expect(p.totalCents).toBe(4382);
    expect(p.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0)).toBe(4382);
    expect(p.lines[0]).toEqual({ description: "Work gloves, 6 pairs", category: "safety", unitPriceCents: 1299, quantity: 2 });
    expect(p.lines.at(-1)).toEqual({ description: "Tax and fees", category: "safety", unitPriceCents: 287, quantity: 1 });
  });
  it("keeps a line whole when its total doesn't split evenly by quantity", () => {
    const p = toProposal(receipt({ items: [{ description: "Rope", quantity: 3, lineTotalCents: 1000, category: "supplies" }], taxCents: 0, totalCents: 1000 }), "supplies");
    expect(p.lines).toEqual([{ description: "3× Rope", category: "supplies", unitPriceCents: 1000, quantity: 1 }]);
  });
  it("falls back to one line when discounts make items exceed the total", () => {
    const p = toProposal(receipt({ totalCents: 3000 }), "supplies");
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0].unitPriceCents).toBe(3000);
    expect(p.lines[0].category).toBe("safety");
  });
  it("uses the fallback category when no items were read", () => {
    const p = toProposal(receipt({ items: [], totalCents: 2500 }), "supplies");
    expect(p.lines).toEqual([{ description: "Receipt from The Home Depot #4521", category: "supplies", unitPriceCents: 2500, quantity: 1 }]);
  });
  it("produces a proposal the mandate engine accepts as well-formed", () => {
    const d = evaluate(mandate, toProposal(receipt(), "supplies"), { spentCents: 0, committedCents: 0, recent: [] }, now);
    expect(d.outcome).toBe("allow");
  });
  it("lets the engine block a category the mandate doesn't cover", () => {
    const r = receipt({ items: [{ description: "Pizza", quantity: 1, lineTotalCents: 2400, category: "food" }], taxCents: 0, totalCents: 2400 });
    const d = evaluate(mandate, toProposal(r, "supplies"), { spentCents: 0, committedCents: 0, recent: [] }, now);
    expect(d.outcome).toBe("deny");
    expect(d.clause).toBe("M5");
  });
  it("lets the engine block a receipt over the remaining cap", () => {
    const d = evaluate(mandate, toProposal(receipt(), "supplies"), { spentCents: 58000, committedCents: 0, recent: [] }, now);
    expect(d.clause).toBe("M7");
  });
});

describe("duplicateScore", () => {
  const prior = [{ id: "r1", imageHash: "abc", merchant: "Home Depot", receiptDate: "2026-10-18", totalCents: 4382 }];
  it("matches the same photo", () => {
    expect(duplicateScore({ imageHash: "abc", merchant: "x", date: null, totalCents: 1 }, prior)).toEqual({ score: 1, matchId: "r1", reason: "The same photo was already submitted" });
  });
  it("matches a re-photographed receipt by merchant, date and total", () => {
    const d = duplicateScore({ imageHash: "zzz", merchant: "The Home Depot #4521", date: "2026-10-18", totalCents: 4382 }, prior);
    expect(d.score).toBe(0.95);
  });
  it("only warns when the merchant differs", () => {
    expect(duplicateScore({ imageHash: "zzz", merchant: "Walmart", date: "2026-10-18", totalCents: 4382 }, prior).score).toBe(0.6);
  });
  it("ignores different totals", () => {
    expect(duplicateScore({ imageHash: "zzz", merchant: "Home Depot", date: "2026-10-18", totalCents: 4383 }, prior).score).toBe(0);
  });
});

describe("receiptChecks", () => {
  const state = (r: ExtractedReceipt, dup = noDup, hasPayee = true) => Object.fromEntries(receiptChecks(r, dup, { now, hasPayee }).map((c) => [c.id, c.state]));
  it("passes a clean receipt", () => {
    expect(state(receipt())).toEqual({ R1: "pass", R2: "pass", R3: "pass", R4: "pass", R5: "pass" });
  });
  it("fails a photo that isn't a receipt", () => {
    expect(state(receipt({ isReceipt: false })).R1).toBe("fail");
  });
  it("warns on old, future or missing dates", () => {
    expect(state(receipt({ date: "2026-08-01" })).R2).toBe("warn");
    expect(state(receipt({ date: "2026-11-01" })).R2).toBe("warn");
    expect(state(receipt({ date: null })).R2).toBe("warn");
  });
  it("fails a duplicate and warns on a near-duplicate", () => {
    expect(state(receipt(), { score: 0.95, matchId: "r1", reason: "x" }).R3).toBe("fail");
    expect(state(receipt(), { score: 0.6, matchId: "r1", reason: "x" }).R3).toBe("warn");
  });
  it("warns when items don't add up, and when there is no payee", () => {
    expect(state(receipt({ totalCents: 5000 })).R4).toBe("warn");
    expect(state(receipt(), noDup, false).R5).toBe("warn");
  });
  it("flags hand-typed details for a closer look", () => {
    expect(state(receipt({ source: "manual", items: [] })).R1).toBe("warn");
    expect(state(receipt({ source: "manual", items: [] })).R4).toBe("pass");
  });
});
