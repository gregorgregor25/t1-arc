import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const format = process.argv[2];
assert.ok(['landscape', 'portrait'].includes(format));
process.chdir(root);
// Invoke CLI implementation directly: its bin wrapper automatically loads .env.
// This render uses only a checked-in empty, public configuration file instead.
process.argv = [process.execPath, resolve(root, 'node_modules/@remotion/cli/remotion-cli.js'),
  'render', 'src/index.ts', `T1Arc-Food-Refresh-${format === 'landscape' ? 'Landscape' : 'Portrait'}`,
  `.render/food-refresh/food-${format}.mp4`, '--env-file=scripts/render-public-config.txt',
  '--gl=angle', '--concurrency=2', '--crf=17', '--image-format=jpeg', '--jpeg-quality=95', '--log=info'];
const require = createRequire(import.meta.url);
await require('../node_modules/@remotion/cli/dist/index.js').cli();
