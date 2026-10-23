import type { Metadata } from "next";
import Link from "next/link";
import { Bricolage_Grotesque, Public_Sans } from "next/font/google";
import "./globals.css";
import { currentMember } from "@/lib/session";
import { RoleButton } from "@/components/role-switch";
import { NavLinks } from "@/components/nav-links";
import { APP_REVISION } from "@/lib/version";

// Bricolage Grotesque for headings and stamps; Public Sans (designed for US government forms) for everything else.
const heading = Bricolage_Grotesque({ variable: "--font-heading", subsets: ["latin"], weight: ["600", "700", "800"] });
const body = Public_Sans({ variable: "--font-body", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Quartermaster — a PayPal purchasing agent for volunteer teams",
  description: "An AI purchasing agent that buys and reimburses with PayPal, only inside spending mandates your treasurer signed.",
};

export const dynamic = "force-dynamic";

async function Nav() {
  let me = null;
  try {
    me = await currentMember();
  } catch {
    // Database not configured yet — still render the shell
  }
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold">
          <span aria-hidden className="stamp px-1.5! py-0.5! text-sm" data-kind="allow">
            Q
          </span>
          Quartermaster
        </Link>
        <NavLinks />
        <div className="ml-auto flex items-center gap-3 text-sm">
          {me ? (
            <>
              <span className="text-right leading-tight">
                <span className="block font-medium">{me.name}</span>
                <span className="block text-xs text-muted">{me.role === "treasurer" ? "Treasurer" : "Volunteer"}</span>
              </span>
              <RoleButton
                key={me.id}
                role={me.role === "treasurer" ? "member" : "treasurer"}
                label={me.role === "treasurer" ? "Switch to volunteer" : "Switch to treasurer"}
                next={me.role === "treasurer" ? "/chat" : "/mandates"}
                className="btn-ghost py-1.5!"
              />
            </>
          ) : (
            <span className="text-muted">Not signed in</span>
          )}
        </div>
      </div>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${heading.variable} ${body.variable} font-sans antialiased`}>
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-6 text-xs text-muted">
          Version {APP_REVISION}. PayPal runs in sandbox mode.
        </footer>
      </body>
    </html>
  );
}
