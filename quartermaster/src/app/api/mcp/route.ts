/**
 * MCP endpoint (streamable HTTP, stateless): POST /api/mcp with
 * "Authorization: Bearer qm_live_..." (create a key on /settings).
 * A fresh server + transport per request keeps it simple on one Render instance.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp/server";
import { keyFromHeader } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handleMcp(req: Request): Promise<Response> {
  const key = await keyFromHeader(req.headers.get("authorization"));
  if (!key)
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid API key. Create one on the Settings page and send it as 'Authorization: Bearer <key>'." }, id: null },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="quartermaster"' } },
    );
  const server = buildMcpServer({ orgId: key.orgId, keyId: key.id, keyName: key.name, agentMemberId: key.agentMemberId, appUrl: process.env.APP_URL ?? new URL(req.url).origin });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON responses are complete once returned, so the per-request server can go.
    void transport.close();
    void server.close();
  }
}

export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;
