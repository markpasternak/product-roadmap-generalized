# Roadmap site

Astro and Vue frontend for the fictional Product Portfolio Roadmap demo.

See the [repository README](../README.md) for features, saving and publishing, resources, sharing, configuration and deployment.

```sh
npm ci
npm run dev
npm test
npm run check
npm run build
node scripts/check-demo.mjs
```

The demo uses its own teal identity, Source Serif Pro and Inter fonts. Shared snapshots package the same local fonts and artwork. Keep all source content fictional and retain the demo-specific API and deployment settings when importing application improvements.

`SITE_AUDIENCE=public` strips owners and internal content. The showcase deploy uses the complete fictional portfolio. `SITE_BASE` configures a path prefix; `SITE_URL` configures canonical URLs.
