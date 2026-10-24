import { describe, expect, it } from "vitest";
import type { SearchBackend } from "./adapter";
import { hybridQuery, indexMapping, ledgerRanks, policyHits, rankScore, withFallback } from "./elastic-query";

describe("hybridQuery", () => {
  it("is keyword-only BM25, filtered by org, without an inference endpoint", () => {
    expect(hybridQuery({ orgId: "o1", query: "two quotes", k: 3, inferenceId: null })).toEqual({
      size: 3,
      query: { bool: { filter: [{ term: { org_id: "o1" } }], must: [{ match: { text: { query: "two quotes" } } }] } },
    });
  });
  it("fuses keyword and semantic retrievers with RRF, both filtered by org (and kind)", () => {
    const q = hybridQuery({ orgId: "o1", query: "gloves", k: 5, inferenceId: ".jina", kind: "purchase" }) as { retriever: { rrf: { retrievers: { standard: { query: { bool: { filter: unknown[]; must: unknown[] } } } }[]; rank_window_size: number } } };
    const [kw, sem] = q.retriever.rrf.retrievers.map((r) => r.standard.query.bool);
    expect(kw.filter).toEqual([{ term: { org_id: "o1" } }, { term: { kind: "purchase" } }]);
    expect(sem.filter).toEqual(kw.filter);
    expect(sem.must).toEqual([{ semantic: { field: "semantic", query: "gloves" } }]);
    expect(q.retriever.rrf.rank_window_size).toBe(20);
  });
});

describe("indexMapping", () => {
  it("adds a semantic_text field only with an inference endpoint", () => {
    expect(indexMapping(null).mappings.properties).not.toHaveProperty("semantic");
    expect(indexMapping(".jina").mappings.properties).toMatchObject({ text: { copy_to: "semantic" }, semantic: { type: "semantic_text", inference_id: ".jina" } });
  });
});

describe("hit parsing", () => {
  it("scores by rank, since Elastic scores aren't on pgvector's scale", () => {
    expect([0, 1, 2].map(rankScore)).toEqual([1, 0.5, 0.333]);
    expect(policyHits([{ _id: "a", _score: 9.1, _source: { clause: "3.3", section: "Quotes", text: "t" } }])).toEqual([{ clause: "3.3", section: "Quotes", text: "t", score: 1 }]);
    expect(ledgerRanks([{ _id: "x", _score: null, _source: { kind: "purchase", ref_id: "p1" } }])).toEqual([{ kind: "purchase", refId: "p1", score: 1 }]);
  });
});

describe("withFallback", () => {
  const pg: SearchBackend = {
    name: "pgvector",
    searchPolicy: async () => ({ source: "pgvector", hits: [] }),
    purchaseHistory: async () => ({ source: "pgvector", hits: [] }),
    similarReceipts: async () => [],
  };
  const broken: SearchBackend = {
    name: "elastic",
    searchPolicy: async () => {
      throw new Error("ECONNREFUSED");
    },
    purchaseHistory: async () => {
      throw new Error("401");
    },
    similarReceipts: async () => {
      throw new Error("timeout");
    },
  };
  it("answers from pgvector on any error, and reports each failure", async () => {
    const seen: string[] = [];
    const s = withFallback(broken, pg, (m) => seen.push(m));
    expect((await s.searchPolicy("o", "q")).source).toBe("pgvector");
    expect((await s.purchaseHistory("o", "q")).source).toBe("pgvector");
    expect(await s.similarReceipts("o", "f")).toEqual([]);
    expect(seen).toEqual(["searchPolicy", "purchaseHistory", "similarReceipts"]);
  });
  it("passes Elastic's answer through when it works", async () => {
    const ok: SearchBackend = { ...pg, name: "elastic", searchPolicy: async () => ({ source: "elastic", hits: [] }) };
    expect((await withFallback(ok, pg).searchPolicy("o", "q")).source).toBe("elastic");
  });
});
