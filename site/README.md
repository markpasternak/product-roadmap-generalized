# Roadmap site

A production static site that renders the product portfolio roadmap straight from
the repo's markdown. Built with **Astro + Vue + Tailwind CSS 4 + TypeScript**.

The markdown files under `content/items/**` are the source of truth for both item
fields and bodies. This site renders them, and also supports **in-app editing**:
sign in with GitHub, switch to edit mode, edit/add/delete/reorder items, then
**Sync** — it commits the changed files in one commit (via a GitHub App) and
triggers a rebuild.

## What it renders

- **Now / Next / Later board** (`/`) - a filterable 5-lane board (Candidates · Now ·
  Next · Later · Completed) with search (`/` to focus), product / stage / impact /
  effort / tag / hygiene filters, group-by-lane or group-by-product, shareable
  filtered URLs, an expansive item drawer (arrow-key + swipe navigation, copy link,
  edit on GitHub), and a chrome-less presentation view (`?present=1`).
- **Item pages** (`/item/<id>`) - the full rendered markdown for each roadmap item,
  with lede, tags, prev/next navigation, and a Related-documents block linking to
  its PRD / technical design / research.
- **Docs library** (`/docs`, `/docs/<type>/<slug>`) - the PRDs, technical designs,
  and research notes, with "Referenced by" backlinks to the items that cite them.
- **Context pages** - `/help` (how to read and edit the roadmap, including its AI
  features), `/themes` (strategic bets), `/product/<slug>` (per-product view),
  `/changelog` (recently updated), `/changes` (the Sync commit-history activity feed),
  and a branded 404.
- **AI & live collaboration** - in edit mode: draft a new item from a prompt ("New with
  AI"), ask AI to rewrite an existing one with a plan-then-apply diff ("Rewrite with
  AI"), and see who else is viewing/editing right now (live presence) — all gated on
  canvas-drop's AI/realtime Backend being enabled. See `/help` for details.

Markdown is rendered at build time as full GitHub-flavored markdown (tables, task
lists, Shiki-highlighted code, images). Mermaid diagrams render client-side via a
lazy-loaded island. Light and dark themes are supported.

## Content sources

Collections are read from `../content/` (one level up from `site/`):

| Collection   | Path                             |
| ------------ | -------------------------------- |
| `items`      | `../content/items/**`            |
| `prds`       | `../content/prds/**`             |
| `techDesign` | `../content/technical-design/**` |
| `research`   | `../content/research/**`         |

## Develop

```bash
cd site
npm install
npm run dev      # dev server with HMR
npm run build    # static build → dist/
npm run preview  # serve the built dist/
npm run check    # astro check (types)
npm run test     # vitest (schema, filters, components)
```

## Design system

The token layer (primitives, typography, semantic `@theme` tokens) and the Inter
font are **vendored and adapted** from
[`seenthis-ab/component-library`](https://github.com/seenthis-ab/component-library)
under `src/styles/`. The UI components in `src/components/ui/` are our own Vue
implementations built from that system (CVA + `cn()`), not a dependency on it.

## Structure

```
site/
├─ astro.config.mjs        # Vue + Tailwind + markdown pipeline (mermaid/link rehype)
├─ src/
│  ├─ content.config.ts    # content collections + Zod schemas (read ../content/)
│  ├─ styles/              # vendored tokens, typography, fonts, global.css
│  ├─ lib/                 # schema, items, filters, display, slugs, cn()
│  ├─ components/
│  │  ├─ ui/               # Badge, Pill, Card, SearchInput, Navbar, …
│  │  ├─ board/            # Board, RoadmapCard, FilterBar
│  │  └─ markdown/         # MarkdownContent.astro + Mermaid.vue
│  ├─ layouts/Base.astro
│  └─ pages/               # index, item/[id], docs/index, docs/[type]/[slug]
└─ (deploy is at <repo-root>/.github/workflows/deploy.yml)
```

## Hosting

The build outputs a static `dist/` that can be hosted anywhere.

- **At a domain root** (default): `npm run build` - links are root-relative.
- **Under a subpath** (GitHub project Pages, e.g. `/product-roadmap/`): build with
  `SITE_BASE=/product-roadmap npm run build` so asset and page URLs are prefixed.
- **Public (external) site**: `SITE_AUDIENCE=public npm run build` includes only
  `visibility: Public` items and docs, uses canonical item copy, drops owners,
  and strips internal-only detail sections like `## Open questions`. The default
  build is the full internal site - never host it externally.

The deploy is live at [`<repo-root>/.github/workflows/deploy.yml`](../.github/workflows/deploy.yml):
on every push under `site/`, `content/` (excl. `sources/`), or `presentations/` it
builds this site, copies each `presentations/<slug>/` folder to `dist/p/<slug>/`,
zips `dist/`, and PUTs it to **canvas-drop** (`seenthisroadmap.canvas-drop.com`,
team-only) using the `CANVAS_DROP_TOKEN` repo secret. It ships the full internal
build; the canvas is access-controlled. Served at the subdomain root, so no
`SITE_BASE` is needed (`/`).
