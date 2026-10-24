"use client";

/** Shown when a page fails to render, e.g. the database is unreachable. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const db = /Failed query|NeonDbError|DATABASE_URL|fetch failed/i.test(error.message);
  return (
    <div className="card mx-auto max-w-xl p-6" role="alert">
      <h1 className="text-lg font-semibold">{db ? "Can't reach the database" : "Something went wrong"}</h1>
      <p className="mt-2 text-sm text-muted">
        {db
          ? "Check DATABASE_URL in .env.local (npm run check:env tells you exactly what's wrong), make sure you ran npm run setup, then restart npm run dev."
          : "The error is logged in the terminal running the app."}
      </p>
      <button className="btn-primary mt-4" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
