# Repository Guidelines

## Agent Execution Requirements

- Always validate locally before declaring completion.
- Only claim a task is complete when all quality checks are green: `pnpm compile`, `pnpm test`, and `pnpm lint` must all pass with zero errors/failures.
- If you cannot run these commands (e.g., sandboxed environment), do not mark the task complete; instead, state what you changed and what remains to be validated.
- When reporting completion, mention which commands were run and confirm their green status.

## Project Structure & Modules

- `index.ts`: Main Cloud Function (HTTP `main`) that scrapes ECB, computes cross rates, and writes to Firestore.
- `index.js`: Compiled output (ignored by Git). Do not commit build artifacts.
- `test/`: Vitest tests, helpers, and XML fixtures (`test/samples/`).
- Config: `tsconfig*.json`, `eslint.config.mjs`, `babel.config.js`, `.editorconfig`, `.nvmrc`, `.github/workflows/ci.yml`.

## Build, Test, and Development

- Package manager: PNPM. Install dependencies with `pnpm install` (recommend `corepack enable`).
- Node version: if a different Node.js version is active, run `nvm use` to switch to the version from `.nvmrc`.
- `pnpm compile`: Compile TypeScript using `tsconfig.build.json` to `index.js`.
- `pnpm test`: Run Vitest (can be wrapped with Firestore emulator if configured), then lint.
- `pnpm start`: Run locally with Functions Framework on `:8081`.
  Example: `GCP_PROJECT_ID=forex-api-daily pnpm start`
- Lint/format: `pnpm lint`, `pnpm format`, or `pnpm lint --fix`.
- `pnpm clean`: Remove `node_modules` and build output.

## Coding Style & Naming

- Indentation: 2 spaces (`.editorconfig`). Node `22` (`.nvmrc`).
- TypeScript: strict mode; prefer explicit types for public APIs.
- Linting: ESLint (flat config) with `typescript-eslint` + Prettier.
- Naming: camelCase for vars/functions, PascalCase for classes, UPPER_SNAKE_CASE for constants.
- Tests: `*.test.ts` under `test/`.

## Testing Guidelines

- Framework: Vitest.
- Location: `test/**/*.ts`; fixtures in `test/samples/`.
- Run: `pnpm test` (may run under Firestore emulator if configured). Tests start a local Functions Framework instance with `TEST=1` to read fixtures.
- Aim for fast, deterministic tests that validate Firestore writes and response payloads.

## Commit & Pull Requests

- Commits: concise, imperative subject (≤72 chars). Example: "Add Firestore cleanup for stale dates".
- PRs: include summary, rationale, verification steps (commands), and linked issues.
- Requirements: CI must pass (`pnpm test`). Do not commit secrets or build artifacts.
- Screenshots/logs: include only when clarifying behavior or responses.

## Security & Configuration

- Env: `GCP_PROJECT_ID` required for local run and deploy. Never commit credentials; `.env` and `service-account.json` are ignored.
- CI: GitHub Actions tests on every push; deploys from `main` using `google-github-actions` with repo secrets.
- Firestore: Writes to `exchange_rates` collection; data cleanup removes stale dates in batches.
