/**
 * A tiny stand-in for PayPal, for CI and the Playwright smoke test (Task 8).
 * Listens on MOCK_PAYPAL_PORT (default 4020). Point the app at it with PAYPAL_API_BASE=http://localhost:4020 and
 * NEXT_PUBLIC_PAYPAL_SDK_URL=http://localhost:4020/sdk.js (the second is baked in at build time); scripts/e2e-env.mjs does both.
 * It answers just the calls the app makes, never verifies a webhook, and keeps nothing between runs.
 * Plain Node, no dependencies, works on Windows: `node scripts/mock-paypal.mjs`.
 */
import { createServer } from "node:http";

const port = Number(process.env.MOCK_PAYPAL_PORT || 4020);
const orders = new Map();
let n = 0;

const SDK = `window.paypal = {
  async createInstance() {
    return {
      createPayPalOneTimePaymentSession(opts) {
        return {
          async start(_options, order) {
            try { await opts.onApprove(await order); } catch (e) { opts.onError && opts.onError(e); }
          },
        };
      },
    };
  },
};`;

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "PayPal-Debug-Id": "mock-debug-id", "Access-Control-Allow-Origin": "*" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;
    const body = raw && raw.startsWith("{") ? JSON.parse(raw) : {};
    console.log(req.method, path);

    if (path === "/sdk.js") return send(res, 200, SDK, "text/javascript");
    if (path === "/health") return send(res, 200, { ok: true });
    if (path === "/v1/oauth2/token") return send(res, 200, { access_token: "mock-token", expires_in: 3000, token_type: "Bearer" });
    if (path === "/v1/notifications/verify-webhook-signature") return send(res, 200, { verification_status: "FAILURE" });

    if (req.method === "POST" && path === "/v2/checkout/orders") {
      const id = `MOCKORDER${++n}`;
      const unit = body.purchase_units?.[0] ?? {};
      orders.set(id, { id, status: "CREATED", unit });
      return send(res, 201, { id, status: "CREATED" });
    }
    const order = path.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
    if (order) {
      const found = orders.get(order[1]);
      if (!found) return send(res, 404, { name: "RESOURCE_NOT_FOUND", message: "Unknown mock order" });
      if (order[2]) found.status = "COMPLETED";
      return send(res, order[2] ? 201 : 200, {
        id: found.id,
        status: found.status,
        purchase_units: [{ payments: { captures: [{ id: `MOCKCAPTURE${found.id}`, status: "COMPLETED", amount: found.unit.amount ?? { value: "0.00", currency_code: "USD" } }] } }],
      });
    }
    if (/^\/v2\/payments\/captures\/[^/]+\/refund$/.test(path)) return send(res, 201, { id: `MOCKREFUND${++n}`, status: "COMPLETED" });
    if (req.method === "POST" && path === "/v1/payments/payouts") return send(res, 201, { batch_header: { payout_batch_id: `MOCKBATCH${++n}`, batch_status: "PENDING" } });
    const payout = path.match(/^\/v1\/payments\/payouts\/([^/]+)$/);
    if (payout) return send(res, 200, { batch_header: { payout_batch_id: payout[1], batch_status: "SUCCESS" }, items: [{ payout_item_id: "MOCKITEM", transaction_status: "SUCCESS" }] });

    send(res, 404, { name: "NOT_MOCKED", message: `The mock PayPal does not answer ${req.method} ${path}` });
  });
});

server.listen(port, () => console.log(`Mock PayPal listening on http://localhost:${port}`));
