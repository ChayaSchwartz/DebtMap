# 3. Frontend: `apps/web` (Angular)

[Docs index](../README.md) · Previous: [Repository structure](02-repository-structure.md) · Next: [Backend (NestJS)](04-backend-nestjs.md)

This chapter has two parts. **Part A** explains the Angular concepts you need to read this code, assuming you have never used Angular. **Part B** walks through `apps/web` file by file and marks what Angular generated versus what we wrote.

---

## Part A: Angular in ten minutes

### What Angular is

Angular is a framework for building **single-page applications**. The browser downloads one HTML page and a JavaScript bundle once. After that, moving between screens does not reload the page: Angular swaps the content in place and fetches data from the server as JSON.

Angular code is written in **TypeScript** (JavaScript with types). The **Angular CLI** (`ng`) is the command-line tool that creates projects, runs the development server, and builds the production bundle.

### The building blocks

| Concept | What it is | In DebtMap |
|---|---|---|
| **Component** | One piece of screen: a TypeScript class (logic) plus an HTML template (markup) plus a stylesheet. | Each page (`home`, `results`, `file-detail`) and the outer shell (`app`) |
| **Template** | The component's HTML, with extra syntax for showing data and reacting to events. | `home.html`, `results.html`, … |
| **Service** | A class that holds logic or data shared between components, such as talking to the server. Not visible on screen. | `AnalysisService`, `LanguageService` |
| **Dependency injection** | Instead of creating a service with `new`, a component *asks* for it with `inject(...)` and Angular supplies a shared instance. | `private readonly analyses = inject(AnalysisService);` |
| **Router** | Maps URLs to components: visiting `/analysis/123` shows the results page. | `app.routes.ts` |
| **Signal** | A value that Angular watches. When it changes, every part of the screen that uses it updates automatically. | `signal('')`, `computed(...)` |
| **Pipe** | A small transformation used inside templates, written with `|`. | `{{ 'home.heading' \| translate }}` turns a key into the translated text |

### Anatomy of a component

Every component in this project is three files with the same name:

```
pages/home/
├── home.ts      logic: the class, its data, and its methods
├── home.html    markup: what is drawn on screen
└── home.scss    styles that apply only to this component
```

Here is a shortened `home.ts`:

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

`@Component({...})` is a **decorator**: it attaches metadata that tells Angular "this class is a component, and here are its template and styles".

### Template syntax

Templates are HTML plus a handful of additions. These are all of the ones used in this project:

| Syntax | Meaning | Example from `home.html` |
|---|---|---|
| `{{ expr }}` | Print a value as text | `{{ 'home.heading' \| translate }}` |
| `[prop]="expr"` | Set an element property from a value | `[disabled]="submitting()"` |
| `(event)="code"` | Run code when an event fires | `(ngSubmit)="submit()"` |
| `@if (cond) { … }` | Show a block only when the condition holds | `@if (errorMessage(); as message) { … }` |
| `@for (x of list; track x.id) { … }` | Repeat a block for every item | used in the results table |
| `x()` | Read a signal: signals are read by calling them | `repoUrl()` |

### Signals: why `()` everywhere

```ts
const count = signal(0);            // create
count();                            // read  → 0
count.set(5);                       // write
const double = computed(() => count() * 2);  // derived value, recalculated automatically
effect(() => console.log(count())); // run code whenever count changes
```

When a signal used in a template changes, Angular redraws just that part of the screen. This project is **zoneless** (`provideZonelessChangeDetection()` in `app.config.ts`): signals are the only thing that triggers redraws, so state shown on screen must live in a signal.

### Observables (RxJS): the other kind of async value

Angular's `HttpClient` returns an **Observable**, a stream that delivers its value later. Nothing happens until something calls `.subscribe(...)`:

```ts
this.analyses.start(url).subscribe({
  next: (run) => this.router.navigate(['/analysis', run.id]),  // success
  error: (err) => this.errorMessage.set('...'),                  // failure
});
```

The rule of thumb in this codebase: **Observables for talking to the server, signals for state on screen.** A `subscribe` callback usually ends by calling `.set(...)` on a signal.

### Standalone components

Older Angular code grouped components into `NgModule` classes. Since Angular 17 the default is **standalone** components: each one lists what it needs in its own `imports: [...]`. This project has no `NgModule` at all. If you read an older tutorial that mentions `app.module.ts`, that part does not apply here.

---

## Part B: `apps/web` file by file

### What `ng new` creates in every Angular project

The project was created with `ng new` (Angular CLI 21.2). This is the skeleton every new Angular 21 project gets, and what each file is for:

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

### What DebtMap added or changed

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

### How the app starts

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

`<router-outlet>` is a placeholder. The header stays fixed and the page under it changes with the URL.

### `app.config.ts`: application-wide setup

| Provider | Why it is here |
|---|---|
| `provideZonelessChangeDetection()` | Redraw only when signals change. Faster and more predictable than the older zone.js approach. |
| `provideRouter(routes, withComponentInputBinding(), …)` | Turns on routing. `withComponentInputBinding` passes URL parameters such as `:id` straight into the page's `input()` fields. |
| `provideHttpClient(withFetch())` | Makes `HttpClient` available, using the browser's `fetch`. |
| `provideTranslateService(...)` | Sets up ngx-translate, which loads `/i18n/en.json` or `/i18n/he.json`. |

### `app.routes.ts`: the screens

| URL | Page | Purpose |
|---|---|---|
| `/` | `HomePage` | The URL form |
| `/analysis/:id` | `ResultsPage` | Progress while running, then results |
| `/analysis/:id/file/:fileId` | `FileDetailPage` | Details for one file |
| `/shared/:slug` | `ResultsPage` | Public share link: the same page, looked up by slug instead of id |
| anything else | redirects to `/` | |

Every route uses `loadComponent: () => import(...)`. This is **lazy loading**: a page's code is downloaded only when the user first visits it, which keeps the initial download small.

### `core/`: services

**`analysis.service.ts`** is the only file that talks to the backend. Each method maps to one API endpoint:

| Method | HTTP call |
|---|---|
| `start(repoUrl)` | `POST /api/analyses` |
| `status(id)` | `GET /api/analyses/:id/status` |
| `result(id)` | `GET /api/analyses/:id` |
| `shared(slug)` | `GET /api/analyses/shared/:slug` |
| `file(runId, fileId)` | `GET /api/analyses/:id/files/:fileId` |

Errors are converted into an `AnalysisError` carrying a translation key, so pages can show a message in the user's language. The response types (`AnalysisRunResponse` and others) are imported from `@debtmap/shared`. They are the very same types the backend uses to build those responses, so a change on one side that breaks the other is caught by the compiler.

**`language.service.ts`** handles switching between English and Hebrew without reloading the page:

- Keeps the current language in a signal and remembers it in `localStorage`.
- On every change it tells ngx-translate which file to use, and sets `lang` and `dir` on the `<html>` element. `dir="rtl"` is what flips the whole layout for Hebrew.

Angular has its own built-in translation system, but it builds a separate copy of the site per language and cannot switch at runtime, so it was not used.

### `pages/`: the three screens

**`home/`**: the landing page with the URL form. On submit it checks the URL with `parseRepoUrl` from `@debtmap/shared` (the same check the server runs), calls `AnalysisService.start`, and navigates to `/analysis/:id`.

**`results/`**: the busiest page.

- Receives `id` or `slug` from the URL as an `input()`.
- While the run is not finished, it **polls** `status` every 2 seconds and shows the current stage. When the run finishes it fetches the full result once.
- Shows the two repository scores, the status of each scanner, repository-level findings (top 25), and a sortable table of files built with the Angular CDK table.
- "Copy share link" copies the `/shared/:slug` URL. "Re-analyse" starts a new run of the same repository.
- Derived values (sorted files, risk colour bands) are `computed` signals, so they recalculate automatically when the data or the sort key changes.

**`file-detail/`**: one file's raw measurements (commits, bug-fix commits, lines changed, complexity, nesting) and its security findings. The response type also has a `recentCommits` field, but the API currently returns it empty. The page also has room for the AI explanation in both languages; that comes with milestone M3, which has not started yet, so the section is empty for now.

### Translations: `public/i18n/*.json`

Templates never contain visible text directly. They contain keys:

```html
<h1>{{ 'home.heading' | translate }}</h1>
```

and the key is looked up in the active file:

```json
// en.json
{ "home": { "heading": "Which files in your repository are actually dangerous?" } }
// he.json
{ "home": { "heading": "אילו קבצים בריפו שלך באמת מסוכנים?" } }
```

**To add text:** add the same key to both `en.json` and `he.json`, then use it in a template. A key missing from `he.json` falls back to English.

### Styles

- `src/styles.scss` defines colour **tokens** as CSS variables (`--bg`, `--accent`, `--band-critical`, …) used by every component.
- Each component's `.scss` applies only to that component. Angular scopes it automatically, so a class name in `home.scss` cannot affect another page.
- Right-to-left is handled with CSS *logical properties* (`margin-inline-start` instead of `margin-left`). The same styles work in both directions without a second stylesheet.

### `proxy.conf.json`: how the browser reaches the API

In development the site runs on port 4200 and the API on port 3100. The page calls relative URLs such as `/api/analyses`. The proxy file tells the Angular dev server to forward anything under `/api` to `http://localhost:3100`. As far as the browser is concerned there is a single server, which avoids cross-origin (CORS) problems.

### Dependencies worth knowing

| Package | Used for |
|---|---|
| `@angular/*` | The framework itself |
| `@angular/cdk` | The results table (`CdkTableModule`) |
| `@ngx-translate/core`, `http-loader` | Runtime English/Hebrew switching |
| `rxjs` | Observables (HTTP, polling with `interval`) |
| `d3` | Installed for the treemap planned in milestone M4; not used yet |
| `@debtmap/shared` | Types, scoring helpers, and the URL parser shared with the backend |

### Common tasks

| Task | How |
|---|---|
| Start the frontend | `npm run dev:web` from the root, then open http://localhost:4200. The API must be running too. |
| Add a page | Create `pages/<name>/<name>.ts/.html/.scss` (or run `npx ng generate component pages/<name>` inside `apps/web`), then add a route in `app.routes.ts`. |
| Call a new API endpoint | Add a method to `core/analysis.service.ts` and its response type to `packages/shared/src/dto.ts`. |
| Add UI text | Add the key to both `public/i18n/en.json` and `he.json`. |
| Production build | `npm run build -w @debtmap/web`; output goes to `apps/web/dist/`. |
