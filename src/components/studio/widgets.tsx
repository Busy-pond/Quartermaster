"use client";

/**
 * Quartermaster's three AG Studio custom widgets (Day 17). Each reads its own table
 * through widgetApi.getData, so page filters, widget filters and cross filters set
 * in Studio (by the treasurer or the Treasurer agent) narrow it like any built-in.
 * None needs a field mapping: they know their tables.
 */
import { useEffect, useRef, useState } from "react";
import type { AgWidgetParams } from "ag-studio";
import { BudgetBar } from "@/components/budget-bar";
import { Stamp } from "@/components/stamp";
import { ApproveReimbursement } from "@/components/treasurer-dashboard";
import { money } from "@/lib/format";
import { awaitsTreasurer, health, type Result } from "@/lib/dashboard/insights";
import { REIMBURSEMENT_STATUS, reimbursementStamp } from "@/lib/reimbursements/labels";
import type { ReimbursementStatus } from "@/lib/db/schema";

export interface StudioContext {
  isTreasurer: boolean;
  refresh: () => void;
}

type Params = AgWidgetParams & { context: StudioContext };
type Row = Record<string, unknown>;

const cents = (dollars: unknown) => Math.round(Number(dollars ?? 0) * 100);
const usd = (c: number) => money(c, "USD");

/** Reads `fieldIds` of one table (with filters applied), keyed by field id; handles Studio's display states. */
function useTable(p: Params, table: string, fieldIds: string[], queryId?: string): Row[] {
  const [rows, setRows] = useState<Row[]>([]);
  const loaded = useRef(false);
  const { widgetApi } = p;
  useEffect(() => {
    let live = true;
    (async () => {
      const all = widgetApi.getSchema().find((t) => t.id === table)?.fields ?? [];
      const fields = fieldIds.map((id) => all.find((f) => f.key === `${table}.${id}`)).filter((f) => f !== undefined);
      if (fields.length !== fieldIds.length) {
        widgetApi.setDisplayState("noData");
        return;
      }
      widgetApi.setDisplayState("loading", { prominent: !loaded.current });
      const res = await widgetApi.getData({ fields, limit: { count: 500 } }, queryId ? { queryId } : undefined);
      if (!live) return;
      const out = res.results.rows.map((r) => Object.fromEntries(fieldIds.map((id) => [id, r[`${table}.${id}`]])));
      loaded.current = out.length > 0;
      setRows(out);
      widgetApi.setDisplayState(out.length ? "displayed" : "noData");
    })().catch(() => live && widgetApi.setDisplayState("noData"));
    return () => {
      live = false;
    };
    // Studio hands new params on every filter or schema change; refetch on each, like AG's own examples.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);
  return rows;
}

export function BudgetEnvelopeWidget(p: Params) {
  const rows = useTable(p, "mandates", ["id", "mandate", "event", "cap", "spent", "committed", "left", "used_pct"]);
  const sorted = [...rows].sort((a, b) => Number(b.used_pct) - Number(a.used_pct));
  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      {sorted.map((r) => {
        const used = Number(r.used_pct);
        return (
          <div key={String(r.id)}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium leading-snug">
                {String(r.mandate)}
                <span className="block text-xs font-normal text-muted">{String(r.event)}</span>
              </p>
              <p className={`shrink-0 font-display text-lg font-bold tabular-nums ${used >= 90 ? "text-bad" : used >= 80 ? "text-warn" : ""}`}>{used}%</p>
            </div>
            <div className="mt-1.5">
              <BudgetBar capCents={cents(r.cap)} spentCents={cents(r.spent)} committedCents={cents(r.committed)} showLegend={false} />
            </div>
            <p className="mt-1 text-xs text-muted">
              {usd(cents(r.spent))} spent{cents(r.committed) > 0 && ` · ${usd(cents(r.committed))} approved, not yet paid`} · {usd(cents(r.left))} left of {usd(cents(r.cap))}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function ReimbursementQueueWidget(p: Params) {
  const rows = useTable(p, "reimbursements", ["id", "submitted", "volunteer", "merchant", "mandate", "amount", "status"]);
  const queue = rows.filter((r) => awaitsTreasurer({ kind: "reimbursement", status: String(r.status) })).sort((a, b) => String(a.submitted).localeCompare(String(b.submitted)));
  const recent = rows.filter((r) => !queue.includes(r)).sort((a, b) => String(b.submitted).localeCompare(String(a.submitted))).slice(0, 4);
  const line = (r: Row) => {
    const status = r.status as ReimbursementStatus;
    const kind = reimbursementStamp(status);
    return (
      <li key={String(r.id)} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5 last:border-0">
        <span className="min-w-0">
          <span className="font-medium">{usd(cents(r.amount))}</span> to {String(r.volunteer)}
          <span className="block truncate text-xs text-muted">
            {String(r.merchant)} · {String(r.mandate)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {kind ? <Stamp kind={kind} size="sm" animate={false} className="rotate-[-3deg]!" /> : <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REIMBURSEMENT_STATUS[status].cls}`}>{REIMBURSEMENT_STATUS[status].label}</span>}
          <ApproveReimbursement row={{ id: String(r.id), status, amountCents: cents(r.amount), volunteer: String(r.volunteer) }} isTreasurer={p.context.isTreasurer} onDone={p.context.refresh} />
        </span>
      </li>
    );
  };
  return (
    <div className="h-full overflow-auto p-4">
      <p className="text-sm text-muted">{queue.length ? `${queue.length} waiting for the treasurer` : "Nothing waiting. New receipts appear here as soon as a volunteer submits one."}</p>
      {queue.length > 0 && <ul className="mt-2">{queue.map(line)}</ul>}
      {recent.length > 0 && (
        <>
          <p className="label mt-4">Recent</p>
          <ul className="mt-1">{recent.map(line)}</ul>
        </>
      )}
    </div>
  );
}

export function MandateHealthWidget(p: Params) {
  const decisions = useTable(p, "decisions", ["id", "result"], "decisions");
  const checks = useTable(p, "rule_checks", ["id", "clause"], "rule_checks");
  const h = health(
    decisions.map((d) => d.result as Result),
    checks.map((c) => String(c.clause)),
  );
  const most = h.topRules[0]?.count ?? 1;
  return (
    <div className="h-full overflow-auto p-4">
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-muted">Approval rate</dt>
          <dd className="font-display text-2xl font-bold tabular-nums">{h.approvalRatePct === null ? "—" : `${h.approvalRatePct}%`}</dd>
        </div>
        <div>
          <dt className="text-muted">Blocked</dt>
          <dd className="font-display text-2xl font-bold tabular-nums text-bad">{h.blocked}</dd>
        </div>
        <div>
          <dt className="text-muted">Waiting</dt>
          <dd className="font-display text-2xl font-bold tabular-nums">{h.waiting}</dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-muted">
        {h.attempts} requests: {h.preApproved} pre-approved by the rules, {h.treasurerApproved} approved by the treasurer
      </p>
      <p className="label mt-4">Rules that fired most</p>
      {h.topRules.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No rule has fired yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {h.topRules.map((r) => (
            <li key={r.clause} className="text-sm">
              <span className="flex justify-between gap-2">
                <span>
                  <span className="font-mono text-xs font-semibold">{r.clause}</span> {r.rule}
                </span>
                <span className="tabular-nums text-muted">{r.count}</span>
              </span>
              <span className="mt-1 block h-1.5 rounded-full bg-line">
                <span className="block h-full rounded-full bg-warn" style={{ width: `${(r.count / most) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
