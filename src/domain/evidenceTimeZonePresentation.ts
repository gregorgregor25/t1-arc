export function evidenceTimeZoneLabel(timeZone: string) {
  return timeZone;
}

export function evidenceRequestedPeriodLabel(timeZone: string) {
  return `EXACT REQUESTED PERIOD · ${evidenceTimeZoneLabel(timeZone)}`;
}
