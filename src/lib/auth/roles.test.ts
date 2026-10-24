import { describe, expect, it } from "vitest";
import { assertApprover, assertTreasurer, Forbidden, treasurerGate } from "./roles";

const treasurer = { id: "t1", orgId: "o1", role: "treasurer" };
const volunteer = { id: "v1", orgId: "o1", role: "member" };
const mandate = { orgId: "o1", approverIds: ["t1"] };

describe("assertTreasurer (insights, Studio agent)", () => {
  it("lets the treasurer through", () => expect(() => assertTreasurer(treasurer)).not.toThrow());
  it("refuses a volunteer with a 403", () => {
    expect(() => assertTreasurer(volunteer)).toThrow(Forbidden);
    try {
      assertTreasurer(volunteer);
    } catch (e) {
      expect((e as Forbidden).status).toBe(403);
    }
  });
});

describe("assertApprover (order, capture, refund, invoice, reimbursement)", () => {
  it("lets the mandate's approver through", () => expect(() => assertApprover(mandate, treasurer)).not.toThrow());
  it("refuses a volunteer who isn't an approver", () => expect(() => assertApprover(mandate, volunteer)).toThrow(Forbidden));
  it("refuses an approver id from another org", () => expect(() => assertApprover(mandate, { id: "t1", orgId: "o2" })).toThrow(Forbidden));
  it("refuses when the mandate is missing", () => {
    expect(() => assertApprover(undefined, treasurer)).toThrow(Forbidden);
    expect(() => assertApprover(null, treasurer)).toThrow(Forbidden);
  });
});

describe("treasurerGate (/treasurer page)", () => {
  it("shows the dashboard only to the treasurer", () => {
    expect(treasurerGate(treasurer)).toBe("ok");
    expect(treasurerGate(volunteer)).toBe("not-treasurer");
    expect(treasurerGate(null)).toBe("signed-out");
  });
});
