/**
 * `npm run db:push`: creates the tables with drizzle-kit, but only on an EMPTY
 * database. On a database with tables it stops and points to `npm run db:migrate`,
 * because drizzle-kit 0.31.1 on Postgres 18 plans to drop NOT NULL constraints (D46).
 * Override with `npm run db:push -- --force` only if you know the plan is safe.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { spawnSync } from "node:child_process";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — copy .env.example to .env.local");
  const [{ n }] = (await neon(url)`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`) as { n: number }[];
  if (n > 0 && !process.argv.includes("--force")) {
    console.log(`The database already has ${n} tables, so drizzle-kit push is skipped (it would try to drop NOT NULL constraints on Postgres 18).`);
    console.log("For new columns and tables on an existing database, run:  npm run db:migrate");
    return;
  }
  const r = spawnSync("npx", ["drizzle-kit", "push"], { stdio: "inherit", shell: process.platform === "win32" });
  process.exitCode = r.status ?? 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
