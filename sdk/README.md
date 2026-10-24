# Quartermaster TypeScript SDK

A dependency-free client for the Quartermaster API: one method per route in [`/api/openapi.json`](../src/lib/api/openapi.ts), typed request and response bodies, and the demo session cookie kept between calls. Works in Node 20+ and browsers. Sandbox only.

```ts
import { QuartermasterClient, QuartermasterError } from "./sdk/src/index";

const qm = new QuartermasterClient({ baseUrl: "http://localhost:3000" });

await qm.signIn("treasurer"); // demo sign-in, no password
const { key } = await qm.createApiKey("my agent"); // shown once
const { result } = await qm.mcp<{ tools: { name: string }[] }>(key, "tools/list");
console.log(result.tools.map((t) => t.name)); // list_mandates, search_products, check_purchase, request_purchase, ...

try {
  await qm.refundPayment("not-a-payment");
} catch (e) {
  if (e instanceof QuartermasterError) console.log(e.status, e.body.error); // 400 "Payment not found"
}
```

No method here can make the AI pay by itself: purchases still go through the mandate engine, and `capturePayment` needs an order the approver approved in PayPal.

## Generated with APIMatic

This file is a hand-built stand-in so the repo works without an account. To produce APIMatic's own SDK and docs portal:

1. Open [apimatic.io](https://www.apimatic.io), sign in, and import `https://<your-app>/api/openapi.json` (or the file saved from `http://localhost:3000/api/openapi.json`).
2. Generate the **TypeScript** SDK and the **API Portal**, download them, and commit the SDK into this folder (replace `src/index.ts`, keep the README example above in sync).
3. Run `npm test`: `src/lib/api/sdk.test.ts` checks that every route in the OpenAPI document has a method here. If APIMatic's method names differ, update that test's route table.

The PayPal calls in `src/lib/paypal/client.ts` were written with the APIMatic PayPal context plugin.
