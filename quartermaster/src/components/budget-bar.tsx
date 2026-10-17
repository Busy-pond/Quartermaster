import type { CSSProperties } from "react";
import { money } from "@/lib/format";

/**
 * Spent | committed | this order | left, drawn to scale against the cap.
 * The segments grow in from the left, in that order, when the bar appears.
 */
export function BudgetBar({
  capCents,
  spentCents,
  committedCents = 0,
  orderCents = 0,
  currency = "USD",
  showLegend = true,
}: {
  capCents: number;
  spentCents: number;
  committedCents?: number;
  orderCents?: number;
  currency?: string;
  showLegend?: boolean;
}) {
  const pct = (c: number) => `${Math.max(0, Math.min(100, (c / capCents) * 100))}%`;
  const used = spentCents + committedCents;
  const fits = used + orderCents <= capCents;
  const orderShown = Math.min(orderCents, Math.max(0, capCents - used));
  const left = capCents - used - orderCents;
  const seg = (w: string, cls: string, d: number) => <div className={`bar-seg h-full ${cls}`} style={{ width: w, "--d": `${d}ms` } as CSSProperties} />;

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-paper ring-1 ring-line" role="img" aria-label={`${money(used, currency)} used of ${money(capCents, currency)}${orderCents ? `, this order ${money(orderCents, currency)}` : ""}`}>
        {seg(pct(spentCents), "bg-brand", 0)}
        {committedCents > 0 && seg(pct(committedCents), "bg-brand/45", 150)}
        {orderCents > 0 && seg(pct(orderShown), fits ? "bg-warn" : "bg-bad bar-over", 300)}
      </div>
      {showLegend && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            <i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand" />
            Spent {money(spentCents, currency)}
          </span>
          {committedCents > 0 && (
            <span>
              <i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand/45" />
              Approved, not yet paid {money(committedCents, currency)}
            </span>
          )}
          {orderCents > 0 && (
            <span className={fits ? "" : "font-medium text-bad"}>
              <i className={`mr-1.5 inline-block h-2 w-2 rounded-full ${fits ? "bg-warn" : "bg-bad"}`} />
              This order {money(orderCents, currency)}
            </span>
          )}
          <span className={left < 0 ? "font-medium text-bad" : "text-ink"}>{left < 0 ? `Over the cap by ${money(-left, currency)}` : `${money(left, currency)} left of ${money(capCents, currency)}`}</span>
        </div>
      )}
    </div>
  );
}
