import { Injectable, inject, signal } from "@angular/core";
import { IoService } from "./io.service";
import {
  forgetOpened,
  lastOpenedFromSettings,
  normalizePeopleSort,
  peopleSortFromSettings,
  retargetOpened,
  stampOpened,
  type PeopleSortMethod,
} from "./people-sort";
import { settingsWithoutSecrets } from "./research";

@Injectable({ providedIn: "root" })
export class PeopleSortService {
  private readonly io = inject(IoService);

  readonly method = signal<PeopleSortMethod>("name-az");
  readonly lastOpened = signal<Record<string, string>>({});

  async load(): Promise<void> {
    const settings = await this.io.getSettings();
    this.method.set(peopleSortFromSettings(settings));
    this.lastOpened.set(lastOpenedFromSettings(settings));
  }

  async set(method: PeopleSortMethod): Promise<void> {
    const next = normalizePeopleSort(method);
    if (next === this.method()) return;
    this.method.set(next);
    await this.persist();
  }

  async rememberOpened(slug: string, at: string = new Date().toISOString()): Promise<void> {
    const key = slug.trim();
    if (!key) return;
    const next = stampOpened(this.lastOpened(), key, at);
    if (next[key] === this.lastOpened()[key]) return;
    this.lastOpened.set(next);
    await this.persist();
  }

  async forget(slug: string): Promise<void> {
    const next = forgetOpened(this.lastOpened(), slug);
    if (Object.keys(next).length === Object.keys(this.lastOpened()).length) return;
    this.lastOpened.set(next);
    await this.persist();
  }

  async retarget(fromSlug: string, toSlug: string): Promise<void> {
    const next = retargetOpened(this.lastOpened(), fromSlug, toSlug);
    if (JSON.stringify(next) === JSON.stringify(this.lastOpened())) return;
    this.lastOpened.set(next);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const settings = await this.io.getSettings();
    await this.io.saveSettings(
      settingsWithoutSecrets({
        ...settings,
        peopleSort: this.method(),
        peopleLastOpened: this.lastOpened(),
      }) as typeof settings,
    );
  }
}
