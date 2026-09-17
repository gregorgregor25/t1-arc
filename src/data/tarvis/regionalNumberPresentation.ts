import {
  formatRegionalFixedNumber,
  formatRegionalNumber,
} from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';

export function formatTarvisFixedNumber(
  value: number,
  fractionDigits: number,
) {
  return formatRegionalFixedNumber(
    value,
    getRuntimeRegionalDefaults().locale,
    fractionDigits,
  );
}

export function formatTarvisNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
) {
  return formatRegionalNumber(
    value,
    getRuntimeRegionalDefaults().locale,
    options,
  );
}
