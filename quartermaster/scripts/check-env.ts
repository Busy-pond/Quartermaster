/**
 * Checks .env.local before setup:  npm run check:env
 * Names every missing or placeholder value, then tests the database connection,
 * so a typo shows up as one clear line instead of a stack trace.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

if (!existsSync(".env.local")) {
  console.error("✕ .env.local not found. Create it with:  cp .env.example .env.local   then fill in the values.");
  process.exit(1);
}
config({ path: ".env.local" });

type Check = { name: string; required: boolean; hint: string; test?: (v: string) => string | null };

const looksPlaceholder = (v: string) => /ep-xxx|user:pass|region\.aws|your[-_]|<|>|changeme/i.test(v);

const pgUrl = (pooled: boolean) => (v: string) => {
  if (!/^postgres(ql)?:\/\//.test(v)) return "must start with postgresql://";
  if (!/sslmode=require/.test(v)) return "should end with ?sslmode=require";
  const host = v.split("@")[1]?.split("/")[0] ?? "";
  if (pooled && !host.includes("-pooler")) return "this is the direct string; DATABASE_URL should be the pooled one (host contains -pooler)";
  if (!pooled && host.includes("-pooler")) return "this is the pooled string; DATABASE_URL_DIRECT should be the one without -pooler";
  return null;
};

const checks: Check[] = [
  { name: "DATABASE_URL", required: true, hint: "Neon console → your project → Connect → copy the connection string with pooling ON", test: pgUrl(true) },
  { name: "DATABASE_URL_DIRECT", required: false, hint: "Neon console → Connect → turn pooling OFF → copy", test: pgUrl(false) },
  { name: "PAYPAL_CLIENT_ID", required: false, hint: "developer.paypal.com → Apps & Credentials → Sandbox → your app" },
  { name: "PAYPAL_CLIENT_SECRET", required: false, hint: "same place as the client ID (click Show)" },
  { name: "GOOGLE_GENERATIVE_AI_API_KEY", required: false, hint: "aistudio.google.com/apikey" },
  { name: "SANDBOX_PAYEE_EMAIL", required: false, hint: "developer.paypal.com → Testing tools → Sandbox accounts → a Business account email" },
  { name: "PAYPAL_WEBHOOK_ID", required: false, hint: "only needed once you add a webhook URL (Day 2)" },
  { name: "CHANNEL3_API_KEY", required: false, hint: "optional — sample products are used without it" },
];

let blocking = 0;
for (const c of checks) {
  const v = (process.env[c.name] ?? "").trim();
  const problem = !v ? "is empty" : looksPlaceholder(v) ? "still has the example placeholder" : (c.test?.(v) ?? null);
  if (!problem) {
    console.log(`✓ ${c.name}`);
    continue;
  }
  if (c.required) blocking++;
  console.log(`${c.required ? "✕" : "!"} ${c.name} ${problem}\n    → ${c.hint}`);
}

async function main() {
  if (blocking) {
    console.error(`\n✕ Fix the ${blocking} value(s) marked ✕ in .env.local, then run this again.`);
    process.exit(1);
  }
  try {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`select 1`;
    console.log("✓ Connected to Neon");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n✕ Could not connect to the database: ${msg}`);
    if (/ENOTFOUND|fetch failed/i.test(msg)) console.error("  The host name is wrong or the internet connection is blocked. Re-copy DATABASE_URL from Neon.");
    if (/password|auth/i.test(msg)) console.error("  The password is wrong. In Neon, reset the role password and copy the string again.");
    process.exit(1);
  }
  console.log("\nAll set. Values marked ! are optional for now; the features that need them stay off until you add them.");
}

main();
