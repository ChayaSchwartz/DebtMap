<div dir="rtl">

# 2. מבנה הריפו

[תוכן העניינים](../README.md) · הקודם: [סקירה כללית](01-overview.md) · הבא: [צד לקוח (Angular)](03-frontend-angular.md)

## הרעיון: ריפו אחד, ארבעה פרויקטים

DebtMap הוא **monorepo**: ריפו אחד שמכיל כמה פרויקטים נפרדים. לכל פרויקט יש `package.json` משלו ותלויות משלו, אבל הם יושבים זה לצד זה ויכולים לייבא זה מזה.

זה עובד באמצעות **npm workspaces**. קובץ ה-`package.json` שבשורש מצהיר:

</div>
<div dir="ltr">

```json
"workspaces": ["packages/*", "apps/*"]
```

</div>
<div dir="rtl">

כלומר: "כל תיקייה תחת `packages/` ותחת `apps/` היא פרויקט בפני עצמו". מזה נובעים שלושה דברים:

1. **`npm install` אחד בשורש מתקין הכול** לכל ארבעת הפרויקטים, לתוך `node_modules/` אחת בשורש.
2. **פרויקטים מייבאים זה את זה לפי שם.** `apps/api` יכול לכתוב `import { parseRepoUrl } from '@debtmap/shared'`, ו-npm מקשר את זה לתיקייה המקומית `packages/shared` בלי להוריד שום דבר.
3. **אפשר להריץ סקריפט של פרויקט אחד מהשורש** עם `-w` (קיצור של `--workspace`):

</div>
<div dir="ltr">

```bash
npm run build -w @debtmap/shared     # runs "build" inside packages/shared
```

</div>
<div dir="rtl">

### ההבדל בין `apps/` לבין `packages/`

| תיקייה | מה יש בה | אפשר להריץ אותה לבד? |
|---|---|---|
| `apps/` | אפליקציות: דברים שמפעילים ופותחים | כן. `apps/web` הוא אתר, `apps/api` הוא שרת |
| `packages/` | ספריות: קוד שפרויקטים אחרים מייבאים | לא. האפליקציות מייבאות אותן |

### מי תלוי במי

</div>
<div dir="ltr">

```
apps/web  ───────────────►  packages/shared
apps/api  ──┬────────────►  packages/shared
            └──►  packages/analyzer  ──►  packages/shared
```

</div>
<div dir="rtl">

`packages/shared` לא תלוי בשום דבר. **בגלל זה סדר הבנייה חשוב:** האפליקציות מייבאות את הפלט ה*מקומפל* (`dist/`) של החבילות. לכן צריך לבנות את `shared` לפני `analyzer`, ואת שתיהן לפני שמריצים את האפליקציות. סקריפט ה-`build` שבשורש עושה את זה בסדר הנכון.

## העץ

תיקיות `node_modules/` ו-`dist/` הושמטו, כי הן נוצרות אוטומטית (פירוט בסוף העמוד). התוויות מוסברות ב[תוכן העניינים](../README.md): `generated` = נוצר על ידי כלי, `generated, edited` = נוצר על ידי כלי ושונה אצלנו, `ours` = נכתב אצלנו.

</div>
<div dir="ltr">

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

</div>
<div dir="rtl">

## קבצי השורש בפירוט

### `package.json`

מלבד רשימת ה-workspaces, הקובץ מגדיר את הסקריפטים שמריצים מהשורש. רובם פשוט מעבירים את הפקודה ל-workspace מסוים:

| סקריפט | מה הוא עושה |
|---|---|
| `npm run infra:up` | `docker compose up -d`: מפעיל את PostgreSQL ואת Redis ברקע |
| `npm run infra:down` | עוצר אותם (הנתונים נשמרים) |
| `npm run infra:reset` | עוצר אותם, **מוחק את הנתונים שלהם** ומפעיל מחדש |
| `npm run build` | בונה את כל ארבעת הפרויקטים לפי סדר התלויות |
| `npm run dev:api` | מפעיל את השרת במצב watch (עולה מחדש בכל שמירה) |
| `npm run dev:web` | מפעיל את שרת הפיתוח של הממשק (מרענן את הדפדפן בכל שמירה) |
| `npm run analyze -- <url>` | מריץ את מנוע הניתוח משורת הפקודה, בלי השרת |
| `npm test` | מריץ את הטסטים של כל ה-workspaces |
| `npm run prisma:migrate` | מחיל שינויים בסכמת מסד הנתונים |
| `npm run prisma:studio` | פותח ממשק דפדפן לצפייה במסד הנתונים |

### `tsconfig.base.json`

הגדרות קומפיילר TypeScript שכל פרויקט יורש באמצעות `"extends": "../../tsconfig.base.json"`. הן מפעילות בדיקה קפדנית (strict), כך שטעויות כמו ערך שעלול להיות `undefined` מתגלות כבר בקומפילציה. כל פרויקט מוסיף רק את מה שייחודי לו. למשל, `apps/api` מוסיף את הגדרות ה-decorators ש-NestJS צריך.

### `docker-compose.yml`

מגדיר שני קונטיינרים:

| שירות | Image | פורט | איפה הנתונים נשמרים |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432 | Docker volume בשם `postgres-data` |
| `redis` | `redis:7-alpine` | 6379 | Docker volume בשם `redis-data` |

שם המשתמש, הסיסמה ושם מסד הנתונים (`debtmap`) תואמים לברירות המחדל ב-`.env.example`, כך שעותק חדש של הריפו עובד בלי לערוך כלום.

### `.env` ו-`.env.example`

`.env` מחזיק הגדרות שמשתנות ממחשב למחשב: כתובת מסד הנתונים, טוקן של GitHub, מגבלות וכו'. הוא ברשימת `.gitignore` כי הוא עלול להכיל סודות. `.env.example` הוא התבנית שנשמרת ב-git: מעתיקים אותה ל-`.env` וממלאים. קובץ `.env` אחד בשורש משרת את ה-API, את כלי שורת הפקודה של Prisma ואת docker-compose. כל המשתנים מתוארים ב[פרק 6](06-running-locally.md#משתני-סביבה).

## תיקיות שנוצרות אוטומטית: לא עורכים ולא שומרים ב-git

| תיקייה | נוצרת על ידי | מה יש בה | מותר למחוק? |
|---|---|---|---|
| `node_modules/` | `npm install` | ספריות צד שלישי שהורדו | כן. `npm install` יוצר אותה מחדש |
| `*/dist/` | `npm run build` / `tsc` / `ng build` | JavaScript מקומפל | כן. בונים שוב |
| `apps/web/.angular/` | Angular CLI | מטמון בנייה שמאיץ בניות חוזרות | כן |
| `.debtmap-workspace/` | המנוע | שכפולים זמניים של ריפואים בניתוח | כן, כשאין ניתוח שרץ. ה-API גם מנקה אותה בעלייה. |
| `.playwright-mcp/` | אוטומציית דפדפן | צילומי מסך מבדיקות אוטומטיות | כן |

כל אלה נמצאים ב-`.gitignore`.

</div>
