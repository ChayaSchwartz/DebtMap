# DebtMap

Paste a public GitHub repository. DebtMap ranks its files by **security exposure** and **bug-proneness**, and explains why.

The two dimensions are reported separately and never merged into one number. A file holding a leaked credential and a file that is merely hard to change are different problems with different owners and different fixes; averaging them produces a score that means nothing and hides both.

---

## Layout

Full developer documentation, in English and Hebrew, is in [docs/](docs/README.md).

```
apps/
  api/        NestJS + BullMQ worker, running in one process
  web/        Angular 21, standalone components, signals, bilingual (en/he)
packages/
  analyzer/   The analysis engine. No framework dependencies.
  shared/     DTOs, scoring rules, and the repository-URL parser
```

`packages/analyzer` is deliberately independent of Nest. It is the highest-risk part of the product, and keeping it framework-free means it can be run and calibrated against real repositories through a local CLI, with no database or queue involved.

---

## Running it locally

Requires Node 22+, Docker, and git.

```bash
cp .env.example .env       # defaults match docker-compose
npm install
npm run infra:up           # Postgres + Redis
npm run prisma:migrate
npm run build -w @debtmap/shared
npm run build -w @debtmap/analyzer

npm run dev:api            # http://localhost:3100
npm run dev:web            # http://localhost:4200
```

`GITHUB_TOKEN` is optional but strongly recommended: without it GitHub allows only 60 API requests per hour per IP, which a handful of analyses exhausts.

### Running the engine on its own

The fastest way to see what the engine produces, and the intended tool for calibrating thresholds:

```bash
npm run analyze -- https://github.com/sindresorhus/got --top 15
```

Add `--no-security` to skip the scanners. Semgrep dominates the wall clock on a large repository, and the bug-proneness thresholds this harness exists to calibrate do not depend on it.

---

## How a run works

1. **Resolve** — parse the URL, then ask the GitHub API whether the repository exists, is public, and is within the size limit. All of this happens *before* anything is downloaded: discovering that a repository is too large by cloning it first is exactly what the limit exists to prevent.
2. **Clone** — full depth, not shallow. Gitleaks can only find a credential that was committed and later removed if the history containing it is present, which is the case most worth catching.
3. **Discover** — `.ts` and `.js` files, excluding installed, generated, and vendored code. Test files are included: they break and get fixed like any other code, and a churning test suite is a signal.
4. **Git metrics** — one pass over `git log --numstat`, aggregated in memory. Running one `git log` per file would mean thousands of process spawns and thousands of history walks.
5. **AST metrics** — `ts-morph` with no type checking. The clone has no `node_modules` and we will never run `npm install` on untrusted code, but complexity and nesting are purely syntactic, so nothing is lost.
6. **Security** — Semgrep over the working tree, Gitleaks over the full history, and OSV.dev over the lockfile. They run one after another rather than together: both binaries are CPU- and IO-bound over the same clone, and on a container that already runs the queue at concurrency 1, overlapping them trades a shorter wall clock for a real chance of an OOM kill that loses the whole analysis. Any scanner that fails, is missing, or is switched off reports its own outcome, and the other two still produce results.
7. **Score** — percentile ranks within the repository, then `0.3 × churn + 0.4 × bugs + 0.3 × complexity`. Security is scored separately, from the worst finding on a file rather than from how many it has.
8. **Explain** *(M3)* — Gemini, for files above the threshold in either dimension.

### Findings that belong to no file

A scanner reports paths; the table reports files, and the two sets do not match. A credential is worth catching precisely when it was committed and later deleted, so its path may not exist at `HEAD` at all; a vulnerable dependency belongs to a lockfile, which is not source code. Neither can hang off a row in the file table.

They are kept as **repository-level findings**, shown in their own panel and folded into the repository security score. Dropping them would leave a repository scoring 90 on security with no file that explains why.

### Two scales, on purpose

Per-file scores are **percentile ranks** — they answer "which files are worst *in this codebase*", which is the right question for ranking.

Repository-level scores are **absolute**, calibrated against fixed reference points. Percentile ranks are uniform by construction, so any aggregate of them lands on roughly the same value for every repository and never moves between runs. A trend line built on ranks would be flat forever.

---

## Security posture

Every analysed repository is untrusted input.

- **`npm install` is never run.** Dependency advisories come from parsing `package-lock.json` as text and querying [OSV.dev](https://osv.dev), which needs no code execution. This deviates from the original spec's `npm audit` and is the single most important decision in the codebase: `npm audit` in its normal form requires an install, which executes `postinstall` scripts from a stranger's repository on our server. OSV also has broader coverage than the advisory database behind `npm audit`.
- **The scanned code is never executed.** `ts-morph` parses; Semgrep and Gitleaks read.
- Git runs with symlinks disabled and the `ext::` transport blocked.
- **Scanners are spawned without a shell.** Their arguments include paths from a stranger's repository, and a shell would turn a filename into a command.
- **Gitleaks runs with `--redact`.** An unredacted report would write live credentials into our database, hand them to anyone holding the share link, and later send them to a model for explanation. The finding says which rule matched and where; it never carries the secret.
- Each scanner has its own timeout and output ceiling, and is killed on either. A scanner that floods stdout is a memory exhaustion vector, not just a slow one.

---

## Known constraints

| Constraint | Detail |
|---|---|
| Gemini free tier | **15 requests/minute**, 1,000/day on Flash-Lite. The per-minute ceiling binds first, so explanations per run are capped rather than only the daily total. |
| Free-tier data use | Gemini's free tier may use inputs for training. Acceptable while only public code is analysed; a hard blocker for private repositories. |
| `MAX_FILES` | An env var by design. Scanner memory use on the deploy target is unverified, and this is the dial that gets turned without a redeploy. |
| Neon scale-to-zero | The first query after a quiet period is slow even though the API never sleeps. `POST /api/health/warmup` moves that delay off the critical path before a live demo. |
| Queue concurrency | Fixed at 1. A 1 GB clone plus a scan over thousands of files is the whole resource budget of a small container. |
| Semgrep rulesets | Fetched from the registry on first use and cached there. A host with no outbound network reports Semgrep as failed rather than clean. `--config auto` is deliberately not used: it fingerprints the project to the registry, and returns rules that change between runs. |
| Secrets in history | One secret carried by twenty commits is one finding, deduplicated on path, rule, and line. The commit recorded is the earliest sighting, not every one. |
| Advisory cache | OSV records are cached for 7 days. Severity ratings are revised and fixes are published after disclosure, so a cache without expiry would keep recommending a superseded upgrade. |
| Findings stored per row | Capped at 50 per file and 500 per repository, worst first. The score already ignores volume past a small bonus, so the tail costs payload without adding information. The true count stays in the scanner outcome. |
| `deepmerge-ts` advisory | Reported by `npm audit` via `@prisma/config`. It is a stack exhaustion on attacker-controlled recursive input; we merge a static config file we author. The only offered fix is a two-major Prisma downgrade, which is the worse trade. |

---

## Status

| Milestone | State |
|---|---|
| M0 — scaffold, schema, i18n | Done |
| M1 — vertical slice: URL → queue → clone → metrics → DB → UI | Done |
| M2 — security dimension (Semgrep, Gitleaks, OSV) | Done |
| M3 — AI explanations | Not started |
| M4 — D3 treemap, trend view, history | Not started |
| M5 — deployment | Not started |

Tests: `npm test` (163 across `shared`, `analyzer`, and `api`). The web workspace has no unit tests yet, so the root script exits non-zero on it.

Semgrep and Gitleaks are external binaries and are not required to run the tests or the app; without them those two sources report `skipped`. Install them to exercise the full security dimension:

```bash
pipx install semgrep      # or: brew install semgrep
brew install gitleaks     # or a release binary from github.com/gitleaks/gitleaks
```
