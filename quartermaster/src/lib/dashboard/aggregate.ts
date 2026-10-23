/**
 * Treasurer dashboard figures, the pure part (Day 12). Rows in, chart data out.
 * Spent = captured purchases + paid reimbursements; refunded money is not spent.
 */

export interface LedgerRow {
  kind: "purchase" | "reimbursement";
  mandateId: string | null;
  status: string; // payment or reimbursement status
  totalCents: number;
  lines: { category: string; unitPriceCents: number; quantity: number }[];
  createdAt: Date;
}

export const isSpent = (r: Pick<LedgerRow, "kind" | "status">) => (r.kind === "purchase" ? r.status === "captured" : r.status === "paid");
export const isCommitted = (r: Pick<LedgerRow, "kind" | "status">) => r.status === "approved";
const isBlocked = (r: Pick<LedgerRow, "kind" | "status">) => (r.kind === "purchase" ? r.status === "denied" : r.status === "rejected");

/** Spent and committed per category, in cents, largest first. */
export function spendByCategory(rows: LedgerRow[]): { category: string; spentCents: number; committedCents: number }[] {
  const by = new Map<string, { spentCents: number; committedCents: number }>();
  for (const r of rows) {
    const spent = isSpent(r);
    if (!spent && !isCommitted(r)) continue;
    for (const l of r.lines) {
      const e = by.get(l.category) ?? { spentCents: 0, committedCents: 0 };
      e[spent ? "spentCents" : "committedCents"] += l.unitPriceCents * l.quantity;
      by.set(l.category, e);
    }
  }
  return [...by.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.spentCents + b.committedCents - (a.spentCents + a.committedCents));
}

/** Blocked attempts and refunds per day (YYYY-MM-DD, UTC) over the last `days` days, zero-filled. */
export function exceptionsOverTime(rows: LedgerRow[], now: Date, days = 14): { day: string; blocked: number; refunded: number; refundedCents: number }[] {
  const out = new Map<string, { blocked: number; refunded: number; refundedCents: number }>();
  for (let i = days - 1; i >= 0; i--) out.set(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10), { blocked: 0, refunded: 0, refundedCents: 0 });
  for (const r of rows) {
    const e = out.get(r.createdAt.toISOString().slice(0, 10));
    if (!e) continue;
    if (isBlocked(r)) e.blocked++;
    if (r.status === "refunded") {
      e.refunded++;
      e.refundedCents += r.totalCents;
    }
  }
  return [...out.entries()].map(([day, v]) => ({ day, ...v }));
}

export interface Envelope {
  mandateId: string;
  title: string;
  event: string | null;
  capCents: number;
  spentCents: number;
  committedCents: number;
  remainingCents: number;
  usedPct: number; // 0..100+, spent + committed over the cap
  blocked: number;
}

/** One budget envelope per mandate, from the same ledger rules the engine uses. */
export function envelopes(mandates: { id: string; title: string; capCents: number; event: string | null }[], rows: LedgerRow[]): Envelope[] {
  return mandates.map((m) => {
    const mine = rows.filter((r) => r.mandateId === m.id);
    const spentCents = mine.filter(isSpent).reduce((s, r) => s + r.totalCents, 0);
    const committedCents = mine.filter(isCommitted).reduce((s, r) => s + r.totalCents, 0);
    return {
      mandateId: m.id,
      title: m.title,
      event: m.event,
      capCents: m.capCents,
      spentCents,
      committedCents,
      remainingCents: m.capCents - spentCents - committedCents,
      usedPct: m.capCents > 0 ? Math.round(((spentCents + committedCents) / m.capCents) * 1000) / 10 : 0,
      blocked: mine.filter(isBlocked).length,
    };
  });
}
