import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import * as sdk from "./index.js";

describe("authorized Arc mainnet pilot configuration", () => {
  it("prepares provider and recovery calls for the bound draft deployment without a signer", () => {
    const client = sdk.createArcMainnetPilotClient();
    expect(client.chainId).toBe(5042);
    expect(client.vault).toBe("0x2415a87B0b9280C1989F03ceA9DC1c3644777862");
    expect(client.adapter).toBe("0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d");
    expect(client.escrow).toBe("0x19E14a1006d106882D4c24584AAA6Ce1771E4151");
    expect(client.prepareProviderBudget(2n, 5000n).to).toBe(client.escrow);
    expect(decodeFunctionData({ abi: sdk.erc20Abi, data: client.prepareDepositApproval(10000n).data })).toMatchObject({ functionName: "approve", args: [client.vault, 10000n] });
    expect(client.prepareClaimRefund(2n).to).toBe(client.escrow);
  });
});
