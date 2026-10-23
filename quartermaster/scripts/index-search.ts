/**
 * Builds the search index for the demo org: embeds every policy clause, then
 * every purchase and receipt not indexed yet. Safe to re-run.   npm run db:index
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { demoOrgId } from "./demo-org";
import { backfillIndex, indexPolicy } from "../src/lib/integrations/search";

async function main() {
  const orgId = await demoOrgId();
  const policy = await indexPolicy(orgId);
  console.log(`✓ Policy: ${policy.chunks} clauses, ${policy.embedded} embedded${policy.embedded === 0 ? " (embeddings off or failing: keyword search will be used)" : ""}`);
  const added = await backfillIndex(orgId);
  console.log(`✓ Purchases and receipts: ${added} newly embedded`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
