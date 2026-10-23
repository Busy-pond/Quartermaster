"use client";

/**
 * The home page's live requisition slip. It runs the REAL mandate engine in the
 * browser (it is pure code), against a copy of the demo org's Beach Cleanup
 * mandate. Change the item or quantity and watch the rules decide.
 */
import { useEffect, useMemo, useState } from "react";
import { evaluate, type Ledger, type Mandate } from "@/lib/mandates/engine";
import { DecisionPanel } from "@/components/decision";
import { BudgetBar } from "@/components/budget-bar";
import { Stamp } from "@/components/stamp";
import { useTween } from "@/lib/use-tween";

const MANDATE: Mandate = {
  id: "demo-beach",
  status: "active",
  currency: "USD",
  capCents: 60_000,
  perItemAutoLimitCents: 15_000,
  perOrderAutoLimitCents: 25_000,
  categories: ["supplies", "safety"],
  vendorAllowlist: [],
  startsAt: "2026-10-01T00:00:00Z",
  expiresAt: "2026-12-10T00:00:00+05:30",
  approverIds: ["treasurer"],
};
const ALREADY_SPENT = 16_200; // trash bags and gloves already bought for this event

const ITEMS = [
  { id: "bottle", name: "Reusable water bottles", vendor: "walmart.com", cents: 398, category: "supplies", start: 60, max: 200 },
  { id: "table", name: "6 ft folding tables", vendor: "walmart.com", cents: 4_497, category: "supplies", start: 4, max: 20 },
  { id: "vests", name: "Safety vests, pack of 10", vendor: "amazon.com", cents: 2_399, category: "safety", start: 3, max: 20 },
  { id: "generator", name: "Portable generator", vendor: "homedepot.com", cents: 64_900, category: "supplies", start: 1, max: 2 },
  { id: "pizza", name: "Pizza for volunteers", vendor: "slice-house.com", cents: 1_800, category: "food", start: 6, max: 30 },
] as const;

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
// Fixed "now" so the demo never expires or depends on the visitor's clock.
const NOW = new Date("2026-11-20T10:00:00Z");

export function MandateSimulator() {
  const [itemId, setItemId] = useState<(typeof ITEMS)[number]["id"]>("bottle");
  const item = ITEMS.find((i) => i.id === itemId)!;
  const [qty, setQty] = useState<number>(item.start);
  const [boughtToday, setBoughtToday] = useState(false);
  const [revoked, setRevoked] = useState(false);
  // Rows cascade in on first paint; afterwards only rows whose result changes replay.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Wait for the first cascade to finish (11 rows × 70 ms + draw time) before switching modes.
    const t = setTimeout(() => setMounted(true), 1300);
    return () => clearTimeout(t);
  }, []);

  const { decision, totalCents, ledger } = useMemo(() => {
    const totalCents = item.cents * qty;
    const earlier = boughtToday ? 18_000 : 0;
    const ledger: Ledger = {
      spentCents: ALREADY_SPENT + earlier,
      committedCents: 0,
      recent: boughtToday ? [{ vendor: item.vendor, category: item.category, totalCents: earlier, createdAt: "2026-11-20T08:30:00Z" }] : [],
    };
    const decision = evaluate(
      { ...MANDATE, status: revoked ? "revoked" : "active" },
      { vendor: item.vendor, currency: "USD", totalCents, lines: [{ description: item.name, category: item.category, unitPriceCents: item.cents, quantity: qty }] },
      ledger,
      NOW,
    );
    return { decision, totalCents, ledger };
  }, [item, qty, boughtToday, revoked]);

  const shownTotal = useTween(totalCents);

  const outcomeLine =
    decision.outcome === "allow"
      ? "Inside every rule. The agent can buy this without waking anyone up."
      : decision.outcome === "needs_approval"
        ? `Allowed, but the treasurer has to sign. ${decision.clause}: ${decision.message}.`
        : `Stopped before any money moves. ${decision.clause}: ${decision.message}.`;

  return (
    <div className="slip p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">Requisition</h2>
        <p className="text-xs text-muted">Beach Cleanup Drive mandate, signed by the treasurer</p>
      </div>

      <fieldset className="mt-4">
        <legend className="label mb-2">What to buy</legend>
        <div className="flex flex-wrap gap-2">
          {ITEMS.map((it) => (
            <button
              key={it.id}
              type="button"
              aria-pressed={it.id === itemId}
              onClick={() => {
                setItemId(it.id);
                setQty(it.start);
              }}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors duration-150 ${
                it.id === itemId ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink/40"
              }`}
            >
              {it.name}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-x-4">
        <label htmlFor="qty" className="label">
          Quantity <span className="font-normal">at {usd(item.cents)} from {item.vendor}</span>
        </label>
        <output htmlFor="qty" className="font-display text-3xl font-bold tabular-nums">
          {qty}
        </output>
        <input
          id="qty"
          type="range"
          min={1}
          max={item.max}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          className="ledger-range col-span-2 w-full"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={boughtToday} onChange={(e) => setBoughtToday(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />
          $180 already bought from {item.vendor} today
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={revoked} onChange={(e) => setRevoked(e.target.checked)} className="h-4 w-4 accent-[var(--color-bad)]" />
          Treasurer revokes the mandate
        </label>
      </div>

      <div className="mt-5 border-t border-dashed border-line pt-4">
        <div className="flex items-baseline justify-between">
          <span className="label">Order total</span>
          <span className="font-display text-2xl font-bold tabular-nums">{usd(Math.round(shownTotal))}</span>
        </div>
        <div className="mt-3">
          <BudgetBar key={`${ledger.spentCents}`} capCents={MANDATE.capCents} spentCents={ledger.spentCents} orderCents={totalCents} />
        </div>
      </div>

      <div className="relative mt-5 grid gap-4 sm:grid-cols-[1fr_auto]">
        <DecisionPanel decision={decision} compact liveKeys stagger={!mounted} />
        <div className="flex items-end justify-end sm:min-w-[10.5rem]">
          <Stamp kind={decision.outcome} size={decision.outcome === "needs_approval" ? "md" : "lg"} animateKey={`${decision.outcome}-${decision.clause}`} />
        </div>
      </div>
      <p className="mt-4 text-sm" aria-live="polite">
        {outcomeLine}
      </p>
    </div>
  );
}
