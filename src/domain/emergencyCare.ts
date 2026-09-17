import type { T1ArcRegion } from './regionalProfile';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';

export interface EmergencyCareTerms {
  call: string;
  emergency: string;
  emergencyAction: string;
  department: string;
  urgentAdvice: string;
}

export function emergencyCareTerms(
  countryCode: string,
  region: Exclude<T1ArcRegion, 'automatic'>,
): EmergencyCareTerms {
  if (countryCode === 'GB') {
    return {
      call: 'Call 999 now',
      emergency: 'Call 999 now or go to A&E',
      emergencyAction: 'call 999 now or go to A&E',
      department: 'A&E',
      urgentAdvice: 'contact your diabetes care team now or call NHS 111',
    };
  }
  if (countryCode === 'US') {
    return {
      call: 'Call 911 now',
      emergency: 'Call 911 now or go to an emergency department',
      emergencyAction: 'call 911 now or go to an emergency department',
      department: 'an emergency department',
      urgentAdvice:
        'contact your diabetes care team or an urgent medical service now',
    };
  }
  if (countryCode === 'JP') {
    return {
      call: 'Call 119 now',
      emergency: 'Call 119 now or go to an emergency department',
      emergencyAction: 'call 119 now or go to an emergency department',
      department: 'an emergency department',
      urgentAdvice:
        'contact your diabetes care team or an urgent medical service now',
    };
  }
  const european = region === 'europe';
  return {
    call: european ? 'Call 112 now' : 'Call your local emergency number now',
    emergency: european
      ? 'Call 112 now or go to an emergency department'
      : 'Call your local emergency number or go to an emergency department',
    emergencyAction: european
      ? 'call 112 now or go to an emergency department'
      : 'call your local emergency number or go to an emergency department',
    department: 'an emergency department',
    urgentAdvice:
      'contact your diabetes care team or an urgent medical service now',
  };
}

export function getRuntimeEmergencyCareTerms() {
  const regional = getRuntimeRegionalDefaults();
  return emergencyCareTerms(regional.countryCode, regional.region);
}
