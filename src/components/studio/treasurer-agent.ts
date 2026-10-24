/**
 * The "Treasurer" agent for AG Studio's Agent Framework (Day 18). Its own tools read
 * GET /api/treasurer/insights (the same ledger the mandate engine checks); Studio's
 * tools let it build and filter widgets. It can't approve, pay or change a mandate:
 * no tool here writes anything outside the dashboard layout.
 */
import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgAiToolContext, type AgAiToolResult, type AgLlmAdapter, type AgStudioApi } from "ag-studio";

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Events above 80%", prompt: "Which events are above 80% of budget?" },
  { label: "Waiting for me", prompt: "Which reimbursements are waiting for me, and for how long?" },
  { label: "Blocked this month", prompt: "Show the purchases the mandate engine blocked in the last 30 days, and which rule blocked them." },
  { label: "Mandate health", prompt: "How healthy are our mandates? Approval rate and the rules that fire most." },
];

async function insights(view: string, query: Record<string, string>, signal: AbortSignal) {
  const res = await fetch(`/api/treasurer/insights?${new URLSearchParams({ view, ...query })}`, { signal });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Insights answered ${res.status}`);
  return json as { asOf: string; result: unknown };
}

/** Runs one insights view and hands the model the figures, or a message it can act on. */
async function answer(view: string, query: Record<string, string>, ctx: AgAiToolContext): Promise<AgAiToolResult> {
  try {
    const r = await insights(view, query, ctx.signal);
    return ctx.success(`Live ledger figures as of ${r.asOf}. Money is in integer cents.`, r.result);
  } catch (e) {
    return ctx.error(e instanceof Error ? e.message : "Could not read the ledger");
  }
}

function insightTools(api: AgStudioApi) {
  return [
    api.defineAiTool({
      name: "spend_by_event",
      description: "Spend per event from the live ledger: cap, spent, approved-not-yet-paid (committed), left, and percent used. Money in integer cents.",
      params: (s) => s.object({}),
      execute: (_args, ctx) => answer("spend_by_event", {}, ctx),
    }),
    api.defineAiTool({
      name: "over_budget_share",
      description: "Mandates whose spent + approved-not-yet-paid is at or above a percent of their cap, fullest first. Use for 'above 80% of budget' questions. Money in integer cents.",
      params: (s) => s.object({ thresholdPct: s.number({ description: "Percent of the cap used, e.g. 80." }) }),
      execute: (args, ctx) => answer("over_budget_share", { threshold: String(args.thresholdPct) }, ctx),
    }),
    api.defineAiTool({
      name: "pending_reimbursements",
      description: "Receipts waiting for the treasurer's approval (or a payout to retry), oldest first, with hours waiting.",
      params: (s) => s.object({}),
      execute: (_args, ctx) => answer("pending_reimbursements", {}, ctx),
    }),
    api.defineAiTool({
      name: "blocked_attempts",
      description: "Purchases and receipts the mandate engine or the treasurer blocked, newest first, with the deciding rule (e.g. M7 = over the cap).",
      params: (s) => s.object({ days: s.number({ description: "How many days back. Defaults to 30." }).optional() }),
      execute: (args, ctx) => answer("blocked_attempts", { days: String(args.days ?? 30) }, ctx),
    }),
    api.defineAiTool({
      name: "mandate_health",
      description: "Per mandate and overall: attempts, pre-approved (inside the auto-approve limits), treasurer-approved, waiting, blocked, approval rate, and the rules that fired most.",
      params: (s) => s.object({}),
      execute: (_args, ctx) => answer("mandate_health", {}, ctx),
    }),
  ];
}

const instructions = (api: AgStudioApi) => () => {
  const { tables } = api.getAiContext().schema();
  return `You are the Treasurer assistant on Riverside Cleanup Crew's spending dashboard. You answer the treasurer's questions about budgets, payments and reimbursements, and you build or edit widgets on this AG Studio dashboard to show the answer.

How you work:
- Get the numbers from your ledger tools first (over_budget_share, spend_by_event, pending_reimbursements, blocked_attempts, mandate_health). They read the same ledger the mandate engine enforces, so quote them, not estimates. They give money in integer cents: write it as dollars.
- Then show the answer on the dashboard. Look at the page with view_page, add a widget with add_widget, place it with position_widget, and narrow it with add_widget_filter. Hand detailed chart setup to the widget agent with delegate_to when a built-in chart needs its fields mapped.
- For "which events or mandates are above N% of budget": add a 'budget-envelope' widget and filter it with add_widget_filter on mandates.used_pct greater than or equal to N. The budget-envelope widget shows our budget bars and needs no field mapping.
- For waiting receipts use the 'reimbursement-queue' widget; for approval rate and rules use 'mandate-health'.
- Say in one or two sentences what you found and what you added. Sentence case, no all-caps.

Limits: you can't approve, pay, refund or change a mandate, and no tool lets you. If asked, say the treasurer does that from the Reimbursement queue widget or the approval page. Sample data does not exist here: every figure is live.

Tables: ${tables.map((t) => t.name).join(", ")}. mandates.used_pct is spent + approved-not-yet-paid over the cap, in percent.`;
};

export function treasurerHarness(adapter: AgLlmAdapter): AgAiHarnessSetup {
  return ({ api }) =>
    createAiHarness(api, ({ tools, builtIn }) => {
      const studio = tools.studio;
      const treasurer = directLlmRunner({
        id: "treasurer",
        name: "Treasurer",
        adapter,
        description: "Answers budget questions from the live ledger and builds dashboard widgets to show the answer.",
        schema: (s) => s.undefined(),
        instructions: instructions(api),
        tools: () => [
          ...insightTools(api),
          studio.viewSchema(),
          studio.viewPage(),
          studio.viewWidget(),
          studio.executeQuery(),
          studio.addWidget(),
          studio.positionWidget(),
          studio.removeWidget(),
          studio.addWidgetFilter(),
          studio.removeWidgetFilter(),
          studio.addPageFilter(),
          studio.removePageFilter(),
          tools.delegateTo(["widget", "data"]),
        ],
      });
      // AG's own agents, on the same Gemini adapter, so the Treasurer can hand them chart setup.
      return {
        agents: [treasurer, ...Object.values(builtIn).map((d) => directLlmRunner({ ...d, adapter }))],
        primary: "treasurer",
        promptStarters: PROMPT_STARTERS,
      };
    });
}
