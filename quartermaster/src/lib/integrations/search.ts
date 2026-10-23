/**
 * Search adapter (Day 9). Everything that searches by meaning goes through
 * `search()`, so Elastic (Day 19) can be put in front later with pgvector as
 * its fallback. Each method falls back to keyword matching when embeddings are
 * unavailable, and says which one answered.
 */
import { and, cosineDistance, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SPENDING_POLICY } from "@/lib/policy";
import { chunkPolicy, keywordScore, ledgerText, policyChunkText, receiptFingerprint } from "@/lib/search/text";
import { embedText, embedTexts } from "./embeddings";

export type SearchSource = "pgvector" | "keyword";

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
  name: string;
  searchPolicy(orgId: string, query: string, k?: number): Promise<{ source: SearchSource; hits: PolicyHit[] }>;
  purchaseHistory(orgId: string, query: string, k?: number): Promise<{ source: SearchSource; hits: PurchaseHit[] }>;
  similarReceipts(orgId: string, fingerprint: string, excludeId?: string, k?: number): Promise<ReceiptMatch[]>;
}

const similarity = (col: Parameters<typeof cosineDistance>[0], v: number[]) => sql<number>`1 - (${cosineDistance(col, v)})`;

// ---------------------------------------------------------------- indexing

/** (Re)builds the org's policy chunks with embeddings. Called by the seed and `npm run db:index`. */
export async function indexPolicy(orgId: string, policy = SPENDING_POLICY) {
  const chunks = chunkPolicy(policy);
  const vectors = await embedTexts(chunks.map(policyChunkText), "document");
  await db().delete(schema.policyChunks).where(eq(schema.policyChunks.orgId, orgId));
  await db()
    .insert(schema.policyChunks)
    .values(chunks.map((c, i) => ({ orgId, clause: c.clause, section: c.section, text: c.text, embedding: vectors?.[i] ?? null })));
  return { chunks: chunks.length, embedded: vectors ? chunks.length : 0 };
}

/** Best effort: a failure here is logged and never blocks the purchase or the receipt. */
async function upsertIndex(orgId: string, kind: "purchase" | "reimbursement", refId: string, text: string) {
  try {
    const v = await embedText(text, "document");
    if (!v) return false;
    await db()
      .insert(schema.searchIndex)
      .values({ orgId, kind, refId, text, embedding: v })
      .onConflictDoUpdate({ target: [schema.searchIndex.kind, schema.searchIndex.refId], set: { text, embedding: v } });
    return true;
  } catch (e) {
    console.error(`Indexing ${kind} ${refId} failed`, e instanceof Error ? e.message : e);
    return false;
  }
}

export function indexPurchase(p: Pick<typeof schema.payments.$inferSelect, "id" | "orgId" | "vendor" | "lines">) {
  return upsertIndex(p.orgId, "purchase", p.id, ledgerText({ kind: "purchase", vendor: p.vendor, lines: p.lines }));
}

export function indexReimbursement(r: Pick<typeof schema.reimbursements.$inferSelect, "id" | "orgId" | "merchant" | "receiptDate" | "totalCents" | "lines">) {
  return upsertIndex(r.orgId, "reimbursement", r.id, fingerprintOf(r));
}

export const fingerprintOf = (r: Pick<typeof schema.reimbursements.$inferSelect, "merchant" | "receiptDate" | "totalCents" | "lines">) =>
  receiptFingerprint({ merchant: r.merchant, date: r.receiptDate, totalCents: r.totalCents, items: (r.lines ?? []).filter((l) => !/^tax and fees$/i.test(l.description)).map((l) => l.description) });

/** Fills in embeddings for anything created while embeddings were off. */
export async function backfillIndex(orgId: string) {
  const done = await db().select({ kind: schema.searchIndex.kind, refId: schema.searchIndex.refId }).from(schema.searchIndex).where(eq(schema.searchIndex.orgId, orgId));
  const have = new Set(done.map((d) => `${d.kind}:${d.refId}`));
  const [payments, receipts] = await Promise.all([
    db().select({ id: schema.payments.id, orgId: schema.payments.orgId, vendor: schema.payments.vendor, lines: schema.payments.lines }).from(schema.payments).where(eq(schema.payments.orgId, orgId)),
    db()
      .select({ id: schema.reimbursements.id, orgId: schema.reimbursements.orgId, merchant: schema.reimbursements.merchant, receiptDate: schema.reimbursements.receiptDate, totalCents: schema.reimbursements.totalCents, lines: schema.reimbursements.lines })
      .from(schema.reimbursements)
      .where(eq(schema.reimbursements.orgId, orgId)),
  ]);
  let added = 0;
  for (const p of payments) if (!have.has(`purchase:${p.id}`) && (await indexPurchase(p))) added++;
  for (const r of receipts) if (!have.has(`reimbursement:${r.id}`) && (await indexReimbursement(r))) added++;
  return added;
}

// ---------------------------------------------------------------- pgvector backend

async function policyRows(orgId: string) {
  const rows = await db().select().from(schema.policyChunks).where(eq(schema.policyChunks.orgId, orgId));
  if (rows.length > 0) return rows;
  await indexPolicy(orgId); // first use on a database seeded before Day 9
  return db().select().from(schema.policyChunks).where(eq(schema.policyChunks.orgId, orgId));
}

const pgvector: SearchBackend = {
  name: "pgvector",

  async searchPolicy(orgId, query, k = 3) {
    const rows = await policyRows(orgId);
    const q = rows.some((r) => r.embedding) ? await embedText(query, "query") : null;
    if (q) {
      const hits = await db()
        .select({ clause: schema.policyChunks.clause, section: schema.policyChunks.section, text: schema.policyChunks.text, score: similarity(schema.policyChunks.embedding, q) })
        .from(schema.policyChunks)
        .where(and(eq(schema.policyChunks.orgId, orgId), sql`${schema.policyChunks.embedding} is not null`))
        .orderBy(cosineDistance(schema.policyChunks.embedding, q))
        .limit(k);
      return { source: "pgvector", hits: hits.map((h) => ({ ...h, score: round(h.score) })) };
    }
    const hits = rows
      .map((r) => ({ clause: r.clause, section: r.section, text: r.text, score: round(keywordScore(query, policyChunkText(r))) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return { source: "keyword", hits };
  },

  async purchaseHistory(orgId, query, k = 5) {
    const q = await embedText(query, "query");
    let ranked: { kind: "purchase" | "reimbursement"; refId: string; score: number }[];
    let source: SearchSource = "pgvector";
    if (q) {
      ranked = await db()
        .select({ kind: schema.searchIndex.kind, refId: schema.searchIndex.refId, score: similarity(schema.searchIndex.embedding, q) })
        .from(schema.searchIndex)
        .where(eq(schema.searchIndex.orgId, orgId))
        .orderBy(cosineDistance(schema.searchIndex.embedding, q))
        .limit(k);
    } else {
      source = "keyword";
      const all = await db().select({ id: schema.payments.id, vendor: schema.payments.vendor, lines: schema.payments.lines }).from(schema.payments).where(eq(schema.payments.orgId, orgId)).orderBy(desc(schema.payments.createdAt)).limit(200);
      ranked = all
        .map((p) => ({ kind: "purchase" as const, refId: p.id, score: keywordScore(query, ledgerText({ kind: "purchase", vendor: p.vendor, lines: p.lines })) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    }
    const pIds = ranked.filter((r) => r.kind === "purchase").map((r) => r.refId);
    const rIds = ranked.filter((r) => r.kind === "reimbursement").map((r) => r.refId);
    const [payments, receipts] = await Promise.all([
      pIds.length ? db().select().from(schema.payments).where(inArray(schema.payments.id, pIds)) : [],
      rIds.length
        ? db()
            .select({ id: schema.reimbursements.id, vendor: schema.reimbursements.vendor, merchant: schema.reimbursements.merchant, lines: schema.reimbursements.lines, totalCents: schema.reimbursements.totalCents, currency: schema.reimbursements.currency, status: schema.reimbursements.status, createdAt: schema.reimbursements.createdAt })
            .from(schema.reimbursements)
            .where(inArray(schema.reimbursements.id, rIds))
        : [],
    ]);
    const hits: PurchaseHit[] = [];
    for (const r of ranked) {
      const p = r.kind === "purchase" ? payments.find((x) => x.id === r.refId) : undefined;
      const m = r.kind === "reimbursement" ? receipts.find((x) => x.id === r.refId) : undefined;
      if (p)
        hits.push({ kind: "purchase", id: p.id, vendor: p.vendor, items: p.lines, totalCents: p.totalCents, currency: p.currency, status: p.status, date: p.createdAt.toISOString().slice(0, 10), score: round(r.score) });
      else if (m)
        hits.push({ kind: "reimbursement", id: m.id, vendor: m.merchant ?? m.vendor ?? "unknown", items: m.lines ?? [], totalCents: m.totalCents ?? 0, currency: m.currency ?? "USD", status: m.status, date: m.createdAt.toISOString().slice(0, 10), score: round(r.score) });
    }
    return { source, hits };
  },

  async similarReceipts(orgId, fingerprint, excludeId, k = 3) {
    const q = await embedText(fingerprint, "document"); // compared document-to-document, as calibrated
    if (!q) return [];
    const conds = [eq(schema.searchIndex.orgId, orgId), eq(schema.searchIndex.kind, "reimbursement"), ne(schema.reimbursements.status, "rejected")];
    if (excludeId) conds.push(ne(schema.searchIndex.refId, excludeId));
    const rows = await db()
      .select({ id: schema.reimbursements.id, similarity: similarity(schema.searchIndex.embedding, q), totalCents: schema.reimbursements.totalCents, merchant: schema.reimbursements.merchant, receiptDate: schema.reimbursements.receiptDate })
      .from(schema.searchIndex)
      .innerJoin(schema.reimbursements, eq(schema.reimbursements.id, schema.searchIndex.refId))
      .where(and(...conds))
      .orderBy(cosineDistance(schema.searchIndex.embedding, q))
      .limit(k);
    return rows.map((r) => ({ ...r, similarity: round(r.similarity) }));
  },
};

const round = (n: number) => Math.round(Number(n) * 1000) / 1000;

/** The active search backend. Day 19 adds Elastic here, falling back to pgvector. */
export function search(): SearchBackend {
  return pgvector;
}
