<div dir="rtl">

# 3. צד לקוח: `apps/web` (Angular)

[תוכן העניינים](../README.md) · הקודם: [מבנה הריפו](02-repository-structure.md) · הבא: [צד שרת (NestJS)](04-backend-nestjs.md)

לפרק הזה שני חלקים. **חלק א'** מסביר את המושגים של Angular שצריך כדי לקרוא את הקוד, בהנחה שמעולם לא עבדתם עם Angular. **חלק ב'** עובר על `apps/web` קובץ אחרי קובץ ומסמן מה Angular יצר ומה אנחנו כתבנו.

---

## חלק א': Angular בעשר דקות

### מה זה Angular

Angular הוא פריימוורק לבניית **אפליקציות של עמוד יחיד** (Single-Page Application). הדפדפן מוריד פעם אחת דף HTML אחד וחבילת JavaScript. מאותו רגע, מעבר בין מסכים לא טוען את הדף מחדש: Angular מחליף את התוכן במקום ומביא נתונים מהשרת בפורמט JSON.

קוד Angular נכתב ב-**TypeScript**, כלומר JavaScript עם טיפוסים. ה-**Angular CLI** (הפקודה `ng`) הוא כלי שורת הפקודה שיוצר פרויקטים, מריץ את שרת הפיתוח ובונה את גרסת ה-production.

### אבני הבניין

| מושג | מה זה | איפה ב-DebtMap |
|---|---|---|
| **Component (רכיב)** | חתיכה אחת של מסך: מחלקת TypeScript (לוגיקה), תבנית HTML (מבנה) וקובץ עיצוב. | כל עמוד (`home`, `results`, `file-detail`) והמעטפת החיצונית (`app`) |
| **Template (תבנית)** | ה-HTML של הרכיב, עם תחביר נוסף להצגת נתונים ולתגובה לאירועים. | `home.html`, `results.html` וכו' |
| **Service (שירות)** | מחלקה שמחזיקה לוגיקה או נתונים שמשותפים לכמה רכיבים, למשל תקשורת עם השרת. לא מוצגת על המסך. | `AnalysisService`, `LanguageService` |
| **Dependency injection (הזרקת תלויות)** | במקום ליצור שירות עם `new`, הרכיב *מבקש* אותו עם `inject(...)`, ו-Angular מספק מופע משותף. | `private readonly analyses = inject(AnalysisService);` |
| **Router (נתב)** | ממפה כתובות URL לרכיבים: מעבר ל-`/analysis/123` מציג את עמוד התוצאות. | `app.routes.ts` |
| **Signal** | ערך ש-Angular עוקב אחריו. כשהוא משתנה, כל חלק במסך שמשתמש בו מתעדכן אוטומטית. | `signal('')`, `computed(...)` |
| **Pipe** | המרה קטנה בתוך תבנית, שנכתבת עם `|`. | `{{ 'home.heading' \| translate }}` הופך מפתח לטקסט המתורגם |

### האנטומיה של רכיב

כל רכיב בפרויקט הזה מורכב משלושה קבצים עם אותו שם:

</div>
<div dir="ltr">

```
pages/home/
├── home.ts      logic: the class, its data, and its methods
├── home.html    markup: what is drawn on screen
└── home.scss    styles that apply only to this component
```

</div>
<div dir="rtl">

זה `home.ts` בקיצור:

</div>
<div dir="ltr">

```ts
@Component({
  selector: 'app-home',                    // the HTML tag name, <app-home>
  imports: [FormsModule, TranslatePipe],   // what the template is allowed to use
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',              // the markup file
  styleUrl: './home.scss',                 // the style file
})
export class HomePage {
  private readonly analyses = inject(AnalysisService);  // ask Angular for a service

  protected readonly repoUrl = signal('');              // state the template reads
  protected readonly submitting = signal(false);

  protected submit(): void { /* ... */ }                 // called from the template
}
```

</div>
<div dir="rtl">

`@Component({...})` הוא **decorator**: הוא מצמיד למחלקה מידע שאומר ל-Angular "המחלקה הזו היא רכיב, ואלה התבנית והעיצוב שלה".

### תחביר התבניות

תבנית היא HTML עם כמה תוספות. אלה כל התוספות שמופיעות בפרויקט:

| תחביר | משמעות | דוגמה מתוך `home.html` |
|---|---|---|
| `{{ expr }}` | הדפסת ערך כטקסט | `{{ 'home.heading' \| translate }}` |
| `[prop]="expr"` | קביעת מאפיין של אלמנט לפי ערך | `[disabled]="submitting()"` |
| `(event)="code"` | הרצת קוד כשאירוע קורה | `(ngSubmit)="submit()"` |
| `@if (cond) { … }` | הצגת בלוק רק כשהתנאי מתקיים | `@if (errorMessage(); as message) { … }` |
| `@for (x of list; track x.id) { … }` | חזרה על בלוק לכל פריט ברשימה | בטבלת התוצאות |
| `x()` | קריאת signal: קוראים signal על ידי הפעלה שלו כפונקציה | `repoUrl()` |

### Signals: למה יש `()` בכל מקום

</div>
<div dir="ltr">

```ts
const count = signal(0);            // create
count();                            // read  → 0
count.set(5);                       // write
const double = computed(() => count() * 2);  // derived value, recalculated automatically
effect(() => console.log(count())); // run code whenever count changes
```

</div>
<div dir="rtl">

כש-signal שמופיע בתבנית משתנה, Angular מצייר מחדש רק את החלק הזה של המסך. הפרויקט הזה הוא **zoneless** (`provideZonelessChangeDetection()` ב-`app.config.ts`): signals הם הדבר היחיד שגורם לציור מחדש. לכן כל מצב שמוצג על המסך חייב לשבת בתוך signal.

### Observables (RxJS): הסוג השני של ערך אסינכרוני

ה-`HttpClient` של Angular מחזיר **Observable**: זרם שמספק את הערך שלו מאוחר יותר. שום דבר לא קורה עד שמישהו קורא ל-`.subscribe(...)`:

</div>
<div dir="ltr">

```ts
this.analyses.start(url).subscribe({
  next: (run) => this.router.navigate(['/analysis', run.id]),  // success
  error: (err) => this.errorMessage.set('...'),                  // failure
});
```

</div>
<div dir="rtl">

הכלל בקוד הזה: **Observables לתקשורת עם השרת, signals למצב שעל המסך.** קריאת `subscribe` מסתיימת בדרך כלל ב-`.set(...)` על signal.

### Standalone components

בקוד Angular ישן, רכיבים קובצו במחלקות `NgModule`. מאז Angular 17 ברירת המחדל היא רכיבים **standalone**: כל רכיב מצהיר בעצמו על מה שהוא צריך, ב-`imports: [...]`. בפרויקט הזה אין `NgModule` בכלל. אם מדריך ישן מזכיר `app.module.ts`, החלק הזה לא רלוונטי כאן.

---

## חלק ב': `apps/web` קובץ אחרי קובץ

### מה `ng new` יוצר בכל פרויקט Angular

הפרויקט נוצר עם `ng new` (Angular CLI 21.2). זה השלד שכל פרויקט Angular 21 חדש מקבל, ומה התפקיד של כל קובץ:

</div>
<div dir="ltr">

```
apps/web/
├── angular.json          Build configuration: entry file, assets, styles, budgets, dev-server
├── package.json          Dependencies and scripts (ng serve, ng build, ng test)
├── tsconfig.json         TypeScript settings for the whole Angular project
├── tsconfig.app.json     …extended for application code (excludes tests)
├── tsconfig.spec.json    …extended for test code
├── .editorconfig         Editor formatting: 2 spaces, UTF-8
├── .prettierrc           Code formatter settings
├── .gitignore            Angular-specific ignores (.angular/, dist/, …)
├── .vscode/              Suggested VS Code extensions, debug and task configs, Angular MCP server
├── README.md             Generic "how to use the Angular CLI" text
├── public/
│   └── favicon.ico       Copied as-is into the build; anything here is served at the site root
└── src/
    ├── index.html        The single HTML page; contains the <app-root> tag
    ├── main.ts           Entry point: starts Angular with the root component
    ├── styles.scss       Global styles for the whole site
    └── app/
        ├── app.ts        Root component class
        ├── app.html      Root component template
        ├── app.scss      Root component styles
        ├── app.spec.ts   Example test (deleted in this project)
        ├── app.config.ts Application-wide providers: router, HTTP client, …
        └── app.routes.ts URL → component table (empty in a new project)
```

</div>
<div dir="rtl">

| קובץ | הסבר במילים פשוטות |
|---|---|
| `angular.json` | "המתכון" של הבנייה: מאיזה קובץ מתחילים, איזה עיצוב גלובלי לטעון, אילו קבצים להעתיק כמו שהם, ומגבלות גודל |
| `tsconfig*.json` | הגדרות TypeScript. אחת כללית, ושתיים שיורשות ממנה: לקוד האפליקציה ולקוד הטסטים |
| `public/` | כל מה שנמצא כאן מוגש כמו שהוא מכתובת השורש של האתר. `public/favicon.ico` נגיש ב-`/favicon.ico` |
| `src/index.html` | הדף היחיד באתר. כמעט ריק: יש בו תגית `<app-root>`, ו-Angular ממלא אותה |
| `src/main.ts` | נקודת הכניסה: מפעיל את Angular עם רכיב השורש ועם ההגדרות |
| `src/app/` | הקוד של האפליקציה עצמה |

### מה DebtMap הוסיף או שינה

</div>
<div dir="ltr">

```
apps/web/
├── angular.json            generated, edited  allowedCommonJsDependencies: ["@debtmap/shared"]
├── package.json            generated, edited  "start" uses the proxy; added ngx-translate, CDK, d3, @debtmap/shared
├── proxy.conf.json         ours               /api → http://localhost:3100
├── tsconfig*.json          generated
├── .editorconfig           generated
├── .prettierrc             generated
├── .vscode/                generated
├── README.md               generated          Not updated; the docs you are reading replace it
├── public/
│   ├── favicon.ico         generated
│   └── i18n/               ours
│       ├── en.json         ours               English UI text
│       └── he.json         ours               Hebrew UI text
└── src/
    ├── index.html          generated          <title> is still "Web"
    ├── main.ts             generated
    ├── styles.scss         generated, edited  Colour tokens, dark theme, RTL support
    └── app/
        ├── app.ts          generated, edited  Injects LanguageService for the header toggle
        ├── app.html        generated, edited  Header (logo, language button) + <router-outlet>
        ├── app.scss        generated, edited  Header and layout styles
        ├── app.config.ts   generated, edited  Zoneless, router options, HTTP client, translations
        ├── app.routes.ts   generated, edited  The four routes
        ├── core/           ours               Services used across pages
        │   ├── analysis.service.ts
        │   └── language.service.ts
        └── pages/          ours               One folder per screen
            ├── home/
            ├── results/
            └── file-detail/
```

</div>
<div dir="rtl">

כלל אצבע: **כל מה שתחת `core/`, `pages/` ו-`public/i18n/` הוא שלנו.** כל השאר הוא שלד שכל פרויקט Angular מקבל, חלקו עם שינויים קטנים.

### איך האפליקציה עולה

</div>
<div dir="ltr">

```
index.html                 the browser loads this page; it contains <app-root></app-root>
   │
main.ts                    bootstrapApplication(App, appConfig)
   │
app.config.ts              registers providers: router, HTTP, translations, zoneless
   │
app.ts / app.html          the App component fills <app-root>: header + <router-outlet>
   │
app.routes.ts              the router reads the URL and puts the matching page into <router-outlet>
   │
pages/…                    HomePage, ResultsPage or FileDetailPage
```

</div>
<div dir="rtl">

`<router-outlet>` הוא מקום שמור בדף. הכותרת העליונה נשארת קבועה, והעמוד שמתחתיה מתחלף לפי הכתובת.

### `app.config.ts`: הגדרות לכל האפליקציה

| Provider | למה הוא כאן |
|---|---|
| `provideZonelessChangeDetection()` | ציור מחדש רק כש-signals משתנים. מהיר וצפוי יותר מהשיטה הישנה של zone.js. |
| `provideRouter(routes, withComponentInputBinding(), …)` | מפעיל ניתוב. `withComponentInputBinding` מעביר פרמטרים מהכתובת, כמו `:id`, ישירות לשדות `input()` של העמוד. |
| `provideHttpClient(withFetch())` | מספק את `HttpClient`, שמשתמש ב-`fetch` של הדפדפן. |
| `provideTranslateService(...)` | מגדיר את ngx-translate, שטוען את `/i18n/en.json` או את `/i18n/he.json`. |

### `app.routes.ts`: המסכים

| כתובת | עמוד | מטרה |
|---|---|---|
| `/` | `HomePage` | טופס הכתובת |
| `/analysis/:id` | `ResultsPage` | התקדמות בזמן הריצה, ואחר כך התוצאות |
| `/analysis/:id/file/:fileId` | `FileDetailPage` | פרטים על קובץ אחד |
| `/shared/:slug` | `ResultsPage` | קישור שיתוף ציבורי: אותו עמוד, אבל מאותר לפי slug במקום לפי id |
| כל כתובת אחרת | מפנה ל-`/` | |

כל נתיב משתמש ב-`loadComponent: () => import(...)`. זו **טעינה עצלה (lazy loading)**: הקוד של עמוד יורד רק בפעם הראשונה שנכנסים אליו, וכך ההורדה הראשונית נשארת קטנה.

### `core/`: השירותים

**`analysis.service.ts`** הוא הקובץ היחיד שמדבר עם השרת. כל מתודה מתאימה לנקודת קצה אחת ב-API:

| מתודה | קריאת HTTP |
|---|---|
| `start(repoUrl)` | `POST /api/analyses` |
| `status(id)` | `GET /api/analyses/:id/status` |
| `result(id)` | `GET /api/analyses/:id` |
| `shared(slug)` | `GET /api/analyses/shared/:slug` |
| `file(runId, fileId)` | `GET /api/analyses/:id/files/:fileId` |

שגיאות מומרות ל-`AnalysisError` שנושא מפתח תרגום, כדי שהעמודים יוכלו להציג הודעה בשפה של המשתמש. טיפוסי התשובות (`AnalysisRunResponse` ואחרים) מיובאים מ-`@debtmap/shared`. אלה בדיוק אותם טיפוסים שהשרת משתמש בהם כדי לבנות את התשובות. לכן שינוי בצד אחד ששובר את הצד השני ייתפס על ידי הקומפיילר.

**`language.service.ts`** מחליף בין אנגלית לעברית בלי לטעון את הדף מחדש:

- שומר את השפה הנוכחית ב-signal, וזוכר אותה ב-`localStorage`.
- בכל שינוי הוא אומר ל-ngx-translate באיזה קובץ להשתמש, ומגדיר `lang` ו-`dir` על אלמנט ה-`<html>`. ההגדרה `dir="rtl"` היא מה שהופך את כל הפריסה לעברית.

ל-Angular יש מערכת תרגום מובנית משלה, אבל היא בונה עותק נפרד של האתר לכל שפה ולא יכולה להחליף שפה בזמן ריצה, ולכן לא השתמשו בה.

### `pages/`: שלושת המסכים

**`home/`**: דף הנחיתה עם טופס הכתובת. בשליחה הוא בודק את הכתובת עם `parseRepoUrl` מתוך `@debtmap/shared` (אותה בדיקה שהשרת מריץ), קורא ל-`AnalysisService.start`, ועובר ל-`/analysis/:id`.

**`results/`**: העמוד העמוס ביותר.

- מקבל `id` או `slug` מהכתובת דרך `input()`.
- כל עוד ההרצה לא הסתיימה הוא **שואל** את `status` כל 2 שניות ומציג את השלב הנוכחי. כשההרצה מסתיימת הוא מביא את התוצאה המלאה פעם אחת.
- מציג את שני הציונים של הריפו, את הסטטוס של כל סורק, ממצאים ברמת הריפו (25 הראשונים), וטבלת קבצים שאפשר למיין, בנויה עם טבלת Angular CDK.
- "Copy share link" מעתיק את כתובת ה-`/shared/:slug`. "Re-analyse" מתחיל הרצה חדשה של אותו ריפו.
- ערכים נגזרים (הקבצים הממוינים, פסי הצבע של הסיכון) הם signals מסוג `computed`, ולכן הם מחושבים מחדש אוטומטית כשהנתונים או מפתח המיון משתנים.

**`file-detail/`**: המדידות הגולמיות של קובץ אחד (קומיטים, קומיטים של תיקון באג, שורות שהשתנו, מורכבות, קינון) והממצאים האבטחתיים שלו. בטיפוס התשובה יש גם שדה `recentCommits`, אבל ה-API מחזיר אותו כרגע ריק. בעמוד יש גם מקום להסבר של ה-AI בשתי השפות. ההסבר מגיע באבן הדרך M3, שעוד לא התחילה, ולכן החלק הזה ריק בינתיים.

### תרגומים: `public/i18n/*.json`

בתבניות אף פעם אין טקסט גלוי ישירות. יש בהן מפתחות:

</div>
<div dir="ltr">

```html
<h1>{{ 'home.heading' | translate }}</h1>
```

</div>
<div dir="rtl">

והמפתח נשלף מהקובץ הפעיל:

</div>
<div dir="ltr">

```json
// en.json
{ "home": { "heading": "Which files in your repository are actually dangerous?" } }
// he.json
{ "home": { "heading": "אילו קבצים בריפו שלך באמת מסוכנים?" } }
```

</div>
<div dir="rtl">

**כדי להוסיף טקסט:** מוסיפים את אותו מפתח גם ל-`en.json` וגם ל-`he.json`, ומשתמשים בו בתבנית. מפתח שחסר ב-`he.json` יוצג באנגלית.

### עיצוב

- `src/styles.scss` מגדיר **טוקנים** של צבע כמשתני CSS (`--bg`, `--accent`, `--band-critical` וכו'), וכל הרכיבים משתמשים בהם.
- קובץ ה-`.scss` של כל רכיב חל רק על אותו רכיב. Angular תוחם אותו אוטומטית, כך ששם class ב-`home.scss` לא ישפיע על עמוד אחר.
- מימין-לשמאל מטופל בעזרת *logical properties* של CSS (`margin-inline-start` במקום `margin-left`). אותו עיצוב עובד בשני הכיוונים בלי קובץ עיצוב נוסף.

### `proxy.conf.json`: איך הדפדפן מגיע ל-API

בפיתוח, האתר רץ על פורט 4200 וה-API על פורט 3100. הדף קורא לכתובות יחסיות כמו `/api/analyses`. קובץ ה-proxy אומר לשרת הפיתוח של Angular להעביר כל מה שמתחת ל-`/api` אל `http://localhost:3100`. מבחינת הדפדפן יש שרת אחד בלבד, וכך נמנעות בעיות CORS (קריאות בין מקורות שונים).

### תלויות שכדאי להכיר

| חבילה | בשביל מה |
|---|---|
| `@angular/*` | הפריימוורק עצמו |
| `@angular/cdk` | טבלת התוצאות (`CdkTableModule`) |
| `@ngx-translate/core`, `http-loader` | החלפה בין אנגלית לעברית בזמן ריצה |
| `rxjs` | Observables (HTTP, ו-polling עם `interval`) |
| `d3` | הותקן בשביל ה-treemap המתוכנן לאבן הדרך M4. עדיין לא בשימוש |
| `@debtmap/shared` | טיפוסים, פונקציות ציון ומפענח הכתובות, משותפים עם השרת |

### משימות נפוצות

| משימה | איך |
|---|---|
| להפעיל את הממשק | `npm run dev:web` מהשורש, ואז לפתוח את http://localhost:4200. גם ה-API צריך לרוץ. |
| להוסיף עמוד | ליצור `pages/<name>/<name>.ts/.html/.scss` (או להריץ `npx ng generate component pages/<name>` בתוך `apps/web`), ואז להוסיף נתיב ב-`app.routes.ts`. |
| לקרוא לנקודת קצה חדשה ב-API | להוסיף מתודה ל-`core/analysis.service.ts`, ואת טיפוס התשובה ל-`packages/shared/src/dto.ts`. |
| להוסיף טקסט לממשק | להוסיף את המפתח גם ל-`public/i18n/en.json` וגם ל-`he.json`. |
| בניית production | `npm run build -w @debtmap/web`. הפלט נכתב ל-`apps/web/dist/`. |

</div>
