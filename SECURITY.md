# Security

## Report a vulnerability

Use GitHub's **Report a vulnerability** action in this repository's Security tab. Include the affected commit, reproduction steps, impact and a suggested fix if available. Do not put access tokens, account data or private roadmap content in public issues or pull requests.

## Deployment boundaries

- The static site contains everything included at build time. Its UI filters are not access control.
- A public repository exposes committed content and reachable Git history, including items labeled Internal. Use a separate private repository for confidential work.
- `PUBLIC_` environment variables are shipped to browsers. Store GitHub App private keys, client secrets, session secrets and deployment tokens on the server or in Actions secrets.
- Editing requires repository write access. An authenticated visitor without write access must remain a viewer.
- A seven-day roadmap session is separate from GitHub's token lifetime. Keep server state private and use HTTPS outside local development.
- Deleting an attachment from the current tree does not remove historical copies or existing snapshots.
- The Go service uses process-local publication locks: run one writable instance for a state directory.

## Maintenance

The maintained branch is `main`. CI scans Git history with Gitleaks. Two exact historical CSS-string false positives are documented in `.gitleaksignore`; no paths or credential families are broadly excluded. Dependency update proposals are tracked with Dependabot.

The public-release review covers committed files and history, workflow logs, configuration and fictional content. It is not a guarantee that the application has no vulnerabilities. Re-run dependency audits and tests before deploying. The September 2026 release upgrades Astro, Vite, Vitest, Zod and the DOM test environment; its full npm dependency audit reported zero known vulnerabilities. Do not expose development or preview servers as production services.

## Main branch protection

Normal changes require a pull request, resolved review conversations and a passing GitHub Actions `check` against the current main branch. Main cannot be deleted or force-pushed, and merges use a linear history. The dedicated Roadmap Demo Editor GitHub App may bypass the PR and check requirements to publish validated content from the application; it cannot bypass the history rules. Human pushes and other installed apps do not receive that exception.
