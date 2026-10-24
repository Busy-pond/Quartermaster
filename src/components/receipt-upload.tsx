"use client";

/**
 * Snap a receipt: take or pick a photo, shrink it in the browser (so a 5 MB
 * phone photo uploads as ~300 KB), then submit. If the AI can't read it, the
 * volunteer can type the details in instead.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export interface MandateChoice {
  id: string;
  title: string;
  event: string | null;
  categories: string[];
  remaining: string;
}

const MAX_SIDE = 1600;

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This photo format can't be opened here. Take a screenshot of it, or save it as JPEG, and try again.");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

const STEPS = ["Reading the receipt with Gemini", "Checking for duplicates", "Running the mandate rules"];

export function ReceiptUpload({ mandates }: { mandates: MandateChoice[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [mandateId, setMandateId] = useState(mandates[0]?.id ?? "");
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ merchant: "", date: "", total: "", category: "" });
  const mandate = mandates.find((x) => x.id === mandateId);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setPhoto(await shrink(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the photo");
    }
  }

  async function submit() {
    if (!photo || !mandateId) return;
    setBusy(true);
    setError(null);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), manual ? 600 : 2500);
    try {
      const body = {
        mandateId,
        imageDataUrl: photo,
        note: note || null,
        manual: manual
          ? { merchant: m.merchant, date: m.date || null, totalDollars: Number(m.total), category: m.category || mandate?.categories[0] || "supplies" }
          : null,
      };
      const res = await fetch("/api/reimbursements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg: string = json.error ?? "Could not submit the receipt";
        if (msg.startsWith("READ_FAILED: ")) {
          setManual(true);
          throw new Error(msg.slice("READ_FAILED: ".length));
        }
        throw new Error(msg.startsWith("[") ? "Check the details you typed in and try again." : msg);
      }
      router.push(`/reimbursements/${json.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit the receipt");
      setBusy(false);
    } finally {
      clearInterval(timer);
    }
  }

  const manualOk = !manual || (m.merchant.trim() && Number(m.total) > 0);

  return (
    <div className="slip space-y-6 p-5 sm:p-6">
      <div>
        <label htmlFor="mandate" className="label">
          Which budget is this for?
        </label>
        <select id="mandate" value={mandateId} onChange={(e) => setMandateId(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2.5" disabled={busy}>
          {mandates.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title} ({x.remaining} left)
            </option>
          ))}
        </select>
        {mandate && <p className="mt-1.5 text-sm text-muted">Covers: {mandate.categories.join(", ")}</p>}
      </div>

      <div>
        <p className="label">Receipt photo</p>
        <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Receipt photo file" onChange={(e) => pick(e.target.files?.[0])} disabled={busy} />
        {photo ? (
          <div className="mt-2 flex flex-wrap items-end gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="Your receipt" className="max-h-72 rounded-lg border border-line bg-paper object-contain shadow-sm" />
            <button type="button" className="btn-ghost" onClick={() => input.current?.click()} disabled={busy}>
              Retake
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="mt-2 grid w-full place-items-center gap-1 rounded-xl border-2 border-dashed border-line bg-card px-4 py-10 text-center transition-colors hover:border-brand hover:bg-brand-soft"
          >
            <span className="font-display text-lg font-bold">Take a photo or choose one</span>
            <span className="text-sm text-muted">On a phone this opens the camera. Lay the receipt flat, in good light.</span>
          </button>
        )}
      </div>

      {manual && (
        <fieldset className="space-y-3 rounded-lg border border-line bg-card p-4">
          <legend className="px-1 text-sm font-medium">Type the details from the receipt</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Store
              <input className="mt-1 w-full rounded-md border border-line px-3 py-2" value={m.merchant} onChange={(e) => setM({ ...m, merchant: e.target.value })} disabled={busy} />
            </label>
            <label className="text-sm">
              Date on the receipt
              <input type="date" className="mt-1 w-full rounded-md border border-line px-3 py-2" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} disabled={busy} />
            </label>
            <label className="text-sm">
              Total paid (USD)
              <input type="number" inputMode="decimal" min="0.01" step="0.01" className="mt-1 w-full rounded-md border border-line px-3 py-2 tabular-nums" value={m.total} onChange={(e) => setM({ ...m, total: e.target.value })} disabled={busy} />
            </label>
            <label className="text-sm">
              What it was for
              <select className="mt-1 w-full rounded-md border border-line bg-card px-3 py-2" value={m.category} onChange={(e) => setM({ ...m, category: e.target.value })} disabled={busy}>
                {(mandate?.categories ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">The treasurer sees that these were typed in, next to your photo.</p>
        </fieldset>
      )}

      <div>
        <label htmlFor="note" className="label">
          Note for the treasurer (optional)
        </label>
        <input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. extra gloves for the school group" className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2.5" disabled={busy} />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="btn-primary px-5! py-3!" onClick={submit} disabled={!photo || !mandateId || busy || !manualOk}>
          {busy ? "Submitting…" : manual ? "Submit for reimbursement" : "Read receipt and submit"}
        </button>
        {!manual && photo && !busy && (
          <button type="button" className="text-sm text-muted underline" onClick={() => setManual(true)}>
            Type the details in instead
          </button>
        )}
      </div>

      {busy && (
        <ol className="space-y-1.5 text-sm" aria-live="polite">
          {(manual ? ["Saving the details you typed", ...STEPS.slice(1)] : STEPS).map((s, i) => {
            const at = step;
            return (
              <li key={s} className={`flex items-center gap-2 ${i <= at ? "text-ink" : "text-muted"}`}>
                <span className={`inline-block h-2 w-2 rounded-full ${i < at ? "bg-ok" : i === at ? "trail-dot-live bg-brand" : "bg-line"}`} />
                {s}
              </li>
            );
          })}
        </ol>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
