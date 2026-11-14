/** Solana program ids must be valid 32-byte keys. TOKEN_2022 was mistyped and refused every Token-2022 mint (fail closed). */
import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { ATA_PROGRAM, MEMO_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "@/deposits/builder";

describe("Solana program ids", () => {
  it.each([["Token", TOKEN_PROGRAM], ["Token-2022", TOKEN_2022_PROGRAM], ["Associated Token", ATA_PROGRAM], ["Memo", MEMO_PROGRAM]])("%s is a valid 32-byte key", (_n, id) => {
    expect(new PublicKey(id).toBytes().length).toBe(32);
  });
  it("Token-2022 is the program that owns real Token-2022 mints (read on mainnet 2026-11-14: PYUSD 2b1kV6Dk…)", () => {
    expect(TOKEN_2022_PROGRAM).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  });
});
