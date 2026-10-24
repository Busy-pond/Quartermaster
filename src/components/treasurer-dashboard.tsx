"use client";

/**
 * Treasurer dashboard (Day 12) on AG Grid Community and AG Charts Community,
 * themed from the requisition-desk tokens (globals.css) instead of AG's default look.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule as AllChartsModule, ModuleRegistry as ChartsModuleRegistry, type AgChartOptions, type AgChartTheme } from "ag-charts-community";
import { BudgetBar } from "@/components/budget-bar";
import { Stamp, stampFor } from "@/components/stamp";
import { money, shortDate } from "@/lib/format";
import { REIMBURSEMENT_STATUS, reimbursementStamp } from "@/lib/reimbursements/labels";
import type { Envelope } from "@/lib/dashboard/aggregate";
import { awaitsTreasurer, paymentState } from "@/lib/dashboard/insights";
import type { PaymentGridRow, ReimbursementGridRow } from "@/lib/dashboard/load";

// AG Grid and AG Charts each keep their own module registry.
ModuleRegistry.registerModules([AllCommunityModule]);
ChartsModuleRegistry.registerModules([AllChartsModule]);

// The design tokens from globals.css, as AG Grid theme parameters.
const INK = "#1b2a4a";
const MUTED = "#5b6b7f";
const LINE = "#d5dee5";
const PAPER = "#f3f6f8";
const BRAND = "#0f5b4a";
const WARN = "#b7791f";
const BAD = "#c4302b";
/** Also themes the AG Studio dashboard, so both versions of /treasurer look like one app. */
export const DESK_TOKENS = { INK, MUTED, LINE, PAPER, BRAND, WARN, BAD } as const;

const gridTheme = themeQuartz.withParams({
  accentColor: BRAND,
  backgroundColor: "#ffffff",
  foregroundColor: INK,
  borderColor: LINE,
  headerBackgroundColor: PAPER,
  headerTextColor: MUTED,
  headerFontWeight: 600,
  oddRowBackgroundColor: "#fafbfc",
  rowHoverColor: "#eef4f1",
  fontFamily: "var(--font-body), ui-sans-serif, system-ui, sans-serif",
  fontSize: 14,
  wrapperBorderRadius: 12,
  spacing: 7,
});

// Charts don't animate: animation is an AG Charts Enterprise module, and static charts suit reduced motion anyway.
const themeFor = (fontFamily: string): AgChartTheme => ({
  baseTheme: "ag-default",
  palette: { fills: [BRAND, "#7fb3a4", WARN, BAD, "#6b7fa8", "#b9c4cf"], strokes: [BRAND, "#5f9888", WARN, BAD, "#55688f", "#9aa7b4"] },
  params: { fontFamily, foregroundColor: INK, subtleTextColor: MUTED, gridLineColor: LINE, backgroundColor: "#ffffff", fontSize: 13 },
});

export type { PaymentGridRow, ReimbursementGridRow };

/** AG Charts draws on a canvas and needs a real font name, not a CSS variable: read the one next/font applied to the body. */
export function useBodyFont() {
  return useSyncExternalStore(
    () => () => undefined,
    () => getComputedStyle(document.body).fontFamily,
    () => "ui-sans-serif, system-ui, sans-serif",
  );
}

const usd = (c: number) => money(c, "USD");

function EnvelopeCell({ data }: ICellRendererParams<Envelope>) {
  if (!data) return null;
  return (
    <div className="py-2.5 leading-snug">
      <BudgetBar capCents={data.capCents} spentCents={data.spentCents} committedCents={data.committedCents} showLegend={false} />
      <p className="mt-1.5 text-xs text-muted">
        {usd(data.spentCents)} spent{data.committedCents > 0 && ` · ${usd(data.committedCents)} approved, not yet paid`} · {usd(data.remainingCents)} left
      </p>
    </div>
  );
}

function PaymentStatusCell({ data }: ICellRendererParams<PaymentGridRow>) {
  if (!data) return null;
  // "approved" = nobody has paid yet; the Pre-approved stamp is for the engine's decision, shown on the receipt.
  if (data.status === "approved") return <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">{paymentState(data.status)}</span>;
  const kind = stampFor(data.status);
  return kind ? <Stamp kind={kind} size="sm" animate={false} className="my-2.5 rotate-[-3deg]!" /> : <span className="text-muted">{data.status}</span>;
}

function ReimbursementStatusCell({ data }: ICellRendererParams<ReimbursementGridRow>) {
  if (!data) return null;
  const kind = reimbursementStamp(data.status);
  return kind ? <Stamp kind={kind} size="sm" animate={false} className="my-2.5 rotate-[-3deg]!" /> : <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REIMBURSEMENT_STATUS[data.status].cls}`}>{REIMBURSEMENT_STATUS[data.status].label}</span>;
}

function ApproveCell({ data, context }: ICellRendererParams<ReimbursementGridRow, unknown, { isTreasurer: boolean; refresh: () => void }>) {
  if (!data) return null;
  return <ApproveReimbursement row={data} isTreasurer={context.isTreasurer} onDone={context.refresh} />;
}

/** One-tap approve (the mandate is re-checked server-side before the payout). Shared with the AG Studio queue widget. */
export function ApproveReimbursement({ row: data, isTreasurer, onDone }: { row: Pick<ReimbursementGridRow, "id" | "status" | "amountCents" | "volunteer">; isTreasurer: boolean; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const actionable = awaitsTreasurer({ kind: "reimbursement", status: data.status });
  if (!actionable)
    return (
      <Link href={`/reimbursements/${data.id}`} className="text-sm underline">
        Open
      </Link>
    );
  if (!isTreasurer)
    return (
      <Link href={`/reimbursements/${data.id}`} className="text-sm underline">
        Review
      </Link>
    );
  return (
    <span className="flex items-center gap-2">
      <button
        className="btn-primary px-3! py-1! text-xs"
        disabled={state === "busy"}
        aria-label={`Approve ${usd(data.amountCents)} to ${data.volunteer}`}
        onClick={async () => {
          setState("busy");
          setError(null);
          const res = await fetch(`/api/reimbursements/${data.id}/approve`, { method: "POST" });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            setState("error");
            setError(json.error ?? "Approval failed");
            return;
          }
          onDone();
        }}
      >
        {state === "busy" ? "Sending payout…" : data.status === "failed" ? "Retry payout" : "Approve"}
      </button>
      <Link href={`/reimbursements/${data.id}`} className="text-xs underline">
        Review
      </Link>
      {error && <span className="text-xs text-bad" title={error}>Failed</span>}
    </span>
  );
}

export function TreasurerDashboard(props: {
  orgName: string;
  isTreasurer: boolean;
  envelopes: Envelope[];
  payments: PaymentGridRow[];
  reimbursements: ReimbursementGridRow[];
  byCategory: { category: string; spentCents: number; committedCents: number }[];
  exceptions: { day: string; blocked: number; refunded: number; refundedCents: number }[];
  awaitingTreasurer: number;
}) {
  const router = useRouter();
  const font = useBodyFont();
  const chartTheme = useMemo(() => themeFor(font), [font]);
  const [quick, setQuick] = useState("");
  const queue = props.reimbursements.filter((r) => awaitsTreasurer({ kind: "reimbursement", status: r.status }));

  const envelopeCols = useMemo<ColDef<Envelope>[]>(
    () => [
      { field: "title", headerName: "Mandate", flex: 1.4, minWidth: 220, wrapText: true, autoHeight: true, cellRenderer: (p: ICellRendererParams<Envelope>) => <span className="block py-2 font-medium leading-snug">{p.value}<span className="block text-xs font-normal text-muted">{p.data?.event ?? "Standing budget"}</span></span> },
      { headerName: "Budget", flex: 2, minWidth: 260, autoHeight: true, cellRenderer: EnvelopeCell, sortable: false },
      { field: "capCents", headerName: "Cap", width: 110, type: "rightAligned", valueFormatter: (p) => usd(p.value) },
      { field: "remainingCents", headerName: "Left", width: 120, type: "rightAligned", valueFormatter: (p) => usd(p.value), cellClass: (p) => ((p.value ?? 0) < (p.data?.capCents ?? 0) * 0.1 ? "text-bad font-medium" : "") },
      { field: "usedPct", headerName: "Used", width: 95, type: "rightAligned", valueFormatter: (p) => `${p.value}%`, sort: "desc" },
      { field: "blocked", headerName: "Blocked", width: 100, type: "rightAligned", headerTooltip: "Attempts the mandate engine blocked" },
    ],
    [],
  );

  const paymentCols = useMemo<ColDef<PaymentGridRow>[]>(
    () => [
      { field: "date", headerName: "Date", width: 120, valueFormatter: (p) => shortDate(p.value), sort: "desc" },
      { field: "items", headerName: "Items", flex: 2, minWidth: 220, cellRenderer: (p: ICellRendererParams<PaymentGridRow>) => <Link href={`/receipts/${p.data?.id}`} className="hover:underline">{p.value}</Link> },
      { field: "vendor", headerName: "Vendor", width: 140 },
      { field: "mandate", headerName: "Mandate", flex: 1, minWidth: 160, hide: false },
      { field: "amountCents", headerName: "Amount", width: 115, type: "rightAligned", valueFormatter: (p) => money(p.value, p.data?.currency ?? "USD"), filter: "agNumberColumnFilter" },
      { field: "status", headerName: "Status", width: 170, cellRenderer: PaymentStatusCell, filter: true },
      { field: "clause", headerName: "Rule", width: 80, headerTooltip: "The deciding mandate clause (M7 = cap, M9 = order limit)" },
      { field: "orderId", headerName: "PayPal order", width: 190, cellClass: "font-mono text-xs", valueFormatter: (p) => p.value ?? "—" },
      { field: "captureId", headerName: "Capture", width: 190, cellClass: "font-mono text-xs", valueFormatter: (p) => p.value ?? "—" },
    ],
    [],
  );

  const reimbursementCols = useMemo<ColDef<ReimbursementGridRow>[]>(
    () => [
      { field: "date", headerName: "Submitted", width: 125, valueFormatter: (p) => shortDate(p.value), sort: "desc" },
      { field: "volunteer", headerName: "Volunteer", width: 150 },
      { field: "merchant", headerName: "Receipt", flex: 1, minWidth: 170, valueFormatter: (p) => `${p.value}${p.data?.receiptDate ? ` · ${p.data.receiptDate}` : ""}` },
      { field: "amountCents", headerName: "Amount", width: 110, type: "rightAligned", valueFormatter: (p) => money(p.value, p.data?.currency ?? "USD") },
      { field: "status", headerName: "Status", width: 170, cellRenderer: ReimbursementStatusCell },
      { field: "note", headerName: "Note", flex: 1, minWidth: 160, tooltipField: "note", cellClass: "text-muted text-xs", valueFormatter: (p) => p.value ?? "" },
      { headerName: "", width: 210, cellRenderer: ApproveCell, sortable: false, filter: false },
    ],
    [],
  );

  const eventChart: AgChartOptions = {
    theme: chartTheme,
    title: { text: "Spend by mandate" },
    data: props.envelopes.map((e) => ({ name: e.event ?? e.title, spent: e.spentCents / 100, committed: e.committedCents / 100, left: Math.max(0, e.remainingCents) / 100 })),
    series: [
      { type: "bar", direction: "horizontal", xKey: "name", yKey: "spent", yName: "Spent", stacked: true },
      { type: "bar", direction: "horizontal", xKey: "name", yKey: "committed", yName: "Approved, not yet paid", stacked: true },
      { type: "bar", direction: "horizontal", xKey: "name", yKey: "left", yName: "Left", stacked: true, fill: "#e6ecf0", stroke: "#e6ecf0" },
    ],
    axes: {
      x: { type: "category", position: "left" },
      y: { type: "number", position: "bottom", label: { formatter: ({ value }: { value: number }) => `${value}` } },
    },
    legend: { position: "bottom" },
  };

  const categoryChart: AgChartOptions = {
    theme: chartTheme,
    title: { text: "Spend by category" },
    data: props.byCategory.map((c) => ({ category: c.category, amount: (c.spentCents + c.committedCents) / 100 })),
    series: [{ type: "donut", angleKey: "amount", legendItemKey: "category", innerRadiusRatio: 0.62, calloutLabel: { enabled: false }, tooltip: { renderer: ({ datum }: { datum: { category: string; amount: number } }) => ({ title: datum.category, content: usd(Math.round(datum.amount * 100)) }) } }],
    legend: { position: "right" },
  };

  const exceptionChart: AgChartOptions = {
    theme: chartTheme,
    title: { text: "Blocked and refunded, 14 days" },
    data: props.exceptions.map((d) => ({ day: d.day.slice(5), blocked: d.blocked, refunded: d.refunded })),
    series: [
      { type: "bar", xKey: "day", yKey: "blocked", yName: "Blocked by a mandate rule", fill: BAD, stroke: BAD },
      { type: "bar", xKey: "day", yKey: "refunded", yName: "Refunded", fill: MUTED, stroke: MUTED },
    ],
    axes: {
      x: { type: "category", position: "bottom" },
      y: { type: "number", position: "left", interval: { step: 1 } },
    },
    legend: { position: "bottom" },
  };

  const context = useMemo(() => ({ isTreasurer: props.isTreasurer, refresh: () => router.refresh() }), [props.isTreasurer, router]);
  const totalLeft = props.envelopes.reduce((s, e) => s + e.remainingCents, 0);

  return (
    <div className="min-w-0 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">{props.orgName}</p>
          <h1 className="mt-1 text-2xl font-semibold">Treasurer dashboard</h1>
          <p className="mt-1 text-muted">Budgets, payments and reimbursements, live from the same ledger the mandate engine checks.</p>
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-muted">Left across mandates</dt>
            <dd className="font-display text-2xl font-bold tabular-nums">{usd(totalLeft)}</dd>
          </div>
          <div>
            <dt className="text-muted" title="Purchases and receipts that need your approval, and payouts to retry">Waiting for you</dt>
            <dd className="font-display text-2xl font-bold tabular-nums">{props.awaitingTreasurer}</dd>
          </div>
        </dl>
      </div>

      {!props.isTreasurer && <p className="card border-warn/40 bg-warn-soft p-3 text-sm text-warn">You're viewing as a volunteer. Switch to the treasurer to approve reimbursements.</p>}

      <section aria-labelledby="queue-h">
        <h2 id="queue-h" className="font-medium">
          Reimbursement queue {queue.length > 0 && <span className="text-muted">({queue.length})</span>}
        </h2>
        {queue.length === 0 ? (
          <p className="card mt-3 p-4 text-sm text-muted">Nothing waiting. New receipts appear here as soon as a volunteer submits one.</p>
        ) : (
          <div className="mt-3" style={{ height: Math.min(56 + queue.length * 52, 320) }}>
            <AgGridReact theme={gridTheme} rowData={queue} columnDefs={reimbursementCols} context={context} getRowId={(p) => p.data.id} rowHeight={52} />
          </div>
        )}
      </section>

      <section aria-labelledby="env-h">
        <h2 id="env-h" className="font-medium">Budget envelopes</h2>
        <div className="mt-3">
          <AgGridReact theme={gridTheme} overlayNoRowsTemplate="No budgets yet." rowData={props.envelopes} columnDefs={envelopeCols} domLayout="autoHeight" getRowId={(p) => p.data.mandateId} />
        </div>
      </section>

      <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3" aria-label="Charts">
        <div className="card h-72 min-w-0 overflow-hidden p-2 lg:col-span-1">
          <AgCharts options={eventChart} style={{ height: "100%" }} />
        </div>
        <div className="card h-72 min-w-0 overflow-hidden p-2">
          {props.byCategory.length ? <AgCharts options={categoryChart} style={{ height: "100%" }} /> : <p className="p-4 text-sm text-muted">No spending yet.</p>}
        </div>
        <div className="card h-72 min-w-0 overflow-hidden p-2">
          <AgCharts options={exceptionChart} style={{ height: "100%" }} />
        </div>
      </section>

      <section aria-labelledby="pay-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="pay-h" className="font-medium">Payments</h2>
          <label className="text-sm">
            <span className="sr-only">Filter payments</span>
            <input
              type="search"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              placeholder="Filter: vendor, item, status, PayPal ID…"
              className="w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-card px-3 py-1.5"
            />
          </label>
        </div>
        <div className="mt-3 h-[480px]">
          <AgGridReact theme={gridTheme} overlayNoRowsTemplate="No payments yet. Requests from volunteers appear here." rowData={props.payments} columnDefs={paymentCols} quickFilterText={quick} getRowId={(p) => p.data.id} rowHeight={50} pagination paginationPageSize={20} paginationPageSizeSelector={[20, 50, 100]} />
        </div>
        {props.reimbursements.length > queue.length && (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-medium">All reimbursements ({props.reimbursements.length})</summary>
            <div className="mt-3 h-80">
              <AgGridReact theme={gridTheme} rowData={props.reimbursements} columnDefs={reimbursementCols} context={context} getRowId={(p) => p.data.id} rowHeight={52} />
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
