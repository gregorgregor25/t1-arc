/**
 * Plain wording for an unexpected reply from an online service. The status
 * code stays at the end, in brackets, so support can still identify it.
 */
export function serviceStatusMessage(service: string, status: number): string {
  if (status === 401 || status === 403) {
    return `${service} did not accept the saved sign-in details. Check them in Settings, then try again. (Code ${status})`;
  }
  if (status === 404) {
    return `${service} could not find what T1 Arc asked for. Check the address or account in Settings. (Code ${status})`;
  }
  if (status === 429) {
    return `${service} is limiting requests right now. T1 Arc will try again later. (Code ${status})`;
  }
  if (status >= 500) {
    return `${service} is having a problem right now. T1 Arc will try again later. (Code ${status})`;
  }
  return `${service} could not complete the request. Try again later, and contact support if it keeps happening. (Code ${status})`;
}
