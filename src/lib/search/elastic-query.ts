/**
 * Elastic search requests and answers, the pure part (Day 19). Hybrid search is
 * Elasticsearch's RRF retriever over a keyword match and a `semantic_text` field
 * (Jina embeddings through an inference endpoint). Without an inference endpoint
 * (e.g. the free local Elasticsearch in docker-compose) it is keyword-only BM25.
 */
import type { SearchBackend } from "./adapter";

export const INDEX = { policy: "qm-policy", ledger: "qm-ledger" } as const;

/** Field mappings. `semantic` is copied from `text` and embedded by the inference endpoint, when there is one. */
export function indexMapping(inferenceId: string | null) {
  return {
    mappings: {
      properties: {
        org_id: { type: "keyword" },
        kind: { type: "keyword" },
        ref_id: { type: "keyword" },
        clause: { type: "keyword" },
        section: { type: "text", analyzer: "english" },
        text: { type: "text", analyzer: "english", ...(inferenceId ? { copy_to: "semantic" } : {}) },
        ...(inferenceId ? { semantic: { type: "semantic_text", inference_id: inferenceId } } : {}),
      },
    },
  };
}

/** One search body: filtered by org, keyword match on `text`, plus semantic match fused by RRF when available. */
export function hybridQuery(opts: { orgId: string; query: string; k: number; inferenceId: string | null; kind?: string }) {
  const filter = [{ term: { org_id: opts.orgId } }, ...(opts.kind ? [{ term: { kind: opts.kind } }] : [])];
  const keyword = { bool: { filter, must: [{ match: { text: { query: opts.query } } }] } };
  if (!opts.inferenceId) return { size: opts.k, query: keyword };
  return {
    size: opts.k,
    retriever: {
      rrf: {
        retrievers: [{ standard: { query: keyword } }, { standard: { query: { bool: { filter, must: [{ semantic: { field: "semantic", query: opts.query } }] } } } }],
        rank_window_size: Math.max(20, opts.k * 4),
      },
    },
  };
}

export interface EsHit<T> {
  _id: string;
  _score: number | null;
  _source: T;
}

/** Elastic scores aren't on pgvector's 0–1 cosine scale, so hits are ranked, and the score is the rank's share (1, 0.5, 0.33…). */
export const rankScore = (i: number) => Math.round((1 / (i + 1)) * 1000) / 1000;

export function policyHits(hits: EsHit<{ clause: string; section: string; text: string }>[]) {
  return hits.map((h, i) => ({ clause: h._source.clause, section: h._source.section, text: h._source.text, score: rankScore(i) }));
}

export function ledgerRanks(hits: EsHit<{ kind: "purchase" | "reimbursement"; ref_id: string }>[]) {
  return hits.map((h, i) => ({ kind: h._source.kind, refId: h._source.ref_id, score: rankScore(i) }));
}

/**
 * Every call tries `primary` first; on any error (down, timeout, bad key, mapping missing)
 * it logs once and answers from `fallback`, whose own `source` then says who answered.
 */
export function withFallback(primary: SearchBackend, fallback: SearchBackend, onError: (method: string, e: unknown) => void = () => {}): SearchBackend {
  const guard =
    <A extends unknown[], R>(method: keyof Omit<SearchBackend, "name">, a: (...args: A) => Promise<R>, b: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await a(...args);
      } catch (e) {
        onError(method, e);
        return b(...args);
      }
    };
  return {
    name: primary.name,
    searchPolicy: guard("searchPolicy", primary.searchPolicy, fallback.searchPolicy),
    purchaseHistory: guard("purchaseHistory", primary.purchaseHistory, fallback.purchaseHistory),
    similarReceipts: guard("similarReceipts", primary.similarReceipts, fallback.similarReceipts),
  };
}
