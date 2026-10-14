# 2. Repository structure

[Docs index](../README.md) · Previous: [Overview](01-overview.md) · Next: [Frontend (Angular)](03-frontend-angular.md)

## The idea: one repository, four projects

DebtMap is a **monorepo**: a single repository that contains several separate projects. Each project has its own `package.json` and its own dependencies, but they live side by side and can import each other.

This works through **npm workspaces**. The root `package.json` declares:

```json
"workspaces": ["packages/*", "apps/*"]
```

That tells npm: "every folder under `packages/` and `apps/` is a project of its own". Three things follow from it:

1. **One `npm install` at the root installs everything** for all four projects, into a single `node_modules/` at the root.
2. **Projects can import each other by name.** `apps/api` can write `import { parseRepoUrl } from '@debtmap/shared'`, and npm links it to the local `packages/shared` folder instead of downloading anything.
3. **You can run a script in one project from the root** with `-w` (short for `--workspace`):

   ```bash
   npm run build -w @debtmap/shared     # runs "build" inside packages/shared
   ```

### `apps/` versus `packages/`

| Folder | Holds | Can it run by itself? |
|---|---|---|
| `apps/` | Applications: things you start and open | Yes: `apps/web` is a website, `apps/api` is a server |
| `packages/` | Libraries: code other projects import | No: they are imported by the apps |

### Who depends on whom

```
apps/web  ───────────────►  packages/shared
apps/api  ──┬────────────►  packages/shared
            └──►  packages/analyzer  ──►  packages/shared
```

`packages/shared` depends on nothing. **Build order matters for this reason:** the apps import the *compiled* output (`dist/`) of the packages, so `shared` must be built before `analyzer`, and both before the apps run. The root `build` script does this in the right order.

## The tree

`node_modules/` and `dist/` folders are left out; they are generated (see the end of this page).

```
DebtMap/
├── README.md                  ours               Product summary: decisions, security posture, status
├── package.json               ours               Workspace list and root-level scripts
├── package-lock.json          generated          Exact installed versions. Never edit by hand.
├── tsconfig.base.json         ours               TypeScript settings shared by every project
├── docker-compose.yml         ours               Starts PostgreSQL and Redis for local development
├── .env.example               ours               Template for environment variables (safe to commit)
├── .env                       ours (local)       Your real settings. Ignored by git; may hold secrets.
├── .gitignore                 ours               Files git must never track
├── docs/                      ours               This documentation
│
├── apps/
│   ├── web/                   Angular app        → chapter 3
│   │   ├── angular.json       generated, edited  Angular build configuration
│   │   ├── proxy.conf.json    ours               Sends /api calls to the backend during development
│   │   ├── public/            generated, edited  Static files: favicon, translation files
│   │   └── src/               generated, edited  The application source
│   │       └── app/
│   │           ├── core/      ours               Services: API client, language switching
│   │           └── pages/     ours               One folder per screen
│   │
│   └── api/                   NestJS app         → chapter 4
│       ├── nest-cli.json      generated          Nest CLI configuration
│       ├── prisma.config.ts   generated, edited  Where Prisma finds the database and migrations
│       ├── prisma/            generated, edited  Database schema and migration history
│       └── src/               generated, edited  The server source, one folder per feature
│
└── packages/
    ├── analyzer/              ours               The analysis engine → chapter 5
    │   └── src/
    │       └── security/      ours               Semgrep, Gitleaks, and OSV integrations
    └── shared/                ours               Types, scoring rules, URL parser → chapter 5
```

## Root files in detail

### `package.json`

Besides the workspace list, it defines the scripts you run from the root. Most simply forward to a workspace:

| Script | What it does |
|---|---|
| `npm run infra:up` | `docker compose up -d`: start PostgreSQL and Redis in the background |
| `npm run infra:down` | Stop them (data is kept) |
| `npm run infra:reset` | Stop them, **delete their data**, and start fresh |
| `npm run build` | Build all four projects in dependency order |
| `npm run dev:api` | Start the backend in watch mode (restarts on every save) |
| `npm run dev:web` | Start the frontend dev server (reloads the browser on every save) |
| `npm run analyze -- <url>` | Run the analysis engine from the command line, without the server |
| `npm test` | Run the tests of every workspace |
| `npm run prisma:migrate` | Apply database schema changes |
| `npm run prisma:studio` | Open a browser UI for looking at the database |

### `tsconfig.base.json`

TypeScript compiler settings that every project inherits through `"extends": "../../tsconfig.base.json"`. They turn on strict checking, so mistakes such as a possibly-`undefined` value surface at compile time. Each project adds only what is specific to it; for example, `apps/api` adds the decorator settings NestJS needs.

### `docker-compose.yml`

Defines two containers:

| Service | Image | Port | Data kept in |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432 | Docker volume `postgres-data` |
| `redis` | `redis:7-alpine` | 6379 | Docker volume `redis-data` |

The username, password, and database name (`debtmap`) match the defaults in `.env.example`, so a fresh checkout works without editing anything.

### `.env` and `.env.example`

`.env` holds configuration that differs between machines: database address, GitHub token, limits, and so on. It is listed in `.gitignore` because it may contain secrets. `.env.example` is the committed template: copy it to `.env` and fill it in. One `.env` at the root serves the API, the Prisma command-line tool, and docker-compose. Every variable is described in [chapter 6](06-running-locally.md#environment-variables).

## Generated folders: never edit, never commit

| Folder | Created by | Contains | Safe to delete? |
|---|---|---|---|
| `node_modules/` | `npm install` | Downloaded third-party libraries | Yes; `npm install` recreates it |
| `*/dist/` | `npm run build` / `tsc` / `ng build` | Compiled JavaScript | Yes; build again |
| `apps/web/.angular/` | Angular CLI | Build cache that speeds up rebuilds | Yes |
| `.debtmap-workspace/` | The analyzer | Temporary clones of analysed repositories | Yes, when no analysis is running. The API also cleans it on startup. |
| `.playwright-mcp/` | Browser automation | Screenshots from automated checks | Yes |

All of these are in `.gitignore`.
