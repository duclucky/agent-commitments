import { createCipheriv, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const [targetPath] = process.argv.slice(2);
const password = process.env.AGENT_COMMITMENTS_KEYSTORE_PASSWORD;

if (!targetPath || !password) {
  throw new Error("target path and process-scoped keystore password are required");
}

const privateKey = generatePrivateKey();
const privateKeyBytes = Buffer.from(privateKey.slice(2), "hex");
const salt = randomBytes(32);
const iv = randomBytes(16);
const n = 262_144;
const r = 8;
const p = 1;
const derivedKey = scryptSync(Buffer.from(password, "utf8"), salt, 32, {
  N: n,
  r,
  p,
  maxmem: 512 * 1024 * 1024,
});
const cipher = createCipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
const ciphertext = Buffer.concat([cipher.update(privateKeyBytes), cipher.final()]);
const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertext]);
const account = privateKeyToAccount(privateKey);

const keystore = {
  crypto: {
    cipher: "aes-128-ctr",
    cipherparams: { iv: iv.toString("hex") },
    ciphertext: ciphertext.toString("hex"),
    kdf: "scrypt",
    kdfparams: {
      dklen: 32,
      n,
      p,
      r,
      salt: salt.toString("hex"),
    },
    mac: keccak256(toHex(macInput)).slice(2),
  },
  id: randomUUID(),
  version: 3,
};

writeFileSync(targetPath, `${JSON.stringify(keystore)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(`${account.address}\n`);
