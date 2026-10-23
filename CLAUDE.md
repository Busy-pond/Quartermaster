# Quartermaster (PayPal AI Hackathon, submit by Nov 7)
Read flow.md and decision.md before working. Do only the task given, one step at a time, then stop.
- AI never moves money: tools search/dry-run/propose; the pure mandate engine (integer cents) decides; PayPal calls re-check the mandate. Prices come from stored data, never the model.
- PayPal-Request-Id on money calls; webhooks verified and stored by event id.
- Every integration: flag + fallback + shown on /status. Label sample data.
- Free tiers only; no AG Studio/Elastic/Bryntum trials before Nov 1.
- Keep the pinned stack (Next 15.5, AI SDK v6, @ai-sdk/google 3.0.134, Neon/Drizzle, gemini-3.5-flash). Windows-safe scripts. New deps need a reason in decision.md.
- UI: reuse Stamp/DecisionPanel/BudgetBar/.slip; motion only on events; no all-caps labels.
- Never run dev servers or tunnels in the foreground. Ask me immediately when blocked.
- After each change: add a decision.md entry, update flow.md (🟡 = written but not run), bump APP_REVISION, pass test/typecheck/build, commit, and tell me briefly what changed and what I must do.
