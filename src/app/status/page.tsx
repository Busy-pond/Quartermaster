import { integrations } from "@/lib/flags";

export const dynamic = "force-dynamic";

const STYLE = {
  live: "bg-ok-soft text-ok",
  fallback: "bg-warn-soft text-warn",
  off: "bg-bad-soft text-bad",
} as const;

export default function StatusPage() {
  const list = integrations();
  return (
    <div className="mx-auto max-w-3xl">
      <p className="label">System</p>
      <h1 className="mt-1 text-2xl font-semibold">Integration status</h1>
      <p className="mt-1 text-muted">Every integration has a fallback, so one service being down never breaks the demo.</p>
      <div className="card mt-6 divide-y divide-line">
        {list.map((i) => (
          <div key={i.key} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{i.name}</p>
              <p className="text-sm text-muted">{i.role}</p>
              {i.state !== "live" && <p className="mt-1 text-sm text-muted">Fallback: {i.fallback}</p>}
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STYLE[i.state]}`}>{i.state}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
