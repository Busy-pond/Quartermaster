/**
 * Elastic in front of pgvector (Day 19), over Elasticsearch's REST API with plain
 * fetch (no client package). Off unless ELASTIC_ENABLED=true and ELASTIC_URL is set.
 * Works against Elastic Cloud (ELASTIC_API_KEY) or the free local Elasticsearch in
 * docker-compose (no key). Callers wrap it with withFallback(), so any error here
 * answers from pgvector instead.
 */
import type { PurchaseHit, SearchBackend } from "@/lib/search/adapter";
import { hybridQuery, indexMapping, INDEX, ledgerRanks, policyHits, type EsHit } from "@/lib/search/elastic-query";
import { EVENTS_INDEX, eventsMapping } from "@/lib/traces/trace";

const TIMEOUT_MS = 4000;

export const elasticInferenceId = () => process.env.ELASTIC_INFERENCE_ID || null;

async function es<T>(method: "GET" | "PUT" | "POST" | "HEAD", path: string, body?: unknown, ndjson = false, timeoutMs = TIMEOUT_MS): Promise<T> {
  const url = process.env.ELASTIC_URL;
  if (!url) throw new Error("ELASTIC_URL is not set");
  const res = await fetch(`${url.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      "Content-Type": ndjson ? "application/x-ndjson" : "application/json",
      ...(process.env.ELASTIC_API_KEY ? { Authorization: `ApiKey ${process.env.ELASTIC_API_KEY}` } : {}),
    },
    body: body === undefined ? undefined : ndjson ? String(body) : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Elastic ${method} ${path} → ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (method === "HEAD" ? undefined : await res.json()) as T;
}

const ensured = new Set<string>();

async function ensureIndex(index: string, mapping: unknown) {
  if (ensured.has(index)) return;
  const exists = await es("HEAD", `/${index}`).then(
    () => true,
    () => false,
  );
  if (!exists) await es("PUT", `/${index}`, mapping);
  ensured.add(index);
}

/** Creates the two search indices with their mappings when they don't exist yet. */
export async function ensureElasticIndices() {
  for (const index of Object.values(INDEX)) await ensureIndex(index, indexMapping(elasticInferenceId()));
}

/** The audit trail and agent traces (`qm-events`), read by the ES|QL anomaly query. */
export const ensureEventsIndex = () => ensureIndex(EVENTS_INDEX, eventsMapping);

/** Runs one ES|QL query with positional `?` params. */
export function elasticEsql(query: string, params: unknown[]) {
  return es<{ columns: { name: string; type: string }[]; values: unknown[][] }>("POST", "/_query", { query, params });
}

/** Writes documents (by id) with one _bulk call. Best effort: callers log and carry on. A bulk sync passes a longer timeout. */
export async function elasticUpsert(index: string, docs: { id: string; doc: Record<string, unknown> }[], timeoutMs = TIMEOUT_MS) {
  if (!docs.length) return;
  const body = docs.map((d) => `${JSON.stringify({ index: { _index: index, _id: d.id } })}\n${JSON.stringify(d.doc)}\n`).join("");
  const r = await es<{ errors: boolean; items: { index: { error?: { reason: string } } }[] }>("POST", "/_bulk?refresh=wait_for", body, true, timeoutMs);
  if (r.errors) throw new Error(`Elastic bulk: ${r.items.find((i) => i.index.error)?.index.error?.reason ?? "some documents failed"}`);
}

async function searchIndex<T>(index: string, body: unknown) {
  return (await es<{ hits: { hits: EsHit<T>[] } }>("POST", `/${index}/_search`, body)).hits.hits;
}

/**
 * The Elastic backend. Ledger hits are re-read from Postgres (`hydrate`), so status
 * and refunds are always current. Duplicate receipts stay on pgvector: their 0.9
 * threshold was calibrated on Gemini embeddings (Day 9), not on Elastic's scores.
 */
export function elasticBackend(deps: {
  hydrate: (ranked: { kind: "purchase" | "reimbursement"; refId: string; score: number }[]) => Promise<PurchaseHit[]>;
  similarReceipts: SearchBackend["similarReceipts"];
}): SearchBackend {
  const inferenceId = elasticInferenceId();
  return {
    name: "elastic",
    async searchPolicy(orgId, query, k = 3) {
      const hits = await searchIndex<{ clause: string; section: string; text: string }>(INDEX.policy, hybridQuery({ orgId, query, k, inferenceId }));
      return { source: "elastic", hits: policyHits(hits) };
    },
    async purchaseHistory(orgId, query, k = 5) {
      const hits = await searchIndex<{ kind: "purchase" | "reimbursement"; ref_id: string }>(INDEX.ledger, hybridQuery({ orgId, query, k, inferenceId }));
      return { source: "elastic", hits: await deps.hydrate(ledgerRanks(hits)) };
    },
    similarReceipts: deps.similarReceipts,
  };
}
