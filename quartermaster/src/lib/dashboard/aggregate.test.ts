import { describe, expect, it } from "vitest";
import { envelopes, exceptionsOverTime, spendByCategory, type LedgerRow } from "./aggregate";

const day = (d: string) => new Date(`${d}T10:00:00Z`);
const row = (o: Partial<LedgerRow>): LedgerRow => ({ kind: "purchase", mandateId: "m1", status: "captured", totalCents: 0, lines: [], createdAt: day("2026-10-20"), ...o });

const rows: LedgerRow[] = [
  row({ totalCents: 7700, lines: [{ category: "supplies", unitPriceCents: 3850, quantity: 2 }] }),
  row({ totalCents: 8500, lines: [{ category: "safety", unitPriceCents: 425, quantity: 20 }] }),
  row({ status: "approved", totalCents: 4996, lines: [{ category: "safety", unitPriceCents: 2498, quantity: 2 }] }),
  row({ status: "denied", totalCents: 145780, lines: [{ category: "supplies", unitPriceCents: 145780, quantity: 1 }], createdAt: day("2026-10-16") }),
  row({ status: "refunded", totalCents: 17800, lines: [{ category: "supplies", unitPriceCents: 8900, quantity: 2 }], createdAt: day("2026-10-20") }),
  row({ kind: "reimbursement", status: "paid", totalCents: 2781, lines: [{ category: "supplies", unitPriceCents: 2781, quantity: 1 }], mandateId: "m2" }),
  row({ kind: "reimbursement", status: "rejected", totalCents: 4217, lines: [{ category: "safety", unitPriceCents: 4217, quantity: 1 }], createdAt: day("2026-10-23") }),
];

describe("spendByCategory", () => {
  it("adds spent and committed per category and ignores blocked and refunded", () => {
    expect(spendByCategory(rows)).toEqual([
      { category: "safety", spentCents: 8500, committedCents: 4996 },
      { category: "supplies", spentCents: 7700 + 2781, committedCents: 0 },
    ]);
  });
});

describe("envelopes", () => {
  it("uses spent + committed against the cap", () => {
    const [e] = envelopes([{ id: "m1", title: "Beach", capCents: 60000, event: "Beach Cleanup" }], rows);
    expect(e).toMatchObject({ spentCents: 16200, committedCents: 4996, remainingCents: 60000 - 16200 - 4996, blocked: 2 });
    expect(e.usedPct).toBe(35.3);
  });
  it("counts a paid reimbursement as spent on its own mandate", () => {
    const [e] = envelopes([{ id: "m2", title: "Food", capCents: 40000, event: null }], rows);
    expect(e.spentCents).toBe(2781);
  });
  it("handles a zero cap", () => expect(envelopes([{ id: "x", title: "x", capCents: 0, event: null }], []).at(0)?.usedPct).toBe(0));
});

describe("exceptionsOverTime", () => {
  const series = exceptionsOverTime(rows, day("2026-10-23"), 14);
  it("zero-fills every day in the window", () => {
    expect(series).toHaveLength(14);
    expect(series[0].day).toBe("2026-10-10");
    expect(series.at(-1)!.day).toBe("2026-10-23");
  });
  it("counts blocked attempts and refunds on their day", () => {
    expect(series.find((d) => d.day === "2026-10-16")).toMatchObject({ blocked: 1, refunded: 0 });
    expect(series.find((d) => d.day === "2026-10-20")).toMatchObject({ refunded: 1, refundedCents: 17800 });
    expect(series.find((d) => d.day === "2026-10-23")).toMatchObject({ blocked: 1 });
  });
});
