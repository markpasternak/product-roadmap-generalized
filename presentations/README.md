# Presentations

Self-contained static **microsites** — a research write-up compiled into a little
site, a pitch, an interactive prototype. Anything that is plain HTML / CSS / JS /
Markdown and needs no server.

Each subfolder here is published as its own site alongside the roadmap:

```
presentations/<slug>/index.html   →   https://<site>/p/<slug>/
```

The deploy workflow copies every folder **verbatim** into the site build (`site/dist/p/`)
— nothing here is processed, bundled, or run through Astro. What you commit is what
ships.

## Rules (so it just works)

1. **One folder per presentation.** The folder name is the URL slug — lowercase,
   hyphens, no spaces (`q3-media-research`, not `Q3 Media Research`). Folders
   starting with `_` (like `_example`) are conventionally scratch/demo.
2. **Every folder has an `index.html`** — that's what loads at `/p/<slug>/`.
3. **Use relative paths only** — `./style.css`, `./app.js`, `./content.md`,
   `./img/chart.png`. Never absolute (`/style.css`) — the site may be served under
   a base path (e.g. `/product-roadmap/`), and relative links stay correct there.
4. **Self-contained.** Bundle what you need in the folder. External CDNs will load
   on GitHub Pages, but vendoring keeps a presentation working offline and forever.
5. **Markdown is yours to render.** These are static files — if you want a `.md`
   rendered in the browser, include a small renderer in the folder (see `_example/`,
   which renders `content.md` with a tiny inline function and no dependencies).
6. **Images render** — drop the file in the folder and reference it relatively
   (`![alt](./img/chart.svg)`); remote `https://…` images work too. The `_example/`
   renderer handles both. (On the main roadmap site, markdown images render natively
   via Astro.)

## Add one

```bash
mkdir presentations/my-thing
cp presentations/_example/* presentations/my-thing/   # or start fresh
# edit index.html, commit, push → live at /p/my-thing/
```

## Preview locally

```bash
cd presentations/my-thing
python3 -m http.server 8000   # → http://localhost:8000
```

`_example/` is a minimal working reference: `index.html` + `style.css` + `app.js`
+ `content.md`, all relative, rendering markdown client-side with zero dependencies.
