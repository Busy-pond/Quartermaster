import Link from "next/link";
import { currentMember, demoOrg } from "@/lib/session";
import { flags } from "@/lib/flags";
import { loadDashboard } from "@/lib/dashboard/load";
import { TreasurerDashboard } from "@/components/treasurer-dashboard";
import { TreasurerStudio } from "@/components/studio/treasurer-studio";
import { AnomalyTile } from "@/components/anomaly-tile";
import { loadAnomalies } from "@/lib/traces/load";
import { treasurerGate } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Day 17–18: the treasurer's dashboard in AG Studio when AG_STUDIO_ENABLED is on and a
 * licence key is set. Otherwise (or with ?view=classic) the Day 12 page on AG Grid
 * Community + AG Charts Community, which is the fallback.
 */
export default async function TreasurerPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const org = await demoOrg();
  if (!org) return <p className="text-muted">Demo org not found — run <code>npm run db:seed</code>.</p>;
  // Treasurer only (Day 20): the ledger, the approve buttons and the Studio assistant aren't for volunteers.
  const me = await currentMember();
  const gate = treasurerGate(me);
  if (gate !== "ok")
    return (
      <div className="card mx-auto max-w-lg p-6">
        <h1 className="font-display text-xl font-semibold">The treasurer&rsquo;s dashboard</h1>
        <p className="mt-2 text-muted">{gate === "signed-out" ? "Sign in as the treasurer to see budgets, payments and the receipt queue." : "Only the treasurer can open this page. Switch role to try it, or see your budgets on the Mandates page."}</p>
        <p className="mt-4 flex gap-4 text-sm">
          <Link href="/" className="underline">{gate === "signed-out" ? "Sign in" : "Switch role"}</Link>
          <Link href="/mandates" className="underline">Mandates</Link>
        </p>
      </div>
    );
  const [data, anomalies, { view }] = await Promise.all([loadDashboard(org.id), loadAnomalies(org.id), searchParams]);

  if (flags.agStudio() && view !== "classic")
    return (
      <div className="space-y-6">
        <TreasurerStudio orgName={org.name} isTreasurer licenseKey={process.env.AG_STUDIO_LICENSE_KEY ?? ""} assistant={flags.agStudioAssistant()} data={data} />
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
        isTreasurer
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
