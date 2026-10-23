import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";

export const DEMO_SLUG = "riverside";

/** The seeded demo org's id; scripts that work on it fail clearly if the seed hasn't run. */
export async function demoOrgId(): Promise<string> {
  const org = await db().query.orgs.findFirst({ where: eq(schema.orgs.slug, DEMO_SLUG) });
  if (!org) throw new Error("Demo org not found — run npm run db:seed first");
  return org.id;
}
