import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateKey, hashKey, parseBearer } from "./keys";
import { Forbidden } from "@/lib/auth/roles";

type MemberRow = typeof schema.members.$inferSelect;

/** Finds the live key behind an Authorization header and notes when it was used. */
export async function keyFromHeader(header: string | null) {
  const key = parseBearer(header);
  if (!key) return null;
  const row = await db().query.apiKeys.findFirst({ where: and(eq(schema.apiKeys.hash, hashKey(key)), isNull(schema.apiKeys.revokedAt)) });
  if (!row) return null;
  await db().update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.id));
  return row;
}

/** Treasurer creates a key. Each key gets its own "External agent" member, so receipts say who asked. */
export async function createApiKey(treasurer: MemberRow, name: string) {
  if (treasurer.role !== "treasurer") throw new Forbidden("Only the treasurer can create API keys");
  const label = name.trim().slice(0, 60) || "External agent";
  const [agent] = await db()
    .insert(schema.members)
    .values({ orgId: treasurer.orgId, name: `External agent (${label})`, email: `agent+${crypto.randomUUID().slice(0, 8)}@agents.quartermaster.invalid`, role: "member" })
    .returning();
  const k = generateKey();
  const [row] = await db().insert(schema.apiKeys).values({ orgId: treasurer.orgId, name: label, hash: k.hash, hint: k.hint, agentMemberId: agent.id, createdBy: treasurer.id }).returning();
  return { id: row.id, name: row.name, hint: row.hint, key: k.key };
}

export async function revokeApiKey(treasurer: MemberRow, id: string) {
  if (treasurer.role !== "treasurer") throw new Forbidden("Only the treasurer can revoke API keys");
  await db().update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, treasurer.orgId)));
}
