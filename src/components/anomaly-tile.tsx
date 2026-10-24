import type { AnomalyReport } from "@/lib/traces/load";
import { ANOMALY_DAYS, ANOMALY_THRESHOLD } from "@/lib/traces/anomalies";

const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Repeated blocked attempts and refund spikes, from one ES|QL query (or the same rule in Postgres when Elastic is off). */
export function AnomalyTile({ report }: { report: AnomalyReport }) {
  return (
    <section className="card p-5" aria-labelledby="anomaly-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="anomaly-title" className="font-display text-lg font-semibold">
          Unusual activity, last {ANOMALY_DAYS} days
        </h2>
        <p className="text-xs text-muted">{report.source === "elastic" ? "Elastic ES|QL over agent traces and the audit trail" : "Computed from the audit table in Postgres (Elastic is off)"}</p>
      </div>
      {report.note && <p className="mt-1 text-xs text-muted">{report.note}</p>}
      {report.anomalies.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Nothing unusual: no member had {ANOMALY_THRESHOLD} or more blocked attempts in a day, and no day had {ANOMALY_THRESHOLD} or more refunds.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line text-sm">
          {report.anomalies.map((a) => (
            <li key={`${a.signal}-${a.subject}-${a.day}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span>
                <span className="font-medium text-bad">{a.signal === "blocked" ? "Repeated blocked attempts" : "Refund spike"}</span>
                {" · "}
                {a.signal === "blocked" ? `${a.count} by ${a.who}` : `${a.count} refunds`} on {shortDay(a.day)}
              </span>
              <span className="text-xs text-muted tabular-nums">
                across {a.traces} {a.traces === 1 ? "request" : "requests"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">The query</summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-paper p-3 font-mono leading-relaxed">{report.query}</pre>
      </details>
    </section>
  );
}
