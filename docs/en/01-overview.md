# 1. Overview

[Docs index](../README.md) · Next: [Repository structure](02-repository-structure.md)

## What DebtMap does

A user pastes the URL of a public GitHub repository. DebtMap downloads it, measures every TypeScript and JavaScript file, and shows a ranked table with two separate scores per file:

- **Security**: how exposed the file is. It comes from three scanners: Semgrep (dangerous code patterns), Gitleaks (passwords and keys committed to git history), and OSV.dev (known vulnerabilities in dependencies).
- **Bug-proneness**: how likely the file is to break. It is built from how often the file changes (*churn*), how many bug-fix commits touched it, and how complex its code is.

The two scores are never merged into one number. A leaked password and a file that is merely hard to change are different problems with different owners.

## The moving parts

```
 Browser
   │
   ▼
┌──────────────────────┐   HTTP /api/...   ┌───────────────────────────────────────┐
│  apps/web            │ ────────────────► │  apps/api  (one Node.js process)      │
│  Angular 21          │                   │                                       │
│  localhost:4200      │ ◄──────────────── │  ┌─────────────┐   ┌───────────────┐  │
└──────────────────────┘    JSON           │  │ HTTP layer  │   │ Queue worker  │  │
                                           │  │ (NestJS)    │   │ (BullMQ)      │  │
                                           │  └──────┬──────┘   └──────┬────────┘  │
                                           │         │                 │ calls     │
                                           │         │                 ▼           │
                                           │         │      packages/analyzer      │
                                           │         │      (the analysis engine)  │
                                           └─────────┼─────────────────┼───────────┘
                                                     │                 │
                                    ┌────────────────┴──┐       ┌──────┴──────┐
                                    │ PostgreSQL        │       │ Redis       │
                                    │ (results)         │       │ (job queue, │
                                    │ via Prisma        │       │  quotas)    │
                                    └───────────────────┘       └─────────────┘

         packages/shared: types and rules imported by web, api, and analyzer alike
```

| Part | Technology | Role |
|---|---|---|
| `apps/web` | Angular 21 | What the user sees: the URL form, the progress screen, the results table, file details. Hebrew and English. |
| `apps/api` | NestJS 11 | HTTP endpoints, validation, the database, and the background worker that runs analyses. |
| `packages/analyzer` | Plain TypeScript | The engine: clone, measure, scan, score. It has no web framework in it, so it can also be run from the command line. |
| `packages/shared` | Plain TypeScript | Types, scoring formulas, and the URL parser used by all three of the above, so they cannot disagree. |
| PostgreSQL | Docker container | Stores repositories, analysis runs, per-file metrics, and cached advisories. |
| Redis | Docker container | Holds the job queue and daily usage counters. |

## One analysis, end to end

1. **The user submits a URL.** The home page checks the URL locally with `parseRepoUrl` from `packages/shared`, then sends `POST /api/analyses`.
2. **The API checks the repository before downloading it.** `GitHubService` asks the GitHub API whether the repository exists, is public, and is under the size limit. The API creates an `AnalysisRun` row with status `QUEUED`, puts a job on the Redis queue, and replies immediately with the run id.
3. **The browser polls.** The results page calls `GET /api/analyses/:id/status` every two seconds and shows the current stage.
4. **The worker picks up the job.** `AnalysisProcessor` (running inside the API process) calls `analyzeRepository` from `packages/analyzer`, which goes through these stages:

   | Stage | What happens |
   |---|---|
   | `cloning` | `git clone` with full history into a temporary folder |
   | `discovering` | Find `.ts`/`.js` files, skipping `node_modules`, `dist`, minified files, and similar |
   | `git-metrics` | One pass over `git log`: commits per file, lines changed, bug-fix commits |
   | `ast-metrics` | Parse every file with `ts-morph` and measure complexity and nesting. Nothing is executed. |
   | `security` | Semgrep, then Gitleaks, then OSV, one after another |
   | `scoring` | Turn raw numbers into 0–100 scores |

   After each stage the worker updates the run's `status`, `stage`, and `progress` in the database, which is what the polling in step 3 reads.
5. **Results are saved.** One `FileMetric` row per file, plus run-level scores and scanner outcomes. The temporary clone is deleted.
6. **The page shows the results.** Once the status reaches `COMPLETED`, the page fetches `GET /api/analyses/:id` and renders the table. Every run also gets an unguessable share link, `/shared/:slug`.

## Words you will see in the code

| Term | Meaning |
|---|---|
| **Run** (`AnalysisRun`) | One analysis of one repository at one commit. A repository can have many runs. |
| **Churn** | How much a file changes: number of commits and lines changed, within the last 24 months by default. |
| **Bug commit** | A commit whose message looks like a fix (`fix`, `bug`, `hotfix`, …). |
| **Cyclomatic complexity** | The number of independent paths through the code. Every `if`, loop, `case`, `&&`, `catch`, etc. adds one. |
| **Percentile rank** | Per-file scores are relative: 90 means "worse than 90% of the files in this repository", not an absolute grade. |
| **Finding** | One issue reported by a scanner. |
| **Repository-level finding** | A finding that belongs to no analysed file, such as a vulnerable dependency or a secret in a file that was later deleted. |
| **Scan outcome** | Whether each scanner ran (`ok`), was not available (`skipped`), or crashed (`failed`). The UI shows this so "found nothing" is never confused with "never ran". |
| **Slug** | The random identifier in a share link. |
