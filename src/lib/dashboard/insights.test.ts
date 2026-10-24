import { describe, expect, it } from "vitest";
import { awaitsTreasurer, blockedAttempts, health, mandateHealth, overBudgetShare, paymentState, pendingReimbursements, resultOf, spendByEvent, type DecidedRow } from "./insights";
import type { Envelope } from "./aggregate";

const day = (d: string) => new Date(`${d}T10:00:00Z`);
const deny = (clause: string) => ({ outcome: "deny" as const, clause, message: `${clause} says no`, reasons: [{ clause, outcome: "deny" as const, message: "" }] });
const ask = (...clauses: string[]) => ({ outcome: "needs_approval" as const, clause: clauses[0], message: "", reasons: clauses.map((clause) => ({ clause, outcome: "needs_approval" as const, message: "" })) });
const allow = { outcome: "allow" as const, clause: "OK", message: "", reasons: [] };
const row = (o: Partial<DecidedRow>): DecidedRow => ({ kind: "purchase", id: Math.random().toString(36), mandateId: "m1", mandate: "Beach", label: "x", status: "captured", totalCents: 1000, decision: allow, createdAt: day("2026-10-20"), ...o });

const rows: DecidedRow[] = [
  row({}),
  row({ status: "captured", decision: ask("M9") }),
  row({ status: "needs_approval", decision: ask("M9", "M8") }),
  row({ status: "denied", decision: deny("M7"), createdAt: day("2026-10-22") }),
  row({ status: "denied", decision: { ...deny("M7"), reasons: [...deny("M7").reasons, { clause: "M10", outcome: "needs_approval", message: "" }] }, createdAt: day("2026-10-23") }),
  row({ kind: "reimbursement", status: "rejected", decision: null, mandateId: "m2", mandate: "Food", createdAt: day("2026-09-01") }),
  row({ kind: "reimbursement", status: "paid", decision: ask("M9"), mandateId: "m2", mandate: "Food" }),
];

describe("resultOf", () => {
  it("names what happened to each request", () => {
    expect(rows.map(resultOf)).toEqual(["pre-approved", "treasurer-approved", "waiting", "blocked", "blocked", "blocked", "treasurer-approved"]);
  });
  it("keeps a receipt still being read out of 'waiting'", () => expect(resultOf({ kind: "reimbursement", status: "submitted", decision: null })).toBe("checking"));
  it("never calls a receipt pre-approved: the treasurer clicked to pay it, even when the rules allowed it", () => {
    expect(resultOf({ kind: "reimbursement", status: "paid", decision: allow })).toBe("treasurer-approved");
    expect(resultOf({ kind: "reimbursement", status: "approved", decision: allow })).toBe("treasurer-approved");
    expect(resultOf({ kind: "purchase", status: "approved", decision: allow })).toBe("pre-approved");
  });
});

describe("paymentState", () => {
  it("names the state of a purchase, not the decision", () => {
    expect(paymentState("approved")).toBe("Approved, not yet paid");
    expect(paymentState("captured")).toBe("Paid");
    expect(paymentState("needs_approval")).toBe("Waiting for the treasurer");
    expect(paymentState("something_new")).toBe("something_new");
  });
});

describe("awaitsTreasurer", () => {
  it("is the one rule for every 'waiting' count: needs approval, or a payout to retry", () => {
    expect(awaitsTreasurer({ kind: "purchase", status: "needs_approval" })).toBe(true);
    expect(awaitsTreasurer({ kind: "reimbursement", status: "needs_approval" })).toBe(true);
    expect(awaitsTreasurer({ kind: "reimbursement", status: "failed" })).toBe(true);
    expect(awaitsTreasurer({ kind: "purchase", status: "failed" })).toBe(false);
    expect(awaitsTreasurer({ kind: "reimbursement", status: "submitted" })).toBe(false);
  });
  it("gives the same count as the Mandate health widget's 'waiting'", () => {
    expect(rows.filter(awaitsTreasurer).length).toBe(mandateHealth(rows).overall.waiting);
  });
});

describe("mandateHealth", () => {
  const h = mandateHealth(rows);
  it("counts approval rate over decided requests only", () => {
    expect(h.overall).toMatchObject({ attempts: 7, preApproved: 1, treasurerApproved: 2, waiting: 1, blocked: 3 });
    expect(h.overall.approvalRatePct).toBe(50); // 3 let through of 6 decided
  });
  it("ranks the rules that fired, each counted once per request", () => {
    expect(h.overall.topRules.map((r) => [r.clause, r.count])).toEqual([
      ["M9", 3],
      ["M7", 2],
      ["M8", 1],
      ["M10", 1],
    ]);
    expect(h.overall.topRules[1].rule).toBe("Total spend stays within the cap");
  });
  it("splits by mandate", () => {
    expect(h.byMandate.map((m) => [m.mandate, m.attempts, m.blocked])).toEqual([
      ["Beach", 5, 2],
      ["Food", 2, 1],
    ]);
  });
  it("has no approval rate when nothing is decided", () => expect(health(["waiting"], []).approvalRatePct).toBeNull());
});

const env = (o: Partial<Envelope>): Envelope => ({ mandateId: "m", title: "t", event: null, capCents: 10000, spentCents: 0, committedCents: 0, remainingCents: 10000, usedPct: 0, blocked: 0, ...o });

describe("overBudgetShare", () => {
  const list = [env({ title: "a", usedPct: 79.9 }), env({ title: "b", usedPct: 80 }), env({ title: "c", usedPct: 99.9 })];
  it("keeps mandates at or above the threshold, fullest first", () => expect(overBudgetShare(list, 80).map((e) => e.title)).toEqual(["c", "b"]));
});

describe("spendByEvent", () => {
  it("adds up mandates of one event and keeps standing budgets apart", () => {
    const out = spendByEvent([
      env({ title: "Beach supplies", event: "Beach Cleanup", capCents: 60000, spentCents: 50000, committedCents: 5000, remainingCents: 5000 }),
      env({ title: "Beach food", event: "Beach Cleanup", capCents: 20000, spentCents: 5000, remainingCents: 15000 }),
      env({ title: "Operations", event: null, capCents: 10000, spentCents: 1000, remainingCents: 9000 }),
    ]);
    expect(out).toEqual([
      { event: "Beach Cleanup", mandates: 2, capCents: 80000, spentCents: 55000, committedCents: 5000, remainingCents: 20000, usedPct: 75 },
      { event: "Operations", mandates: 1, capCents: 10000, spentCents: 1000, committedCents: 0, remainingCents: 9000, usedPct: 10 },
    ]);
  });
});

describe("blockedAttempts", () => {
  it("lists blocked requests in the window, newest first, with the deciding rule", () => {
    const out = blockedAttempts(rows, day("2026-10-24"), 30);
    expect(out.map((b) => [b.date.slice(0, 10), b.clause])).toEqual([
      ["2026-10-23", "M7"],
      ["2026-10-22", "M7"],
    ]);
    expect(out[0].rule).toBe("Total spend stays within the cap");
  });
  it("explains a rejection without an engine decision", () => {
    expect(blockedAttempts(rows, day("2026-10-24"), 60).at(-1)?.rule).toMatch(/treasurer or a receipt check/);
  });
});

describe("pendingReimbursements", () => {
  it("keeps waiting and failed receipts, oldest first, with hours waiting", () => {
    const out = pendingReimbursements(
      [
        { id: "a", status: "needs_approval", date: "2026-10-24T08:00:00Z" },
        { id: "b", status: "paid", date: "2026-10-20T08:00:00Z" },
        { id: "c", status: "failed", date: "2026-10-23T10:00:00Z" },
      ],
      new Date("2026-10-24T10:30:00Z"),
    );
    expect(out.map((r) => [r.id, r.waitingHours])).toEqual([
      ["c", 24],
      ["a", 2],
    ]);
  });
});
