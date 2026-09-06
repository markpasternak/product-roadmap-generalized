// Full client-side pre-flight validation (U5, R6, KTD5).
//
// The lockstep target is `ValidateFrontmatter` in `edit-service/items.go` — the ACTUAL
// sync-time gate `buildFiles` calls before committing (see sync.go:226) — NOT the CI-only
// `tooling/validate_items.py`, which never runs in the edit-service request path. This module
// mirrors that function's rules field-by-field so a bad value is named before Sync ever sends
// it, instead of 422ing the whole bundle (or landing and breaking the build). See
// validate.test.ts for the lockstep test that reads items.go's actual source and pins its
// rule set, so a future change there that isn't mirrored here is caught.
//
// Two rules below are NOT mirrors — `ValidateFrontmatter` (and the CI script) has no
// equivalent check for either: tag format and YAML-safety. Both are authored fresh,
// client-only.
import { PRODUCTS, HORIZONS, STAGES, LEVELS, VISIBILITIES } from '../schema';

export interface FieldError {
  /** The item's id — a real id (`ARTISTS-001`) for an updated item, or a client-only temp id
   *  (`new-1`) for a not-yet-synced created item. */
  id: string;
  field: string;
  message: string;
}

interface ChangesetUpdated {
  id: string;
  frontmatter: Record<string, string>;
  body?: string;
}
interface ChangesetCreated {
  id: string;
  product: string;
  title: string;
  frontmatter?: Record<string, string>;
}
/** The subset of `store.ts`'s `changeset()` shape this module needs — deletes and reorders
 *  carry no frontmatter to validate. */
export interface ValidatableChangeset {
  updated: ChangesetUpdated[];
  created: ChangesetCreated[];
}

const ENUMS: Record<string, readonly string[]> = {
  product: PRODUCTS,
  horizon: HORIZONS,
  stage: STAGES,
  impact: LEVELS,
  effort: LEVELS,
  visibility: VISIBILITIES,
};
const ENUM_NOUN: Record<string, string> = {
  product: 'product',
  horizon: 'horizon',
  stage: 'stage',
  impact: 'level',
  effort: 'level',
  visibility: 'visibility',
};

// --- Mirrored rule set (see items.go:53-95) -------------------------------------------------
//
// `ValidateFrontmatter` enforces two shapes of rule:
//   - REQUIRED, no `v != ""` guard: id, product, horizon, stage, title, owner. Empty always
//     fails... UNLESS a server-side default already filled it in first. `buildFiles`'s create
//     path (sync.go:150-167) defaults `stage` -> "Discovery" and `owner` -> "Unassigned" when
//     empty, BEFORE calling ValidateFrontmatter — so an empty stage/owner never actually fails
//     validation for a create. No such default runs on the update path, so an update that
//     explicitly clears stage/owner DOES fail. `title` and `horizon` get no default on either
//     path, so they're unconditionally required.
//   - OPTIONAL, guarded by `v != ""`: impact, effort, visibility. Empty always passes,
//     regardless of create/update; non-empty must be a valid enum member.
export const MIRRORED_ENUM_FIELDS = ['product', 'horizon', 'stage', 'impact', 'effort', 'visibility'] as const;
export const MIRRORED_REQUIRED_TEXT_FIELDS = ['title', 'owner'] as const;
// Enum fields that get a create-only server default when empty, so an empty value only fails
// validation on the update path (see comment above). (`product`/`horizon` get no default on
// either path, so they fall through to the unconditional-required branch below.)
const CREATE_DEFAULTED_ENUM = new Set(['stage']);
// Enum fields ValidateFrontmatter never requires (optional, `v != ""` guarded).
const OPTIONAL_ENUM = new Set(['impact', 'effort', 'visibility']);
// Required text (non-enum) fields with a create-only server default. (`title` gets no default
// on either path, so it falls through to the unconditional-required branch below.)
const CREATE_DEFAULTED_TEXT = new Set(['owner']);

// Rules ValidateFrontmatter enforces that are intentionally NOT mirrored here: the client
// never sends an id or a file path (a create's id/path are server-assigned via `NextID` /
// `FilePath`; an update's id is fixed and isn't user-editable), so there is no client-supplied
// value that could go wrong on these axes. Exported so the lockstep test can assert this
// exclusion is deliberate, not an oversight.
export const SERVER_ONLY_UNMIRRORED_RULES = [
  'id must match PREFIX-NNN',
  'id prefix must match product',
  'file must be in the product folder',
  'filename must start with the id',
] as const;

function enumError(id: string, field: string, value: string): FieldError {
  return { id, field, message: `${field} "${value}" isn't a valid ${ENUM_NOUN[field]}` };
}
function requiredError(id: string, field: string): FieldError {
  return { id, field, message: `${field} is required` };
}

function checkEnumField(
  errors: FieldError[],
  id: string,
  field: string,
  value: string,
  present: boolean,
  isCreate: boolean,
) {
  if (!present) return;
  const v = value.trim();
  if (v === '') {
    if (OPTIONAL_ENUM.has(field)) return;
    if (isCreate && CREATE_DEFAULTED_ENUM.has(field)) return; // server fills a default first
    errors.push(requiredError(id, field));
    return;
  }
  const set = ENUMS[field];
  if (set && !set.includes(v)) errors.push(enumError(id, field, v));
}

function checkRequiredTextField(
  errors: FieldError[],
  id: string,
  field: string,
  value: string,
  present: boolean,
  isCreate: boolean,
) {
  if (!present) return;
  if (value.trim() === '') {
    if (isCreate && CREATE_DEFAULTED_TEXT.has(field)) return; // server defaults owner
    errors.push(requiredError(id, field));
  }
}

// --- Client-only: tag format (no server rule mirrors this) -------------------------------
//
// A well-formed `tags` value is a comma-separated list of lowercase, hyphenated tokens (an
// optional `theme:` prefix is allowed — see site/src/lib/items.ts's parseTags, the reader for
// this same field) with no empty entries from a stray/doubled/trailing comma.
const TAG_TOKEN_RE = /^(theme:)?[a-z0-9][a-z0-9-]*$/;

function checkTagsFormat(errors: FieldError[], id: string, raw: string) {
  if (raw.trim() === '') return; // no tags is fine
  const parts = raw.split(',').map((t) => t.trim());
  for (const part of parts) {
    if (part === '') {
      errors.push({ id, field: 'tags', message: 'tags has an empty entry — check for a stray or doubled comma' });
      return;
    }
    if (!TAG_TOKEN_RE.test(part)) {
      errors.push({ id, field: 'tags', message: `tag "${part}" must be lowercase letters, numbers, and hyphens only` });
      return;
    }
  }
}

// --- Client-only: YAML safety (no server rule mirrors this) ------------------------------
//
// `edit-service/frontmatter.go`'s writer (yamlScalar/needsYAMLQuoting) leaves a value
// unquoted, keeping its literal on-disk form, whenever it looks like a YAML number/bool/null
// (`plainScalarLookalike`) — correct for a genuinely numeric field like `order`, but a footgun
// for a free-text field: a title of "2024" or an owner of "true" round-trips fine through the
// edit-service's own hand-rolled reader/writer, but a real YAML parser (js-yaml, which the
// published Astro site actually uses to read content) reads the resulting `title: 2024` line
// as a NUMBER, not a string — silently breaking the site's Zod `z.string()` schema at build
// time, well after Sync has already "succeeded". Flag it pre-flight instead.
const YAML_SCALAR_LOOKALIKE_RE = /^-?[0-9]+(\.[0-9]+)?$|^(true|false|null|yes|no|on|off)$/i;

function checkYamlSafety(errors: FieldError[], id: string, field: string, raw: string) {
  const v = raw.trim();
  if (v === '') return;
  if (YAML_SCALAR_LOOKALIKE_RE.test(v)) {
    errors.push({
      id,
      field,
      message: `${field} "${v}" reads as a number/boolean, not text — rename it so it isn't written as one`,
    });
  }
}

interface FieldSource {
  (field: string): { value: string; present: boolean };
}

function validateItem(errors: FieldError[], id: string, isCreate: boolean, get: FieldSource) {
  for (const field of MIRRORED_ENUM_FIELDS) {
    const { value, present } = get(field);
    checkEnumField(errors, id, field, value, present, isCreate);
  }
  for (const field of MIRRORED_REQUIRED_TEXT_FIELDS) {
    const { value, present } = get(field);
    checkRequiredTextField(errors, id, field, value, present, isCreate);
  }
  const tags = get('tags');
  if (tags.present) checkTagsFormat(errors, id, tags.value);

  // YAML-safety only applies to the free-text fields (title/owner/tags) — every other field
  // this module validates is enum-constrained to known-safe strings, so it can never trip a
  // YAML-scalar-lookalike check.
  for (const field of ['title', 'owner', 'tags'] as const) {
    const { value, present } = get(field);
    if (present) checkYamlSafety(errors, id, field, value);
  }
}

/**
 * Validates every `updated` and `created` item in a changeset against the same rules
 * `ValidateFrontmatter` (edit-service/items.go) enforces at Sync time, plus the client-only
 * tag-format and YAML-safety checks. Returns one {id, field, message} entry per violation, or
 * `[]` if the changeset is clean.
 *
 * Mirrors `changeset()`'s own philosophy for `updated` items (see store.ts's owner check this
 * replaces): a field is only checked when the pending frontmatter patch actually touches it —
 * an item's OTHER, untouched fields already passed this same gate on a prior Sync (or came
 * from content that passed CI), so re-validating them here would just be re-deriving what's
 * already true. `created` items have no prior state, so every field is checked unconditionally
 * (a missing key reads as "").
 */
export function validateChangeset(cs: ValidatableChangeset): FieldError[] {
  const errors: FieldError[] = [];
  for (const c of cs.created) {
    const fm = c.frontmatter ?? {};
    const get: FieldSource = (field) => {
      if (field === 'product') return { value: c.product ?? '', present: true };
      if (field === 'title') return { value: c.title ?? '', present: true };
      return { value: fm[field] ?? '', present: true };
    };
    validateItem(errors, c.id, true, get);
  }
  for (const u of cs.updated) {
    const fm = u.frontmatter ?? {};
    const get: FieldSource = (field) => ({ value: fm[field] ?? '', present: field in fm });
    validateItem(errors, u.id, false, get);
  }
  return errors;
}
