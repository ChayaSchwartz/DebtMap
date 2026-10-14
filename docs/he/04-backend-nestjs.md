<div dir="rtl">

# 4. צד שרת: `apps/api` (NestJS)

[תוכן העניינים](../README.md) · הקודם: [צד לקוח (Angular)](03-frontend-angular.md) · הבא: [המנוע והחבילה המשותפת](05-analyzer-and-shared.md)

**חלק א'** מסביר את המושגים של NestJS, Prisma ו-BullMQ שצריך כדי לקרוא את הקוד. **חלק ב'** עובר על `apps/api` קובץ אחרי קובץ.

---

## חלק א': המושגים

### NestJS

NestJS הוא פריימוורק לבניית שרתים על Node.js. המבנה שלו דומה בכוונה ל-Angular: מחלקות עם **decorators** ו-**הזרקת תלויות**. מי שקרא את פרק 3 יזהה הרבה דברים.

| מושג | מה זה | המקבילה ב-Angular |
|---|---|---|
| **Module** (`@Module`) | מקבץ controllers ו-services קשורים לפיצ'ר אחד, ומצהיר מה הוא משתף עם מודולים אחרים. | `NgModule` ב-Angular הישן |
| **Controller** (`@Controller`) | מקבל בקשות HTTP. כל מתודה מטפלת בכתובת אחת ובפעולת HTTP אחת. | רכיב עמוד, רק ל-HTTP במקום למסך |
| **Service / provider** (`@Injectable`) | מחזיק את הלוגיקה. ה-controllers נשארים דקים וקוראים ל-services. | Service |
| **הזרקת תלויות** | מבקשים services דרך ה-constructor, ו-Nest מספק אותם. | `inject(...)` |
| **Pipe** | מאמת או ממיר נתונים נכנסים לפני שהם מגיעים ל-controller. | (לא אותו דבר כמו pipe ב-Angular) |
| **DTO** | *Data Transfer Object*: מחלקה שמתארת את גוף הבקשה הצפוי, עם כללי ולידציה. | אין |

בקשה עוברת בשכבות כך:

</div>
<div dir="ltr">

```
HTTP request
   │
ValidationPipe          rejects malformed bodies (via the DTO's rules)
   │
Controller method       @Post() create(@Body() dto)  → reads the request
   │
Service                 business logic, database, queue
   │
JSON response
```

</div>
<div dir="rtl">

מתודה של controller במלואה:

</div>
<div dir="ltr">

```ts
@Controller('api/analyses')              // every route below starts with /api/analyses
export class AnalysesController {
  constructor(private readonly analyses: AnalysesService) {}   // injected by Nest

  @Post()                                // POST /api/analyses
  create(@Body() dto: CreateAnalysisDto) {   // @Body() = the parsed JSON body
    return this.analyses.create(dto.repoUrl);
  }

  @Get(':id')                            // GET /api/analyses/123
  getById(@Param('id') id: string) {     // @Param('id') = "123"
    return this.analyses.getById(id);
  }
}
```

</div>
<div dir="rtl">

מה שהמתודה מחזירה (או מה ש-Promise שהיא מחזירה נפתר אליו) נשלח בחזרה כ-JSON. זריקת `BadRequestException` מחזירה 400, `NotFoundException` מחזירה 404, וכן הלאה.

### Prisma: שכבת מסד הנתונים

Prisma הוא **ORM**: הוא מאפשר לקוד לעבוד מול מסד הנתונים דרך אובייקטים של TypeScript עם טיפוסים, במקום מחרוזות SQL.

1. **`prisma/schema.prisma`** מתאר את הטבלאות (ב-Prisma קוראים להן *models*) ואת העמודות שלהן.
2. **`prisma migrate dev`** משווה את הסכמה למסד הנתונים וכותב **migration**: קובץ SQL שמעדכן את מסד הנתונים. ה-migrations נשמרים ב-`prisma/migrations/` לפי סדר תאריכים ונכנסים ל-git, כך שמסד הנתונים של כל מפתח זהה.
3. **`prisma generate`** מייצר מהסכמה client עם טיפוסים. אחרי זה, קוד כמו זה נבדק טיפוסית במלואו:

</div>
<div dir="ltr">

```ts
const run = await this.prisma.analysisRun.findUnique({ where: { id } });
//    ^ the type of `run` is derived from the AnalysisRun model
```

</div>
<div dir="rtl">

**אחרי כל שינוי ב-`schema.prisma` מריצים `npm run prisma:migrate`.** הפקודה יוצרת את ה-migration, מחילה אותו ומייצרת מחדש את ה-client.

### BullMQ ו-Redis: תור העבודות

ניתוח יכול לקחת דקות, הרבה יותר זמן ממה שבקשת HTTP אמורה להישאר פתוחה. לכן העבודה מפוצלת לשניים:

- ה-**controller** כותב עבודה (job) לתור ששמור ב-Redis, ועונה מיד.
- **worker** (`AnalysisProcessor`) לוקח עבודות מהתור אחת אחרי השנייה ומריץ אותן.

BullMQ היא ספריית התור, ו-`@nestjs/bullmq` מחבר אותה ל-Nest. ב-DebtMap ה-worker רץ **בתוך אותו תהליך** כמו שרת ה-HTTP, כך שיש תהליך אחד להפעיל ולא שניים. מספר העבודות המקבילות קבוע על 1, כי ניתוח אחד (שכפול של עד 1GB ועוד הסורקים) כבר צורך את כל המשאבים של שרת קטן.

---

## חלק ב': `apps/api` קובץ אחרי קובץ

### מה הכלים יצרו, ומה שלנו

ה-Nest CLI (`nest new`) יוצר בדרך כלל `main.ts`, `app.module.ts`, דוגמה של `app.controller.ts` ו-`app.service.ts`, תיקיית `test/` ואת `nest-cli.json`. בפרויקט הזה דוגמת ה-controller, ה-service ותיקיית `test/` נמחקו. הטסטים נכתבים ב-Vitest ויושבים ליד הקוד שהם בודקים, כקבצי `*.spec.ts`.

`prisma init` יוצר את `prisma/schema.prisma`, וב-Prisma 7 גם את `prisma.config.ts`. תיקיות ה-migrations נוצרות על ידי `prisma migrate dev` מתוך הסכמה שלנו.

</div>
<div dir="ltr">

```
apps/api/
├── package.json            generated, edited  Dependencies and scripts
├── nest-cli.json           generated          Tells the Nest CLI where the source lives
├── tsconfig.json           ours               Extends tsconfig.base.json; adds decorator settings
├── prisma.config.ts        generated, edited  Loads the root .env so the Prisma CLI finds DATABASE_URL
├── prisma/
│   ├── schema.prisma       generated, edited  The database tables (all of the content is ours)
│   └── migrations/         generated          SQL produced from the schema. Never edit by hand.
│       ├── 20260826071525_init/
│       ├── 20260827090000_security_findings/
│       └── migration_lock.toml
└── src/
    ├── main.ts             generated, edited  Starts the server: validation, CORS, port
    ├── app.module.ts       generated, edited  Root module: config, queue, and all feature modules
    ├── config/             ours               Environment variable validation
    ├── analyses/           ours               The main feature: endpoints, logic, worker
    ├── github/             ours               Checks repositories against the GitHub API
    ├── health/             ours               Health-check endpoint
    ├── prisma/             ours               Database connection as an injectable service
    ├── quota/              ours               Daily usage limits, stored in Redis
    └── security/           ours               Cache of vulnerability advisories
```

</div>
<div dir="rtl">

### תיקייה לכל פיצ'ר

כל תיקייה תחת `src/` היא **פיצ'ר** אחד, ובדרך כלל היא בנויה כך:

</div>
<div dir="ltr">

```
analyses/
├── analyses.module.ts      wires the feature together
├── analyses.controller.ts  HTTP endpoints
├── analyses.service.ts     logic
├── analysis.processor.ts   queue worker
├── analysis.queue.ts       queue name, job shape, concurrency
└── dto/
    └── create-analysis.dto.ts   request body validation
```

</div>
<div dir="rtl">

הסיומת בשם הקובץ אומרת מה הוא: `.module`, `.controller`, `.service`, `.processor`, `.dto`, `.spec` (טסט).

### `main.ts`: עליית השרת

1. יוצר את אפליקציית Nest מתוך `AppModule`.
2. מתקין `ValidationPipe` גלובלי. שדות לא מוכרים בגוף בקשה **נדחים** ולא נמחקים בשקט, כך שלקוח ששולח מבנה שגוי מגלה את זה מיד.
3. מפעיל CORS למקורות שב-`CORS_ORIGINS`, ל-GET ו-POST בלבד.
4. מאזין על `PORT` (3100 ב-`.env`).

### `app.module.ts`: מודול השורש

| Import | מטרה |
|---|---|
| `ConfigModule.forRoot({ validate })` | טוען את `.env` (מ-`apps/api` או משורש הריפו) ומאמת אותו בעלייה. `DATABASE_URL` חסר עוצר את השרת עם הודעה ברורה, במקום להיכשל בבקשה הראשונה. |
| `BullModule.forRootAsync` | מחבר את BullMQ ל-Redis לפי `REDIS_URL`. שומר את 50 העבודות האחרונות שהצליחו ואת 100 האחרונות שנכשלו. |
| `PrismaModule`, `QuotaModule` | מסומנים `@Global()`, ולכן כל מודול אחר יכול להזריק את ה-services שלהם בלי לייבא אותם. |
| `GitHubModule`, `AnalysesModule` | פיצ'רים |
| `HealthController` | רשום ישירות, כי אין לו מודול משלו |

### `config/configuration.ts`

מצהיר על כל משתנה סביבה כשדה במחלקה, עם decorators של ולידציה (`@IsInt()`, `@Min(1)` וכו') וערך ברירת מחדל. כדי להוסיף הגדרה: מוסיפים שדה כאן, מוסיפים אותו ל-`.env.example`, וקוראים אותו עם `config.get('NAME')`. הרשימה המלאה ב[פרק 6](06-running-locally.md#משתני-סביבה).

### `analyses/`: הפיצ'ר המרכזי

**נקודות הקצה** (`analyses.controller.ts`):

| מתודה ונתיב | מה מוחזר | מי משתמש |
|---|---|---|
| `POST /api/analyses` עם הגוף `{ "repoUrl": "…" }` | המזהה והסטטוס של ההרצה החדשה | דף הבית |
| `GET /api/analyses/:id/status` | סטטוס, שלב והתקדמות בלבד (קטן) | דף התוצאות, כל 2 שניות בזמן ריצה |
| `GET /api/analyses/:id` | התוצאה המלאה, עם כל הקבצים | דף התוצאות, אחרי הסיום |
| `GET /api/analyses/shared/:slug` | אותו דבר, לפי ה-slug של השיתוף | קישורי שיתוף |
| `GET /api/analyses/:id/files/:fileId` | פרטים של קובץ אחד | עמוד הקובץ |
| `GET /api/analyses/history?repoUrl=…` | הציונים של הרצות קודמות של ריפו | שמור לתצוגת המגמות (M4) |

**מה קורה ב-`POST`** (`analyses.service.ts`, המתודה `create`):

1. פענוח הכתובת עם `parseRepoUrl` מתוך `@debtmap/shared`.
2. אם לריפו הזה כבר יש הרצה פעילה, **מחזירים את ההרצה הזו** במקום להתחיל עוד אחת.
3. שואלים את GitHub אם הריפו קיים, אם הוא ציבורי ואם הוא בגבולות `MAX_REPO_SIZE_MB` (`GitHubService`).
4. מורידים יחידה אחת מהתקציב היומי של ריפואים (`QuotaService`). אם התקציב נגמר, עונים 503.
5. יוצרים או מעדכנים את שורת ה-`Repository`, ויוצרים שורת `AnalysisRun` בסטטוס `QUEUED` עם slug אקראי לשיתוף.
6. מוסיפים עבודה לתור. מזהה העבודה הוא מזהה ההרצה. עבודה שנכשלה **לא מנוסה שוב**, כי כשלונות ניתוח הם כמעט תמיד דטרמיניסטיים.
7. מחזירים את הסטטוס של ההרצה.

**ה-worker** (`analysis.processor.ts`):

- בעלייה הוא מוחק תיקיות שכפול שנשארו מתהליך קודם.
- לכל עבודה הוא קורא ל-`analyzeRepository(...)` מתוך `@debtmap/analyzer`, עם הגדרות מתוך משתני הסביבה.
- המנוע מדווח על התקדמות דרך callback. ה-processor כותב כל שלב לשורת ההרצה, ומתרגם את השלבים המפורטים של המנוע ל-`RunStatus` הכללי יותר שמוצג בממשק:

  | שלב במנוע | `RunStatus` |
  |---|---|
  | `cloning` | `CLONING` |
  | `discovering`, `git-metrics`, `ast-metrics`, `scoring` | `ANALYZING` |
  | `security` | `SCANNING` |

- בהצלחה הוא שומר את כל מדדי הקבצים בטרנזקציה אחת ומגדיר `COMPLETED`. בכישלון הוא מגדיר `FAILED` עם הודעת השגיאה.

### `github/github.service.ts`

קורא ל-`GET https://api.github.com/repos/:owner/:name` **לפני** השכפול. הוא קורא את ענף ברירת המחדל, את הגודל ואת הנראות. הוא זורק שגיאה ספציפית ל"לא נמצא / פרטי", ל"גדול מדי" ול"חרגת ממגבלת הבקשות", וכל אחת מהן הופכת לשגיאת HTTP ברורה למשתמש. אם מוגדר `GITHUB_TOKEN` הוא שולח אותו. בלי טוקן, GitHub מאפשר רק 60 בקשות בשעה.

### `quota/`

`QuotaService` מחזיק ב-Redis מונים יומיים (`repos`, `gemini`) שמתאפסים כל יום. הם שומרים שהשימוש יישאר בגבולות השכבה החינמית (`DAILY_REPO_BUDGET`, `AI_DAILY_REQUEST_BUDGET`). `redis.provider.ts` יוצר את החיבור המשותף ל-Redis.

### `security/advisory-cache.service.ts`

OSV.dev מחזיר בתשובה המרוכזת שלו רק מזהים של פרצות, כך שכל פרצה דורשת בקשה נוספת כדי לקבל את הפרטים. הפרטים זהים לכל ריפו שמשתמש באותה חבילה, ולכן הם נשמרים במטמון בטבלה `vulnerability_cache` למשך 7 ימים. המנוע מגדיר את הממשק של המטמון (`AdvisoryCache`), וה-service הזה מממש אותו מעל Postgres. כך המנוע עצמו לעולם לא תלוי במסד נתונים.

### `health/health.controller.ts`

| נקודת קצה | מטרה |
|---|---|
| `GET /api/health` | מחזיר `ok`, את זמן הפעולה, וכמה נשאר מהמכסות של היום |
| `POST /api/health/warmup` | פותח מראש את החיבור למסד הנתונים. Postgres מתארח (Neon) נרדם כשאין פעילות, וקריאה לזה לפני הדגמה חוסכת בקשה ראשונה איטית. |

### `prisma/prisma.service.ts`

יורש מ-`PrismaClient` כדי שאפשר יהיה להזריק את ה-client של מסד הנתונים כמו כל service אחר. הוא מתחבר דרך ה-driver adapter של `pg` (חובה ב-Prisma 7), עם מאגר חיבורים קטן.

### מסד הנתונים: `schema.prisma`

</div>
<div dir="ltr">

```
Repository 1 ──── * AnalysisRun 1 ──── * FileMetric 1 ──── 0..1 AiExplanation

VulnerabilityCache   (standalone; shared by all runs)
```

</div>
<div dir="rtl">

| טבלה | שורה אחת לכל | עמודות מרכזיות |
|---|---|---|
| `repositories` | ריפו ב-GitHub | `url` (ייחודי, למשל `github.com/owner/name`), `owner`, `name`, `defaultBranch` |
| `analysis_runs` | ניתוח | `status`, `stage`, `progress`, `error`, `commitSha`, `securityScore`, `bugPronenessScore`, `scanOutcomes` (JSON), `repositoryFindings` (JSON), `shareSlug` |
| `file_metrics` | קובץ בהרצה | גולמי: `churnCommits`, `churnLinesChanged`, `bugCommits`, `cyclomaticComplexity`, `maxNestingDepth`, `loc`. ציונים: `churnScore`, `bugScore`, `complexityScore`, `bugPronenessScore`, `securityScore`. וגם `securityFindings` (JSON). |
| `ai_explanations` | קובץ שהוסבר (M3) | סיכום והמלצה באנגלית ובעברית, `cacheKey` |
| `vulnerability_cache` | פרצה מ-OSV | `osvId`, `severity`, `cvss`, `fixedVersions` (JSON), `fetchedAt` |

מחיקת ריפו מוחקת את ההרצות שלו, ומחיקת הרצה מוחקת את מדדי הקבצים שלה (`onDelete: Cascade`).

כדי לראות את הנתונים בדפדפן: `npm run prisma:studio`.

### משימות נפוצות

| משימה | איך |
|---|---|
| להפעיל את ה-API | `npm run dev:api` מהשורש. הוא עולה מחדש אוטומטית כששומרים קובץ תחת `apps/api/src`. |
| להוסיף נקודת קצה | להוסיף מתודה ל-controller, עם הלוגיקה ב-service המתאים. את טיפוס התשובה לשים ב-`packages/shared/src/dto.ts` כדי שגם הממשק יוכל להשתמש בו. |
| להוסיף תחום פיצ'ר | ליצור `src/<feature>/` עם `.module.ts`, `.controller.ts` ו-`.service.ts`, ולהוסיף את המודול ל-`imports` ב-`app.module.ts`. |
| לשנות את מסד הנתונים | לערוך את `prisma/schema.prisma`, ואז `npm run prisma:migrate`. לשמור ב-git את תיקיית ה-migration החדשה. |
| שיניתם קוד ב-`packages/analyzer` או ב-`shared` | לבנות אותו מחדש (`npm run build -w @debtmap/analyzer`) ולהפעיל מחדש את ה-API. מצב ה-watch של ה-API עוקב רק אחרי התיקייה שלו. |
| להריץ טסטים | `npm test -w @debtmap/api` |

</div>
