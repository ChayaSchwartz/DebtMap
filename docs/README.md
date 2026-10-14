# DebtMap documentation

Documentation for developers joining the project, including those who have never worked with Angular or NestJS.

The same content exists in two languages. Pick one and read the chapters in order; each builds on the one before it.

| # | English | עברית | What it covers |
|---|---|---|---|
| 1 | [Overview](en/01-overview.md) | [סקירה כללית](he/01-overview.md) | What DebtMap does, the moving parts, and how one analysis flows through them |
| 2 | [Repository structure](en/02-repository-structure.md) | [מבנה הריפו](he/02-repository-structure.md) | Every top-level folder and file, and how the workspaces fit together |
| 3 | [Frontend (Angular)](en/03-frontend-angular.md) | [צד לקוח (Angular)](he/03-frontend-angular.md) | Angular from zero, then `apps/web` file by file: what Angular generated and what we wrote |
| 4 | [Backend (NestJS)](en/04-backend-nestjs.md) | [צד שרת (NestJS)](he/04-backend-nestjs.md) | NestJS from zero, then `apps/api` file by file, the database, and the queue |
| 5 | [Analyzer and shared packages](en/05-analyzer-and-shared.md) | [המנוע והחבילה המשותפת](he/05-analyzer-and-shared.md) | The analysis engine and the code shared between the frontend and the backend |
| 6 | [Running locally](en/06-running-locally.md) | [הרצה מקומית](he/06-running-locally.md) | Setup, environment variables, scanners, and Windows-specific problems |

The root [README.md](../README.md) remains the short product-level summary: design decisions, security posture, and milestone status.

## Labels used throughout

Every file listed in these docs carries one of three labels, so you can tell framework boilerplate from project code at a glance:

| Label | Meaning |
|---|---|
| `generated` | Created by a tool (Angular CLI, Nest CLI, Prisma) and left as it was. Every project built with that tool has it. Rarely needs editing. |
| `generated, edited` | Created by a tool, then changed for DebtMap. The file exists in every such project, but its content here is ours. |
| `ours` | Written from scratch for DebtMap. |
