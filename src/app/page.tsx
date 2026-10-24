import Link from "next/link";
import { Stamp } from "@/components/stamp";
import { Story } from "@/components/landing/story";
import { Rules } from "@/components/landing/rules";
import { MandateSimulator } from "@/components/mandate-simulator";
import { StateBadge } from "@/components/integration-state";
import { integrations } from "@/lib/flags";
import { RoleButton } from "@/components/role-switch";

/**
 * Landing page. The interactive requisition slip that used to live here is on /try.
 * The receipt below is sample data: it shows the shape of a real trust receipt.
 */
const RECEIPT = [
  ["Requested by", "Arjun Mehta, volunteer"],
  ["Mandate", "Beach Cleanup Drive"],
  ["Item", "6 ft folding tables × 6"],
  ["Vendor", "walmart.com at $44.97 each"],
  ["Rules", "M0–M10 checked; M9 sent it to the treasurer"],
  ["Signed by", "Priya Nair, treasurer"],
] as const;

// The "Built on" strip reads the same integrations() as /status on every request.
export const dynamic = "force-dynamic";

const REPO = "https://github.com/Busy-pond/Quartermaster";

// The first five lines of the example in sdk/README.md.
const SDK_EXAMPLE = `import { QuartermasterClient } from "./sdk/src/index";
const qm = new QuartermasterClient({ baseUrl: "http://localhost:3000" });
await qm.signIn("treasurer"); // demo sign-in, no password
const { key } = await qm.createApiKey("my agent"); // shown once
const { result } = await qm.mcp<{ tools: { name: string }[] }>(key, "tools/list");`;

export default function Landing() {
  // Same URL and config shape as the key manager on /settings, with a placeholder key.
  const mcpUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/api/mcp`;
  const mcpConfig = JSON.stringify(
    { mcpServers: { quartermaster: { command: "npx", args: ["-y", "mcp-remote@0.14.3", mcpUrl, "--header", "Authorization: Bearer qm_live_..."] } } },
    null,
    2,
  );
  // overflow-x-clip: a stamp lands at 2.4x scale (stamp-slam); it must not make the page scroll sideways mid-animation.
  return (
    <div className="space-y-24 overflow-x-clip py-4">
      <section className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
        <div>
          <p className="text-sm font-medium text-brand">PayPal purchasing agent for volunteer teams</p>
          <h1 className="mt-4 text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl">An AI that buys for your team, inside rules it can’t break.</h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted">
            Volunteers ask for what an event needs. Quartermaster finds it and pays with PayPal, but only within the spending mandate your treasurer signed. The
            rules run in code, not in the AI, and every order is filed with a receipt that shows why it was allowed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/try" className="btn-primary px-5! py-3! text-base!">
              Try the requisition slip
            </Link>
            <a href="#story" className="btn-ghost px-5! py-3! text-base!">
              See how an order travels
            </a>
          </div>
          <p className="mt-4 text-sm text-muted">PayPal runs in sandbox, so no real money moves.</p>
        </div>

        <figure className="slip paper-jolt mx-auto w-full max-w-md p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold">Trust receipt</h2>
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Sample data</span>
          </div>
          <p className="mt-1 text-xs text-muted">Riverside Cleanup Crew</p>
          <dl className="mt-4 space-y-2 text-sm">
            {RECEIPT.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="relative mt-5 flex items-end justify-between gap-3 border-t border-dashed border-line pt-4">
            <div>
              <p className="label">Total</p>
              <p className="amount font-display text-3xl font-bold">$269.82</p>
              <p className="mt-1 font-mono text-xs text-muted">PayPal capture · sample-0000</p>
            </div>
            <Stamp kind="paid" size="lg" className="landing-stamp" />
          </div>
        </figure>
      </section>

      <section id="story" aria-labelledby="story-title" className="scroll-mt-8">
        <h2 id="story-title" className="text-2xl font-bold sm:text-3xl">
          How an order travels
        </h2>
        <p className="mt-2 max-w-[38rem] text-muted">Six steps from a volunteer’s request to a filed receipt. The AI does the first two; code and people do the rest.</p>
        <Story />
      </section>

      <section id="try" aria-labelledby="try-title" className="scroll-mt-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 id="try-title" className="text-2xl font-bold sm:text-3xl">
            Try it
          </h2>
          <Link href="/try" className="text-sm font-medium text-brand underline">
            Open the slip on its own page
          </Link>
        </div>
        <p className="mt-2 max-w-[38rem] text-muted">Pick an item and drag the quantity. This is the real mandate engine, running in your browser on a copy of the demo mandate.</p>
        <div className="mx-auto mt-8 max-w-2xl">
          <MandateSimulator />
        </div>
      </section>

      <section id="rules" aria-labelledby="rules-title" className="scroll-mt-8">
        <h2 id="rules-title" className="text-2xl font-bold sm:text-3xl">
          The eleven rules
        </h2>
        <p className="mt-2 max-w-[38rem] text-muted">Every order runs through all of them in code, on whole cents, and again right before PayPal is called. Pick a rule to see what it checks.</p>
        <Rules />
      </section>

      <section id="built-on" aria-labelledby="built-on-title" className="scroll-mt-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 id="built-on-title" className="text-2xl font-bold sm:text-3xl">
            Built on
          </h2>
          <Link href="/status" className="text-sm font-medium text-brand underline">
            Full status and fallbacks
          </Link>
        </div>
        <p className="mt-2 max-w-[38rem] text-muted">Live on this server right now. Every tool has a fallback, so one being off never breaks the demo.</p>
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {integrations().map((i) => (
            <li key={i.key} className="card flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 text-sm font-medium">{i.name}</span>
              <StateBadge state={i.state} />
            </li>
          ))}
        </ul>
      </section>

      <section id="developers" aria-labelledby="developers-title" className="scroll-mt-8">
        <h2 id="developers-title" className="text-2xl font-bold sm:text-3xl">
          For developers
        </h2>
        <p className="mt-2 max-w-[38rem] text-muted">Other agents can search, dry-run and request purchases, but never pay. The same mandates apply to every caller.</p>
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="card min-w-0 p-5">
            <h3 className="text-lg font-bold">MCP server</h3>
            <p className="mt-1 text-sm text-muted">
              Add this to Claude Desktop. Create a real key on{" "}
              <Link href="/settings" className="font-medium text-brand underline">
                the Agents page
              </Link>{" "}
              and use it in place of the placeholder.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-ink p-4 font-mono text-xs leading-relaxed text-white">{mcpConfig}</pre>
          </div>
          <div className="card min-w-0 p-5">
            <h3 className="text-lg font-bold">TypeScript SDK</h3>
            <p className="mt-1 text-sm text-muted">
              One method per route, no dependencies. From <span className="font-mono">sdk/README.md</span>.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-ink p-4 font-mono text-xs leading-relaxed text-white">{SDK_EXAMPLE}</pre>
            <p className="mt-4 text-sm">
              <a href="/api/openapi.json" className="font-medium text-brand underline">
                OpenAPI document
              </a>{" "}
              <span className="text-muted">covers every route and how each one signs in.</span>
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="start-title" className="slip px-5 py-8 text-center sm:px-10 sm:py-10">
        <h2 id="start-title" className="text-2xl font-bold sm:text-3xl">
          Open the demo
        </h2>
        <p className="mx-auto mt-2 max-w-[34rem] text-muted">Demo sign-in, no password. Riverside Cleanup Crew, with PayPal in sandbox.</p>
        <div className="mt-6 flex flex-wrap items-start justify-center gap-3">
          <RoleButton role="member" label="Ask as a volunteer" next="/chat" className="btn-primary px-5! py-3! text-base!" />
          <RoleButton role="treasurer" label="Open the treasurer’s dashboard" next="/treasurer" className="btn-ghost px-5! py-3! text-base!" />
          <Link href="/status" className="btn-ghost px-5! py-3! text-base!">
            See integration status
          </Link>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-6 text-sm text-muted">
        <p>Quartermaster, built for the PayPal AI Hackathon.</p>
        <p className="flex flex-wrap gap-x-5 gap-y-1">
          <a href={`${REPO}/blob/main/LICENSE`} className="underline hover:text-ink">
            MIT License
          </a>
          <a href={REPO} className="underline hover:text-ink">
            Source on GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
