/**
 * Additive, idempotent schema changes for a database that already has data.
 *   npm run db:migrate
 *
 * Why not `drizzle-kit push`? On Neon's Postgres 18, drizzle-kit 0.31.1 reads
 * NOT NULL as named constraints and plans to DROP them on every table (D46).
 * Push is still fine on an empty database, where it only creates tables.
 * Every statement here is safe to run again.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

const STEPS: { name: string; sql: string }[] = [
  { name: "pgvector extension", sql: `create extension if not exists vector` },
  // Day 9: search
  {
    name: "policy_chunks table",
    sql: `create table if not exists "policy_chunks" (
      "id" text primary key, "org_id" text not null references "orgs"("id"), "clause" text not null, "section" text not null,
      "text" text not null, "embedding" vector(768), "created_at" timestamptz not null default now())`,
  },
  { name: "policy_chunks unique clause", sql: `create unique index if not exists "policy_chunks_org_clause" on "policy_chunks" ("org_id", "clause")` },
  { name: "policy_chunks vector index", sql: `create index if not exists "policy_chunks_embedding" on "policy_chunks" using hnsw ("embedding" vector_cosine_ops)` },
  {
    name: "search_index table",
    sql: `create table if not exists "search_index" (
      "id" text primary key, "org_id" text not null references "orgs"("id"), "kind" text not null, "ref_id" text not null,
      "text" text not null, "embedding" vector(768) not null, "created_at" timestamptz not null default now())`,
  },
  { name: "search_index unique ref", sql: `create unique index if not exists "search_index_kind_ref" on "search_index" ("kind", "ref_id")` },
  { name: "search_index org index", sql: `create index if not exists "search_index_org_kind" on "search_index" ("org_id", "kind")` },
  { name: "search_index vector index", sql: `create index if not exists "search_index_embedding" on "search_index" using hnsw ("embedding" vector_cosine_ops)` },
];

async function main() {
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — copy .env.example to .env.local");
  const sql = neon(url);
  for (const s of STEPS) {
    await sql.query(s.sql);
    console.log(`✓ ${s.name}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
