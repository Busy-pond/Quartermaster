/**
 * Demo sessions: judges pick "Try as Treasurer" or "Try as Volunteer" — no
 * passwords. The cookie only holds a member id from the seeded demo org.
 */
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assertTreasurer } from "@/lib/auth/roles";

export const SESSION_COOKIE = "qm_member";
export const DEMO_ORG_SLUG = "riverside";

export async function demoOrg() {
  return db().query.orgs.findFirst({ where: eq(schema.orgs.slug, DEMO_ORG_SLUG) });
}

export async function currentMember() {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  return (await db().query.members.findFirst({ where: eq(schema.members.id, id) })) ?? null;
}

export async function requireMember() {
  const m = await currentMember();
  if (!m) throw Response.json({ error: "Not signed in" }, { status: 401 });
  return m;
}

/** Signed in as the treasurer, or a 401 / 403. */
export async function requireTreasurer() {
  const m = await requireMember();
  assertTreasurer(m);
  return m;
}

export async function memberForRole(role: "member" | "treasurer") {
  const org = await demoOrg();
  if (!org) return null;
  return db().query.members.findFirst({ where: and(eq(schema.members.orgId, org.id), eq(schema.members.role, role)) });
}
