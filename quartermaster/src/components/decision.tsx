import type { CSSProperties } from "react";
import { CLAUSES, type Decision } from "@/lib/mandates/engine";

type RuleState = "pass" | "needs_approval" | "deny";

function Mark({ state }: { state: RuleState }) {
  const color = state === "pass" ? "var(--color-ok)" : state === "deny" ? "var(--color-bad)" : "var(--color-warn)";
  return (
    <svg className="rule-mark shrink-0" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="8" fill="none" stroke={color} strokeOpacity="0.25" />
      {state === "pass" && <path d="M5 9.5l2.6 2.5L13 6.5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {state === "deny" && <path d="M6 6l6 6M12 6l-6 6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />}
      {state === "needs_approval" && <path d="M9 5v5M9 12.8v.2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

/**
 * The mandate's rules, checked one by one. Each row animates in turn, so the
 * reader sees the engine work through M0–M10; a blocking rule shakes.
 * Re-mount (change `key`) to replay.
 */
export function DecisionPanel({
  decision,
  compact = false,
  liveKeys = false,
  stagger = true,
}: {
  decision: Decision;
  compact?: boolean;
  /** Re-key rows by result, so a row replays its animation when its result changes. */
  liveKeys?: boolean;
  /** Cascade rows one after another (first paint); otherwise changed rows animate at once. */
  stagger?: boolean;
}) {
  const failed = new Map(decision.reasons.map((r) => [r.clause, r]));
  return (
    <ol className={`${compact ? "space-y-1 text-[13px]" : "space-y-1.5 text-sm"}`} aria-label="Mandate rules">
      {(Object.keys(CLAUSES) as (keyof typeof CLAUSES)[]).map((c, i) => {
        const r = failed.get(c);
        const state: RuleState = !r ? "pass" : r.outcome;
        return (
          <li key={liveKeys ? `${c}-${state}` : c} className="rule-row flex items-start gap-2.5" data-state={state} style={{ "--i": stagger ? i : 0 } as CSSProperties}>
            <Mark state={state} />
            <span className="w-8 shrink-0 text-xs leading-[18px] text-muted tabular-nums">{c}</span>
            <span className={state === "pass" ? "" : state === "deny" ? "font-medium text-bad" : "font-medium text-warn"}>
              {CLAUSES[c]}
              {r && <span className="block font-normal text-muted">{r.message}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
