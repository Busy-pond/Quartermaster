/**
 * Treasurer insights, the pure part (Day 17–18). The AG Studio widgets and the
 * Studio "Treasurer" agent both read these, so a number on a widget and a number
 * the agent quotes always come from the same rules (envelopes() in aggregate.ts).
 */
import { CLAUSES, type Decision } from "@/lib/mandates/engine";
import type { Envelope } from "./aggregate";

/** One purchase attempt or receipt, with the engine's decision when it has one. */
export interface DecidedRow {
  kind: "purchase" | "reimbursement";
  id: string;
  mandateId: string | null;
  mandate: string;
  label: string; // the items, or the receipt's merchant
  status: string; // payment or reimbursement status
  totalCents: number;
  decision: Pick<Decision, "outcome" | "clause" | "message" | "reasons"> | null;
  createdAt: Date;
}

/**
 * Waiting on the treasurer: a purchase or receipt that needs approval, or a payout to retry.
 * The one rule behind every "waiting" figure (classic dashboard, Studio widgets, the agent).
 */
export const awaitsTreasurer = (r: Pick<DecidedRow, "kind" | "status">) => r.status === "needs_approval" || (r.kind === "reimbursement" && r.status === "failed");

/** What happened to a request, in the treasurer's words. Pre-approved = inside the mandate's auto-approve limits (the "Pre-approved" stamp). Checking = a receipt still being read. */
export type Result = "pre-approved" | "treasurer-approved" | "waiting" | "blocked" | "checking";

export function resultOf(r: Pick<DecidedRow, "kind" | "status" | "decision">): Result {
  if (r.kind === "purchase" ? r.status === "denied" : r.status === "rejected") return "blocked";
  if (awaitsTreasurer(r)) return "waiting";
  if (r.status === "submitted") return "checking";
  return r.decision?.outcome === "allow" ? "pre-approved" : "treasurer-approved";
}

export const ruleLabel = (clause: string) => CLAUSES[clause as keyof typeof CLAUSES] ?? clause;

/** The clauses that fired on a row (blocked it or sent it to the treasurer), each counted once. */
export const firedClauses = (r: Pick<DecidedRow, "decision">) => [...new Set((r.decision?.reasons ?? []).map((x) => x.clause))];

export interface Health {
  attempts: number;
  preApproved: number;
  treasurerApproved: number;
  waiting: number;
  blocked: number;
  /** Let through (by the rules or the treasurer) out of everything already decided; null when nothing is decided yet. */
  approvalRatePct: number | null;
  topRules: { clause: string; rule: string; count: number }[];
}

const clauseOrder = (c: string) => Number(c.replace(/\D/g, "")) || 0;

export function health(results: Result[], clauses: string[], top = 5): Health {
  const count = (x: Result) => results.filter((r) => r === x).length;
  const [preApproved, treasurerApproved, waiting, blocked] = (["pre-approved", "treasurer-approved", "waiting", "blocked"] as const).map(count);
  const decided = preApproved + treasurerApproved + blocked;
  const tally = new Map<string, number>();
  for (const c of clauses) tally.set(c, (tally.get(c) ?? 0) + 1);
  return {
    attempts: results.length,
    preApproved,
    treasurerApproved,
    waiting,
    blocked,
    approvalRatePct: decided ? Math.round(((preApproved + treasurerApproved) / decided) * 1000) / 10 : null,
    topRules: [...tally.entries()]
      .sort((a, b) => b[1] - a[1] || clauseOrder(a[0]) - clauseOrder(b[0]))
      .slice(0, top)
      .map(([clause, count]) => ({ clause, rule: ruleLabel(clause), count })),
  };
}

/** Mandate health overall and per mandate: blocked attempts, approval rate, the rules that fired most. */
export function mandateHealth(rows: DecidedRow[]) {
  const of = (list: DecidedRow[]) => health(list.map(resultOf), list.flatMap(firedClauses));
  const ids = [...new Set(rows.map((r) => r.mandateId))];
  return {
    overall: of(rows),
    byMandate: ids.map((id) => {
      const mine = rows.filter((r) => r.mandateId === id);
      return { mandateId: id, mandate: mine[0]?.mandate ?? "—", ...of(mine) };
    }),
  };
}

/** Mandates whose spent + approved-not-yet-paid is at or above `pct` of the cap, fullest first. */
export function overBudgetShare(list: Envelope[], pct: number) {
  return list.filter((e) => e.usedPct >= pct).sort((a, b) => b.usedPct - a.usedPct);
}

/** Spend per event; a standing budget (no event) is its own line, under the mandate's title. */
export function spendByEvent(list: Envelope[]) {
  const by = new Map<string, { event: string; mandates: number; capCents: number; spentCents: number; committedCents: number; remainingCents: number }>();
  for (const e of list) {
    const key = e.event ?? e.title;
    const g = by.get(key) ?? { event: key, mandates: 0, capCents: 0, spentCents: 0, committedCents: 0, remainingCents: 0 };
    g.mandates++;
    g.capCents += e.capCents;
    g.spentCents += e.spentCents;
    g.committedCents += e.committedCents;
    g.remainingCents += e.remainingCents;
    by.set(key, g);
  }
  return [...by.values()]
    .map((g) => ({ ...g, usedPct: g.capCents > 0 ? Math.round(((g.spentCents + g.committedCents) / g.capCents) * 1000) / 10 : 0 }))
    .sort((a, b) => b.spentCents + b.committedCents - (a.spentCents + a.committedCents));
}

/** Blocked attempts, newest first, with the rule that decided each one. */
export function blockedAttempts(rows: DecidedRow[], now: Date, days = 30) {
  const since = now.getTime() - days * 86_400_000;
  return rows
    .filter((r) => resultOf(r) === "blocked" && r.createdAt.getTime() >= since)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      date: r.createdAt.toISOString(),
      mandate: r.mandate,
      label: r.label,
      amountCents: r.totalCents,
      clause: r.decision?.clause ?? "—",
      rule: r.decision ? ruleLabel(r.decision.clause) : "Rejected by the treasurer or a receipt check",
      message: r.decision?.message ?? null,
    }));
}

/** Receipts waiting for the treasurer (or a payout to retry), oldest first. */
export function pendingReimbursements<T extends { status: string; date: string }>(rows: T[], now: Date) {
  return rows
    .filter((r) => awaitsTreasurer({ kind: "reimbursement", status: r.status }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ ...r, waitingHours: Math.max(0, Math.floor((now.getTime() - new Date(r.date).getTime()) / 3_600_000)) }));
}
