import { PreparedGlookoImport } from '@/data/import/glookoImport';

export interface GlookoManualImportAttestation {
  samePersonOrFirstGlookoDataConfirmed: true;
  ukTimestampFormatConfirmed: true;
}

/** Fail-closed API guard; the UI confirmation is not trusted on its own. */
export function assertManualGlookoImportIntegrity(
  prepared: Pick<PreparedGlookoImport, 'preview'>,
  attestation?: GlookoManualImportAttestation,
) {
  if (prepared.preview.unsafeTimestampLocale) {
    throw new Error(
      'This archive contains timestamps T1 Arc cannot safely map to Europe/London instants (month/day/year dates, a skipped spring time, or an unresolved repeated autumn hour). Nothing was imported.',
    );
  }
  if (
    attestation?.samePersonOrFirstGlookoDataConfirmed !== true ||
    attestation.ukTimestampFormatConfirmed !== true
  ) {
    throw new Error(
      'Confirm that this is the same person (or the first Glooko import) and that the export uses Europe/London local time with day/month/year dates.',
    );
  }
}
