import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("Tarv1s BYOK boundary", () => {
  it("keeps experimental service and workload-identity routes out of the app screen", () => {
    const screen = source("src/screens/TarvisScreen.tsx");

    expect(screen).toContain('from "@/data/tarvis/openAiClient"');
    expect(screen).not.toContain("experimentalBackendClient");
    expect(screen).not.toContain("directPocRuntime");
    expect(screen).not.toContain("askTarvisAnalystLab");
    expect(screen).not.toContain("askTarvisDirectPoc");
    expect(screen).not.toContain("EXPO_PUBLIC_TARVIS_");
  });

  it("loads the user key locally and sends both model request types directly to OpenAI", () => {
    const client = source("src/data/tarvis/openAiClient.ts");

    expect(client).toContain(
      'const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";',
    );
    expect(client.match(/loadTarvisApiKey\(writeLease\)/g)).toHaveLength(2);
    expect(client.match(/Authorization: `Bearer \$\{key\}`/g)).toHaveLength(2);
    expect(client.match(/fetch\(OPENAI_RESPONSES_URL/g)).toHaveLength(2);
    expect(client).not.toContain("process.env");
    expect(client).not.toContain("X-OpenAI-API-Key");
  });

  it("preserves the existing key setup and privacy wording", () => {
    const screen = source("src/screens/TarvisScreen.tsx");

    expect(screen).toContain("Connect broader answers");
    expect(screen).toContain("Paste a key from your OpenAI project.");
    expect(screen).toContain("Save key on this phone");
    expect(screen).toContain("Remove saved key");
  });

  it("uses the saved treatment profile only through the production local route", () => {
    const screen = source("src/screens/TarvisScreen.tsx");
    const coordinator = source("src/data/tarvis/requestCoordinator.ts");

    expect(screen).toContain('loadTarvisTreatmentProfile');
    expect(screen).toContain('buildTarvisTreatmentProfileAnswer');
    expect(screen).toContain('modelRequestSent: false');
    expect(screen).toContain('modelSharing: "local-only"');
    expect(coordinator).toContain('kind: "treatment-profile"');
  });

  it("keeps contributor-facing release plans on the same BYOK architecture", () => {
    const readme = source("README.md");
    const byokGuide = source("docs/TARV1S_BYOK.md");
    const releaseStatus = source("docs/RELEASE_STATUS.md");
    const normalEnvironment = source(".env.example");
    const archivedEnvironment = source(".env.mtls-poc.example");

    expect(readme).toContain(
      "Every user follows the same bring-your-own-key route:",
    );
    expect(byokGuide).toContain(
      "The maintainer and every other user follow the",
    );
    expect(byokGuide).toContain("same setup.");
    expect(releaseStatus).toContain(
      "the same direct bring-your-own-key Tarv1s route for every user",
    );
    expect(releaseStatus).not.toContain(
      "Put the production OpenAI key in a T1 Arc backend",
    );
    expect(normalEnvironment).not.toContain("EXPO_PUBLIC_TARVIS_");
    expect(normalEnvironment).toContain("Every user connects their own OpenAI");
    expect(archivedEnvironment).toContain("Archived direct-mTLS proof of concept");
  });

  it("cannot reactivate the archived workload-identity route at build time", () => {
    const moduleConfig = JSON.parse(
      source("modules/t1arc-tarvis-direct/expo-module.config.json"),
    ) as { platforms?: string[]; android?: unknown };
    const nativeBuild = source("modules/t1arc-tarvis-direct/android/build.gradle");

    expect(moduleConfig.platforms).toEqual([]);
    expect(moduleConfig.android).toBeUndefined();
    expect(nativeBuild).toContain(
      'buildConfigField "boolean", "TARVIS_MTLS_POC_ENABLED", "false"',
    );
    expect(nativeBuild).not.toContain("T1ARC_TARVIS_MTLS_POC_ENABLED");
    expect(nativeBuild).not.toContain("System.getenv");
  });
});
