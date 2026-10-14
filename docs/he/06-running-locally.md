<div dir="rtl">

# 6. הרצה מקומית

[תוכן העניינים](../README.md) · הקודם: [המנוע והחבילה המשותפת](05-analyzer-and-shared.md)

## דרישות מוקדמות

| כלי | גרסה | חובה? | בדיקה |
|---|---|---|---|
| Node.js | 22 ומעלה | כן | `node -v` |
| Docker Desktop | גרסה עדכנית | כן, בשביל PostgreSQL ו-Redis | `docker ps` |
| git | גרסה עדכנית | כן | `git --version` |
| Semgrep | גרסה עדכנית | לא. בלעדיו Semgrep יוצג כ-*Skipped* | `semgrep --version` |
| Gitleaks | 8.x | לא. בלעדיו Gitleaks יוצג כ-*Skipped* | `gitleaks version` |

## התקנה ראשונה

מריצים משורש הריפו:

</div>
<div dir="ltr">

```bash
cp .env.example .env                  # 1. create your local settings
npm install                           # 2. install dependencies for all four projects
npm run infra:up                      # 3. start PostgreSQL and Redis in Docker
npm run prisma:migrate                # 4. create the database tables
npm run build -w @debtmap/shared      # 5. build the shared packages,
npm run build -w @debtmap/analyzer    #    which the apps import compiled
```

</div>
<div dir="rtl">

אחר כך מוסיפים ל-`.env` טוקן של GitHub (פירוט בהמשך). הוא לא חובה, אבל בלעדיו תגיעו למגבלה של GitHub אחרי כמה ניתוחים.

## בכל יום

שני טרמינלים, שניהם בשורש הריפו:

</div>
<div dir="ltr">

```bash
npm run dev:api     # terminal 1: backend on http://localhost:3100
npm run dev:web     # terminal 2: frontend on http://localhost:4200
```

</div>
<div dir="rtl">

פותחים את http://localhost:4200. אם Docker הופעל מחדש, מריצים קודם `npm run infra:up`.

**בדיקה מהירה:** http://localhost:3100/api/health צריך להחזיר `{"status":"ok", …}`.

## מתי להריץ מה

| עשיתם את זה | אז מריצים |
|---|---|
| משכתם שינויים ב-`prisma/schema.prisma` או migration חדש | `npm run prisma:migrate` |
| משכתם שינויים ב-`packages/shared` או ב-`packages/analyzer` | בונים אותם מחדש (שלב 5 למעלה) ומפעילים מחדש את ה-API |
| משכתם שינויים באחד מקבצי ה-`package.json` | `npm install` |
| ערכתם את `.env` | מפעילים מחדש את ה-API |
| רוצים להתחיל מחדש עם מסד נתונים ריק | `npm run infra:reset` ואחריו `npm run prisma:migrate`. **זה מוחק את כל הנתונים.** |

## משתני סביבה

כולם נמצאים ב-`.env` שבשורש הריפו.

| משתנה | ברירת מחדל | משמעות |
|---|---|---|
| `NODE_ENV` | `development` | |
| `PORT` | `3100` | הפורט של ה-API. אם משנים אותו, צריך לעדכן גם את `apps/web/proxy.conf.json`. |
| `CORS_ORIGINS` | `http://localhost:4200` | מקורות שמורשים לקרוא ל-API, מופרדים בפסיקים |
| `DATABASE_URL` | Postgres המקומי ב-Docker | מחרוזת החיבור ל-PostgreSQL |
| `REDIS_URL` | `redis://localhost:6379` | מחרוזת החיבור ל-Redis |
| `GITHUB_TOKEN` | ריק | Personal access token של GitHub. לריפואים ציבוריים לא צריך הרשאות. בלעדיו: 60 בקשות ל-GitHub בשעה. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | ריק / `gemini-2.5-flash-lite` | להסברי AI (אבן הדרך M3, עוד לא נבנתה) |
| `MAX_FILES` | `5000` | מעל המספר הזה מנותחים רק הקבצים הגדולים ביותר |
| `MAX_REPO_SIZE_MB` | `1024` | ריפואים גדולים יותר נדחים עוד לפני השכפול |
| `CLONE_TIMEOUT_MS` | `300000` | 5 דקות |
| `CHURN_WINDOW_MONTHS` | `24` | כמה אחורה בהיסטוריית git נספר ה-churn |
| `SECURITY_SOURCES` | `semgrep,gitleaks,osv` | מוחקים סורק מהרשימה כדי לכבות אותו. הוא יוצג כ-*Skipped*. |
| `SEMGREP_TIMEOUT_MS`, `GITLEAKS_TIMEOUT_MS`, `OSV_TIMEOUT_MS` | 10 / 5 / 2 דקות | מגבלות זמן לכל סורק |
| `SEMGREP_CONFIG` | ריק | חבילות חוקים של Semgrep או נתיבים לקבצי חוקים, מופרדים בפסיקים. ריק פירושו `p/security-audit`, `p/javascript` ו-`p/typescript`, שיורדים מ-semgrep.dev. |
| `WORKSPACE_DIR` | `.debtmap-workspace` | לאן הריפואים משוכפלים זמנית |
| `AI_*`, `DAILY_REPO_BUDGET` | | מגבלות יומיות ששומרות שהשימוש יישאר בשכבות החינמיות |

## התקנת הסורקים (Windows)

**Gitleaks:**

</div>
<div dir="ltr">

```powershell
winget install --id Gitleaks.Gitleaks -e --source winget
```

</div>
<div dir="rtl">

(`--source winget` עוקף שגיאה של מקור ה-Microsoft Store.)

**Semgrep**, בסביבת Python וירטואלית משלו, כדי שהספריות שלו לא יתערבבו עם ה-Python הראשי:

</div>
<div dir="ltr">

```powershell
python -m venv $env:USERPROFILE\.venvs\semgrep
& $env:USERPROFILE\.venvs\semgrep\Scripts\python.exe -m pip install semgrep
```

</div>
<div dir="rtl">

אחר כך מוסיפים את `%USERPROFILE%\.venvs\semgrep\Scripts` ל**סוף** ה-`PATH` של המשתמש, כדי שה-`python` הראשי ימשיך לקבל עדיפות.

**אחרי התקנה של כל אחד מהם צריך לפתוח טרמינל חדש** (ואם מפעילים את ה-API מהטרמינל של VS Code, גם להפעיל מחדש את VS Code). תוכנה שכבר רצה לא רואה שינויים ב-`PATH`.

## פתרון בעיות

| תסמין | סיבה | פתרון |
|---|---|---|
| Semgrep *Skipped*: "semgrep is not installed" | הוא לא נמצא ב-`PATH` של התהליך שמריץ את ה-API | להתקין כמו למעלה, ואז להפעיל מחדש את הטרמינל ואת ה-API |
| Semgrep *Failed*: "exit 2: Unexpected end of JSON input" | Semgrep לא הצליח להוריד את החוקים שלו. מאחורי מסנן רשת שבודק HTTPS (למשל NetFree), Python 3.13 ומעלה דוחה את התעודה של המסנן (`CERTIFICATE_VERIFY_FAILED … key usage extension`), גם כשדפדפנים ו-curl מקבלים אותה. | להוריד את החוקים פעם אחת עם curl ולהפנות את `SEMGREP_CONFIG` לקבצים (ראו למטה) |
| OSV *Failed*: "OSV responded 418" | מסנן הרשת חוסם את `api.osv.dev` | אין מה לתקן ב-DebtMap. אפשר לבקש לפתוח את הדומיין, או להוציא את `osv` מ-`SECURITY_SOURCES`. |
| OSV *Skipped*: "no package-lock.json" | לריפו שנותח אין קובץ lock של npm | צפוי. OSV קורא רק `package-lock.json`. |
| כל ניתוח נכשל עם `Use of "GIT_ASKPASS" is not permitted` | בנייה ישנה של המנוע, שהופעלה מטרמינל של VS Code (VS Code מגדיר `GIT_ASKPASS`) | תוקן ב-`packages/analyzer/src/clone.ts`. לבנות מחדש את המנוע ולהפעיל מחדש את ה-API. |
| ריפו גדול מתחיל מההתחלה, או שההתקדמות חוזרת אחורה | בבניות ישנות: פענוח ארוך תפס את ה-worker, הנעילה שלו בתור פגה, ו-BullMQ הריץ את העבודה שוב | תוקן: הנעילה נמשכת 5 דקות, עבודה תקועה נכשלת במקום לרוץ שוב, וקבצים מעל 1MB מדולגים |
| הרצה שהייתה באמצע כשה-API נעצר מציגה "interrupted by a server restart" | ה-API מסמן הרצות כאלה כנכשלות כשהוא עולה | להריץ את הניתוח שוב |
| עמודת "Changes" היא 0 בכל הקבצים | לא היו קומיטים ב-`CHURN_WINDOW_MONTHS` האחרונים | צפוי בריפואים לא פעילים |
| שגיאת rate limit של GitHub | אין `GITHUB_TOKEN`, ונוצלו 60 הבקשות של השעה | להוסיף טוקן ל-`.env` |
| ה-API לא עולה: `Invalid environment configuration` | משתנה חובה חסר או לא תקין | ההודעה מציינת את שם המשתנה. להשוות ל-`.env.example`. |
| ה-API לא מצליח להתחבר למסד הנתונים או ל-Redis | קונטיינרי ה-Docker לא רצים | `npm run infra:up` |
| שגיאות על טבלאות או עמודות חסרות | מסד הנתונים לא מעודכן לסכמה | `npm run prisma:migrate` |
| שגיאות ב-API בייבוא `@debtmap/analyzer` או `@debtmap/shared` | החבילות אף פעם לא נבנו, או שהן לא עדכניות | לבנות אותן מחדש (שלב 5 בהתקנה) |
| פורט 3100 או 4200 כבר תפוס | שרת ישן עדיין רץ | לעצור אותו, או להרוג את התהליך שמאזין על הפורט |

### חוקי Semgrep כקבצים מקומיים

</div>
<div dir="ltr">

```bash
mkdir -p ~/.semgrep-rules
curl -o ~/.semgrep-rules/security-audit.yml https://semgrep.dev/c/p/security-audit
curl -o ~/.semgrep-rules/javascript.yml     https://semgrep.dev/c/p/javascript
curl -o ~/.semgrep-rules/typescript.yml     https://semgrep.dev/c/p/typescript
```

</div>
<div dir="rtl">

וב-`.env` (עם תיקיית המשתמש שלכם):

</div>
<div dir="ltr">

```
SEMGREP_CONFIG=C:/Users/<you>/.semgrep-rules/security-audit.yml,C:/Users/<you>/.semgrep-rules/javascript.yml,C:/Users/<you>/.semgrep-rules/typescript.yml
```

</div>
<div dir="rtl">

זה גם הופך את הסריקות לניתנות לשחזור: החוקים משתנים רק כשמורידים אותם מחדש.

## טסטים

</div>
<div dir="ltr">

```bash
npm test                          # every workspace
npm test -w @debtmap/analyzer     # one workspace
```

</div>
<div dir="rtl">

ל-`apps/web` עוד אין טסטים, ולכן `npm test` מהשורש מסתיים בשגיאה על ה-workspace הזה גם כשכל שאר הטסטים עוברים.

## כלים שימושיים

| פקודה | מה היא פותחת |
|---|---|
| `npm run prisma:studio` | ממשק דפדפן לעיון בשורות של מסד הנתונים ולעריכה שלהן |
| `npm run analyze -- <url> --top 15` | המנוע לבד, מדפיס לטרמינל את 15 הקבצים המובילים |
| `docker compose logs -f postgres` | הלוגים של מסד הנתונים |

</div>
