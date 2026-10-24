/**
 * Builds the demo org in one command:  npm run db:seed
 * Safe to re-run: it deletes the demo org's rows first. The work is in src/lib/demo/seed.ts,
 * shared with POST /api/admin/reset-demo.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { seedDemo } from "../src/lib/demo/seed";

async function main() {
  const r = await seedDemo();
  if (!r.payeeSet) console.warn("! SANDBOX_PAYEE_EMAIL not set — orders will go to your app's own sandbox business account.");
  console.log(`✓ Seeded "${r.org}": ${r.members} members, 2 events, 2 mandates, ${r.purchases} past purchases`);
  console.log(`✓ Search index: ${r.policyClauses} policy clauses (${r.policyEmbedded} embedded), ${r.purchasesEmbedded} purchases embedded`);
  console.log(`  Treasurer: ${r.treasurer}   Volunteer: ${r.volunteer}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
