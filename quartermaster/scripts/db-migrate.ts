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
  // Day 13: money in
  {
    name: "funding table",
    sql: `create table if not exists "funding" (
      "id" text primary key, "org_id" text not null references "orgs"("id"), "mandate_id" text not null references "mandates"("id"),
      "source" text not null, "paypal_id" text not null, "reference" text, "amount_cents" integer not null, "currency" text not null,
      "note" text, "created_at" timestamptz not null default now())`,
  },
  { name: "funding unique PayPal id", sql: `create unique index if not exists "funding_paypal_id" on "funding" ("paypal_id")` },
  { name: "funding mandate index", sql: `create index if not exists "funding_mandate" on "funding" ("mandate_id")` },
  {
    name: "subscriptions table",
    sql: `create table if not exists "subscriptions" (
      "id" text primary key, "org_id" text not null references "orgs"("id"), "member_id" text not null references "members"("id"),
      "plan_id" text not null, "status" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now())`,
  },
  {
    name: "invoices table",
    sql: `create table if not exists "invoices" (
      "id" text primary key, "org_id" text not null references "orgs"("id"), "mandate_id" text not null references "mandates"("id"),
      "paypal_invoice_id" text, "sponsor_email" text not null, "sponsor_name" text, "amount_cents" integer not null, "currency" text not null,
      "note" text not null, "status" text not null, "recipient_url" text, "created_by" text not null, "sent_by" text, "sent_at" timestamptz,
      "trace_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now())`,
  },
  { name: "invoices unique PayPal id", sql: `create unique index if not exists "invoices_paypal_id" on "invoices" ("paypal_invoice_id")` },
  // Day 14: MCP server keys
  {
    name: "api_keys table",
    sql: `create table if not exists "api_keys" (
      "id" text primary key, "org_id" text not null references "orgs"("id"), "name" text not null, "hash" text not null, "hint" text not null,
      "agent_member_id" text not null references "members"("id"), "created_by" text not null references "members"("id"),
      "last_used_at" timestamptz, "revoked_at" timestamptz, "created_at" timestamptz not null default now())`,
  },
  { name: "api_keys unique hash", sql: `create unique index if not exists "api_keys_hash" on "api_keys" ("hash")` },
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
