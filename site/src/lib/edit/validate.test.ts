import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  validateChangeset,
  MIRRORED_ENUM_FIELDS,
  MIRRORED_REQUIRED_TEXT_FIELDS,
  SERVER_ONLY_UNMIRRORED_RULES,
  type ValidatableChangeset,
} from './validate';

// A changeset with no updated/created entries at all is trivially clean — most tests below
// build a minimal one-item changeset instead via these helpers.
const updated = (id: string, frontmatter: Record<string, string>): ValidatableChangeset => ({
  updated: [{ id, frontmatter, body: '' }],
  created: [],
});
const created = (product: string, title: string, frontmatter: Record<string, string> = {}): ValidatableChangeset => ({
  updated: [],
  created: [{ id: 'new-1', product, title, frontmatter }],
});

describe('validateChangeset — lockstep with ValidateFrontmatter (edit-service/items.go)', () => {
  // KTD5: the lockstep target is ValidateFrontmatter, the ACTUAL sync-time gate buildFiles
  // calls (sync.go:226) — not the CI-only tooling/validate_items.py, which never runs in the
  // edit-service request path. Reading the real Go source here (rather than just asserting
  // against a hand-copied description of it) means a future edit to items.go that changes the
  // rule shape — e.g. dropping the `v != ""` guard on `impact`, making it unexpectedly
  // required — actually fails this test instead of silently drifting from what's mirrored.
  let itemsGoSource: string;
  beforeAll(() => {
    // Resolved via path.resolve (not `new URL(relative, import.meta.url)`) — the test
    // environment's URL base resolution doesn't reliably honor a `file:` base past several
    // `../` segments, so go through fileURLToPath on the un-combined self URL instead.
    const selfPath = fileURLToPath(import.meta.url);
    const itemsGoPath = path.resolve(path.dirname(selfPath), '../../../../edit-service/items.go');
    itemsGoSource = readFileSync(itemsGoPath, 'utf-8');
  });

  it('pins the enum fields ValidateFrontmatter checks against a fixed set (Horizons/Stages/Levels x2/Visibilities)', () => {
    expect(itemsGoSource).toContain('!Horizons[fm["horizon"]]');
    expect(itemsGoSource).toContain('!Stages[fm["stage"]]');
    expect(itemsGoSource).toContain('!Levels[v]'); // impact + effort share this exact guard shape
    expect(itemsGoSource).toContain('!Visibilities[v]');
    expect(itemsGoSource).toContain('ProductFolder[product]'); // product's enum check
    expect(MIRRORED_ENUM_FIELDS).toEqual(['product', 'horizon', 'stage', 'impact', 'effort', 'visibility']);
  });

  it('pins horizon and stage as UNCONDITIONALLY required (no `v != ""` guard, unlike impact/effort/visibility)', () => {
    // horizon/stage are checked directly against the map with no emptiness guard in front —
    // if a future change added a `v != ""` guard (making it optional, like impact/effort), this
    // exact substring would disappear and this assertion would catch it.
    expect(itemsGoSource).toContain('if !Horizons[fm["horizon"]] {');
    expect(itemsGoSource).toContain('if !Stages[fm["stage"]] {');
  });

  it('pins impact/effort/visibility as guarded-optional (`v != "" && !Set[v]`)', () => {
    expect(itemsGoSource).toMatch(/if v := fm\["impact"\]; v != "" && !Levels\[v\]/);
    expect(itemsGoSource).toMatch(/if v := fm\["effort"\]; v != "" && !Levels\[v\]/);
    expect(itemsGoSource).toMatch(/if v := fm\["visibility"\]; v != "" && !Visibilities\[v\]/);
  });

  it('pins title and owner as required-if-blank, with no enum set behind them', () => {
    expect(itemsGoSource).toContain('strings.TrimSpace(fm["title"]) == ""');
    expect(itemsGoSource).toContain('strings.TrimSpace(fm["owner"]) == ""');
    expect(MIRRORED_REQUIRED_TEXT_FIELDS).toEqual(['title', 'owner']);
  });

  it('confirms `order` has NO rule in ValidateFrontmatter (so it is deliberately not mirrored, despite appearing in prose elsewhere)', () => {
    // ValidateFrontmatter never reads fm["order"] at all — order is only validated by the
    // CI-only tooling/validate_items.py (a positive-integer check), which never runs in the
    // edit-service Sync path. If a future items.go change starts checking order, this
    // assertion (there is no `fm["order"]` reference in the function body) will fail.
    const fnStart = itemsGoSource.indexOf('func ValidateFrontmatter');
    const fnBody = itemsGoSource.slice(fnStart, itemsGoSource.indexOf('\n}', fnStart));
    expect(fnBody).not.toContain('fm["order"]');
  });

  it('pins the id/filename/folder rules as present in items.go but deliberately unmirrored (the client never sends an id or path)', () => {
    expect(itemsGoSource).toContain('idRe.MatchString(id)');
    expect(itemsGoSource).toContain('strings.HasPrefix(id, ProductPrefix[product]+"-")');
    expect(itemsGoSource).toContain('file not in product folder');
    expect(itemsGoSource).toContain('filename must start with id');
    expect(SERVER_ONLY_UNMIRRORED_RULES).toHaveLength(4);
  });
});

describe('validateChangeset — per-field failures', () => {
  it('flags an invalid horizon enum value, naming the item and field', () => {
    const errs = validateChangeset(updated('TALK-1', { horizon: 'Sonn' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'horizon', message: 'horizon "Sonn" isn\'t a valid horizon' }]);
  });

  it('flags an invalid stage enum value', () => {
    const errs = validateChangeset(updated('TALK-1', { stage: 'Nope' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'stage', message: 'stage "Nope" isn\'t a valid stage' }]);
  });

  it('flags an invalid product enum value', () => {
    const errs = validateChangeset(updated('TALK-1', { product: 'Not A Product' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'product', message: 'product "Not A Product" isn\'t a valid product' }]);
  });

  it('flags an invalid visibility enum value', () => {
    const errs = validateChangeset(updated('TALK-1', { visibility: 'Secret' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'visibility', message: 'visibility "Secret" isn\'t a valid visibility' }]);
  });

  it('flags an invalid impact enum value', () => {
    const errs = validateChangeset(updated('TALK-1', { impact: 'Extreme' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'impact', message: 'impact "Extreme" isn\'t a valid level' }]);
  });

  it('flags an invalid effort enum value', () => {
    const errs = validateChangeset(updated('TALK-1', { effort: 'Extreme' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'effort', message: 'effort "Extreme" isn\'t a valid level' }]);
  });

  it('does not flag empty impact/effort/visibility — these are truly optional, matching the `v != ""` guard', () => {
    expect(validateChangeset(updated('TALK-1', { impact: '', effort: '', visibility: '' }))).toEqual([]);
    expect(
      validateChangeset(created('Music App', 'A title', { horizon: 'Now', impact: '', effort: '', visibility: '' })),
    ).toEqual([]);
  });

  it('flags a missing/blank required title on a created item', () => {
    const errs = validateChangeset(created('Music App', '   ', { horizon: 'Now' }));
    expect(errs).toEqual([{ id: 'new-1', field: 'title', message: 'title is required' }]);
  });

  it('flags a required title explicitly cleared on an updated item (no create-only default applies to updates)', () => {
    const errs = validateChangeset(updated('TALK-1', { title: '  ' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'title', message: 'title is required' }]);
  });

  it('flags an owner cleared on an updated item', () => {
    const errs = validateChangeset(updated('TALK-1', { owner: '   ' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'owner', message: 'owner is required' }]);
  });

  it('does NOT flag a missing/blank owner on a created item — the server defaults creates to "Unassigned"', () => {
    expect(validateChangeset(created('Music App', 'A title', { horizon: 'Now', owner: '' }))).toEqual([]);
    expect(validateChangeset(created('Music App', 'A title', { horizon: 'Now' }))).toEqual([]);
  });

  it('does NOT flag a missing/blank stage on a created item — the server defaults creates to "Discovery"', () => {
    expect(validateChangeset(created('Music App', 'A title', { horizon: 'Now', stage: '' }))).toEqual([]);
  });

  it('DOES flag a stage explicitly cleared on an updated item — no default applies to updates', () => {
    const errs = validateChangeset(updated('TALK-1', { stage: '' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'stage', message: 'stage is required' }]);
  });

  it('flags a missing horizon on a created item — horizon has no server default on either path', () => {
    const errs = validateChangeset(created('Music App', 'A title', { stage: 'Discovery' }));
    expect(errs).toEqual([{ id: 'new-1', field: 'horizon', message: 'horizon is required' }]);
  });

  it('only validates fields an update patch actually touches (untouched fields are assumed already-valid)', () => {
    // No horizon/stage/product/title/owner key at all in the patch — nothing to flag, even
    // though none of those fields' real values are known here.
    expect(validateChangeset(updated('TALK-1', { tags: 'roadmap, ai' }))).toEqual([]);
  });

  it('flags a malformed tags value — uppercase characters', () => {
    const errs = validateChangeset(updated('TALK-1', { tags: 'Roadmap, ai' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'tags', message: 'tag "Roadmap" must be lowercase letters, numbers, and hyphens only' }]);
  });

  it('flags a malformed tags value — empty entry from a doubled comma', () => {
    const errs = validateChangeset(updated('TALK-1', { tags: 'roadmap,, ai' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'tags', message: 'tags has an empty entry — check for a stray or doubled comma' }]);
  });

  it('flags a malformed tags value — trailing comma', () => {
    const errs = validateChangeset(updated('TALK-1', { tags: 'roadmap,' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'tags', message: 'tags has an empty entry — check for a stray or doubled comma' }]);
  });

  it('accepts well-formed comma-separated lowercase tags, including a theme: prefix', () => {
    expect(validateChangeset(updated('TALK-1', { tags: 'roadmap, ai-tools, theme:one-view' }))).toEqual([]);
  });

  it('accepts an empty tags value (no tags is fine)', () => {
    expect(validateChangeset(updated('TALK-1', { tags: '' }))).toEqual([]);
  });

  it('flags a YAML-unsafe title that would round-trip as a number, not a string', () => {
    const errs = validateChangeset(updated('TALK-1', { title: '2024' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'title', message: 'title "2024" reads as a number/boolean, not text — rename it so it isn\'t written as one' }]);
  });

  it('flags a YAML-unsafe owner that would round-trip as a boolean', () => {
    const errs = validateChangeset(updated('TALK-1', { owner: 'true' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'owner', message: 'owner "true" reads as a number/boolean, not text — rename it so it isn\'t written as one' }]);
  });

  it('flags a YAML-unsafe tags value even though it is well-formed by the tag-format rule (both checks are independent)', () => {
    const errs = validateChangeset(updated('TALK-1', { tags: 'true' }));
    expect(errs).toEqual([{ id: 'TALK-1', field: 'tags', message: 'tags "true" reads as a number/boolean, not text — rename it so it isn\'t written as one' }]);
  });

  it('does not flag a normal-looking title/owner/tags value', () => {
    expect(
      validateChangeset(updated('TALK-1', { title: 'Music App Templates', owner: 'Mark', tags: 'roadmap, ai-tools' })),
    ).toEqual([]);
  });

  it('a fully-valid changeset (updated + created) validates clean', () => {
    const cs: ValidatableChangeset = {
      updated: [
        { id: 'TALK-1', frontmatter: { horizon: 'Now', stage: 'Building', owner: 'Mark', impact: 'High' }, body: '' },
      ],
      created: [
        { id: 'new-1', product: 'Music App', title: 'New idea', frontmatter: { horizon: 'Next', stage: 'Discovery' } },
      ],
    };
    expect(validateChangeset(cs)).toEqual([]);
  });

  it('an empty changeset validates clean', () => {
    expect(validateChangeset({ updated: [], created: [] })).toEqual([]);
  });

  it('groups multiple violations on the same item under that item’s id', () => {
    const errs = validateChangeset(updated('TALK-1', { horizon: 'Sonn', owner: '  ' }));
    expect(errs).toHaveLength(2);
    expect(errs).toContainEqual({ id: 'TALK-1', field: 'horizon', message: 'horizon "Sonn" isn\'t a valid horizon' });
    expect(errs).toContainEqual({ id: 'TALK-1', field: 'owner', message: 'owner is required' });
  });

  it('reports violations across multiple items independently', () => {
    const cs: ValidatableChangeset = {
      updated: [{ id: 'TALK-1', frontmatter: { horizon: 'Sonn' }, body: '' }],
      created: [{ id: 'new-1', product: 'Music App', title: '', frontmatter: { horizon: 'Now' } }],
    };
    const errs = validateChangeset(cs);
    expect(errs).toContainEqual({ id: 'TALK-1', field: 'horizon', message: 'horizon "Sonn" isn\'t a valid horizon' });
    expect(errs).toContainEqual({ id: 'new-1', field: 'title', message: 'title is required' });
  });
});
