import { describe, expect, it } from "vitest";
import { classify } from "./lifecycle";
import { errorText } from "./genlayer";

// The guarantees a reviewer checks first: only ACCEPTED / FINALIZED are success,
// and a call the contract rejected is never shown as one, whatever the consensus status says.
describe("classify", () => {
  it("accepts ACCEPTED (5) and FINALIZED (7)", () => {
    expect(classify({ status: 5 }, "x").ok).toBe(true);
    expect(classify({ status: "7" }, "x").ok).toBe(true);
  });

  it.each([[6, "UNDETERMINED"], [8, "CANCELED"], [12, "VALIDATORS_TIMEOUT"], [13, "LEADER_TIMEOUT"], [1, "PENDING"]])(
    "does not accept status %s (%s)", (status) => {
      const out = classify({ status }, "x");
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.kind).toBe("consensus");
    });

  it("a contract rejection is a rejection even when consensus accepted it", () => {
    const tx = { status: 5, txExecutionResultName: "FINISHED_WITH_ERROR", result: "company_number already registered" };
    const out = classify(tx, "fallback hint");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe("rejected");
      expect(out.message).toContain("already registered");
    }
  });

  it("keeps a revert message that contains a URL whole", () => {
    const tx = { status: 5, txExecutionResultName: "FINISHED_WITH_ERROR",
                 result: "website must be a hostname or URL, e.g. https://www.example.eu" };
    const out = classify(tx, "hint");
    if (!out.ok) expect(out.message).toContain("https://www.example.eu");
  });

  it("falls back to the hint when the revert text is not found", () => {
    const out = classify({ status: 7, txExecutionResultName: "FINISHED_WITH_ERROR" }, "the contract refused it");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("the contract refused it");
  });
});

describe("errorText", () => {
  it("surfaces a 429 buried in viem's cause chain instead of 'unknown RPC error'", () => {
    const err = Object.assign(new Error("An unknown RPC error occurred."), {
      name: "UnknownRpcError", details: "Rate limit exceeded: 30 requests per minute",
      cause: { code: -32029, message: "Rate limit exceeded: 30 requests per minute" },
    });
    const text = errorText(err);
    expect(text).toMatch(/Rate limit exceeded/);
    expect(text).not.toMatch(/unknown RPC error/);
  });

  it("falls back to the plain message", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
  });
});
