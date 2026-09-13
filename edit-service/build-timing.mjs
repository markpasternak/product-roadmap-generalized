// Read-only observations: do not wrap fetch, consume responses, change npm
// scripts, or import application code. All emitted labels are fixed constants.
import { subscribe } from 'node:diagnostics_channel';
import { writeSync } from 'node:fs';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';

const stages = {
  'npm': 'npm_build', 'npm-cli.js': 'npm_build',
  'astro': 'astro_build', 'astro.js': 'astro_build', 'astro.mjs': 'astro_build',
  'sync-presentations.mjs': 'sync_presentations', 'gen-version.mjs': 'generate_version',
  'build-item-history.mjs': 'item_history', 'check-document-links.mjs': 'document_links',
  'check-item-history.mjs': 'item_dates', 'check-demo.mjs': 'demo_check',
  'coordinate.mjs': 'coordinator',
  'prepare-content.mjs': 'prepare_content',
};
const stage = stages[basename(process.argv[1] || '')];
let records = 0;
function emit(value) {
  if (++records > 128) return;
  try { writeSync(2, `ROADMAP_BUILD_TIMING ${JSON.stringify({ ...value, pid: process.pid })}\n`); } catch { /* best effort */ }
}
if (stage) {
  emit({ stage, outcome: 'started', duration_ms: 0 });
  process.once('exit', code => {
    const usage = process.resourceUsage();
    emit({ stage, outcome: code === 0 ? 'success' : 'failed', duration_ms: performance.now(),
      user_ms: usage.userCPUTime / 1000, system_ms: usage.systemCPUTime / 1000, max_rss_kib: usage.maxRSS });
  });
}

// Undici diagnostics fire after the complete response body (trailers), not
// merely headers. Never inspect/log authorization, query values, or payloads.
if (stage === 'coordinator') {
  const requests = new WeakMap();
  subscribe('undici:request:create', ({ request }) => {
    try {
      const url = new URL(request.path, 'http://instrumentation.invalid');
      let label;
      if (/^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/main$/.test(url.pathname)) label = 'github_latest';
      else if (/^\/v1\/canvases\/[^/]+\/deploy$/.test(url.pathname) && request.method === 'PUT') label = 'canvas_upload';
      else if (/^\/v1\/canvases\/[^/]+\/uploads$/.test(url.pathname) && request.method === 'POST') label = 'canvas_begin';
      else if (/^\/v1\/canvases\/[^/]+\/uploads\/[^/]+\/blobs\/[^/]+$/.test(url.pathname) && request.method === 'PUT') label = 'canvas_blob';
      else if (/^\/v1\/canvases\/[^/]+\/uploads\/[^/]+\/finalize$/.test(url.pathname) && request.method === 'POST') label = 'canvas_finalize';
      else if (/^\/v1\/canvases\/[^/]+\/files$/.test(url.pathname)) label = url.searchParams.has('path') ? 'canvas_version' : 'canvas_manifest';
      else if (/^\/v1\/canvases\/[^/]+$/.test(url.pathname)) label = 'canvas_status';
      if (label) requests.set(request, { stage: label, started: performance.now() });
    } catch { /* diagnostics never affect the request */ }
  });
  subscribe('undici:request:headers', ({ request, response }) => {
    const timing = requests.get(request);
    if (timing) timing.status = response.statusCode;
  });
  function finish(request, failed) {
    const timing = requests.get(request);
    if (!timing) return;
    requests.delete(request);
    emit({ stage: timing.stage, duration_ms: performance.now() - timing.started, status: timing.status || 0,
      outcome: failed || timing.status >= 400 ? (timing.status === 409 ? 'conflict' : 'failed') : 'success' });
  }
  subscribe('undici:request:trailers', ({ request }) => finish(request, false));
  subscribe('undici:request:error', ({ request }) => finish(request, true));
}
