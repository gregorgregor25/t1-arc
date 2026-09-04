// Production follows the Android device locale. Tests that need another region
// pass it explicitly, while older UK regression fixtures expect the historical
// en-GB baseline. Make that baseline independent of the contributor or CI host.
const NativeDateTimeFormat = Intl.DateTimeFormat;

const TestDateTimeFormat = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
) {
  return new NativeDateTimeFormat(locales ?? 'en-GB', options);
} as typeof Intl.DateTimeFormat;

Object.setPrototypeOf(TestDateTimeFormat, NativeDateTimeFormat);
Object.defineProperty(TestDateTimeFormat, 'prototype', {
  value: NativeDateTimeFormat.prototype,
});

Object.defineProperty(Intl, 'DateTimeFormat', {
  configurable: true,
  value: TestDateTimeFormat,
  writable: true,
});
