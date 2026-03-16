/**
 * Genera el par de llaves RSA para JWT RS256
 * Uso: npx tsx src/scripts/generateKeys.ts
 */
import { generateKeyPairSync } from "crypto";
import fs from "fs";
import path from "path";

const keysDir = path.join(process.cwd(), "keys");
fs.mkdirSync(keysDir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

fs.writeFileSync(path.join(keysDir, "private.pem"), privateKey, { mode: 0o600 });
fs.writeFileSync(path.join(keysDir, "public.pem"), publicKey);

console.log("✓ Llaves RSA generadas en ./keys/");
console.log("  private.pem — NUNCA compartir ni versionar");
console.log("  public.pem  — seguro para distribuir");
