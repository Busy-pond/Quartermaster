/**
 * OpenAPI 3.1 for the public routes (Day 15), served at /api/openapi.json.
 * Request bodies come from the same zod schemas the routes validate with.
 */
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { APP_REVISION } from "@/lib/version";
import { CaptureBody, KeyBody, RefundBody, ReimbursementBody, RejectBody, SessionBody, SubscriptionBody } from "./schemas";

type Auth = "session" | "apiKey" | "paypal" | "none";

interface Op {
  method: "get" | "post" | "delete";
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth: Auth;
  body?: ZodTypeAny;
  ok: { status: number; description: string; example?: unknown; contentType?: string };
  errors?: number[];
}

const OPS: Op[] = [
  { method: "get", path: "/api/health", tag: "System", summary: "Health check", auth: "none", ok: { status: 200, description: "The app is up", example: { ok: true } } },
  { method: "get", path: "/api/openapi.json", tag: "System", summary: "This document", auth: "none", ok: { status: 200, description: "OpenAPI 3.1" } },
  { method: "post", path: "/api/session", tag: "Session", summary: "Demo sign-in", description: "Signs in as the demo volunteer or treasurer and sets the session cookie. No passwords: this is a sandbox demo.", auth: "none", body: SessionBody, ok: { status: 200, description: "Signed in", example: { member: { id: "…", name: "Priya Nair", role: "treasurer" } } }, errors: [400, 503] },
  { method: "delete", path: "/api/session", tag: "Session", summary: "Sign out", auth: "none", ok: { status: 200, description: "Signed out", example: { ok: true } } },
  { method: "post", path: "/api/chat", tag: "Agent", summary: "Chat with the purchasing agent", description: "AI SDK v6 UI message stream. Body: { id, messages } as sent by useChat. The agent can search, dry-run and propose; it cannot pay.", auth: "session", ok: { status: 200, description: "Server-sent UI message stream", contentType: "text/event-stream" }, errors: [401] },
  { method: "get", path: "/api/paypal/client-token", tag: "Payments", summary: "Browser client token for the PayPal JS SDK v6", auth: "none", ok: { status: 200, description: "Short-lived client token", example: { accessToken: "…" } }, errors: [502] },
  { method: "post", path: "/api/payments/{id}/order", tag: "Payments", summary: "Create the PayPal order for an approved proposal", description: "Approver only. The mandate is re-checked first; PayPal-Request-Id = order-<id>.", auth: "session", ok: { status: 200, description: "PayPal order", example: { id: "5O190127TN364715T", status: "CREATED" } }, errors: [400, 401, 502] },
  { method: "post", path: "/api/payments/{id}/capture", tag: "Payments", summary: "Capture after the approver pays in the PayPal popup", description: "Mandate re-checked again; PayPal-Request-Id = capture-<id>. Idempotent.", auth: "session", body: CaptureBody, ok: { status: 200, description: "Capture result", example: { status: "captured" } }, errors: [400, 401, 502] },
  { method: "post", path: "/api/payments/{id}/refund", tag: "Payments", summary: "Refund a paid purchase", description: "Mandate approver only. PayPal-Request-Id = refund-<id>.", auth: "session", body: RefundBody, ok: { status: 200, description: "Refund requested", example: { status: "COMPLETED", refundId: "1JU08902781691411" } }, errors: [400, 401, 502] },
  { method: "post", path: "/api/reimbursements", tag: "Reimbursements", summary: "Submit a receipt photo", description: "Gemini reads it; duplicate (hash, exact and by meaning) and mandate checks run; the treasurer is notified.", auth: "session", body: ReimbursementBody, ok: { status: 200, description: "Recorded", example: { id: "…", status: "needs_approval" } }, errors: [400, 401] },
  { method: "post", path: "/api/reimbursements/{id}/approve", tag: "Reimbursements", summary: "Approve and send the PayPal payout", description: "Approver only. Mandate re-checked; sender_batch_id = reimb-<id>; safe against double clicks.", auth: "session", ok: { status: 200, description: "Payout sent", example: { status: "approved", payoutBatchId: "9G526YC9UN5D8", payoutStatus: "PENDING" } }, errors: [400, 401, 502] },
  { method: "post", path: "/api/reimbursements/{id}/reject", tag: "Reimbursements", summary: "Reject a receipt", auth: "session", body: RejectBody, ok: { status: 200, description: "Rejected" }, errors: [400, 401] },
  { method: "get", path: "/api/reimbursements/{id}/status", tag: "Reimbursements", summary: "Payout status (asks PayPal while in flight)", auth: "session", ok: { status: 200, description: "Status", example: { status: "paid", payoutStatus: "SUCCESS", seconds: 44 } }, errors: [401, 404] },
  { method: "post", path: "/api/subscriptions", tag: "Money in", summary: "Record a member's dues subscription", description: "The server reads the subscription back from PayPal and checks the plan before recording it.", auth: "session", body: SubscriptionBody, ok: { status: 200, description: "Recorded", example: { status: "ACTIVE", credited: 1 } }, errors: [400, 401] },
  { method: "post", path: "/api/invoices/{id}/send", tag: "Money in", summary: "Send a drafted sponsor invoice", description: "Treasurer only: this asks the sponsor for money.", auth: "session", ok: { status: 200, description: "Sent", example: { status: "SENT", recipientUrl: "https://www.sandbox.paypal.com/invoice/p/#…" } }, errors: [400, 401, 502] },
  { method: "post", path: "/api/invoices/{id}/sync", tag: "Money in", summary: "Check whether a sponsor invoice was paid", auth: "session", ok: { status: 200, description: "Current status", example: { status: "PAID" } }, errors: [401, 404] },
  { method: "post", path: "/api/keys", tag: "Agents", summary: "Create an MCP API key", description: "Treasurer only. The key is returned once; only its hash is stored.", auth: "session", body: KeyBody, ok: { status: 200, description: "Created", example: { id: "…", name: "Claude Desktop", hint: "qm_live_ab12…xy9z", key: "qm_live_…" } }, errors: [400, 401] },
  { method: "delete", path: "/api/keys/{id}", tag: "Agents", summary: "Revoke an MCP API key", auth: "session", ok: { status: 200, description: "Revoked", example: { ok: true } }, errors: [400, 401] },
  { method: "post", path: "/api/mcp", tag: "Agents", summary: "MCP server (streamable HTTP, JSON-RPC)", description: "Tools: list_mandates, search_products, check_purchase, request_purchase, search_policy, get_trust_receipt, submit_reimbursement. None can pay.", auth: "apiKey", ok: { status: 200, description: "JSON-RPC response" }, errors: [401] },
  { method: "post", path: "/api/webhooks/paypal", tag: "Webhooks", summary: "PayPal webhook receiver", description: "Signature verified with PayPal, stored by event id before processing (duplicates ignored).", auth: "paypal", ok: { status: 200, description: "Accepted", example: { ok: true } }, errors: [400] },
];

const ERRORS: Record<number, string> = {
  400: "Invalid input, or the action isn't allowed in the current state (e.g. blocked by a mandate rule)",
  401: "Not signed in, or missing/invalid API key",
  404: "Not found",
  502: "PayPal returned an error (paypalDebugId included)",
  503: "The database is unreachable",
};

const SECURITY: Record<Auth, Record<string, string[]>[] | undefined> = {
  session: [{ session: [] }],
  apiKey: [{ apiKey: [] }],
  paypal: [{ paypalSignature: [] }],
  none: [],
};

export function openApiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const responses: Record<string, unknown> = {
      [op.ok.status]: {
        description: op.ok.description,
        content: { [op.ok.contentType ?? "application/json"]: { schema: { type: op.ok.contentType ? "string" : "object" }, ...(op.ok.example ? { example: op.ok.example } : {}) } },
      },
    };
    for (const code of op.errors ?? [])
      responses[code] = { description: ERRORS[code], content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
    (paths[op.path] ??= {})[op.method] = {
      tags: [op.tag],
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      operationId: `${op.method}${op.path.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""))}`,
      ...(params.length ? { parameters: params } : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: zodToJsonSchema(op.body, { target: "openApi3", $refStrategy: "none" }) } } } } : {}),
      security: SECURITY[op.auth],
      responses,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Quartermaster API",
      version: APP_REVISION,
      description:
        "AI purchasing agent for volunteer teams. Money moves only through PayPal and only inside spending mandates a human signed; the mandate engine decides, separate code executes. Sandbox only.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: serverUrl }],
    tags: [...new Set(OPS.map((o) => o.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "qm_member", description: "Set by POST /api/session (demo sign-in)" },
        apiKey: { type: "http", scheme: "bearer", description: "qm_live_… key created on /settings (MCP only)" },
        paypalSignature: { type: "apiKey", in: "header", name: "paypal-transmission-sig", description: "Verified with PayPal's verify-webhook-signature API" },
      },
      schemas: { Error: { type: "object", properties: { error: { type: "string" }, paypalDebugId: { type: "string", nullable: true } }, required: ["error"] } },
    },
  };
}

export const OPENAPI_OPERATIONS = OPS;
