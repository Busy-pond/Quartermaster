import { describe, expect, it } from "vitest";
import { studioTables } from "./studio-data";
import type { DashboardData } from "./load";

const data: DashboardData = {
  envelopes: [{ mandateId: "m1", title: "Beach supplies", event: "Beach Cleanup", capCents: 60000, spentCents: 59917, committedCents: 0, remainingCents: 83, usedPct: 99.9, blocked: 2 }],
  payments: [{ id: "p1", date: "2026-10-20T10:00:00.000Z", items: "2× Bottles", vendor: "Uline", mandateId: "m1", mandate: "Beach supplies", amountCents: 17800, currency: "USD", status: "captured", clause: "OK", orderId: null, captureId: null }],
  reimbursements: [{ id: "r1", date: "2026-10-23T10:00:00.000Z", volunteer: "Arjun", merchant: "Walmart", receiptDate: null, mandateId: null, mandate: "Beach supplies", amountCents: 2781, currency: "USD", status: "needs_approval", note: null }],
  byCategory: [],
  exceptions: [],
  awaitingTreasurer: 0,
  decided: [
    {
      kind: "purchase",
      id: "p2",
      mandateId: "m1",
      mandate: "Beach supplies",
      label: "4× Tables",
      status: "denied",
      totalCents: 17988,
      decision: { outcome: "deny", clause: "M7", message: "", reasons: [{ clause: "M7", outcome: "deny", message: "" }, { clause: "M10", outcome: "needs_approval", message: "" }] },
      createdAt: new Date("2026-10-23T10:00:00Z"),
    },
  ],
};

describe("studioTables", () => {
  const t = studioTables(data);
  it("turns cents into dollars once, for Studio's currency format", () => {
    expect(t.mandates[0]).toMatchObject({ cap: 600, spent: 599.17, left: 0.83, used_pct: 99.9, event: "Beach Cleanup" });
    expect(t.payments[0].amount).toBe(178);
    expect(t.payments[0].date).toBeInstanceOf(Date);
  });
  it("links a reimbursement without a mandate id by its mandate title", () => expect(t.reimbursements[0].mandate_id).toBe("m1"));
  it("gives each decision a result and one rule row per fired clause", () => {
    expect(t.decisions[0]).toMatchObject({ result: "blocked", clause: "M7", amount: 179.88, kind: "Purchase" });
    expect(t.rule_checks.map((c) => [c.clause, c.outcome])).toEqual([
      ["M7", "blocked"],
      ["M10", "sent to the treasurer"],
    ]);
    expect(new Set(t.rule_checks.map((c) => c.id)).size).toBe(2);
  });
});
