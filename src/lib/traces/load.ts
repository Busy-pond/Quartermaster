/**
 * The anomaly tile's data: the ES|QL query on Elastic when it is on, otherwise (or on
 * any Elastic error) the same rule over the audit table in Postgres. `source` says
 * which one answered, so the tile never claims Elastic when it wasn't used.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { flags } from "@/lib/flags";
import { elasticEsql } from "@/lib/integrations/elastic";
import { ANOMALY_DAYS, ANOMALY_ESQL, anomalyParams, detectAnomalies, parseEsql, type Anomaly } from "./anomalies";
import { SIGNAL_TYPES } from "./trace";

export interface AnomalyReport {
  source: "elastic" | "postgres";
  /** Why Postgres answered, when Elastic is on but failed. */
  note: string | null;
  query: string;
  anomalies: (Anomaly & { who: string })[];
}

export async function loadAnomalies(orgId: string, now = new Date()): Promise<AnomalyReport> {
  let source: AnomalyReport["source"] = "postgres";
  let note: string | null = null;
  let found: Anomaly[] | null = null;
  if (flags.elastic()) {
    try {
      found = parseEsql(await elasticEsql(ANOMALY_ESQL, anomalyParams(orgId)));
      source = "elastic";
    } catch (e) {
      note = "Elastic didn't answer, so this was computed from Postgres.";
      console.error("Elastic anomaly query failed; computed from Postgres:", e instanceof Error ? e.message : e);
    }
  }
  if (!found) {
    const rows = await db()
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.orgId, orgId), inArray(schema.auditEvents.type, SIGNAL_TYPES), gte(schema.auditEvents.createdAt, new Date(now.getTime() - ANOMALY_DAYS * 86_400_000))));
    found = detectAnomalies(rows, now);
  }
  const members = await db().query.members.findMany({ where: eq(schema.members.orgId, orgId) });
  const who = (subject: string) => (subject === "org" ? "the org" : (members.find((m) => m.id === subject)?.name ?? "a member"));
  return { source, note, query: ANOMALY_ESQL, anomalies: found.map((a) => ({ ...a, who: who(a.subject) })) };
}
