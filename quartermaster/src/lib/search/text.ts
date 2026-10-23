/**
 * Search, the pure part: chunking the policy, the texts that get embedded, a
 * keyword fallback for when embeddings are unavailable, and the rule that turns
 * a similarity score into a "possible duplicate" warning. No I/O.
 */

export interface PolicyChunk {
  clause: string; // "3.3"
  section: string; // "Quotes and approval"
  text: string; // "Orders above $250 should compare at least two vendors; ..."
}

/** Splits the policy into one chunk per numbered clause ("3.3 ..."), keeping its section heading ("3. Quotes and approval"). */
export function chunkPolicy(policy: string): PolicyChunk[] {
  const chunks: PolicyChunk[] = [];
  let section = "";
  let current: PolicyChunk | null = null;
  for (const raw of policy.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^(\d+)\.\s+(\D.*)$/);
    const clause = line.match(/^(\d+\.\d+)\s+(.*)$/);
    if (clause) {
      if (current) chunks.push(current);
      current = { clause: clause[1], section, text: clause[2].trim() };
    } else if (heading) {
      if (current) chunks.push(current);
      current = null;
      section = heading[2].trim();
    } else if (line && current && !line.startsWith("#")) {
      current.text += ` ${line}`;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** What gets embedded for a policy clause. The section name helps short clauses match. */
export const policyChunkText = (c: PolicyChunk) => `Policy ${c.clause} (${c.section}): ${c.text}`;

/** What gets embedded for a purchase or a reimbursement, so "trash bags" finds "Heavy-duty trash bags (100)". */
export function ledgerText(e: { kind: "purchase" | "reimbursement"; vendor: string | null; lines: { description: string; category: string }[]; merchant?: string | null }): string {
  const items = e.lines.filter((l) => !/^tax and fees$/i.test(l.description)).map((l) => `${l.description} (${l.category})`);
  return `${e.kind === "purchase" ? "Purchase" : "Reimbursed receipt"} from ${e.merchant || e.vendor || "unknown vendor"}: ${items.join("; ") || "no item lines"}`;
}

/** The receipt fingerprint for duplicate search: who, when, how much and what. */
export function receiptFingerprint(r: { merchant: string | null; date: string | null; totalCents: number | null; items: string[] }): string {
  return `Receipt from ${r.merchant || "unknown store"} on ${r.date ?? "unknown date"}, total ${((r.totalCents ?? 0) / 100).toFixed(2)}: ${r.items.join("; ")}`;
}

const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "is", "are", "do", "we", "i", "it", "this", "that", "be", "with", "our", "need", "can", "what", "how", "does", "any"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9$.\s]/g, " ").split(/\s+/).map((w) => w.replace(/^\.+|\.+$/g, "")).filter((w) => w.length > 1 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");

/** Keyword fallback: share of the query's words (stemmed) found in the text, 0..1. */
export function keywordScore(query: string, text: string): number {
  const q = [...new Set(words(query).map(stem))];
  if (q.length === 0) return 0;
  const t = new Set(words(text).map(stem));
  return q.filter((w) => t.has(w)).length / q.length;
}

/**
 * Above this cosine similarity two receipt fingerprints describe the same purchase.
 * Calibrated on gemini-embedding-2 (768 dims, Oct 23): the same receipt read differently
 * scored 0.96–0.98; another trip to the same store 0.79; a different store 0.72.
 */
export const SEMANTIC_DUPLICATE = 0.9;

/**
 * A meaning-level match only warns (the treasurer decides): it needs a very similar
 * fingerprint AND totals within 5%, because two shopping trips to one store look alike.
 */
export function semanticDuplicate(similarity: number, totalCents: number | null, priorTotalCents: number | null): boolean {
  if (similarity < SEMANTIC_DUPLICATE || !totalCents || !priorTotalCents) return false;
  return Math.abs(totalCents - priorTotalCents) <= Math.max(totalCents, priorTotalCents) * 0.05;
}
