/**
 * The anomaly tile on /treasurer (Day 19), the pure part: one ES|QL query over
 * `qm-events` that finds repeated blocked attempts (by member, per day) and refund
 * spikes (per day), and the same rule in TypeScript for when Elastic is off.
 */
import { EVENTS_INDEX, signalOf, subjectOf, type AuditRow, type Signal } from "./trace";

/** Three of the same kind in one day is unusual for a volunteer group. */
export const ANOMALY_THRESHOLD = 3;
export const ANOMALY_DAYS = 7;

export interface Anomaly {
  signal: Signal;
  /** Member id for blocked attempts; "org" for refunds and blocks at payment time. */
  subject: string;
  day: string; // YYYY-MM-DD, UTC
  count: number;
  traces: number;
  last: string; // ISO time of the latest one
}

/** Positional params: org id, then the threshold. A refund counts once per payment, a blocked attempt once per event. */
export const ANOMALY_ESQL = `FROM ${EVENTS_INDEX}
| WHERE org_id == ? AND signal IS NOT NULL AND @timestamp >= NOW() - ${ANOMALY_DAYS} days
| EVAL day = DATE_TRUNC(1 day, @timestamp), unit = CASE(signal == "refund", payment_id, event_id)
| STATS n = COUNT_DISTINCT(unit), traces = COUNT_DISTINCT(trace_id), latest = MAX(@timestamp) BY signal, subject, day
| WHERE n >= ?
| SORT n DESC, latest DESC
| LIMIT 10`;

export const anomalyParams = (orgId: string, threshold = ANOMALY_THRESHOLD) => [orgId, threshold];

/** ES|QL answers in columns + rows; this turns them into Anomalies. */
export function parseEsql(res: { columns: { name: string }[]; values: unknown[][] }): Anomaly[] {
  const col = (name: string) => res.columns.findIndex((c) => c.name === name);
  const i = { signal: col("signal"), subject: col("subject"), day: col("day"), count: col("n"), traces: col("traces"), last: col("latest") };
  if (Object.values(i).some((n) => n < 0)) throw new Error(`ES|QL answer is missing columns: ${res.columns.map((c) => c.name).join(", ")}`);
  return res.values.map((v) => ({
    signal: v[i.signal] as Signal,
    subject: String(v[i.subject] ?? "org"),
    day: String(v[i.day]).slice(0, 10),
    count: Number(v[i.count]),
    traces: Number(v[i.traces]),
    last: String(v[i.last]),
  }));
}

/** The same rule as ANOMALY_ESQL, over audit rows from Postgres. */
export function detectAnomalies(rows: AuditRow[], now: Date, threshold = ANOMALY_THRESHOLD): Anomaly[] {
  const since = now.getTime() - ANOMALY_DAYS * 86_400_000;
  const groups = new Map<string, { a: Omit<Anomaly, "count" | "traces">; units: Set<string>; traces: Set<string> }>();
  for (const r of rows) {
    const signal = signalOf(r.type, r.payload);
    if (!signal || r.createdAt.getTime() < since) continue;
    const subject = subjectOf(r.payload);
    const day = r.createdAt.toISOString().slice(0, 10);
    const key = `${signal}|${subject}|${day}`;
    const g = groups.get(key) ?? { a: { signal, subject, day, last: r.createdAt.toISOString() }, units: new Set(), traces: new Set() };
    g.units.add(signal === "refund" ? (r.paymentId ?? r.id) : r.id);
    g.traces.add(r.traceId);
    if (r.createdAt.toISOString() > g.a.last) g.a.last = r.createdAt.toISOString();
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g.a, count: g.units.size, traces: g.traces.size }))
    .filter((a) => a.count >= threshold)
    .sort((x, y) => y.count - x.count || y.last.localeCompare(x.last))
    .slice(0, 10);
}
