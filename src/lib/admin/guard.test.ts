import { describe, expect, it } from "vitest";
import { checkAdminSecret } from "./guard";

const SECRET = "a-long-enough-app-secret-1234";

describe("checkAdminSecret", () => {
  it("lets the right secret through", () => expect(checkAdminSecret(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true }));

  it("rejects a wrong secret", () => {
    expect(checkAdminSecret("Bearer wrong-secret-wrong-secret", SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(checkAdminSecret(`Bearer ${SECRET}x`, SECRET)).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a missing or malformed header", () => {
    expect(checkAdminSecret(null, SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(checkAdminSecret(SECRET, SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(checkAdminSecret("Bearer ", SECRET)).toMatchObject({ ok: false, status: 401 });
  });

  it("stays closed when APP_SECRET is unset or too short, whatever is sent", () => {
    expect(checkAdminSecret("Bearer anything", undefined)).toMatchObject({ ok: false, status: 503 });
    expect(checkAdminSecret("Bearer ", "")).toMatchObject({ ok: false, status: 503 });
    expect(checkAdminSecret("Bearer short", "short")).toMatchObject({ ok: false, status: 503 });
  });
});
