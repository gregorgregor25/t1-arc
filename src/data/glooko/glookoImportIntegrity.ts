import { PreparedGlookoImport } from '@/data/import/glookoImport';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';

export interface GlookoManualImportAttestation {
  samePersonOrFirstGlookoDataConfirmed: true;
  regionalTimestampFormatConfirmed?: true;
  /** Upgrade compatibility for confirmations made by the UK-only build. */
  ukTimestampFormatConfirmed?: true;
}

/** Fail-closed API guard; the UI confirmation is not trusted on its own. */
export function assertManualGlookoImportIntegrity(
  prepared: Pick<PreparedGlookoImport, 'preview'>,
  attestation?: GlookoManualImportAttestation,
) {
  const regional = getRuntimeRegionalDefaults();
  const dateOrder = regional.glookoRegion === 'us' ? 'month/day/year' : 'day/month/year';
  if (prepared.preview.unsafeTimestampLocale) {
    throw new Error(
      regional.timeZone === 'Europe/London' && regional.glookoRegion === 'eu'
        ? 'This archive contains timestamps T1 Arc cannot safely map to Europe/London instants (month/day/year dates, a skipped spring time, or an unresolved repeated autumn hour). Nothing was imported.'
        : `This archive contains timestamps T1 Arc cannot safely map using ${dateOrder} dates in ${regional.timeZone} (a conflicting date order, skipped local time, or unresolved repeated hour). Nothing was imported.`,
    );
  }
  if (
    attestation?.samePersonOrFirstGlookoDataConfirmed !== true ||
    (attestation.regionalTimestampFormatConfirmed !== true &&
      attestation.ukTimestampFormatConfirmed !== true)
  ) {
    throw new Error(
      `Confirm that this is the same person (or the first Glooko import) and that the export uses ${regional.timeZone} local time with ${dateOrder} dates.`,
    );
  }
}
