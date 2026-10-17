import { RoleButton } from "@/components/role-switch";
import { MandateSimulator } from "@/components/mandate-simulator";

const JOURNEY = [
  { title: "Ask", body: "A volunteer types what the event needs, in plain words, with a budget if they have one." },
  { title: "Search", body: "The agent compares retailers on price per unit and checks the order against the budget before proposing it." },
  { title: "Check", body: "The mandate engine runs eleven fixed rules. The AI can’t override it, and it runs again right before money moves." },
  { title: "Approve and pay", body: "Inside the limits it’s pre-approved; above them the treasurer signs with PayPal. Webhooks confirm the payment." },
  { title: "Receipt", body: "Every order keeps a trust receipt: who asked, what was compared, which rules passed, and the PayPal IDs." },
];

export default function Home() {
  return (
    <div className="space-y-20 py-4">
      <section className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
        <div className="lg:sticky lg:top-10">
          <p className="text-sm font-medium text-brand">PayPal purchasing agent for volunteer teams</p>
          <h1 className="mt-4 text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl">Let an AI buy for your team, inside rules it can’t break.</h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted">
            Volunteers ask for what an event needs. Quartermaster finds it and pays with PayPal, but only within the spending mandate your treasurer
            signed. The rules are checked in code, not by the AI, and every order comes with a receipt that shows why it was allowed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <RoleButton role="member" label="Try it as a volunteer" next="/chat" className="btn-primary px-5! py-3! text-base!" />
            <RoleButton role="treasurer" label="Try it as the treasurer" next="/mandates" className="btn-ghost px-5! py-3! text-base!" />
          </div>
          <p className="mt-4 text-sm text-muted">Demo team: Riverside Cleanup Crew. PayPal runs in sandbox, so no real money moves.</p>
        </div>

        <div>
          <MandateSimulator />
          <p className="mt-3 text-center text-sm text-muted">Drag the quantity. This is the real mandate engine, running in your browser.</p>
        </div>
      </section>

      <section aria-labelledby="journey">
        <h2 id="journey" className="text-2xl font-bold sm:text-3xl">
          How a request travels
        </h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0">
          {JOURNEY.map((s, i) => (
            <li key={s.title} className="relative lg:pr-6">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-ink font-display font-bold">{i + 1}</span>
                {i < JOURNEY.length - 1 && <span aria-hidden className="hidden h-0.5 flex-1 bg-[repeating-linear-gradient(90deg,var(--color-ink)_0_6px,transparent_6px_12px)] opacity-40 lg:block" />}
              </div>
              <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
