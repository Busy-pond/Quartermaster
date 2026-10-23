/**
 * Day 2 spike: can this sandbox app send a PayPal Payout to the volunteer's
 * sandbox personal account?   npm run spike:payout   (sends $1.00 of sandbox money)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createPayout, getPayout } from "../src/lib/paypal/client";

async function main() {
  const receiver = process.env.SANDBOX_VOLUNTEER_EMAIL;
  if (!receiver) throw new Error("Set SANDBOX_VOLUNTEER_EMAIL (a US sandbox personal account) in .env.local");
  const id = `spike-${Date.now()}`;
  const res = await createPayout({ senderBatchId: id, receiverEmail: receiver, amountCents: 100, currency: "USD", note: "Quartermaster payout spike", itemId: id });
  const batchId = res.batch_header.payout_batch_id;
  console.log(`Batch ${batchId}: ${res.batch_header.batch_status}`);

  // Sandbox batches usually finish within a few seconds.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const b = await getPayout(batchId);
    const item = b.items?.[0];
    console.log(`  ${b.batch_header.batch_status} · item ${item?.transaction_status ?? "?"}`);
    if (!["PENDING", "PROCESSING"].includes(b.batch_header.batch_status)) {
      console.log(item?.transaction_status === "SUCCESS" ? "✓ Payouts work from this app" : `✕ Item ended as ${item?.transaction_status}: ${item?.errors?.message ?? ""}`);
      return;
    }
  }
  console.log("Still pending after 30 s; check the sandbox dashboard.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
