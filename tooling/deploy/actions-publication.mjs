// CI orchestration only. Compilation runs in separate credential-free steps;
// canonical private packages are reusable only after their workflow succeeds.
import { readFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { configFromEnv, readCurrentRelease, preflight, publishStaged, writePrivateJSON } from './coordinate.mjs';
import { findApplicationArtifact, downloadApplicationArtifact } from './application-artifact.mjs';
import { reusableApplication } from '../ci/changes.mjs';
import { verifyApplicationPackage, sha256 } from '../../site/scripts/application-package.mjs';

const statePath = '.publication-selection.json';
const intentPath = '.deployment-intent.json';
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const output = async values => {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
};

export function artifactFallbackReason(error) {
  const code = error?.message;
  return ['UNTRUSTED_APPLICATION_ARTIFACT', 'PROFILE_MISMATCH', 'ARTIFACT_DOWNLOAD_FAILED', 'ARTIFACT_HTTP_401', 'ARTIFACT_HTTP_403', 'ARTIFACT_HTTP_404', 'ARTIFACT_HTTP_410', 'ARTIFACT_HTTP_429', 'ARTIFACT_HTTP_500', 'ARTIFACT_HTTP_502', 'ARTIFACT_HTTP_503'].includes(code)
    ? code : 'ARTIFACT_UNAVAILABLE_OR_INVALID';
}

export async function selectPublication(config = configFromEnv()) {
  if (await config.latest() !== config.commit) throw new Error('SOURCE_SUPERSEDED');
  const { canvas, release } = await readCurrentRelease(config);
  const state = { commit: config.commit, api: config.api, canvas, profile: config.profile, fullBuild: true, alreadyCurrent: false, fallbackReason: '' };
  const fallback = error => {
    state.fallbackReason = artifactFallbackReason(error);
    console.log(`::warning::Application reuse unavailable (${state.fallbackReason}); selecting the full build.`);
  };
  if (release?.applicationPackage && reusableApplication(release.applicationCommit, config.commit)) {
    let provenance;
    try {
      provenance = await findApplicationArtifact({ repo: config.repo, source: release.applicationCommit, digest: release.applicationPackage }, process.env.GH_TOKEN);
      // Profile is proven both by authenticated live descriptor and package.
      if (release.profile !== sha256(JSON.stringify(config.profile))) throw new Error('PROFILE_MISMATCH');
    } catch (error) { provenance = null; fallback(error); }
    if (provenance) {
      const application = { source: provenance.source, digest: provenance.digest };
      const intent = await preflight({ ...config, application, reuseApplication: true }, { observed: canvas });
      const directory = resolve('.publication-application');
      if (!intent.alreadyCurrent) {
        try { await downloadApplicationArtifact(provenance, process.env.GH_TOKEN, directory, config.profile); }
        catch (error) { provenance = null; fallback(error); }
      }
      if (provenance) {
        Object.assign(state, { fullBuild: false, alreadyCurrent: intent.alreadyCurrent, application, directory,
          candidate: resolve('.publication-candidate/candidate.json'), publicOutput: resolve('.publication-candidate/public') });
        await writePrivateJSON(intentPath, intent);
      }
    }
  }
  await writePrivateJSON(statePath, state);
  await output({ full_build: state.fullBuild, already_current: state.alreadyCurrent, fallback_reason: state.fallbackReason });
}

async function prepare() {
  const state = await read(statePath);
  if (state.fullBuild || state.alreadyCurrent) throw new Error('INVALID_PREPARATION_MODE');
  const p = state.profile;
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', CI: 'true', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    GITHUB_SHA: state.commit, SITE_URL: p.siteUrl, SITE_BASE: p.base, SITE_AUDIENCE: p.audience, PUBLIC_EDIT_API: p.editApi, PUBLIC_CANVAS_BACKEND: p.canvasBackend };
  await verifyApplicationPackage(state.directory, { digest: state.application.digest, profile: p });
  const command = name => join(state.directory, 'private/commands', name);
  const run = (binary, name, args = []) => execFileSync(binary, [command(name), ...args], { env, cwd: process.cwd(), stdio: 'inherit', timeout: 120000 });
  run('python3', 'validate_items.py', [process.cwd()]);
  run(process.execPath, 'build-item-history.mjs');
  run(process.execPath, 'prepare-content.mjs', [state.directory, process.cwd(), resolve('.publication-candidate'), state.application.digest]);
  run(process.execPath, 'check-document-links.mjs', [state.publicOutput]);
  run(process.execPath, 'check-item-history.mjs', [state.publicOutput]);
}

async function bindFullBuild() {
  const state = await read(statePath);
  if (!state.fullBuild) throw new Error('INVALID_FULL_BUILD_MODE');
  const build = await read('site/.cache/full-build.json');
  const manifest = await verifyApplicationPackage(build.application, { digest: build.packageDigest, profile: state.profile });
  if (manifest.source !== state.commit) throw new Error('APPLICATION_SOURCE_MISMATCH');
  Object.assign(state, { application: { source: manifest.source, digest: build.packageDigest }, directory: build.application,
    candidate: join(build.candidate, 'candidate.json'), publicOutput: build.output });
  await writePrivateJSON(statePath, state);
  await output({ application_directory: state.directory, application_digest: state.application.digest });
}

async function publish() {
  const state = await read(statePath), config = configFromEnv();
  if (state.commit !== config.commit || state.api !== config.api || JSON.stringify(state.profile) !== JSON.stringify(config.profile)) throw new Error('SELECTION_MISMATCH');
  Object.assign(config, { application: state.application, reuseApplication: !state.fullBuild });
  // Binding after full compilation preserves the ORIGINAL token. No late token
  // refresh can overwrite an intervening publish, rollback or unpublish.
  const intent = state.fullBuild ? await preflight(config, { observed: state.canvas }) : await read(intentPath);
  const candidate = state.alreadyCurrent ? undefined : await read(state.candidate);
  const proof = await publishStaged(config, intent, candidate, state.publicOutput);
  await writePrivateJSON('deployment-verification.json', { ...proof, applicationCommit: state.application.source, applicationPackage: state.application.digest, publisher: 'actions', build: state.fullBuild ? 'full' : 'content', fallbackReason: state.fallbackReason });
  console.log(`Deployment verified: ${proof.outcome} (${proof.verification})`);
}

async function main() {
  const action = process.argv[2];
  if (action === 'select') await selectPublication();
  else if (action === 'prepare') await prepare();
  else if (action === 'bind-full') await bindFullBuild();
  else if (action === 'publish') await publish();
  else throw new Error('UNKNOWN_PUBLICATION_ACTION');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(/^[A-Z_0-9]+$/.test(error.message) ? error.message : 'ACTIONS_PUBLICATION_FAILED'); process.exitCode = 1; });
