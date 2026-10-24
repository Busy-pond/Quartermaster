import type { IntegrationState } from "@/lib/flags";

const STYLE = {
  live: "bg-ok-soft text-ok",
  fallback: "bg-warn-soft text-warn",
  off: "bg-bad-soft text-bad",
} as const;

/** The live / fallback / off pill, shared by /status and the landing page so they always match. */
export function StateBadge({ state }: { state: IntegrationState }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STYLE[state]}`}>{state}</span>;
}
