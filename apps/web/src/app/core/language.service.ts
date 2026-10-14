import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export const LANGUAGES = ['en', 'he'] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = 'debtmap.language';
const RTL_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['he']);

/**
 * Runtime language switching.
 *
 * Angular's built-in i18n compiles one bundle per locale and cannot switch
 * without a page load, which rules it out for a toggle in the header. These are
 * static translation files with no model involved — the only generated text in
 * the product is the per-file explanation, which arrives from the API already
 * written in both languages.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);
  private readonly document = inject(DOCUMENT);

  private readonly current = signal<Language>(this.readInitial());

  readonly language = this.current.asReadonly();
  readonly isRtl = computed(() => RTL_LANGUAGES.has(this.current()));
  readonly direction = computed<'rtl' | 'ltr'>(() => (this.isRtl() ? 'rtl' : 'ltr'));

  constructor() {
    this.translate.addLangs([...LANGUAGES]);
    this.translate.setFallbackLang('en');

    effect(() => {
      const language = this.current();
      this.translate.use(language);

      const root = this.document.documentElement;
      root.lang = language;
      root.dir = RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';

      try {
        localStorage.setItem(STORAGE_KEY, language);
      } catch {
        // Private browsing or blocked storage: the choice simply will not
        // survive a reload, which is not worth failing the switch over.
      }
    });
  }

  set(language: Language): void {
    this.current.set(language);
  }

  toggle(): void {
    this.current.update((language) => (language === 'en' ? 'he' : 'en'));
  }

  private readInitial(): Language {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isLanguage(stored)) return stored;
    } catch {
      // Fall through to the browser preference.
    }

    const browser = navigator.language?.slice(0, 2).toLowerCase();
    return isLanguage(browser) ? browser : 'en';
  }
}

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
