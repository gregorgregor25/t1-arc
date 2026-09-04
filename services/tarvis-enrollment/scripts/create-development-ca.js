import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDevelopmentCa } from "../src/certificateIssuer.js";

const outputDirectory = resolve(process.argv[2] ?? "./.development-ca");
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const material = await createDevelopmentCa();
await Promise.all([
  writeFile(resolve(outputDirectory, "ca-certificate.pem"), material.certificatePem, {
    mode: 0o644,
    flag: "wx",
  }),
  writeFile(resolve(outputDirectory, "ca-private-key.pem"), material.privateKeyPem, {
    mode: 0o600,
    flag: "wx",
  }),
]);
process.stdout.write(`${outputDirectory}\n`);
