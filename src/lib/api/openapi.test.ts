import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, } from "node:path";
import { openApiDocument } from "./openapi";

type Doc = ReturnType<typeof openApiDocument>;
const doc = openApiDocument("http://localhost:3000") as Doc;

/** Every src/app/api/**\/route.ts becomes "/api/...", with [id] written as {id}. */
function routePaths(dir = join(process.cwd(), "src", "app", "api"), prefix = "/api"): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routePaths(full, `${prefix}/${name.replace(/^\[(\w+)\]$/, "{$1}")}`));
    else if (name === "route.ts") out.push(prefix);
  }
  return out;
}

describe("OpenAPI document", () => {
  it("is OpenAPI 3.1 and covers every API route", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).sort()).toEqual(routePaths().sort());
  });

  it("gives every operation a unique id and at least one response", () => {
    const ids: string[] = [];
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(item) as { operationId: string; responses: object }[]) {
        ids.push(op.operationId);
        expect(Object.keys(op.responses).length).toBeGreaterThan(0);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses plain JSON Schema (3.1), not the 3.0 dialect", () => {
    const text = JSON.stringify(doc);
    expect(text).not.toContain('"nullable"');
    expect(text).not.toContain('"$schema"');
    expect(text).not.toContain("$ref\":\"#/definitions");
  });

  it("builds request bodies from the shared zod schemas", () => {
    const body = (doc.paths["/api/session"].post as { requestBody: { content: { "application/json": { schema: { properties: { role: { enum: string[] } } } } } } }).requestBody;
    expect(body.content["application/json"].schema.properties.role.enum).toEqual(["member", "treasurer"]);
  });

  it("only references security schemes that exist", () => {
    const known = Object.keys(doc.components.securitySchemes);
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(item) as { security: Record<string, string[]>[] }[]) {
        for (const req of op.security) for (const name of Object.keys(req)) expect(known).toContain(name);
      }
    }
  });
});
