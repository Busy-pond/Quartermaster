import { NextResponse } from "next/server";
import { openApiDocument } from "@/lib/api/openapi";

export const dynamic = "force-dynamic";

/** OpenAPI 3.1 for the public API (import into Postman or APIMatic). */
export function GET(req: Request) {
  return NextResponse.json(openApiDocument(process.env.APP_URL ?? new URL(req.url).origin), { headers: { "Access-Control-Allow-Origin": "*" } });
}
