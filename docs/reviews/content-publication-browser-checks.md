# Compiled content-publication browser checks

Use the browser automation MCP for every browser action and observation. This
procedure uses the project's approved interactive browser workflow. Preparation
commands create immutable local fixtures; they do not
automate the browser or publish anything externally.

1. Compile an internal application with a loopback editor fixture profile. Prepare
   two candidates from clean Git revisions using that same application package,
   changing one item's title, cover revision and attached resource in the second.
   Keep production source unchanged. Verify both complete candidate inventories.
2. Run `site/scripts/serve-content-proof.mjs` with the two candidate directories.
   Use `CONTENT_PROOF_EDITOR=1` for an editor instance and a separate port without
   that variable for a viewer. Separate ports isolate the fixture draft/session;
   different browser profiles alone still share the mock server's account draft.
3. Open both compiled pages through MCP. Filter the viewer to the selected item.
   Enable the supported CDP Page/Network event streams and save their cursors.
   In the editor, change the title and keep its field focused and draft unpublished.
4. Switch each fixture server with its printed loopback-only activation token.
   Observe the viewer's new title and image/resource URLs without navigation,
   retained filters and a matching content-snapshot response. Confirm the editor
   keeps the draft, open form and focus and explains its deferred content update.
   Record zero Page.frameNavigated events between activation and observation.
5. Open direct item and document routes, then use back/forward. Check managed
   images load with natural dimensions. Inspect View/Filter drawers, keyboard
   focus, horizon order, labels and 390-by-667 and short desktop viewports. Restore
   temporary viewport overrides. New baked shares omit internal labels/owners
   and keep their original snapshot after the live source changes.
6. Repeat a non-root `/proof/` public build with a real public item and linked
   document. Validate exclusion of internal sentinel content and private files in
   compiled HTML, JSON, catalog and sitemap; inspect its direct routes through MCP.
7. For incompatible application identity, keep the old tab open, serve the new
   compiled application candidate and confirm a guarded normal-reload offer.
   Confirm corrupt/offline candidates retain the previous complete view.

Record application source/digest, candidate commits, browser observations and
network/navigation evidence in the release report. Local fixtures do not prove
production auth, webhook delivery, GitHub artifact promotion or live latency.
