"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RoleButton({ role, label, next, className }: { role: "member" | "treasurer"; label: string; next: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={className ?? "btn-primary"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
          if (!res.ok) {
            setError((await res.json().catch(() => ({}))).error ?? "Could not sign in");
            setBusy(false);
            return;
          }
          router.push(next);
          router.refresh();
        }}
      >
        {busy ? "Signing in…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
