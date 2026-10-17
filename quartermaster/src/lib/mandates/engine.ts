/**
 * Mandate engine — the only code that decides whether money may move.
 *
 * Pure and deterministic: no I/O, no LLM, no clock (the caller passes `now`).
 * All amounts are integer minor units (cents) so there is no float rounding.
 *
 * The agent PROPOSES a purchase; this function DECIDES; separate code EXECUTES
 * the PayPal call. An LLM can never talk its way past a rule here.
 */

export type MandateStatus = "draft" | "active" | "revoked";

export interface Mandate {
  id: string;
  status: MandateStatus;
  currency: string; // ISO 4217, e.g. "USD"
  capCents: number; // total the mandate may ever spend
  perItemAutoLimitCents: number; // a unit price above this needs a human
  perOrderAutoLimitCents: number; // an order total above this needs a human
  categories: string[]; // allowed categories (lower-case)
  vendorAllowlist: string[]; // allowed vendor domains; empty = any vendor
  startsAt: string | null; // ISO timestamp
  expiresAt: string; // ISO timestamp
  approverIds: string[]; // who may approve when approval is needed
}

export interface ProposalLine {
  description: string;
  category: string;
  unitPriceCents: number;
  quantity: number;
}

export interface Proposal {
  vendor: string; // vendor domain, e.g. "acme-supplies.com"
  currency: string;
  totalCents: number; // must equal the sum of the lines
  lines: ProposalLine[];
}

export interface LedgerEntry {
  vendor: string;
  category: string;
  totalCents: number;
  createdAt: string; // ISO timestamp
}

export interface Ledger {
  spentCents: number; // captured payments under this mandate
  committedCents: number; // approved but not yet captured
  recent: LedgerEntry[]; // recent payments, used to catch split purchases
}

export type Outcome = "allow" | "needs_approval" | "deny";

export interface Reason {
  clause: string; // stable id shown on trust receipts, e.g. "M7"
  outcome: Exclude<Outcome, "allow">;
  message: string;
}

export interface Decision {
  outcome: Outcome;
  clause: string; // the deciding clause ("OK" when allowed)
  message: string;
  reasons: Reason[];
  remainingAfterCents: number; // cap headroom if this proposal goes through
}

export const CLAUSES = {
  M0: "Proposal is well-formed",
  M1: "Mandate is active",
  M2: "Mandate has started",
  M3: "Mandate has not expired",
  M4: "Currency matches the mandate",
  M5: "Every item is in an allowed category",
  M6: "Vendor is on the allowlist",
  M7: "Total spend stays within the cap",
  M8: "Unit prices within the auto-approve limit",
  M9: "Order total within the auto-approve limit",
  M10: "No split purchases to dodge the auto-approve limit",
} as const;

export const SPLIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const isPosInt = (n: number) => Number.isInteger(n) && n > 0;
const isNonNegInt = (n: number) => Number.isInteger(n) && n >= 0;
const norm = (s: string) => s.trim().toLowerCase();

function fmt(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

/** Checks the proposal itself before any mandate rule is applied. */
function validate(p: Proposal): string | null {
  if (!p.vendor || !p.vendor.trim()) return "Proposal has no vendor";
  if (!/^[A-Z]{3}$/.test(p.currency)) return "Currency must be a 3-letter ISO code";
  if (!Array.isArray(p.lines) || p.lines.length === 0) return "Proposal has no items";
  for (const l of p.lines) {
    if (!isPosInt(l.quantity)) return `Quantity for "${l.description}" must be a positive whole number`;
    if (!isPosInt(l.unitPriceCents)) return `Price for "${l.description}" must be a positive amount in cents`;
    if (!l.category || !l.category.trim()) return `"${l.description}" has no category`;
  }
  if (!isPosInt(p.totalCents)) return "Total must be a positive amount in cents";
  const sum = p.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  if (sum !== p.totalCents) return `Total ${p.totalCents} does not equal the sum of items ${sum}`;
  return null;
}

export function evaluate(
  mandate: Mandate,
  proposal: Proposal,
  ledger: Ledger,
  now: Date,
): Decision {
  const reasons: Reason[] = [];
  const deny = (clause: keyof typeof CLAUSES, message: string) =>
    reasons.push({ clause, outcome: "deny", message });
  const ask = (clause: keyof typeof CLAUSES, message: string) =>
    reasons.push({ clause, outcome: "needs_approval", message });

  const headroom = mandate.capCents - ledger.spentCents - ledger.committedCents;

  // M0 — a malformed proposal is denied outright; nothing else is meaningful.
  const invalid = validate(proposal);
  if (invalid) {
    deny("M0", invalid);
    return finish(reasons, headroom);
  }
  if (!isNonNegInt(ledger.spentCents) || !isNonNegInt(ledger.committedCents)) {
    deny("M0", "Ledger amounts must be whole, non-negative cents");
    return finish(reasons, headroom);
  }

  const t = now.getTime();

  // M1–M3: lifecycle
  if (mandate.status !== "active") deny("M1", `Mandate is ${mandate.status}`);
  if (mandate.startsAt && t < Date.parse(mandate.startsAt))
    deny("M2", `Mandate starts ${mandate.startsAt}`);
  if (t >= Date.parse(mandate.expiresAt)) deny("M3", `Mandate expired ${mandate.expiresAt}`);

  // M4: currency
  if (proposal.currency !== mandate.currency)
    deny("M4", `Mandate is in ${mandate.currency}, proposal is in ${proposal.currency}`);

  // M5: categories
  const allowed = new Set(mandate.categories.map(norm));
  const badCats = [...new Set(proposal.lines.map((l) => norm(l.category)).filter((c) => !allowed.has(c)))];
  if (badCats.length) deny("M5", `Category not allowed: ${badCats.join(", ")}`);

  // M6: vendors
  const vendor = norm(proposal.vendor);
  if (mandate.vendorAllowlist.length && !mandate.vendorAllowlist.map(norm).includes(vendor))
    deny("M6", `Vendor ${vendor} is not on the allowlist`);

  // M7: cap (counts money already spent AND already committed)
  if (proposal.totalCents > headroom)
    deny(
      "M7",
      `Would exceed the cap: ${fmt(proposal.totalCents, proposal.currency)} requested, ${fmt(Math.max(headroom, 0), mandate.currency)} left`,
    );

  // M8: per-item auto limit
  const pricey = proposal.lines.filter((l) => l.unitPriceCents > mandate.perItemAutoLimitCents);
  if (pricey.length)
    ask(
      "M8",
      `${pricey.map((l) => l.description).join(", ")} above the ${fmt(mandate.perItemAutoLimitCents, mandate.currency)} per-item auto limit`,
    );

  // M9: per-order auto limit
  if (proposal.totalCents > mandate.perOrderAutoLimitCents)
    ask("M9", `Order total above the ${fmt(mandate.perOrderAutoLimitCents, mandate.currency)} auto limit`);

  // M10: split purchases — same vendor + overlapping category inside the window
  else {
    const cats = new Set(proposal.lines.map((l) => norm(l.category)));
    const prior = ledger.recent
      .filter(
        (e) =>
          norm(e.vendor) === vendor &&
          cats.has(norm(e.category)) &&
          t - Date.parse(e.createdAt) >= 0 &&
          t - Date.parse(e.createdAt) < SPLIT_WINDOW_MS,
      )
      .reduce((s, e) => s + e.totalCents, 0);
    if (prior > 0 && prior + proposal.totalCents > mandate.perOrderAutoLimitCents)
      ask(
        "M10",
        `Together with ${fmt(prior, mandate.currency)} bought from ${vendor} in the last 24h this exceeds the auto limit`,
      );
  }

  return finish(reasons, headroom - proposal.totalCents);
}

function finish(reasons: Reason[], remainingAfterCents: number): Decision {
  const denial = reasons.find((r) => r.outcome === "deny");
  const approval = reasons.find((r) => r.outcome === "needs_approval");
  const decider = denial ?? approval;
  return {
    outcome: denial ? "deny" : approval ? "needs_approval" : "allow",
    clause: decider?.clause ?? "OK",
    message: decider?.message ?? "Within every mandate rule",
    reasons,
    remainingAfterCents,
  };
}
