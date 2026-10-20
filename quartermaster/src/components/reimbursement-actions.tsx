"use client";

/**
 * Treasurer actions on a reimbursement, and the live wait for PayPal once the
 * payout is sent. Polls every 3 s; the status route asks PayPal directly, so
 * this finishes even when no webhook can reach the app.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Stamp } from "@/components/stamp";

type Status = "submitted" | "needs_approval" | "approved" | "paid" | "rejected" | "failed";

export function ReimbursementActions({ id, status, isApprover, amount, payee, seconds = null }: { id: string; status: Status; isApprover: boolean; amount: string; payee: string | null; seconds?: number | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [live, setLive] = useState<{ status: Status; payoutStatus: string | null; seconds: number | null }>({ status, payoutStatus: null, seconds });

  useEffect(() => setLive((l) => ({ ...l, status, seconds: l.seconds ?? seconds })), [status, seconds]);

  useEffect(() => {
    if (live.status !== "approved") return;
    let stop = false;
    const tick = async () => {
      const res = await fetch(`/api/reimbursements/${id}/status`, { cache: "no-store" }).catch(() => null);
      const json = res?.ok ? await res.json() : null;
      if (stop || !json) return;
      setLive({ status: json.status, payoutStatus: json.payoutStatus, seconds: json.seconds });
      if (json.status !== "approved") setTimeout(() => router.refresh(), 1600);
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id, live.status, router]);

  async function act(kind: "approve" | "reject") {
    setBusy(kind);
    setError(null);
    const res = await fetch(`/api/reimbursements/${id}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "reject" ? { reason } : {}),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(json.error ?? "Something went wrong");
      router.refresh();
      return;
    }
    if (kind === "approve") setLive({ status: json.status, payoutStatus: json.payoutStatus, seconds: null });
    else router.refresh();
  }

  if (live.status === "paid")
    return (
      <div className="paper-jolt flex flex-wrap items-center gap-4" aria-live="polite">
        <Stamp kind="paid" size="lg" />
        <p className="text-sm text-muted">
          {amount} sent to {payee ?? "the volunteer"} with PayPal Payouts{live.seconds != null && <>, <strong className="text-ink">{live.seconds} seconds</strong> after the photo was submitted</>}.
        </p>
      </div>
    );

  if (live.status === "approved")
    return (
      <div className="flex items-center gap-3 text-sm" aria-live="polite">
        <span className="trail-dot-live inline-block h-2.5 w-2.5 rounded-full bg-brand" />
        <span>
          Payout sent. Waiting for PayPal to confirm
          {live.payoutStatus && live.payoutStatus !== "SENDING" ? <span className="text-muted"> (PayPal says {live.payoutStatus.toLowerCase()})</span> : "…"}
          {live.payoutStatus === "UNCLAIMED" && <span className="block text-muted">The receiving email has no PayPal account. Use your US sandbox personal account email.</span>}
        </span>
      </div>
    );

  if ((live.status === "needs_approval" || live.status === "failed") && isApprover)
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {live.status === "failed" ? "The last payout didn't go through. You can try again." : "Check the photo against what was read, then approve."} The mandate is checked again right before the money moves.
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary px-5! py-3!" onClick={() => act("approve")} disabled={!!busy || !payee}>
            {busy === "approve" ? "Sending payout…" : `Approve & pay back ${amount}`}
          </button>
          {!rejecting ? (
            <button className="btn-ghost" onClick={() => setRejecting(true)} disabled={!!busy}>
              Reject
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (the volunteer sees this)" maxLength={300} className="rounded-lg border border-line bg-card px-3 py-2 text-sm" />
              <button className="btn-ghost text-bad!" onClick={() => act("reject")} disabled={!!busy}>
                {busy === "reject" ? "Rejecting…" : "Confirm reject"}
              </button>
            </span>
          )}
        </div>
        {!payee && <p className="text-sm text-bad">No PayPal email for this volunteer. Add SANDBOX_VOLUNTEER_EMAIL (your US sandbox personal account) to .env.local and restart.</p>}
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    );

  return null;
}
