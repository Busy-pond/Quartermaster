"use client";

/**
 * The treasurer dashboard in AG Studio (Day 17–18): our data as five related tables,
 * the requisition-desk theme, three custom widgets, a saved default layout and the
 * Treasurer agent. Browser only (loaded with ssr: false by treasurer-studio.tsx).
 */
import { useMemo, useRef, useState } from "react";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import {
  AgStudioAiModule,
  enableStudioDevValidations,
  studioTheme,
  type AgBaseRegistry,
  type AgBaseWidgetDefinition,
  type AgDataSourcesDefinition,
  type AgDefaultWidgetDefinition,
  type AgFieldDefinition,
  type AgReportState,
  type AgStudioApi,
  type AgWidgetDataFormat,
} from "ag-studio";
import { DESK_TOKENS, useBodyFont } from "@/components/treasurer-dashboard";
import type { DashboardData } from "@/lib/dashboard/load";
import { studioTables } from "@/lib/dashboard/studio-data";
import { BudgetEnvelopeWidget, MandateHealthWidget, ReimbursementQueueWidget, type StudioContext } from "./widgets";
import { geminiAdapter } from "./gemini-adapter";
import { treasurerHarness } from "./treasurer-agent";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

type CustomType = "budget-envelope" | "reimbursement-queue" | "mandate-health";
interface TableWidget<T extends CustomType> {
  type: T;
  dataMapping: Record<string, never>;
  format?: AgWidgetDataFormat<Record<string, never>>;
}
interface QmRegistry extends AgBaseRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | AgBaseWidgetDefinition<"budget-envelope", TableWidget<"budget-envelope">> | AgBaseWidgetDefinition<"reimbursement-queue", TableWidget<"reimbursement-queue">> | AgBaseWidgetDefinition<"mandate-health", TableWidget<"mandate-health">>)[];
}

const { INK, MUTED, LINE, PAPER, BRAND } = DESK_TOKENS;
const LAYOUT_KEY = "qm.studio.layout.v1";

const text = (id: string, name: string, description?: string): AgFieldDefinition => ({ id, name, format: "textFormat", ...(description ? { description } : {}) });
const dollars = (id: string, name: string, description?: string): AgFieldDefinition => ({ id, name, format: "currencyFormat", formatOptions: { format: "$#,##0.00" }, ...(description ? { description } : {}) });
const number = (id: string, name: string, description?: string): AgFieldDefinition => ({ id, name, format: "decimalFormat", ...(description ? { description } : {}) });
const date = (id: string, name: string): AgFieldDefinition => ({ id, name, format: "dateFormat" });

function dataSources(d: DashboardData): AgDataSourcesDefinition<QmRegistry> {
  const t = studioTables(d);
  return {
    description: "Riverside Cleanup Crew's live spending ledger: spending mandates (budgets signed by the treasurer), PayPal purchases, receipt reimbursements, and every mandate-engine decision. Nothing is sample data. Spent = captured purchases + paid receipts; committed = approved, not yet paid.",
    sources: [
      {
        id: "mandates",
        name: "Mandates",
        description: "One row per spending mandate (budget envelope) with its cap and what is used.",
        data: t.mandates,
        fields: [
          text("id", "Mandate id"),
          text("mandate", "Mandate"),
          text("event", "Event"),
          dollars("cap", "Cap", "Signed cap plus dues and sponsor money credited to it"),
          dollars("spent", "Spent"),
          dollars("committed", "Approved, not yet paid"),
          dollars("left", "Left"),
          number("used_pct", "Used %", "(spent + approved, not yet paid) / cap × 100"),
          number("blocked", "Blocked attempts"),
        ],
      },
      {
        id: "payments",
        name: "Purchases",
        description: "Every purchase the agent proposed, with its PayPal status and the deciding mandate rule.",
        data: t.payments,
        fields: [text("id", "Purchase id"), date("date", "Date"), text("vendor", "Vendor"), text("items", "Items"), text("mandate_id", "Mandate id"), text("mandate", "Mandate"), dollars("amount", "Amount"), text("status", "Status"), text("rule", "Deciding rule")],
      },
      {
        id: "reimbursements",
        name: "Reimbursements",
        description: "Receipts volunteers photographed, repaid by PayPal Payouts after the treasurer approves.",
        data: t.reimbursements,
        fields: [text("id", "Reimbursement id"), date("submitted", "Submitted"), text("volunteer", "Volunteer"), text("merchant", "Store"), text("mandate_id", "Mandate id"), text("mandate", "Mandate"), dollars("amount", "Amount"), text("status", "Status")],
      },
      {
        id: "decisions",
        name: "Decisions",
        description: "One row per purchase or receipt: what the mandate engine and the treasurer decided.",
        data: t.decisions,
        fields: [text("id", "Request id"), date("date", "Date"), text("kind", "Kind"), text("mandate_id", "Mandate id"), text("mandate", "Mandate"), text("result", "Result", "pre-approved, treasurer-approved, waiting or blocked"), dollars("amount", "Amount"), text("clause", "Deciding rule")],
      },
      {
        id: "rule_checks",
        name: "Rules fired",
        description: "One row per mandate rule that blocked a request or sent it to the treasurer (M7 = cap, M9 = order limit…).",
        data: t.rule_checks,
        fields: [text("id", "Check id"), text("decision_id", "Request id"), text("mandate_id", "Mandate id"), text("mandate", "Mandate"), text("clause", "Rule"), text("rule", "Rule text"), text("outcome", "Outcome")],
      },
    ],
    relationships: [
      { id: "payments-mandate", source: { tableId: "payments", fieldId: "mandate_id" }, target: { tableId: "mandates", fieldId: "id" }, type: "many-to-one" },
      { id: "reimbursements-mandate", source: { tableId: "reimbursements", fieldId: "mandate_id" }, target: { tableId: "mandates", fieldId: "id" }, type: "many-to-one" },
      { id: "decisions-mandate", source: { tableId: "decisions", fieldId: "mandate_id" }, target: { tableId: "mandates", fieldId: "id" }, type: "many-to-one" },
      { id: "checks-decision", source: { tableId: "rule_checks", fieldId: "decision_id" }, target: { tableId: "decisions", fieldId: "id" }, type: "many-to-one" },
    ],
  };
}

const ICON = (path: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

const widgets = createWidgets<QmRegistry>({
  additionalTypes: [
    {
      id: "budget-envelope",
      label: "Budget envelope",
      icon: ICON('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 12h11"/>'),
      form: (p) => p.createDefaults({ dataMappingItems: [] }),
      comp: BudgetEnvelopeWidget,
      defaultSize: { width: 520, height: 320 },
      minSize: { width: 280, height: 160 },
      ai: {
        description: "Quartermaster's budget bars: one per mandate, showing spent, approved-not-yet-paid and left against the cap, fullest first.",
        usage: "Use for questions about how much of a budget is used. Needs no field mapping; narrow it with a widget filter, e.g. mandates.used_pct >= 80.",
      },
    },
    {
      id: "reimbursement-queue",
      label: "Reimbursement queue",
      icon: ICON('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
      form: (p) => p.createDefaults({ dataMappingItems: [] }),
      comp: ReimbursementQueueWidget,
      defaultSize: { width: 420, height: 320 },
      minSize: { width: 280, height: 160 },
      ai: {
        description: "Receipts waiting for the treasurer with one-tap Approve (the mandate is re-checked before the PayPal payout), plus recent ones.",
        usage: "Use for waiting or recent reimbursements. Needs no field mapping. Only the treasurer can approve; the assistant cannot.",
      },
    },
    {
      id: "mandate-health",
      label: "Mandate health",
      icon: ICON('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),
      form: (p) => p.createDefaults({ dataMappingItems: [] }),
      comp: MandateHealthWidget,
      defaultSize: { width: 420, height: 320 },
      minSize: { width: 280, height: 200 },
      ai: {
        description: "Approval rate, blocked attempts, waiting requests and the mandate rules that fired most.",
        usage: "Use for questions about how well the spending rules work. Needs no field mapping; filter by mandate with a widget filter.",
      },
    },
  ],
  menu: [{ label: "Quartermaster", widgetIds: ["budget-envelope", "reimbursement-queue", "mandate-health"] }],
});

/** The saved default layout: the three custom widgets, then two built-ins on the same data. */
export const DEFAULT_LAYOUT: AgReportState<QmRegistry> = {
  pages: [
    {
      id: "treasurer",
      layout: { columns: 24 },
      widgets: {
        envelopes: { type: "budget-envelope", dataMapping: {}, format: { title: { enabled: true, text: "Budget envelopes" } } },
        queue: { type: "reimbursement-queue", dataMapping: {}, format: { title: { enabled: true, text: "Reimbursement queue" } } },
        health: { type: "mandate-health", dataMapping: {}, format: { title: { enabled: true, text: "Mandate health" } } },
        spend: {
          type: "bar-chart-stacked",
          format: { title: { enabled: true, text: "Spend by mandate" } },
          dataMapping: { categoryKey: [{ id: "mandates.mandate" }], valueKey: [{ id: "mandates.spent", aggregation: "sum" }, { id: "mandates.committed", aggregation: "sum" }, { id: "mandates.left", aggregation: "sum" }] },
        },
        payments: {
          type: "grid",
          format: { title: { enabled: true, text: "Purchases" } },
          dataMapping: { cols: [{ id: "payments.date" }, { id: "payments.items" }, { id: "payments.vendor" }, { id: "payments.mandate" }, { id: "payments.amount" }, { id: "payments.status" }, { id: "payments.rule" }] },
        },
      },
      widgetLayout: {
        envelopes: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 22 },
        queue: { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 22 },
        health: { xTrack: 0, yTrack: 22, xSpan: 10, ySpan: 20 },
        spend: { xTrack: 10, yTrack: 22, xSpan: 14, ySpan: 20 },
        payments: { xTrack: 0, yTrack: 42, xSpan: 24, ySpan: 24 },
      },
    },
  ],
  selectedPageId: "treasurer",
  panels: { filters: { collapsed: true }, data: { collapsed: true } },
};

/** The layout this browser last saved, if any. Per-viewer convenience only; the default layout is in code. */
function savedLayout(): AgReportState<QmRegistry> | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? (JSON.parse(raw) as AgReportState<QmRegistry>) : null;
  } catch {
    return null;
  }
}

export default function StudioView(props: { orgName: string; isTreasurer: boolean; licenseKey: string; assistant: boolean; data: DashboardData; refresh: () => void }) {
  const api = useRef<AgStudioApi<QmRegistry> | null>(null);
  // The assistant panel lives in edit mode, so the treasurer starts there; volunteers get the read-only view.
  const [mode, setMode] = useState<"view" | "edit">(props.isTreasurer && props.assistant ? "edit" : "view");
  const [note, setNote] = useState<string | null>(null);
  const font = useBodyFont();
  const data = useMemo(() => dataSources(props.data), [props.data]);
  const [initialState] = useState(() => savedLayout() ?? DEFAULT_LAYOUT);
  const theme = useMemo(
    () =>
      studioTheme.withParams({
        accentColor: BRAND,
        foregroundColor: INK,
        textColor: INK,
        subtleTextColor: MUTED,
        borderColor: LINE,
        backgroundColor: "#ffffff",
        fontFamily: font,
        fontSize: 14,
        borderRadius: 10,
        studioWrapperBackgroundColor: PAPER,
      }),
    [font],
  );
  const context = useMemo<StudioContext>(() => ({ isTreasurer: props.isTreasurer, refresh: props.refresh }), [props.isTreasurer, props.refresh]);
  const ai = useMemo(() => (props.assistant ? treasurerHarness(geminiAdapter()) : undefined), [props.assistant]);

  const save = () => {
    const state = api.current?.getState();
    if (!state) return;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(state));
      setNote("Layout saved in this browser.");
    } catch {
      setNote("This browser won't store the layout (private window?).");
    }
  };
  const reset = () => {
    try {
      localStorage.removeItem(LAYOUT_KEY);
    } catch {}
    api.current?.setState(DEFAULT_LAYOUT);
    setNote("Back to the default layout.");
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">{props.orgName}</p>
          <h1 className="mt-1 text-2xl font-semibold">Treasurer dashboard</h1>
          <p className="mt-1 text-muted">Live from the ledger the mandate engine checks. {props.assistant ? "Ask the Treasurer assistant a question and it builds the widget." : "The assistant needs the Gemini key."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button className="btn-ghost" aria-pressed={mode === "edit"} onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}>
            {mode === "edit" ? "View only" : props.assistant ? "Edit and ask the assistant" : "Edit layout"}
          </button>
          <button className="btn-ghost" onClick={save}>
            Save layout
          </button>
          <button className="btn-ghost" onClick={reset}>
            Reset
          </button>
          <a href="/treasurer?view=classic" className="underline">
            Classic view
          </a>
        </div>
      </div>
      {!props.isTreasurer && <p className="card border-warn/40 bg-warn-soft p-3 text-sm text-warn">You&apos;re viewing as a volunteer. Switch to the treasurer to approve reimbursements.</p>}
      {note && (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      )}
      <div className="h-[calc(100vh-14rem)] min-h-[640px] overflow-hidden rounded-xl border border-line">
        <AgStudioProvider modules={props.assistant ? [AgStudioAiModule] : []} licenseKey={props.licenseKey}>
          <AgStudio<QmRegistry>
            style={{ height: "100%", width: "100%" }}
            data={data}
            theme={theme}
            widgets={widgets}
            initialState={initialState}
            mode={mode}
            context={context}
            ai={ai}
            panels={{ edit: { left: ["data"], right: props.assistant ? ["ai", "edit", "filters"] : ["edit", "filters"] }, view: { right: ["filters"] } }}
            onApiReady={(e) => {
              api.current = e.api as AgStudioApi<QmRegistry>;
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
