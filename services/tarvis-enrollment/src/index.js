import { CertificateIssuer } from "./certificateIssuer.js";
import { loadCaMaterial, readConfig } from "./config.js";
import { createEnrollmentServer } from "./server.js";

const config = readConfig();
const caMaterial = await loadCaMaterial(config);
const certificateIssuer = await CertificateIssuer.create({
  ...caMaterial,
  ttlMs: config.certificateTtlMs,
});
const server = createEnrollmentServer({ config, certificateIssuer });

server.listen(config.port, config.host, () => {
  process.stdout.write(`TARV1S enrolment listening on ${config.host}:${config.port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
