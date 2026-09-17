import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const edition = process.env.T1ARC_NARRATION_EDITION ?? 'original';
if (!['original', 'mixed', 'privacy'].includes(edition)) throw new Error('Unknown narration edition');
const directory = edition === 'original' ? 'narration' : `narration-${edition}`;
export const source = join(root, '.render', directory);
export const output = join(root, 'out', directory);
export const scriptFile = join(root, 'narration', edition === 'original' ? 'script.json' : `script-${edition}.json`);
// One allowance ledger covers every edition, including earlier voice tests.
export const ledgerFile = join(root, '.render', 'narration', 'generation-ledger.json');
