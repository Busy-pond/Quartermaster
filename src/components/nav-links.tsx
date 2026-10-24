"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/chat", label: "Request" },
  { href: "/reimburse", label: "Reimburse" },
  { href: "/join", label: "Dues" },
  { href: "/mandates", label: "Mandates" },
  { href: "/treasurer", label: "Dashboard" },
  { href: "/settings", label: "Agents" },
  { href: "/status", label: "Status" },
];

/** Top navigation; the current page carries an ink underline. */
export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`relative py-1 transition-colors ${active ? "font-medium text-ink" : "text-muted hover:text-ink"}`}
          >
            {l.label}
            <span
              aria-hidden
              className={`absolute inset-x-0 -bottom-0.5 h-[3px] rounded-full bg-ink transition-transform duration-300 ${active ? "scale-x-100" : "scale-x-0"}`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
