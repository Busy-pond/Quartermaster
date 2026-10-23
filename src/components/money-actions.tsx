"use client";

/** Small treasurer actions that move or request money: send a sponsor invoice, check it, refund a purchase. */
import { useRouter } from "next/navigation";
import { useState } from "react";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (url: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Something went wrong");
      return null;
    }
    router.refresh();
    return json;
  };
  return { busy, error, run };
}

export function InvoiceActions({ id, status, canSend }: { id: string; status: string; canSend: boolean }) {
  const { busy, error, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "DRAFT" && canSend && !confirming && (
        <button className="btn-primary" onClick={() => setConfirming(true)}>
          Send to sponsor…
        </button>
      )}
      {confirming && (
        <>
          <span className="text-sm">PayPal will email the sponsor a request for this amount.</span>
          <button className="btn-primary" disabled={busy} onClick={async () => (await run(`/api/invoices/${id}/send`)) && setConfirming(false)}>
            {busy ? "Sending…" : "Yes, send it"}
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Keep as draft
          </button>
        </>
      )}
      {status === "DRAFT" && !canSend && <span className="text-sm text-muted">Waiting for the treasurer to send it.</span>}
      {status !== "DRAFT" && status !== "PAID" && (
        <button className="btn-ghost" disabled={busy} onClick={() => run(`/api/invoices/${id}/sync`)}>
          {busy ? "Checking…" : "Check payment"}
        </button>
      )}
      {error && <span className="text-sm text-bad">{error}</span>}
    </div>
  );
}

export function RefundButton({ paymentId, amount }: { paymentId: string; amount: string }) {
  const { busy, error, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  if (!confirming)
    return (
      <button className="btn-ghost" onClick={() => setConfirming(true)}>
        Refund…
      </button>
    );
  return (
    <div className="card w-full space-y-3 border-bad/30 p-4">
      <p className="text-sm">
        Refund <strong className="amount">{amount}</strong> to the payer? PayPal returns the money and the budget gets it back.
      </p>
      <label className="block text-sm">
        <span className="label">Reason (shown on the receipt)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Arrived damaged" className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-1.5" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="btn bg-bad text-white hover:brightness-95" disabled={busy} onClick={async () => (await run(`/api/payments/${paymentId}/refund`, { reason })) && setConfirming(false)}>
          {busy ? "Refunding…" : `Yes, refund ${amount}`}
        </button>
        <button className="btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
