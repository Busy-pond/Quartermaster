"use client";

/**
 * The eleven mandate rules, M0–M10. Names come from the engine's CLAUSES;
 * the explanations below describe what evaluate() checks for each one.
 */
import { useState } from "react";
import { CLAUSES } from "@/lib/mandates/engine";
import { Stamp, type StampKind } from "@/components/stamp";

type Clause = keyof typeof CLAUSES;

const DETAILS: Record<Clause, { checks: string; fails: StampKind }> = {
  M0: { checks: "The proposal has a vendor, a 3-letter currency, at least one item, and positive whole-number quantities and prices in cents. The total must equal the sum of the items. If this fails, no other rule runs.", fails: "deny" },
  M1: { checks: "The treasurer hasn’t paused or revoked the mandate.", fails: "deny" },
  M2: { checks: "Today is on or after the mandate’s start date.", fails: "deny" },
  M3: { checks: "Today is before the mandate’s expiry date.", fails: "deny" },
  M4: { checks: "The order is in the same currency the mandate was signed in.", fails: "deny" },
  M5: { checks: "Every item’s category, such as supplies or safety, is one the treasurer allowed.", fails: "deny" },
  M6: { checks: "If the mandate lists allowed vendors, the order must come from one of them. An empty list allows any vendor.", fails: "deny" },
  M7: { checks: "The order fits in what’s left of the cap, after money already spent and money committed to orders still waiting.", fails: "deny" },
  M8: { checks: "No single item costs more than the per-item auto-approve limit. Above it, the order waits for the treasurer.", fails: "needs_approval" },
  M9: { checks: "The order total is within the per-order auto-approve limit. Above it, the order waits for the treasurer.", fails: "needs_approval" },
  M10: { checks: "Orders from the same vendor in an overlapping category over the last 24 hours, added to this one, stay within the per-order limit. This stops one big order being split into small ones.", fails: "needs_approval" },
};

const IDS = Object.keys(CLAUSES) as Clause[];

export function Rules() {
  const [open, setOpen] = useState<Clause>("M7");
  const d = DETAILS[open];
  return (
    <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <ul className="card divide-y divide-line overflow-hidden">
        {IDS.map((id) => (
          <li key={id}>
            <button
              type="button"
              aria-pressed={open === id}
              aria-controls="rule-detail"
              onClick={() => setOpen(id)}
              className={`flex w-full items-baseline gap-3 px-4 py-2.5 text-left text-sm transition-colors ${open === id ? "bg-brand-soft font-medium" : "hover:bg-paper"}`}
            >
              <span className="w-9 shrink-0 font-mono text-xs text-muted">{id}</span>
              <span className="min-w-0">{CLAUSES[id]}</span>
            </button>
          </li>
        ))}
      </ul>
      <div id="rule-detail" aria-live="polite" className="slip p-5 sm:p-6 lg:sticky lg:top-8">
        <p className="font-mono text-xs text-muted">{open}</p>
        <h3 className="mt-1 text-xl font-bold">{CLAUSES[open]}</h3>
        <p className="mt-3 leading-relaxed">{d.checks}</p>
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-dashed border-line pt-4">
          <p className="text-sm text-muted">If it fails</p>
          <Stamp kind={d.fails} size="sm" animateKey={open} />
        </div>
      </div>
    </div>
  );
}
