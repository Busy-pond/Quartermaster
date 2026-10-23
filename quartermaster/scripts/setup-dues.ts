/**
 * One-time: creates the PayPal catalog product and the monthly dues plan for the
 * demo org, plus the Operations budget the dues fund. Safe to re-run.
 *   npm run setup:dues            ($10/month)
 *   npm run setup:dues -- 15      ($15/month, only used the first time)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { demoOrgId } from "./demo-org";
import { setupDues } from "../src/lib/funding/service";

async function main() {
  const dollars = Number(process.argv[2] ?? "10");
  const plan = await setupDues(await demoOrgId(), Math.round(dollars * 100));
  console.log(`✓ Dues plan ${plan.planId} (${(plan.amountCents / 100).toFixed(2)} ${plan.currency}/month), product ${plan.productId}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
