import { CombinedDiabetesRepository } from './contracts';
import { SyntheticGlucoseSource } from './synthetic/SyntheticGlucoseSource';
import { SyntheticInsulinSource } from './synthetic/SyntheticInsulinSource';
import { SyntheticContextSource } from './synthetic/SyntheticContextSource';

export function createDemoRepository(now = Date.now()) {
  return new CombinedDiabetesRepository(
    new SyntheticGlucoseSource(now),
    new SyntheticInsulinSource(now),
    new SyntheticContextSource(now),
  );
}
