import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentMember, demoOrg } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { KeyManager, RevokeKey } from "@/components/key-manager";

export const dynamic = "force-dynamic";

/** Day 14: API keys for outside agents that use Quartermaster through MCP. */
export default async function SettingsPage() {
  const org = await demoOrg();
  if (!org) return <p className="text-muted">Demo org not found — run <code>npm run db:seed</code>.</p>;
  const me = await currentMember();
  const keys = await db().select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, org.id)).orderBy(desc(schema.apiKeys.createdAt));
  const mcpUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/api/mcp`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="label">{org.name}</p>
        <h1 className="mt-1 text-2xl font-semibold">Agents and API keys</h1>
        <p className="mt-1 text-muted">
          Other AI agents can use Quartermaster through MCP at <code className="font-mono text-sm">{mcpUrl}</code>. They can search, dry-run and request purchases, but never pay: the same mandates apply, and every request gets a trust receipt that names the agent.
        </p>
      </div>

      <section className="card p-5">
        <KeyManager mcpUrl={mcpUrl} canManage={me?.role === "treasurer"} />
      </section>

      <section>
        <h2 className="font-medium">Keys</h2>
        <div className="card mt-3 divide-y divide-line">
          {keys.length === 0 && <p className="p-4 text-sm text-muted">No keys yet.</p>}
          {keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{k.name}</p>
                <p className="font-mono text-xs text-muted">{k.hint}</p>
                <p className="text-xs text-muted">
                  Created {dateTime(k.createdAt)}
                  {k.lastUsedAt ? ` · last used ${dateTime(k.lastUsedAt)}` : " · never used"}
                </p>
              </div>
              {k.revokedAt ? <span className="rounded-full bg-paper px-2 py-0.5 text-xs text-muted">Revoked {dateTime(k.revokedAt)}</span> : me?.role === "treasurer" && <RevokeKey id={k.id} />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
