import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-xl p-6">
      <h1 className="text-lg font-semibold">We couldn’t find that page</h1>
      <p className="mt-2 text-sm text-muted">The link may be old, or the payment or receipt it points to doesn’t exist in this demo.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/" className="btn-primary">
          Back to the home page
        </Link>
        <Link href="/mandates" className="btn-ghost">
          Open the mandates
        </Link>
      </div>
    </div>
  );
}
