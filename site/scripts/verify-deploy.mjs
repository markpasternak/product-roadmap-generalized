// Optional manual re-verification. The coordinated publisher invokes the same
// proof directly, so Actions does not make a redundant second readback pass.
import { resolve } from 'node:path';
import { configFromEnv, verify, writePrivateJSON } from '../../tooling/deploy/coordinate.mjs';

const report = await verify(configFromEnv(), resolve(import.meta.dirname, '../dist'));
await writePrivateJSON(resolve(import.meta.dirname, '../../deployment-verification.json'), report);
console.log(`Verified ${report.verifiedFiles} files and release identity`);
