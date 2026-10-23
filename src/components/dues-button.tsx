"use client";

/**
 * PayPal subscription button for member dues. Subscriptions use the JS SDK's
 * subscription buttons (vault=true&intent=subscription), loaded only on /join.
 * After approval the server reads the subscription back from PayPal before
 * recording it, so the browser can't fake a member's dues.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    paypalSubscriptions?: {
      Buttons(opts: {
        style?: Record<string, string>;
        createSubscription: (data: unknown, actions: { subscription: { create(o: { plan_id: string }): Promise<string> } }) => Promise<string>;
        onApprove: (data: { subscriptionID?: string | null }) => Promise<void>;
        onError?: (err: unknown) => void;
        onCancel?: () => void;
      }): { render(el: HTMLElement): Promise<void> };
    };
  }
}

export function DuesButton({ clientId, planId, sdkBase }: { clientId: string; planId: string; sdkBase: string }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "done" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = () => {
      if (cancelled || !box.current || !window.paypalSubscriptions) return;
      box.current.innerHTML = "";
      window.paypalSubscriptions
        .Buttons({
          style: { shape: "rect", color: "gold", layout: "vertical", label: "subscribe" },
          createSubscription: (_d, actions) => actions.subscription.create({ plan_id: planId }),
          onApprove: async ({ subscriptionID }) => {
            setState("saving");
            const res = await fetch("/api/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: subscriptionID }) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              setState("error");
              setMessage(json.error ?? "Couldn't record the subscription");
              return;
            }
            setState("done");
            setMessage(json.credited > 0 ? "Thanks! Your first dues payment is already in the Operations budget." : "Thanks! PayPal confirms the first payment shortly; it then appears in the Operations budget.");
            router.refresh();
          },
          onCancel: () => setMessage("Cancelled — nothing was set up."),
          onError: (err) => {
            console.error(err);
            setState("error");
            setMessage("PayPal reported an error. Try again.");
          },
        })
        .render(box.current)
        .then(() => !cancelled && setState("ready"));
    };
    if (window.paypalSubscriptions) render();
    else {
      const s = document.createElement("script");
      // namespace keeps this SDK separate from the v6 checkout SDK used on the approval page
      s.src = `${sdkBase}?client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription&components=buttons`;
      s.setAttribute("data-namespace", "paypalSubscriptions");
      s.async = true;
      s.onload = render;
      s.onerror = () => {
        setState("error");
        setMessage("Could not load PayPal.");
      };
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
    };
  }, [clientId, planId, sdkBase, router]);

  return (
    <div>
      {state === "loading" && <p className="text-sm text-muted">Loading PayPal…</p>}
      <div ref={box} hidden={state === "done"} className="max-w-sm" />
      {message && <p className={`mt-2 text-sm ${state === "error" ? "text-bad" : "text-muted"}`} role="status">{message}</p>}
    </div>
  );
}
