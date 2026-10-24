"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { DashboardData } from "@/lib/dashboard/load";

/** AG Studio touches the DOM as it loads, so it renders in the browser only. */
const StudioView = dynamic(() => import("./studio-view"), {
  ssr: false,
  loading: () => <p className="card p-6 text-sm text-muted">Loading the AG Studio dashboard…</p>,
});

export function TreasurerStudio(props: { orgName: string; isTreasurer: boolean; licenseKey: string; assistant: boolean; data: DashboardData }) {
  const router = useRouter();
  return <StudioView {...props} refresh={router.refresh} />;
}
