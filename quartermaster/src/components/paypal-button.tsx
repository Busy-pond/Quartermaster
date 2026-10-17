"use client";

/**
 * PayPal JavaScript SDK v6 one-time payment button.
 * Flow: client token from our server -> createInstance -> one-time payment
 * session -> start() with an order our server creates (after re-checking the
 * mandate) -> onApprove -> our server captures.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Stamp } from "@/components/stamp";

const SDK_URL = process.env.NEXT_PUBLIC_PAYPAL_SDK_URL ?? "https://www.sandbox.paypal.com/web-sdk/v6/core";

interface PaymentSession {
  start(options: { presentationMode: "auto" | "popup" | "modal" | "redirect" }, order: Promise<{ orderId: string }>): Promise<void>;
}
interface SdkInstance {
  createPayPalOneTimePaymentSession(opts: {
    onApprove: (data: { orderId: string }) => Promise<void> | void;
    onCancel?: (data: unknown) => void;
    onError?: (err: unknown) => void;
  }): PaymentSession;
}
declare global {
  interface Window {
    paypal?: { createInstance(opts: { clientToken: string; components?: string[]; pageType?: string }): Promise<SdkInstance> };
  }
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (window.paypal) return Promise.resolve();
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("Could not load the PayPal SDK"));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export function PayPalButton({ paymentId, label }: { paymentId: string; label: string }) {
  const router = useRouter();
  const session = useRef<PaymentSession | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "paying" | "done" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadSdk();
        const tokenRes = await fetch("/api/paypal/client-token");
        const token = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(token.error ?? "Could not get a PayPal client token");
        const sdk = await window.paypal!.createInstance({ clientToken: token.accessToken, components: ["paypal-payments"], pageType: "checkout" });
        session.current = sdk.createPayPalOneTimePaymentSession({
          onApprove: async ({ orderId }) => {
            setState("paying");
            const res = await fetch(`/api/payments/${paymentId}/capture`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId }),
            });
            const json = await res.json();
            if (!res.ok || json.status !== "captured") {
              setState("error");
              setMessage(json.error ?? `Payment ${json.status ?? "failed"}`);
              return;
            }
            setState("done");
            // Let the "Paid" stamp land before moving to the receipt.
            setTimeout(() => {
              router.push(`/receipts/${paymentId}`);
              router.refresh();
            }, 1400);
          },
          onCancel: () => {
            setState("ready");
            setMessage("Payment cancelled — nothing was charged.");
          },
          onError: (err) => {
            console.error(err);
            setState("error");
            setMessage("PayPal reported an error. Try again.");
          },
        });
        if (!cancelled) setState("ready");
      } catch (e) {
        if (!cancelled) {
          setState("error");
          setMessage(e instanceof Error ? e.message : "PayPal failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId, router]);

  async function createOrder(): Promise<{ orderId: string }> {
    const res = await fetch(`/api/payments/${paymentId}/order`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Could not create the PayPal order");
    return { orderId: json.id };
  }

  if (state === "done")
    return (
      <div className="paper-jolt flex items-center gap-4" aria-live="polite">
        <Stamp kind="paid" size="lg" />
        <p className="text-sm text-muted">Payment captured by PayPal. Opening the trust receipt…</p>
      </div>
    );

  return (
    <div>
      <button
        className="btn w-full bg-[#ffc439] py-3 text-base text-[#111] hover:brightness-95 sm:w-auto sm:px-8"
        disabled={state !== "ready"}
        onClick={async () => {
          setMessage(null);
          const order = createOrder();
          order.catch((e: Error) => {
            setState("error");
            setMessage(e.message);
          });
          try {
            await session.current!.start({ presentationMode: "auto" }, order);
          } catch (e) {
            setState("error");
            setMessage(e instanceof Error ? e.message : "Could not start PayPal");
          }
        }}
      >
        {state === "loading" ? "Loading PayPal…" : state === "paying" ? "Capturing payment…" : label}
      </button>
      {message && <p className={`mt-2 text-sm ${state === "error" ? "text-bad" : "text-muted"}`}>{message}</p>}
      {state === "error" && (
        <button className="mt-1 text-sm underline" onClick={() => window.location.reload()}>
          Reload and try again
        </button>
      )}
    </div>
  );
}
