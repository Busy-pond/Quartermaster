/**
 * Builds the Postman collection and environment from the OpenAPI document, so the two can't drift.
 * `npm run postman:build` writes postman/*.json; `npm run test:api` runs them with newman against a running app.
 * Every operation in the spec must have at least one request here (the build fails otherwise).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openApiDocument, OPENAPI_OPERATIONS } from "../src/lib/api/openapi";

const UNKNOWN = "{{unknownId}}";

interface Case {
  folder: string;
  name: string;
  method: "GET" | "POST" | "DELETE";
  /** An OpenAPI path, e.g. /api/payments/{id}/order; {id} becomes {{unknownId}} unless `id` is given. */
  path: string;
  id?: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  status: number;
  /** Lines of Postman test code, using `json` (the parsed body). */
  checks?: string[];
}

const SIGNED_OUT = "2. Signed out is refused";
const VOLUNTEER = "4. Signed in as the volunteer";
const TREASURER = "5. Signed in as the treasurer";
const ANY_ERROR = 'pm.expect(json.error).to.be.a("string")';
const refused = (name: string, method: Case["method"], path: string, body?: unknown): Case => ({
  folder: SIGNED_OUT,
  name,
  method,
  path,
  body,
  status: 401,
  checks: ['pm.expect(json.error).to.eql("Not signed in")'],
});
const MCP_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const STUDIO_TURN = { input: [{ id: "u1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Which events are above 80% of budget?" }] }], responseFormat: { type: "text" } };
const MCP_HEADERS = { Authorization: "Bearer {{apiKey}}", Accept: "application/json, text/event-stream" };

const CASES: Case[] = [
  { folder: "1. Public", name: "Health check", method: "GET", path: "/api/health", status: 200, checks: ["pm.expect(json.ok).to.eql(true)"] },
  {
    folder: "1. Public",
    name: "OpenAPI document",
    method: "GET",
    path: "/api/openapi.json",
    status: 200,
    checks: ['pm.expect(json.openapi).to.eql("3.1.0")', 'pm.expect(Object.keys(json.paths)).to.include("/api/session")', "pm.expect(Object.keys(json.paths).length).to.be.above(15)"],
  },
  { folder: "1. Public", name: "PayPal client token", method: "GET", path: "/api/paypal/client-token", status: 200, checks: ['pm.expect(json.accessToken).to.be.a("string").and.not.empty'] },
  {
    folder: "1. Public",
    name: "Webhook without a PayPal signature is rejected",
    method: "POST",
    path: "/api/webhooks/paypal",
    body: { id: "WH-NEWMAN-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} },
    status: 400,
    checks: ['pm.expect(json.error).to.eql("invalid signature")'],
  },
  { folder: "1. Public", name: "MCP without a key is refused", method: "POST", path: "/api/mcp", body: MCP_LIST, status: 401, checks: ['pm.expect(json.error.message).to.include("API key")'] },

  refused("Chat", "POST", "/api/chat", { id: "x", messages: [] }),
  refused("Create PayPal order", "POST", "/api/payments/{id}/order"),
  refused("Capture", "POST", "/api/payments/{id}/capture", { orderId: "X" }),
  refused("Refund", "POST", "/api/payments/{id}/refund", { reason: "" }),
  refused("Submit a receipt", "POST", "/api/reimbursements", {}),
  refused("Approve a reimbursement", "POST", "/api/reimbursements/{id}/approve"),
  refused("Reject a reimbursement", "POST", "/api/reimbursements/{id}/reject", { reason: "" }),
  refused("Reimbursement status", "GET", "/api/reimbursements/{id}/status"),
  refused("Record a subscription", "POST", "/api/subscriptions", { subscriptionId: "I-ABC123" }),
  refused("Send an invoice", "POST", "/api/invoices/{id}/send"),
  refused("Check an invoice", "POST", "/api/invoices/{id}/sync"),
  refused("Create an API key", "POST", "/api/keys", { name: "newman" }),
  refused("Revoke an API key", "DELETE", "/api/keys/{id}"),
  { ...refused("Treasurer insights", "GET", "/api/treasurer/insights"), query: { view: "mandate_health" } },
  refused("AG Studio agent turn", "POST", "/api/studio/llm", STUDIO_TURN),

  { folder: "3. Demo sign-in", name: "Sign-in without a role is rejected", method: "POST", path: "/api/session", body: {}, status: 400, checks: [ANY_ERROR] },
  { folder: "3. Demo sign-in", name: "Sign in as the volunteer", method: "POST", path: "/api/session", body: { role: "member" }, status: 200, checks: ['pm.expect(json.member.role).to.eql("member")'] },

  { folder: VOLUNTEER, name: "A volunteer cannot create an API key", method: "POST", path: "/api/keys", body: { name: "newman" }, status: 400, checks: ['pm.expect(json.error).to.include("treasurer")'] },
  { folder: VOLUNTEER, name: "Unknown reimbursement status", method: "GET", path: "/api/reimbursements/{id}/status", status: 404, checks: ['pm.expect(json.error).to.eql("Not found")'] },
  { folder: VOLUNTEER, name: "Order for an unknown payment", method: "POST", path: "/api/payments/{id}/order", status: 400, checks: [ANY_ERROR] },
  { folder: VOLUNTEER, name: "Capture needs an order id", method: "POST", path: "/api/payments/{id}/capture", body: {}, status: 400, checks: [ANY_ERROR] },
  { folder: VOLUNTEER, name: "Refund of an unknown payment", method: "POST", path: "/api/payments/{id}/refund", body: { reason: "newman" }, status: 400, checks: [ANY_ERROR] },
  { folder: VOLUNTEER, name: "A receipt needs a photo", method: "POST", path: "/api/reimbursements", body: { mandateId: "x" }, status: 400, checks: [ANY_ERROR] },
  { folder: VOLUNTEER, name: "Approve an unknown reimbursement", method: "POST", path: "/api/reimbursements/{id}/approve", status: 400, checks: [ANY_ERROR] },
  { folder: VOLUNTEER, name: "Reject an unknown reimbursement", method: "POST", path: "/api/reimbursements/{id}/reject", body: { reason: "newman" }, status: 400, checks: [ANY_ERROR] },
  { folder: VOLUNTEER, name: "Subscription id must look like PayPal's", method: "POST", path: "/api/subscriptions", body: { subscriptionId: "nope" }, status: 400, checks: [ANY_ERROR] },
  { folder: VOLUNTEER, name: "A volunteer cannot send an invoice", method: "POST", path: "/api/invoices/{id}/send", status: 400, checks: [ANY_ERROR] },
  { folder: VOLUNTEER, name: "Check an unknown invoice", method: "POST", path: "/api/invoices/{id}/sync", status: 404, checks: ['pm.expect(json.error).to.eql("Not found")'] },
  { folder: VOLUNTEER, name: "Revoke a key as the volunteer", method: "DELETE", path: "/api/keys/{id}", status: 400, checks: ['pm.expect(json.error).to.include("treasurer")'] },
  { folder: VOLUNTEER, name: "Chat needs messages", method: "POST", path: "/api/chat", body: { id: "" }, status: 400, checks: ['pm.expect(json.error).to.eql("Bad request")'] },
  { folder: VOLUNTEER, name: "Insights need a known view", method: "GET", path: "/api/treasurer/insights", query: { view: "everything" }, status: 400, checks: [ANY_ERROR] },
  {
    folder: VOLUNTEER,
    name: "Mandates at or above 80% of their cap",
    method: "GET",
    path: "/api/treasurer/insights",
    query: { view: "over_budget_share", threshold: "80" },
    status: 200,
    checks: ['pm.expect(json.source).to.eql("live ledger")', "pm.expect(json.result).to.be.an('array')", "json.result.forEach(e => pm.expect(e.usedPct).to.be.at.least(80))"],
  },
  { folder: VOLUNTEER, name: "Mandate health", method: "GET", path: "/api/treasurer/insights", query: { view: "mandate_health" }, status: 200, checks: ["pm.expect(json.result.overall.attempts).to.be.a('number')", "pm.expect(json.result.byMandate).to.be.an('array')"] },
  { folder: VOLUNTEER, name: "A Studio turn needs a response format", method: "POST", path: "/api/studio/llm", body: { input: [] }, status: 400, checks: [ANY_ERROR] },
  { folder: VOLUNTEER, name: "A Studio turn with the scripted model", method: "POST", path: "/api/studio/llm", body: STUDIO_TURN, status: 200, checks: ['pm.expect(json.status).to.eql("completed")', 'pm.expect(json.output[0].type).to.eql("message")'] },
  { folder: VOLUNTEER, name: "Sign out", method: "DELETE", path: "/api/session", status: 200, checks: ["pm.expect(json.ok).to.eql(true)"] },

  { folder: TREASURER, name: "Sign in as the treasurer", method: "POST", path: "/api/session", body: { role: "treasurer" }, status: 200, checks: ['pm.expect(json.member.role).to.eql("treasurer")'] },
  {
    folder: TREASURER,
    name: "Create an API key",
    method: "POST",
    path: "/api/keys",
    body: { name: "newman" },
    status: 200,
    checks: ["pm.expect(json.key).to.match(/^qm_live_/)", 'pm.collectionVariables.set("apiKey", json.key)', 'pm.collectionVariables.set("keyId", json.id)'],
  },
  {
    folder: TREASURER,
    name: "MCP lists seven tools with the key",
    method: "POST",
    path: "/api/mcp",
    body: MCP_LIST,
    headers: MCP_HEADERS,
    status: 200,
    checks: ["pm.expect(json.result.tools.length).to.eql(7)", 'pm.expect(json.result.tools.map(t => t.name)).to.not.include("pay")'],
  },
  { folder: TREASURER, name: "Revoke the key", method: "DELETE", path: "/api/keys/{id}", id: "{{keyId}}", status: 200, checks: ["pm.expect(json.ok).to.eql(true)"] },
  { folder: TREASURER, name: "A revoked key is refused", method: "POST", path: "/api/mcp", body: MCP_LIST, headers: MCP_HEADERS, status: 401 },
];

const spec = openApiDocument("{{baseUrl}}") as unknown as { paths: Record<string, Record<string, { summary: string; description?: string }>> };

function requestItem(c: Case) {
  const path = c.path.replace("{id}", c.id ?? UNKNOWN);
  const query = Object.entries(c.query ?? {}).map(([key, value]) => ({ key, value }));
  const search = query.length ? `?${query.map((q) => `${q.key}=${q.value}`).join("&")}` : "";
  const op = spec.paths[c.path]?.[c.method.toLowerCase()];
  if (!op) throw new Error(`${c.method} ${c.path} is not in the OpenAPI document`);
  const exec = [
    `pm.test("${c.status} for ${c.name.replace(/"/g, "'")}", () => pm.response.to.have.status(${c.status}));`,
    ...(c.checks ? ["const json = pm.response.json();", ...c.checks.map((x, i) => `pm.test("check ${i + 1}", () => { ${x}; });`)] : []),
  ];
  return {
    name: c.name,
    event: [{ listen: "test", script: { type: "text/javascript", exec } }],
    request: {
      method: c.method,
      header: [...(c.body ? [{ key: "Content-Type", value: "application/json" }] : []), ...Object.entries(c.headers ?? {}).map(([key, value]) => ({ key, value }))],
      ...(c.body ? { body: { mode: "raw", raw: JSON.stringify(c.body, null, 2), options: { raw: { language: "json" } } } } : {}),
      url: { raw: `{{baseUrl}}${path}${search}`, host: ["{{baseUrl}}"], path: path.split("/").filter(Boolean), ...(query.length ? { query } : {}) },
      description: [op.summary, op.description].filter(Boolean).join("\n\n"),
    },
  };
}

// Every operation in the spec needs a request.
const covered = new Set(CASES.map((c) => `${c.method.toLowerCase()} ${c.path}`));
const missing = OPENAPI_OPERATIONS.filter((o) => !covered.has(`${o.method} ${o.path}`));
if (missing.length) throw new Error(`No Postman request for: ${missing.map((o) => `${o.method} ${o.path}`).join(", ")}`);

const folders = [...new Set(CASES.map((c) => c.folder))].sort();
const collection = {
  info: {
    name: "Quartermaster API",
    description:
      "Generated from /api/openapi.json by `npm run postman:build`. Run the whole collection (Runner, or `npm run test:api`) from top to bottom: it signs in as the demo volunteer and treasurer and checks that signed-out calls, bad input and the wrong role are refused. It never moves money. Sandbox only.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: folders.map((name) => ({ name, item: CASES.filter((c) => c.folder === name).map(requestItem) })),
  variable: [
    { key: "baseUrl", value: "http://localhost:3000" },
    { key: "unknownId", value: "00000000-0000-4000-8000-000000000000" },
    { key: "apiKey", value: "" },
    { key: "keyId", value: "" },
  ],
};
const environment = {
  name: "Quartermaster sandbox",
  values: [{ key: "baseUrl", value: "http://localhost:3000", type: "default", enabled: true }],
  _postman_variable_scope: "environment",
};

const dir = join(process.cwd(), "postman");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "quartermaster.postman_collection.json"), JSON.stringify(collection, null, 2) + "\n");
writeFileSync(join(dir, "quartermaster-sandbox.postman_environment.json"), JSON.stringify(environment, null, 2) + "\n");
console.log(`Wrote ${CASES.length} requests in ${folders.length} folders to postman/`);
