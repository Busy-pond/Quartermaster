/**
 * Turns on the pgvector extension in Neon (needed before `db:push` creates the
 * vector columns). Safe to re-run.   npm run db:vector
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — copy .env.example to .env.local");
  const sql = neon(url);
  await sql`create extension if not exists vector`;
  const [row] = await sql`select extversion from pg_extension where extname = 'vector'`;
  console.log(`✓ pgvector ${row.extversion} is enabled`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
