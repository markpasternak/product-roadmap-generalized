import { fileURLToPath } from 'node:url';
import { AUDIENCE } from '../lib/audience';
import { prepareModel } from '../lib/published/prepare.server';
import { prepareResources } from '../../scripts/managed-assets.mjs';

// Injected only into astro dev; production catalogs belong to the content candidate.
export const prerender = false;
export async function GET() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const model = await prepareModel(root, import.meta.env.BASE_URL, AUDIENCE);
  return Response.json((await prepareResources(root, model, AUDIENCE)).catalog);
}
