// Full fallback: compile the application once, then use the ordinary content publisher.
import { mkdtemp, mkdir, readFile, writeFile, lstat, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sha256 } from './application-package.mjs';

export async function installBuildOutput(site, candidate) {
  const source = join(candidate, 'public'), destination = join(site, 'dist');
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('Invalid candidate output');
  let previous;
  try { previous = await lstat(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) throw new Error('Invalid build destination');
  const backup = join(candidate, 'previous-dist');
  if (previous) await rename(destination, backup);
  try { await rename(source, destination); }
  catch (error) { if (previous) await rename(backup, destination); throw error; }
  if (previous) await rm(backup, { recursive: true }); // Only the generated dist moved above.
}

async function fullBuild() {
  const site = fileURLToPath(new URL('../', import.meta.url));
  const checkout = resolve(site, '..');
  await mkdir(join(site, '.cache'), { recursive: true });
  const attempt = await mkdtemp(join(site, '.cache/full-build-'));
  const application = join(attempt, 'application'), candidate = join(attempt, 'candidate');
  const run = (script, args = []) => execFileSync(process.execPath, [join(site, 'scripts', script), ...args], { cwd: site, stdio: 'inherit' });
  run('build-application.mjs', [application]);
  const digest = sha256(await readFile(join(application, 'package.json')));
  run('prepare-content.mjs', [application, checkout, candidate, digest]);
  // Validate the assembled output before replacing any previous local build.
  run('check-document-links.mjs', [join(candidate, 'public')]);
  run('check-item-history.mjs', [join(candidate, 'public')]);
  await installBuildOutput(site, candidate);
  const receipt = { application, packageDigest: digest, candidate, output: join(site, 'dist') };
  await writeFile(join(site, '.cache/full-build.json'), JSON.stringify(receipt));
  console.log(JSON.stringify(receipt));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await fullBuild();
