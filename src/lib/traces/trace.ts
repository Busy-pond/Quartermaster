/**
 * Agent traces (Day 19), the pure part. Every tool call the agent makes (chat or MCP)
 * is timed and recorded with its trace id, latency and outcome. The audit table holds
 * them; when Elastic is on they are mirrored to the `qm-events` index with the rest of
 * the audit trail, where the ES|QL anomaly query reads them.
 */

export const EVENTS_INDEX = "qm-events";
export const TOOL_EVENT = "agent.tool";

/** ok, rejected (the tool returned an error for the model to fix), error (it threw), or the mandate engine's outcome. */
export type ToolOutcome = "ok" | "rejected" | "error" | "allow" | "needs_approval" | "deny";

export interface ToolTrace {
  tool: string;
  latencyMs: number;
  outcome: ToolOutcome;
  error?: string;
}

export function toolOutcome(result: unknown): ToolOutcome {
  if (result && typeof result === "object") {
    const r = result as { error?: unknown; outcome?: unknown };
    if (r.error) return "rejected";
    if (r.outcome === "allow" || r.outcome === "needs_approval" || r.outcome === "deny") return r.outcome;
  }
  return "ok";
}

type Exec = (...args: never[]) => unknown;

/**
 * Wraps each tool's execute so its call is timed and passed to `record`. The tool's
 * result (or error) is returned unchanged; a failing `record` never fails the tool.
 */
export function withTraces<T extends Record<string, { execute?: Exec }>>(tools: T, record: (t: ToolTrace) => unknown, clock: () => number = () => performance.now()): T {
  const send = (t: ToolTrace) => {
    try {
      void Promise.resolve(record(t)).catch(() => {});
    } catch {
      // tracing must never break a tool call
    }
  };
  return Object.fromEntries(
    Object.entries(tools).map(([tool, t]) => {
      const run = t.execute as ((...args: unknown[]) => unknown) | undefined;
      if (!run) return [tool, t];
      const execute = async (...args: unknown[]) => {
        const start = clock();
        const ms = () => Math.round(clock() - start);
        try {
          const result = await run(...args);
          send({ tool, latencyMs: ms(), outcome: toolOutcome(result) });
          return result;
        } catch (e) {
          send({ tool, latencyMs: ms(), outcome: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
          throw e;
        }
      };
      return [tool, { ...t, execute }];
    }),
  ) as T;
}

export interface AuditRow {
  id: string;
  orgId: string;
  traceId: string;
  paymentId: string | null;
  actor: string;
  type: string;
  message: string;
  payload: unknown;
  createdAt: Date;
}

/** What the anomaly query looks for. A refund counts once per payment (the app's request and PayPal's webhook are one refund). */
export type Signal = "blocked" | "refund";

const BLOCKING_TOOLS = new Set(["checkPurchase", "proposePurchase"]);

export function signalOf(type: string, payload: unknown): Signal | null {
  const p = (payload ?? {}) as { tool?: unknown; outcome?: unknown };
  if (type === TOOL_EVENT) return BLOCKING_TOOLS.has(String(p.tool)) && p.outcome === "deny" ? "blocked" : null;
  if (type === "payment.blocked" || type === "reimbursement.blocked") return "blocked";
  if (type === "payment.refund_requested" || type === "PAYMENT.CAPTURE.REFUNDED") return "refund";
  return null;
}

/** Audit event types that can carry a signal, for a narrow Postgres query. */
export const SIGNAL_TYPES = [TOOL_EVENT, "payment.blocked", "reimbursement.blocked", "payment.refund_requested", "PAYMENT.CAPTURE.REFUNDED"];

/** Who a signal is about: the member for agent attempts, else the whole org. */
export function subjectOf(payload: unknown): string {
  const m = (payload as { memberId?: unknown } | null)?.memberId;
  return typeof m === "string" && m ? m : "org";
}

/** One audit row as an Elastic document in `qm-events`. */
export function eventDoc(row: AuditRow) {
  const p = (row.payload ?? {}) as { tool?: unknown; latencyMs?: unknown; outcome?: unknown };
  const signal = signalOf(row.type, row.payload);
  return {
    "@timestamp": row.createdAt.toISOString(),
    event_id: row.id,
    org_id: row.orgId,
    trace_id: row.traceId,
    payment_id: row.paymentId,
    actor: row.actor,
    type: row.type,
    message: row.message,
    tool: typeof p.tool === "string" ? p.tool : null,
    latency_ms: typeof p.latencyMs === "number" ? p.latencyMs : null,
    outcome: typeof p.outcome === "string" ? p.outcome : null,
    signal,
    subject: signal ? subjectOf(row.payload) : null,
  };
}

export const eventsMapping = {
  mappings: {
    properties: {
      "@timestamp": { type: "date" },
      event_id: { type: "keyword" },
      org_id: { type: "keyword" },
      trace_id: { type: "keyword" },
      payment_id: { type: "keyword" },
      actor: { type: "keyword" },
      type: { type: "keyword" },
      message: { type: "text" },
      tool: { type: "keyword" },
      latency_ms: { type: "long" },
      outcome: { type: "keyword" },
      signal: { type: "keyword" },
      subject: { type: "keyword" },
    },
  },
};
