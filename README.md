# Forex API daily

Daily European Central Bank web‑scraper that extracts FX rates, computes cross rates, and stores them in Firestore. Exposed as an HTTP Cloud Function (`main`).

## Requirements
- Node.js 22 (see `.nvmrc`). If your shell selects a different version, run `nvm use`.
- PNPM as the package manager (recommend `corepack enable && corepack install`).

## Setup
```sh
pnpm install
```

## Common Commands
- Build: `pnpm compile` (TypeScript → `index.js`).
- Lint/format: `pnpm lint`, `pnpm format` (use `pnpm lint --fix` to auto‑fix).
- Start locally: `GCP_PROJECT_ID=forex-api-daily pnpm start` (Functions Framework on `http://localhost:8081/main`).
- Test: `pnpm test` (runs Vitest; may use Firestore emulator if configured). If you hit PNPM migration issues with lifecycle scripts, run build/lint directly and let us know to update scripts.

## How It Works
- Fetch: Scrapes ECB RSS endpoints to gather daily EUR base rates.
- Process: Combines latest day’s rates and derives cross rates for other bases.
- Store: Writes documents to the `exchange_rates` collection; periodically removes stale dates.

## CI/CD
- GitHub Actions (`.github/workflows/ci.yml`) runs tests on push. Deploys from `main` to Cloud Functions using repo secrets for GCP.

## Notes
- Do not commit credentials. Files like `.env` and `service-account.json` are ignored by Git.
- The compiled `index.js` is generated; avoid committing build artifacts.
