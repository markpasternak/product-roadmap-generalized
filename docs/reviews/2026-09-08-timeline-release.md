# Timeline release review

## Scope

Add optional planned start/end dates and a Board / Timeline switch using the same items, filters, editor, draft and Git publication flow. Timeline supports product, owner, tag, stage and ungrouped rows, calendar navigation, fit-to-items, and unique omission counts. Saved views preserve layout and timeline settings; shared snapshots preserve the resolved date window and exclude private grouping information.

## Standards review

Reviewed the change against the repository's existing Vue, schema, projection, validation and sharing boundaries. No remaining blocking findings. No dependencies added. Shared rendering uses the same timeline model and stylesheet as the application. Calendar values are date-only; frontend, backend and content validation reject invalid or reversed ranges. No company item dates were invented.

## Specification review

All first-version requirements are implemented. Items need both dates before they are plotted. Missing dates and valid dates outside the window are distinguished and reviewable. Multi-tag grouping duplicates rows but not overall counts. Dates never change horizon or stage. Short bars keep their accessible labels, and item titles remain available in a fixed column. Date editing uses the existing item editor; drag rescheduling, milestones and dependencies remain outside this first version.

## Verification

- 912 frontend tests pass in each version, including date validation, grouping, saved views, projections, editor changes and shared rendering.
- Both type checks, production builds, content validators and backend race suites pass.
- Browser checks cover layout restoration, grouping, fit-to-items, missing-date review, opening details, saved-view reset/removal, dark appearance and a 390px viewport without page overflow.
- Standalone share checked in the browser: horizon filtering updates counts, empty groups disappear, and outside-period items remain reviewable and open the normal detail dialog.
- Temporary QA routes removed before production builds.
- Music showcase contains illustrative dates on 15 fictional items; company content remains unchanged.
