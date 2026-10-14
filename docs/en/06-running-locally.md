# 6. Running locally

[Docs index](../README.md) · Previous: [Analyzer and shared packages](05-analyzer-and-shared.md)

## Prerequisites

| Tool | Version | Required? | Check with |
|---|---|---|---|
| Node.js | 22 or newer | Yes | `node -v` |
| Docker Desktop | any recent | Yes, for PostgreSQL and Redis | `docker ps` |
| git | any recent | Yes | `git --version` |
| Semgrep | any recent | Optional: without it, Semgrep shows as *Skipped* | `semgrep --version` |
| Gitleaks | 8.x | Optional: without it, Gitleaks shows as *Skipped* | `gitleaks version` |

## First-time setup

Run from the repository root:

```bash
cp .env.example .env                  # 1. create your local settings
npm install                           # 2. install dependencies for all four projects
npm run infra:up                      # 3. start PostgreSQL and Redis in Docker
npm run prisma:migrate                # 4. create the database tables
npm run build -w @debtmap/shared      # 5. build the shared packages,
npm run build -w @debtmap/analyzer    #    which the apps import compiled
```

Then add a GitHub token to `.env` (see below). It is optional, but without one you will hit GitHub's limit after a few analyses.

## Every day

Two terminals, both at the repository root:

```bash
npm run dev:api     # terminal 1: backend on http://localhost:3100
npm run dev:web     # terminal 2: frontend on http://localhost:4200
```

Open http://localhost:4200. If Docker was restarted, run `npm run infra:up` first.

**Quick check:** http://localhost:3100/api/health should return `{"status":"ok", …}`.

## When to run what

| You did this | Then run |
|---|---|
| Pulled changes that touch `prisma/schema.prisma` or add a migration | `npm run prisma:migrate` |
| Pulled changes in `packages/shared` or `packages/analyzer` | Rebuild them (step 5 above), then restart the API |
| Pulled changes that touch any `package.json` | `npm install` |
| Edited `.env` | Restart the API |
| Want to start over with an empty database | `npm run infra:reset`, then `npm run prisma:migrate`. **This deletes all data.** |

## Environment variables

All of them live in `.env` at the repository root.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | |
| `PORT` | `3100` | API port. If you change it, change `apps/web/proxy.conf.json` to match. |
| `CORS_ORIGINS` | `http://localhost:4200` | Comma-separated origins allowed to call the API |
| `DATABASE_URL` | local Docker Postgres | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `GITHUB_TOKEN` | empty | A GitHub personal access token. No scopes are needed for public repositories. Without it: 60 GitHub requests per hour. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | empty / `gemini-2.5-flash-lite` | For AI explanations (milestone M3, not built yet) |
| `MAX_FILES` | `5000` | Above this, only the largest files are analysed |
| `MAX_REPO_SIZE_MB` | `1024` | Larger repositories are rejected before cloning |
| `CLONE_TIMEOUT_MS` | `300000` | 5 minutes |
| `CHURN_WINDOW_MONTHS` | `24` | How far back git history counts towards churn |
| `SECURITY_SOURCES` | `semgrep,gitleaks,osv` | Remove a scanner from this list to switch it off. It is then shown as *Skipped*. |
| `SEMGREP_TIMEOUT_MS`, `GITLEAKS_TIMEOUT_MS`, `OSV_TIMEOUT_MS` | 10 / 5 / 2 minutes | Per-scanner time limits |
| `SEMGREP_CONFIG` | empty | Comma-separated Semgrep rulesets or rule-file paths. Empty means `p/security-audit`, `p/javascript`, `p/typescript`, downloaded from semgrep.dev. |
| `WORKSPACE_DIR` | `.debtmap-workspace` | Where repositories are cloned temporarily |
| `AI_*`, `DAILY_REPO_BUDGET` | | Daily limits that keep usage inside free tiers |

## Installing the scanners (Windows)

**Gitleaks:**

```powershell
winget install --id Gitleaks.Gitleaks -e --source winget
```

(`--source winget` avoids an error from the Microsoft Store source.)

**Semgrep**, in its own Python virtual environment so its libraries do not mix with your main Python:

```powershell
python -m venv $env:USERPROFILE\.venvs\semgrep
& $env:USERPROFILE\.venvs\semgrep\Scripts\python.exe -m pip install semgrep
```

Then append `%USERPROFILE%\.venvs\semgrep\Scripts` to the **end** of your user `PATH`, so your main `python` still takes precedence.

**After installing either one, open a new terminal** (and restart VS Code if you start the API from its terminal). A program that is already running does not see `PATH` changes.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Semgrep *Skipped*: "semgrep is not installed" | Not on the `PATH` of the process running the API | Install it as above, then restart the terminal and the API |
| Semgrep *Failed*: "exit 2: Unexpected end of JSON input" | Semgrep could not download its rules. Behind a filtering proxy that inspects HTTPS (NetFree, for example), Python 3.13+ rejects the proxy's certificate (`CERTIFICATE_VERIFY_FAILED … key usage extension`), even though browsers and curl accept it. | Download the rules once with curl and point `SEMGREP_CONFIG` at the files (see below) |
| OSV *Failed*: "OSV responded 418" | The network filter blocks `api.osv.dev` | Nothing to fix in DebtMap. Ask for the domain to be unblocked, or remove `osv` from `SECURITY_SOURCES`. |
| OSV *Skipped*: "no package-lock.json" | The analysed repository has no npm lockfile | Expected. OSV only reads `package-lock.json`. |
| Every analysis fails with `Use of "GIT_ASKPASS" is not permitted` | An older analyzer build, started from a VS Code terminal (VS Code sets `GIT_ASKPASS`) | Fixed in `packages/analyzer/src/clone.ts`. Rebuild the analyzer and restart the API. |
| A large repository restarts from the beginning, or the progress bar goes backwards | Older builds: a long parse blocked the worker, its queue lock expired, and BullMQ re-ran the job | Fixed: the lock lasts 5 minutes, a stalled job fails instead of re-running, and files over 1 MB are skipped |
| A run that was in progress when the API stopped shows "interrupted by a server restart" | The API marks such runs as failed when it starts | Run the analysis again |
| "Changes" column is 0 for every file | No commits in the last `CHURN_WINDOW_MONTHS` | Expected for inactive repositories |
| GitHub rate-limit error | No `GITHUB_TOKEN` and 60 requests used this hour | Add a token to `.env` |
| API fails to start: `Invalid environment configuration` | A required variable is missing or invalid | The message names the variable. Compare with `.env.example`. |
| API cannot reach the database or Redis | Docker containers are not running | `npm run infra:up` |
| Errors about missing tables or columns | The database is behind the schema | `npm run prisma:migrate` |
| API errors importing `@debtmap/analyzer` or `@debtmap/shared` | The packages were never built, or are out of date | Rebuild them (setup step 5) |
| Port 3100 or 4200 already in use | An old server is still running | Stop it, or kill the process listening on that port |

### Semgrep rules as local files

```bash
mkdir -p ~/.semgrep-rules
curl -o ~/.semgrep-rules/security-audit.yml https://semgrep.dev/c/p/security-audit
curl -o ~/.semgrep-rules/javascript.yml     https://semgrep.dev/c/p/javascript
curl -o ~/.semgrep-rules/typescript.yml     https://semgrep.dev/c/p/typescript
```

And in `.env` (use your own user folder):

```
SEMGREP_CONFIG=C:/Users/<you>/.semgrep-rules/security-audit.yml,C:/Users/<you>/.semgrep-rules/javascript.yml,C:/Users/<you>/.semgrep-rules/typescript.yml
```

This also makes scans repeatable: the rules change only when you download them again.

## Tests

```bash
npm test                          # every workspace
npm test -w @debtmap/analyzer     # one workspace
```

`apps/web` has no unit tests yet, so the root `npm test` exits with an error on that workspace even when every other test passes.

## Useful tools

| Command | Opens |
|---|---|
| `npm run prisma:studio` | A browser UI for browsing and editing database rows |
| `npm run analyze -- <url> --top 15` | The engine alone, printing the top 15 files to the terminal |
| `docker compose logs -f postgres` | Database logs |
