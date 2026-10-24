/**
 * Copies the demo org's policy, purchases, receipts and audit trail (agent traces
 * included) into Elastic. Needs ELASTIC_ENABLED=true and ELASTIC_URL. Safe to re-run.
 *   docker compose up -d elasticsearch   then   npm run elastic:sync
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { demoOrgId } from "./demo-org";
import { flags } from "../src/lib/flags";
import { syncElastic } from "../src/lib/integrations/search";

async function main() {
  if (!flags.elastic()) {
    console.error("✕ Elastic is off. Set ELASTIC_ENABLED=true and ELASTIC_URL (e.g. http://localhost:9200) in .env.local.");
    process.exit(1);
  }
  const r = await syncElastic(await demoOrgId());
  console.log(`✓ Elastic at ${process.env.ELASTIC_URL}: ${r.policy} policy clauses, ${r.ledger} purchases and receipts, ${r.events} audit events`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✕", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
