/**
 * Snap-to-reimburse, the pure part: no I/O, no LLM, no clock (callers pass `now`).
 *
 * Gemini only READS the receipt. This file turns what it read into a proposal
 * the mandate engine can judge, scores duplicates and runs the receipt checks.
 * All amounts are integer cents.
 */
import type { Proposal, ProposalLine } from "@/lib/mandates/engine";

export interface ReceiptItem {
  description: string;
  quantity: number;
  lineTotalCents: number;
  category: string;
}

export interface ExtractedReceipt {
  isReceipt: boolean;
  merchant: string;
  merchantDomain: string | null;
  date: string | null; // YYYY-MM-DD as printed on the receipt
  currency: string;
  items: ReceiptItem[];
  taxCents: number | null;
  totalCents: number;
  confidence: "low" | "medium" | "high";
  notes: string | null;
  source: "gemini" | "manual";
}

export const DUPLICATE_REJECT = 0.9;
export const DUPLICATE_WARN = 0.5;
export const MAX_RECEIPT_AGE_DAYS = 30; // spending policy 5.1

/** "The Home Depot #1234" → "the home depot". Used for duplicate matching. */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[#№]\s*\d+/g, " ")
    .replace(/\b(store|inc|llc|ltd|co|corp|pvt)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The vendor the mandate engine sees: the merchant's domain if known, otherwise a slug of its name. */
export function receiptVendor(r: Pick<ExtractedReceipt, "merchant" | "merchantDomain">): string {
  const d = r.merchantDomain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (d && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return d;
  return merchantKey(r.merchant).replace(/\s+/g, "-") || "unknown-merchant";
}

function dominantCategory(items: ReceiptItem[], fallback: string): string {
  const byCat = new Map<string, number>();
  for (const i of items) if (i.lineTotalCents > 0) byCat.set(i.category, (byCat.get(i.category) ?? 0) + i.lineTotalCents);
  let best = fallback;
  let max = -1;
  for (const [c, v] of byCat) if (v > max) [best, max] = [c, v];
  return best;
}

/**
 * Builds lines whose sum equals the receipt total exactly, as the engine requires.
 * Tax and fees become their own line in the main category; if discounts make the
 * items add up to more than the total, the receipt becomes a single line.
 */
export function toProposal(r: ExtractedReceipt, fallbackCategory: string): Proposal {
  const vendor = receiptVendor(r);
  const items = r.items.filter((i) => i.lineTotalCents > 0 && i.description.trim());
  const lines: ProposalLine[] = items.map((i) => {
    const qty = Number.isInteger(i.quantity) && i.quantity > 1 ? i.quantity : 1;
    return qty > 1 && i.lineTotalCents % qty === 0
      ? { description: i.description.trim(), category: i.category, unitPriceCents: i.lineTotalCents / qty, quantity: qty }
      : { description: qty > 1 ? `${qty}× ${i.description.trim()}` : i.description.trim(), category: i.category, unitPriceCents: i.lineTotalCents, quantity: 1 };
  });
  const main = dominantCategory(items, fallbackCategory);
  const sum = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const residual = r.totalCents - sum;

  const single = (): Proposal => ({
    vendor,
    currency: r.currency,
    totalCents: r.totalCents,
    lines: [{ description: `Receipt from ${r.merchant || "unknown merchant"}`, category: main, unitPriceCents: r.totalCents, quantity: 1 }],
  });

  if (lines.length === 0 || residual < 0) return single();
  if (residual > 0) lines.push({ description: "Tax and fees", category: main, unitPriceCents: residual, quantity: 1 });
  return { vendor, currency: r.currency, totalCents: r.totalCents, lines };
}

export interface PriorReceipt {
  id: string;
  imageHash: string | null;
  merchant: string | null;
  receiptDate: string | null;
  totalCents: number | null;
}

export interface DuplicateResult {
  score: number;
  matchId: string | null;
  reason: string | null;
}

/** Scores how likely this receipt was already submitted. Pass earlier receipts that were not rejected. */
export function duplicateScore(c: { imageHash: string; merchant: string; date: string | null; totalCents: number }, prior: PriorReceipt[]): DuplicateResult {
  let best: DuplicateResult = { score: 0, matchId: null, reason: null };
  const key = merchantKey(c.merchant);
  for (const p of prior) {
    let score = 0;
    let reason: string | null = null;
    if (p.imageHash && p.imageHash === c.imageHash) {
      score = 1;
      reason = "The same photo was already submitted";
    } else if (p.totalCents === c.totalCents && c.date && p.receiptDate === c.date) {
      const pk = merchantKey(p.merchant ?? "");
      const sameMerchant = !!key && !!pk && (pk === key || pk.includes(key) || key.includes(pk));
      score = sameMerchant ? 0.95 : 0.6;
      reason = sameMerchant ? "A receipt with the same merchant, date and total was already submitted" : "A receipt with the same date and total was already submitted";
    }
    if (score > best.score) best = { score, matchId: p.id, reason };
  }
  return best;
}

export type CheckState = "pass" | "warn" | "fail";
export interface ReceiptCheck {
  id: "R1" | "R2" | "R3" | "R4" | "R5";
  label: string;
  state: CheckState;
  message: string | null;
}

export const RECEIPT_CHECKS = {
  R1: "Photo is a readable receipt",
  R2: `Dated within the last ${MAX_RECEIPT_AGE_DAYS} days`,
  R3: "Not already reimbursed",
  R4: "Items add up to the total",
  R5: "Volunteer has a PayPal account on file",
} as const;

const DAY = 86_400_000;

export function receiptChecks(r: ExtractedReceipt, dup: DuplicateResult, opts: { now: Date; hasPayee: boolean }): ReceiptCheck[] {
  const check = (id: ReceiptCheck["id"], state: CheckState, message: string | null = null): ReceiptCheck => ({ id, label: RECEIPT_CHECKS[id], state, message });
  const out: ReceiptCheck[] = [];

  // R1 readable
  if (r.source === "manual") out.push(check("R1", "warn", "Details were typed in by hand. Compare them with the photo."));
  else if (!r.isReceipt) out.push(check("R1", "fail", "This doesn't look like a receipt."));
  else if (r.totalCents <= 0) out.push(check("R1", "fail", "No total could be read from the photo."));
  else if (r.confidence === "low") out.push(check("R1", "warn", "The photo was hard to read. Compare the details with the photo."));
  else out.push(check("R1", "pass"));

  // R2 date
  const t = r.date ? Date.parse(`${r.date}T12:00:00Z`) : NaN;
  if (Number.isNaN(t)) out.push(check("R2", "warn", "No date could be read from the receipt."));
  else if (t - opts.now.getTime() > DAY) out.push(check("R2", "warn", `The receipt is dated ${r.date}, which is in the future.`));
  else {
    const age = Math.floor((opts.now.getTime() - t) / DAY);
    out.push(age > MAX_RECEIPT_AGE_DAYS ? check("R2", "warn", `The receipt is ${age} days old; policy 5.1 asks for receipts within ${MAX_RECEIPT_AGE_DAYS} days.`) : check("R2", "pass"));
  }

  // R3 duplicates
  if (dup.score >= DUPLICATE_REJECT) out.push(check("R3", "fail", dup.reason));
  else if (dup.score >= DUPLICATE_WARN) out.push(check("R3", "warn", dup.reason));
  else out.push(check("R3", "pass"));

  // R4 arithmetic (only when items were read)
  const items = r.items.reduce((s, i) => s + i.lineTotalCents, 0);
  if (r.items.length === 0) out.push(check("R4", r.source === "manual" ? "pass" : "warn", r.source === "manual" ? null : "No item lines could be read; only the total."));
  else {
    const diff = r.totalCents - items - (r.taxCents ?? 0);
    out.push(Math.abs(diff) <= 2 ? check("R4", "pass") : check("R4", "warn", `Items${r.taxCents ? " plus tax" : ""} come to ${(items + (r.taxCents ?? 0)) / 100}, the total says ${r.totalCents / 100}.`));
  }

  // R5 payee
  out.push(opts.hasPayee ? check("R5", "pass") : check("R5", "warn", "No PayPal email for this volunteer. Set SANDBOX_VOLUNTEER_EMAIL in .env.local before approving."));
  return out;
}

/** Turns dollars from the model into cents without float drift (12.34 → 1234). */
export const toCents = (dollars: number | null | undefined) => (dollars == null || !Number.isFinite(dollars) ? 0 : Math.round(dollars * 100));
