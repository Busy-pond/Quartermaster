/**
 * Mirrors audit rows (agent traces included) into Elastic's `qm-events` index when
 * Elastic is on. Best effort: Postgres stays the source of truth, and a failure here
 * is logged and never blocks the action that was audited.
 */
import { flags } from "@/lib/flags";
import { elasticUpsert, ensureEventsIndex } from "@/lib/integrations/elastic";
import { EVENTS_INDEX, eventDoc, type AuditRow } from "./trace";

export async function mirrorEvents(rows: AuditRow[]) {
  if (!flags.elastic() || rows.length === 0) return;
  try {
    await ensureEventsIndex();
    await elasticUpsert(
      EVENTS_INDEX,
      rows.map((r) => ({ id: r.id, doc: eventDoc(r) })),
    );
  } catch (e) {
    console.error(`Elastic indexing (${EVENTS_INDEX}) failed`, e instanceof Error ? e.message : e);
  }
}
