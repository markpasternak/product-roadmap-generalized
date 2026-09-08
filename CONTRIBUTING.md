# Contributing

Use an issue to describe a bug or a proposed improvement. For larger changes, explain the intended behavior before opening a pull request. Keep changes focused and include a screenshot for visible UI changes.

## Development

Follow the [local setup](README.md#run-locally), create a branch, and make the smallest useful change. Run the frontend checks listed in the README. Run the Go race tests and vet for editing-service changes. Add tests for changed behavior, especially publication, authentication, conflicts and resource permissions.

## Keep the showcase fictional

Never copy corporate roadmaps, real customer information, private documents or upstream Git history into this repository. Screenshots must show the fictional dataset without account details or credentials. Keep generated browser sessions, logs, build output and local environment files out of Git.

Changes to shared application code must preserve the showcase's own product names, artwork and deployment configuration. Source files and generated output are checked by `node site/scripts/check-demo.mjs`.

## Pull requests

Explain the problem, the resulting behavior, and the checks you ran. UI changes should cover light/dark themes and a narrow viewport. Changes to item or resource formats must account for existing Git content and baked snapshots.

Only submit material you are entitled to publish. This repository currently has no repository-wide open-source license; do not assume an additional license grant when contributing or reusing code.

Report suspected vulnerabilities privately through [the security process](SECURITY.md), not a public issue.
