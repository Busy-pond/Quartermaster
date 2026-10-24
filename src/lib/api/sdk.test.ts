import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OPENAPI_OPERATIONS } from "./openapi";
import { QuartermasterClient, QuartermasterError } from "../../../sdk/src/index";

const source = readFileSync(join(process.cwd(), "sdk", "src", "index.ts"), "utf8");
const sdkRoutes = new Set([...source.matchAll(/@route (GET|POST|DELETE) (\S+)/g)].map((m) => `${m[1].toLowerCase()} ${m[2]}`));
/** PayPal calls the webhook, and AG Studio's adapter in the browser calls the agent turn; no client needs them. */
const SERVER_ONLY = new Set(["post /api/webhooks/paypal", "post /api/studio/llm"]);

describe("TypeScript SDK", () => {
  it("has a method for every route in the OpenAPI document", () => {
    const missing = OPENAPI_OPERATIONS.map((o) => `${o.method} ${o.path}`).filter((r) => !SERVER_ONLY.has(r) && !sdkRoutes.has(r));
    expect(missing).toEqual([]);
  });

  it("keeps the session cookie between calls and raises QuartermasterError", async () => {
    const seen: (string | null)[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("cookie"));
      if (String(url).endsWith("/api/session")) return new Response(JSON.stringify({ member: { id: "1", name: "P", role: "treasurer" } }), { headers: { "set-cookie": "qm_member=abc; Path=/; HttpOnly" } });
      return new Response(JSON.stringify({ error: "Only the treasurer can create API keys" }), { status: 400 });
    }) as unknown as typeof fetch;
    const qm = new QuartermasterClient({ baseUrl: "http://x/", fetch: fake });
    await qm.signIn("treasurer");
    await expect(qm.createApiKey("test")).rejects.toBeInstanceOf(QuartermasterError);
    expect(seen).toEqual([null, "qm_member=abc"]);
  });
});
