/**
 * The treasurer's data as flat tables for AG Studio (Day 17), the pure part.
 * Money is in dollars here because Studio's currency format works on numbers;
 * the cents → dollars step happens once, in this file. Every row is live ledger
 * data; nothing here is sample data.
 */
import type { DashboardData } from "./load";
import { firedClauses, resultOf, ruleLabel } from "./insights";

const usd = (cents: number) => cents / 100;

export function studioTables(d: DashboardData) {
  const mandateIdOf = new Map(d.envelopes.map((e) => [e.title, e.mandateId]));
  return {
    mandates: d.envelopes.map((e) => ({
      id: e.mandateId,
      mandate: e.title,
      event: e.event ?? "Standing budget",
      cap: usd(e.capCents),
      spent: usd(e.spentCents),
      committed: usd(e.committedCents),
      left: usd(e.remainingCents),
      used_pct: e.usedPct,
      blocked: e.blocked,
    })),
    payments: d.payments.map((p) => ({
      id: p.id,
      date: new Date(p.date),
      vendor: p.vendor,
      items: p.items,
      mandate_id: p.mandateId,
      mandate: p.mandate,
      amount: usd(p.amountCents),
      status: p.status,
      rule: p.clause,
    })),
    reimbursements: d.reimbursements.map((r) => ({
      id: r.id,
      submitted: new Date(r.date),
      volunteer: r.volunteer,
      merchant: r.merchant,
      mandate_id: r.mandateId ?? mandateIdOf.get(r.mandate) ?? "",
      mandate: r.mandate,
      amount: usd(r.amountCents),
      status: r.status,
    })),
    decisions: d.decided.map((r) => ({
      id: r.id,
      date: r.createdAt,
      kind: r.kind === "purchase" ? "Purchase" : "Reimbursement",
      mandate_id: r.mandateId ?? "",
      mandate: r.mandate,
      result: resultOf(r),
      amount: usd(r.totalCents),
      clause: r.decision?.clause ?? "—",
    })),
    rule_checks: d.decided.flatMap((r) =>
      firedClauses(r).map((clause) => ({
        id: `${r.id}:${clause}`,
        decision_id: r.id,
        mandate_id: r.mandateId ?? "",
        mandate: r.mandate,
        clause,
        rule: ruleLabel(clause),
        outcome: r.decision?.reasons.some((x) => x.clause === clause && x.outcome === "deny") ? "blocked" : "sent to the treasurer",
      })),
    ),
  };
}

export type StudioTables = ReturnType<typeof studioTables>;
