import { DOCUMENT } from "@angular/common";
import { Injectable, computed, inject, signal } from "@angular/core";
import { IoService } from "./io.service";
import { settingsWithoutSecrets } from "./research";
import {
  applyThemeToDocument,
  normalizeThemePreference,
  resolveTheme,
  systemPrefersDark,
  themeFromSettings,
  type ThemePreference,
} from "./theme";

@Injectable({ providedIn: "root" })
export class ThemeService {
  private readonly io = inject(IoService);
  private readonly document = inject(DOCUMENT);

  readonly preference = signal<ThemePreference>("auto");
  private readonly systemDark = signal(false);
  readonly resolved = computed(() => resolveTheme(this.preference(), this.systemDark()));

  private media: MediaQueryList | null = null;
  private readonly onSystemChange = (event: MediaQueryListEvent) => {
    this.systemDark.set(event.matches);
    this.paint();
  };

  constructor() {
    this.watchSystem();
    const hinted = this.document.documentElement.dataset["themePreference"];
    if (hinted) this.preference.set(normalizeThemePreference(hinted));
    this.paint();
  }

  async load(): Promise<void> {
    const settings = await this.io.getSettings();
    this.preference.set(themeFromSettings(settings));
    this.paint();
  }

  async set(preference: ThemePreference): Promise<void> {
    const next = normalizeThemePreference(preference);
    if (next === this.preference()) return;
    this.preference.set(next);
    this.paint();
    await this.persist();
  }

  private watchSystem(): void {
    const view = this.document.defaultView;
    this.media = view?.matchMedia("(prefers-color-scheme: dark)") ?? null;
    this.systemDark.set(systemPrefersDark(this.media));
    this.media?.addEventListener("change", this.onSystemChange);
  }

  private paint(): void {
    const root = this.document.documentElement;
    applyThemeToDocument(root, this.preference(), this.resolved());
  }

  private async persist(): Promise<void> {
    const settings = await this.io.getSettings();
    await this.io.saveSettings(
      settingsWithoutSecrets({
        ...settings,
        theme: this.preference(),
      }) as typeof settings,
    );
  }
}
