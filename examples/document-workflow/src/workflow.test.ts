import { describe, expect, it } from "vitest";
import { runDocumentWorkflow, type PaidProvider } from "./workflow.js";

describe("document workflow partial failure", () => {
  it("settles accepted OCR work and refunds a rejected formatting step", async () => {
    const calls: string[] = [];
    const provider = (name: string, accepted: boolean): PaidProvider => ({
      execute: async (operationId) => { calls.push(`${name}:execute:${operationId}`); return { accepted, outputHash: `${name}-hash` }; },
      settle: async (operationId) => { calls.push(`${name}:settle:${operationId}`); },
      refund: async (operationId) => { calls.push(`${name}:refund:${operationId}`); },
    });
    const result = await runDocumentWorkflow("document-9", provider("ocr", true), provider("format", false));
    expect(result.status).toBe("PARTIAL");
    expect(calls).toEqual([
      "ocr:execute:document-9:ocr", "ocr:settle:document-9:ocr",
      "format:execute:document-9:format", "format:refund:document-9:format",
    ]);
  });
});
