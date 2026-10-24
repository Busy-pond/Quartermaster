import Link from "next/link";
import { currentMember, demoOrg } from "@/lib/session";
import { flags } from "@/lib/flags";
import { loadDashboard } from "@/lib/dashboard/load";
import { TreasurerDashboard } from "@/components/treasurer-dashboard";
import { TreasurerStudio } from "@/components/studio/treasurer-studio";
import { AnomalyTile } from "@/components/anomaly-tile";
import { loadAnomalies } from "@/lib/traces/load";

export const dynamic = "force-dynamic";

/**
 * Day 17–18: the treasurer's dashboard in AG Studio when AG_STUDIO_ENABLED is on and a
 * licence key is set. Otherwise (or with ?view=classic) the Day 12 page on AG Grid
 * Community + AG Charts Community, which is the fallback.
 */
export default async function TreasurerPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const org = await demoOrg();
  if (!org) return <p className="text-muted">Demo org not found — run <code>npm run db:seed</code>.</p>;
  const [me, data, anomalies, { view }] = await Promise.all([currentMember(), loadDashboard(org.id), loadAnomalies(org.id), searchParams]);
  const isTreasurer = me?.role === "treasurer";

  if (flags.agStudio() && view !== "classic")
    return (
      <div className="space-y-6">
        <TreasurerStudio orgName={org.name} isTreasurer={isTreasurer} licenseKey={process.env.AG_STUDIO_LICENSE_KEY ?? ""} assistant={flags.agStudioAssistant()} data={data} />
        <AnomalyTile report={anomalies} />
      </div>
    );

  return (
    <>
      {flags.agStudio() && (
        <p className="mb-4 text-sm text-muted">
          Classic view (AG Grid Community). <Link href="/treasurer" className="underline">Back to the AG Studio dashboard</Link>
        </p>
      )}
      <TreasurerDashboard
        orgName={org.name}
        isTreasurer={isTreasurer}
        envelopes={data.envelopes}
        payments={data.payments}
        reimbursements={data.reimbursements}
        byCategory={data.byCategory}
        exceptions={data.exceptions}
        awaitingTreasurer={data.awaitingTreasurer}
      />
      <div className="mt-8">
        <AnomalyTile report={anomalies} />
      </div>
    </>
  );
}
