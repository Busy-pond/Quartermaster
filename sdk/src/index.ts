/**
 * Quartermaster TypeScript SDK (no dependencies; Node 20+ and browsers).
 *
 * Hand-written stand-in for the APIMatic-generated SDK: the same methods, built from the same OpenAPI document.
 * A test (src/lib/api/sdk.test.ts) fails if a route in /api/openapi.json has no method here, so the two cannot drift.
 * Regenerate with APIMatic from https://<your-app>/api/openapi.json and replace this file (see sdk/README.md).
 */

export type Role = "member" | "treasurer";
export interface Member {
  id: string;
  name: string;
  role: Role;
}
export interface ReceiptManualEntry {
  merchant: string;
  date: string | null;
  totalDollars: number;
  category: string;
}
export interface ReceiptSubmission {
  mandateId: string;
  /** A data URL, e.g. "data:image/jpeg;base64,..." (max 4 MB). */
  imageDataUrl: string;
  note?: string | null;
  /** Details typed in by hand when the photo cannot be read; flagged for the treasurer. */
  manual?: ReceiptManualEntry | null;
}
export interface ApiKey {
  id: string;
  name: string;
  hint: string;
  /** Shown once, when the key is created. */
  key: string;
}
export type InsightsView = "spend_by_event" | "over_budget_share" | "pending_reimbursements" | "blocked_attempts" | "mandate_health";
export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  parts: { type: "text"; text: string }[];
}

/** Thrown for any non-2xx answer. `body.error` is the app's own explanation. */
export class QuartermasterError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; paypalDebugId?: string | null },
    public path: string,
  ) {
    super(body.error ?? `Quartermaster ${path} answered ${status}`);
  }
}

export interface ClientOptions {
  /** e.g. "http://localhost:3000" */
  baseUrl: string;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
}

export class QuartermasterClient {
  private base: string;
  private doFetch: typeof fetch;
  /** The demo session cookie, remembered between calls the way a browser would. */
  private cookie = "";

  constructor(options: ClientOptions) {
    this.base = options.baseUrl.replace(/\/$/, "");
    this.doFetch = options.fetch ?? fetch;
  }

  private async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const res = await this.doFetch(`${this.base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    return res;
  }

  private async json<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const res = await this.raw(method, path, body, headers);
    const parsed = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new QuartermasterError(res.status, parsed as { error?: string }, path);
    return parsed;
  }

  // ---- System

  /** @route GET /api/health */
  health() {
    return this.json<{ ok: boolean; db: string; time: string }>("GET", "/api/health");
  }

  /** @route GET /api/openapi.json */
  openApi() {
    return this.json<{ openapi: string; paths: Record<string, unknown> }>("GET", "/api/openapi.json");
  }

  // ---- Session (demo sign-in, no passwords)

  /** @route POST /api/session */
  signIn(role: Role) {
    return this.json<{ member: Member }>("POST", "/api/session", { role });
  }

  /** @route DELETE /api/session */
  signOut() {
    this.cookie = "";
    return this.json<{ ok: true }>("DELETE", "/api/session");
  }

  // ---- Agent

  /** The agent's reply is an AI SDK UI message stream; read `response.body`. @route POST /api/chat */
  chat(id: string, messages: UiMessage[]): Promise<Response> {
    return this.raw("POST", "/api/chat", { id, messages });
  }

  // ---- Payments

  /** @route GET /api/paypal/client-token */
  paypalClientToken() {
    return this.json<{ accessToken: string }>("GET", "/api/paypal/client-token");
  }

  /** Approver only; the mandate is checked again first. @route POST /api/payments/{id}/order */
  createPayPalOrder(paymentId: string) {
    return this.json<{ id: string; status: string }>("POST", `/api/payments/${paymentId}/order`);
  }

  /** @route POST /api/payments/{id}/capture */
  capturePayment(paymentId: string, orderId: string) {
    return this.json<{ status: string; captureId: string | null }>("POST", `/api/payments/${paymentId}/capture`, { orderId });
  }

  /** @route POST /api/payments/{id}/refund */
  refundPayment(paymentId: string, reason = "") {
    return this.json<{ status: string; refundId?: string }>("POST", `/api/payments/${paymentId}/refund`, { reason });
  }

  // ---- Reimbursements

  /** @route POST /api/reimbursements */
  submitReceipt(receipt: ReceiptSubmission) {
    return this.json<{ id: string; status: string }>("POST", "/api/reimbursements", receipt);
  }

  /** @route POST /api/reimbursements/{id}/approve */
  approveReimbursement(id: string) {
    return this.json<{ status: string; payoutBatchId?: string; payoutStatus?: string }>("POST", `/api/reimbursements/${id}/approve`);
  }

  /** @route POST /api/reimbursements/{id}/reject */
  rejectReimbursement(id: string, reason = "") {
    return this.json<{ status: string }>("POST", `/api/reimbursements/${id}/reject`, { reason });
  }

  /** @route GET /api/reimbursements/{id}/status */
  reimbursementStatus(id: string) {
    return this.json<{ status: string; payoutStatus: string | null; payoutBatchId: string | null; paidAt: string | null; seconds: number | null }>("GET", `/api/reimbursements/${id}/status`);
  }

  // ---- Money in

  /** @route POST /api/subscriptions */
  recordSubscription(subscriptionId: string) {
    return this.json<{ status: string; credited: number }>("POST", "/api/subscriptions", { subscriptionId });
  }

  /** Treasurer only: this asks the sponsor for money. @route POST /api/invoices/{id}/send */
  sendInvoice(id: string) {
    return this.json<{ status: string; recipientUrl: string | null }>("POST", `/api/invoices/${id}/send`);
  }

  /** @route POST /api/invoices/{id}/sync */
  checkInvoice(id: string) {
    return this.json<{ status: string }>("POST", `/api/invoices/${id}/sync`);
  }

  // ---- Dashboard

  /** Read-only treasurer figures (money in cents). `threshold` is for over_budget_share, `days` for blocked_attempts. @route GET /api/treasurer/insights */
  insights<T = unknown>(view: InsightsView, opts: { threshold?: number; days?: number } = {}) {
    const q = new URLSearchParams({ view, ...Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, String(v)])) });
    return this.json<{ view: InsightsView; asOf: string; source: string; result: T }>("GET", `/api/treasurer/insights?${q}`);
  }

  // ---- Agents (MCP)

  /** Treasurer only. The key is returned once. @route POST /api/keys */
  createApiKey(name = "") {
    return this.json<ApiKey>("POST", "/api/keys", { name });
  }

  /** @route DELETE /api/keys/{id} */
  revokeApiKey(id: string) {
    return this.json<{ ok: true }>("DELETE", `/api/keys/${id}`);
  }

  /** One JSON-RPC call to the MCP server with an API key, e.g. `mcp(key, "tools/list")`. @route POST /api/mcp */
  mcp<T = unknown>(apiKey: string, method: string, params?: unknown) {
    return this.json<{ jsonrpc: "2.0"; id: number; result: T }>(
      "POST",
      "/api/mcp",
      { jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) },
      { Authorization: `Bearer ${apiKey}`, Accept: "application/json, text/event-stream" },
    );
  }
}
