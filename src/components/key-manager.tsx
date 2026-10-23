"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Creates an MCP API key and shows it once, with the Claude Desktop config that uses it. */
export function KeyManager({ mcpUrl, canManage }: { mcpUrl: string; canManage: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("Claude Desktop");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return <p className="text-sm text-muted">Switch to the treasurer to create keys.</p>;

  const config = created
    ? JSON.stringify({ mcpServers: { quartermaster: { command: "npx", args: ["-y", "mcp-remote@0.14.3", mcpUrl, "--header", `Authorization: Bearer ${created.key}`] } } }, null, 2)
    : null;

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
          const json = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) return setError(json.error ?? "Couldn't create the key");
          setCreated({ key: json.key, name: json.name });
          router.refresh();
        }}
      >
        <label className="text-sm">
          <span className="label block">Who will use it</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-1 w-64 max-w-full rounded-lg border border-line bg-card px-3 py-1.5" />
        </label>
        <button className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create API key"}
        </button>
      </form>
      {error && <p className="text-sm text-bad">{error}</p>}
      {created && config && (
        <div className="slip space-y-3 p-5">
          <p className="font-medium">Key for {created.name}: copy it now, it won&apos;t be shown again</p>
          <code className="block break-all rounded-md bg-paper p-3 font-mono text-sm">{created.key}</code>
          <p className="text-sm text-muted">
            Claude Desktop: Settings → Developer → Edit config, add this to <code>claude_desktop_config.json</code>, then restart Claude.
          </p>
          <pre className="overflow-x-auto rounded-md bg-paper p-3 font-mono text-xs">{config}</pre>
        </div>
      )}
    </div>
  );
}

export function RevokeKey({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <span className="flex gap-2">
      <button
        className="text-sm font-medium text-bad underline"
        onClick={async () => {
          await fetch(`/api/keys/${id}`, { method: "DELETE" });
          router.refresh();
        }}
      >
        Yes, revoke
      </button>
      <button className="text-sm underline" onClick={() => setConfirming(false)}>
        Keep
      </button>
    </span>
  ) : (
    <button className="text-sm underline" onClick={() => setConfirming(true)}>
      Revoke
    </button>
  );
}
