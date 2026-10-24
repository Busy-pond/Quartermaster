/**
 * The search adapter's contract (Day 9, made pluggable on Day 19). Everything that
 * searches by meaning (policy clauses, purchase history, duplicate receipts) calls a
 * SearchBackend. pgvector is the default; Elastic can sit in front of it, and every
 * answer says which backend produced it. Pure: no database, no network.
 */

export type SearchSource = "elastic" | "pgvector" | "keyword";

export interface PolicyHit {
  clause: string;
  section: string;
  text: string;
  score: number;
}

export interface PurchaseHit {
  kind: "purchase" | "reimbursement";
  id: string;
  vendor: string;
  items: { description: string; quantity: number; unitPriceCents: number }[];
  totalCents: number;
  currency: string;
  status: string;
  date: string;
  score: number;
}

export interface ReceiptMatch {
  id: string;
  similarity: number;
  totalCents: number | null;
  merchant: string | null;
  receiptDate: string | null;
}

export interface SearchBackend {
  name: "elastic" | "pgvector";
  searchPolicy(orgId: string, query: string, k?: number): Promise<{ source: SearchSource; hits: PolicyHit[] }>;
  purchaseHistory(orgId: string, query: string, k?: number): Promise<{ source: SearchSource; hits: PurchaseHit[] }>;
  similarReceipts(orgId: string, fingerprint: string, excludeId?: string, k?: number): Promise<ReceiptMatch[]>;
}

/** pgvector unless an Elastic backend is supplied (i.e. its flag is on and it is configured). */
export function pickBackend(backends: { pgvector: SearchBackend; elastic?: SearchBackend | null }): SearchBackend {
  return backends.elastic ?? backends.pgvector;
}
