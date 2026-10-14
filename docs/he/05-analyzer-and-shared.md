<div dir="rtl">

# 5. המנוע והחבילה המשותפת

[תוכן העניינים](../README.md) · הקודם: [צד שרת (NestJS)](04-backend-nestjs.md) · הבא: [הרצה מקומית](06-running-locally.md)

שתי החבילות כתובות ב-TypeScript נקי, בלי Angular ובלי NestJS. אף כלי לא יצר בהן שום דבר: **הכול כאן `ours`**, חוץ מתיקיות ה-`dist/` המקומפלות.

---

## `packages/shared`: מקור אמת אחד

</div>
<div dir="ltr">

```
packages/shared/
├── package.json        "main": "./dist/index.js": importers get the compiled output
├── tsconfig.json       Compiles to CommonJS, which both Nest and Angular can consume
└── src/
    ├── index.ts        Re-exports everything below
    ├── dto.ts          The shapes of every API request and response
    ├── risk.ts         Severities, security sources, the SecurityFinding shape
    ├── scoring.ts      Scoring formulas, thresholds, colour bands
    ├── repo-url.ts     The GitHub URL parser
    └── *.test.ts       Tests
```

</div>
<div dir="rtl">

### למה צריך חבילה משותפת

הדפדפן, השרת והמנוע צריכים להסכים על אותן עובדות: מה נחשב כתובת ריפו תקינה, איך נראית תשובה, ואיזה ציון נחשב "גבוה". אם לכל אחד מהם היה עותק משלו, העותקים היו מתרחקים זה מזה עם הזמן. כאן יש עותק אחד בדיוק, והקומפיילר של TypeScript מכשיל את הבנייה של כל פרויקט שמשתמש בו לא נכון.

| קובץ | שימוש ב-web | שימוש ב-api | שימוש ב-analyzer |
|---|---|---|---|
| `repo-url.ts` (`parseRepoUrl`) | דף הבית, לפני השליחה | ולידציית ה-DTO | כתובת השכפול |
| `dto.ts` | טיפוסי התשובות ב-`AnalysisService` | בניית התשובות | אין |
| `scoring.ts` | `toRiskBand` לצבעים | אין | כל חישובי הציון |
| `risk.ts` | הצגת ממצאים | שמירת ממצאים | יצירת ממצאים |

### `repo-url.ts`

`parseRepoUrl(input)` מקבל את מה שאנשים מדביקים בפועל (`github.com/a/b`, `https://github.com/a/b/tree/main/src`, `git@github.com:a/b.git` וכו') ומחזיר `{ owner, name, canonical, cloneUrl }`, או `null` אם הקלט הוא לא כתובת של ריפו ב-GitHub. רק github.com מתקבל.

### `scoring.ts`: איך הציונים מחושבים

**נטייה לבאגים של קובץ** (0–100):

</div>
<div dir="ltr">

```
bugProneness = 0.3 × churnScore + 0.4 × bugScore + 0.3 × complexityScore
```

</div>
<div dir="rtl">

כל אחד מהרכיבים הוא **דירוג אחוזוני בתוך הריפו**. `complexityScore` של 80 פירושו שהקובץ מורכב יותר מ-80% מהקבצים באותו ריפו. להיסטוריית תיקוני הבאגים יש המשקל הגבוה ביותר, כי זו ראיה ישירה: הקובץ כבר נשבר בעבר.

**אבטחה של קובץ** (0–100) תלויה בממצא ה**גרוע ביותר** שלו, ולא בכמות הממצאים:

| החומרה הגבוהה ביותר | ציון בסיס |
|---|---|
| critical | 90 |
| high | 72 |
| medium | 45 |
| low | 20 |
| info | 5 |

כל ממצא נוסף באותה חומרה מוסיף 2 נקודות, עד תוספת של 10 בסך הכול.

**ציוני הריפו** משתמשים בסקאלה **מוחלטת** ולא בדירוגים. ממוצע של דירוגים אחוזוניים יוצא תמיד בערך אותו דבר, ולכן מספר ברמת הריפו שבנוי מהם לא היה זז בין הרצות. הסקאלה המוחלטת משתמשת בעקומה שמגיעה ל-50 בנקודת ייחוס (מורכבות 40, 12 קומיטים, 5 קומיטים של תיקון באג), ומתקרבת ל-100 בלי להיחתך אף פעם.

**פסי צבע** (`toRiskBand`): 85 ומעלה הוא `critical`, 70 ומעלה `high`, 40 ומעלה `moderate`, ומתחת ל-40 `low`. הערך 70 הוא גם `HIGH_RISK_THRESHOLD`, הסף שמעליו קובץ יקבל הסבר מה-AI.

---

## `packages/analyzer`: המנוע

</div>
<div dir="ltr">

```
packages/analyzer/
├── package.json        Dependencies: simple-git, ts-morph, tinyglobby
├── tsconfig.json
└── src/
    ├── index.ts        Public API: what the backend may import
    ├── cli.ts          Command-line entry: npm run analyze -- <url>
    ├── analyze.ts      The pipeline: calls every stage in order
    ├── types.ts        Options, defaults, result shapes, progress events
    ├── clone.ts        git clone, cleanup, workspace sweeping
    ├── discover.ts     Which files to analyse
    ├── git-metrics.ts  Churn and bug-fix commits from git log
    ├── complexity.ts   Cyclomatic complexity and nesting via ts-morph
    ├── normalize.ts    Percentile ranks and repository aggregates
    ├── security/
    │   ├── index.ts    Runs the three scanners in sequence; maps findings to files
    │   ├── process.ts  Safe process spawning: no shell, timeout, output cap
    │   ├── semgrep.ts  Code-pattern scanner
    │   ├── gitleaks.ts Secret scanner, over the full git history
    │   ├── lockfile.ts Reads package-lock.json as text
    │   ├── osv.ts      Queries OSV.dev for vulnerable dependency versions
    │   ├── cvss.ts     Turns CVSS vectors into severities
    │   └── types.ts
    └── *.test.ts       Tests, next to the file they test
```

</div>
<div dir="rtl">

### למה אין בו פריימוורק

המנוע הוא החלק הרגיש ביותר במוצר: ממנו מגיעים המספרים. כיוון שאין בו NestJS, אפשר להריץ אותו ולכייל אותו על ריפואים אמיתיים משורת הפקודה, בלי מסד נתונים, בלי תור ובלי שרת:

</div>
<div dir="ltr">

```bash
npm run analyze -- https://github.com/sindresorhus/got --top 15
npm run analyze -- <url> --no-security        # skip the scanners (much faster)
npm run analyze -- <url> --churn-months 12    # shorter history window
```

</div>
<div dir="rtl">

השרת משתמש באותו קוד דרך `analyzeRepository(...)`.

### הצינור (`analyze.ts`)

| # | שלב | קובץ | מה הוא עושה |
|---|---|---|---|
| 1 | `cloning` | `clone.ts` | `git clone` עם כל ההיסטוריה (Gitleaks צריך אותה) לתוך `WORKSPACE_DIR/<random-id>`. השכפול מוקשח: קישורים סימבוליים כבויים, פרוטוקול `ext::` חסום, ואין שאלות אינטראקטיביות. |
| 2 | `discovering` | `discover.ts` | אוסף קבצי `.ts .js .mjs .cjs .mts .cts`, בלי `node_modules`, `dist`, `build`, `vendor`, `*.min.js`, `*.d.ts` וכדומה. קבצי טסט **נכללים** בכוונה. קבצים מעל 1MB מדולגים, כי הם חבילות קוד שנוצרו אוטומטית (`MAX_SOURCE_FILE_BYTES`, אותה מגבלה ש-Semgrep משתמש בה). אם יש יותר מ-`MAX_FILES`, נשמרים רק הגדולים ביותר, וההרצה מסומנת *truncated*. |
| 3 | `git-metrics` | `git-metrics.ts` | מעבר אחד של `git log --numstat` על 24 החודשים האחרונים. לכל קובץ: מספר קומיטים, שורות שהשתנו, וקומיטים שההודעה שלהם נראית כמו תיקון באג (`fix`, `bug`, `hotfix`, `regression`, `crash`, `broken` וכו'). |
| 4 | `ast-metrics` | `complexity.ts` | מפענח כל קובץ עם `ts-morph` וסופר מורכבות ציקלומטית, עומק קינון מקסימלי ושורות קוד. מתבצע רק פענוח: בלי בדיקת טיפוסים, בלי `npm install`, ושום דבר לא מורץ. |
| 5 | `security` | `security/` | Semgrep, אחריו Gitleaks, אחריו OSV. כל אחד מהם יכול להיות `ok`, `skipped` או `failed` בלי לעצור את האחרים. |
| 6 | `scoring` | `normalize.ts` + `shared/scoring.ts` | דירוגים אחוזוניים, ציונים לכל קובץ, ציוני ריפו. |

השכפול נמחק בסוף, גם כששלב כלשהו נכשל.

### סורקי האבטחה

| סורק | על מה הוא מסתכל | מה הוא מוצא | מה הוא צריך |
|---|---|---|---|
| **Semgrep** | הקבצים הנוכחיים | דפוסים מסוכנים כמו `eval`, SQL שנבנה ממחרוזות, הצפנה חלשה | התוכנה `semgrep`, וקבצי החוקים שלה |
| **Gitleaks** | כל היסטוריית git | סיסמאות, מפתחות API וטוקנים שנכנסו לקומיטים, כולל כאלה שנמחקו אחר כך | התוכנה `gitleaks` |
| **OSV** | `package-lock.json` | תלויות עם פרצות ידועות | גישת רשת ל-`api.osv.dev` |

כללים שקוד האבטחה תמיד שומר עליהם, כי כל ריפו שמנותח הוא קלט לא מהימן:

- **הקוד של הריפו אף פעם לא מורץ.** בלי `npm install` (זה היה מריץ סקריפטי `postinstall` של זרים), בלי בנייה ובלי טסטים.
- **הסורקים מופעלים בלי shell** (`process.ts`), כך ששם קובץ זדוני לא יכול להפוך לפקודה.
- **לכל סורק יש מגבלת זמן ומגבלת פלט.** סורק שמציף את הפלט שלו נהרג.
- **Gitleaks רץ עם `--redact`**, כך שסוד אמיתי אף פעם לא נשמר במסד הנתונים ולא מוצג בממשק.

ממצאים בנתיבים שאינם בין הקבצים שנותחו (קובץ lock, או קובץ שנמחק מההיסטוריה) הופכים ל**ממצאים ברמת הריפו**.

### Ports: איך המנוע לא תלוי במסד הנתונים

השילוב עם OSV צריך מטמון, אבל אסור למנוע להכיר את Postgres. לכן הוא מצהיר על ממשק, `AdvisoryCache`, ומקבל כל מימוש שלו:

- השרת מעביר את `AdvisoryCacheService` (מעל Postgres, ראו פרק 4).
- שורת הפקודה והטסטים מעבירים את `createMemoryAdvisoryCache()` (בזיכרון).

דיווח ההתקדמות (`onProgress`) והלוגים (`logger`) עובדים באותה צורה: מי שקורא למנוע מחליט לאן הם הולכים.

### טסטים

</div>
<div dir="ltr">

```bash
npm test -w @debtmap/analyzer
npm test -w @debtmap/shared
```

</div>
<div dir="rtl">

הטסטים כתובים ב-Vitest ויושבים ליד הקוד שהם בודקים (`complexity.ts` לצד `complexity.test.ts`). חלקם יוצרים ריפואי git קטנים ואמיתיים בתיקייה זמנית, ולכן `git` חייב להיות מותקן.

### אחרי שינוי קוד כאן

האפליקציות מייבאות את הפלט המקומפל שב-`dist/`, ולא את קוד המקור. אחרי שינוי:

</div>
<div dir="ltr">

```bash
npm run build -w @debtmap/shared      # if you changed shared
npm run build -w @debtmap/analyzer    # if you changed the analyzer (or shared)
```

</div>
<div dir="rtl">

ואז להפעיל מחדש את ה-API. שורת הפקודה (`npm run analyze`) מריצה את קוד ה-TypeScript ישירות דרך `tsx`, ולכן היא לא צריכה בנייה.

</div>
