import { Injectable, computed, inject, signal } from "@angular/core";
import { IoService } from "./io.service";
import { PeopleService } from "./people.service";
import { settingsWithoutSecrets } from "./research";
import { forgetSelf, isSelf, markSelf, normalizeSelfSlug, retargetSelf, unmarkSelf } from "./self";

@Injectable({ providedIn: "root" })
export class SelfService {
  private readonly io = inject(IoService);
  private readonly people = inject(PeopleService);

  readonly selfSlug = signal<string | null>(null);
  readonly owner = computed(() => {
    const slug = this.selfSlug();
    if (!slug) return null;
    return this.people.people().find((person) => person.slug === slug) ?? null;
  });

  isSelf(slug: string): boolean {
    return isSelf(this.selfSlug(), slug);
  }

  async load(): Promise<void> {
    const settings = await this.io.getSettings();
    this.selfSlug.set(normalizeSelfSlug(settings.selfSlug));
  }

  async mark(slug: string): Promise<void> {
    if (this.selfSlug()) return;
    const next = markSelf(this.selfSlug(), slug);
    if (next === this.selfSlug()) return;
    this.selfSlug.set(next);
    await this.persist();
  }

  async unmark(): Promise<void> {
    if (this.selfSlug() === null) return;
    this.selfSlug.set(unmarkSelf());
    await this.persist();
  }

  async toggle(slug: string): Promise<void> {
    if (this.selfSlug()) return;
    await this.mark(slug);
  }

  async retarget(fromSlug: string, toSlug: string): Promise<void> {
    const next = retargetSelf(this.selfSlug(), fromSlug, toSlug);
    if (next === this.selfSlug()) return;
    this.selfSlug.set(next);
    await this.persist();
  }

  async forget(slug: string): Promise<void> {
    const next = forgetSelf(this.selfSlug(), slug);
    if (next === this.selfSlug()) return;
    this.selfSlug.set(next);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const settings = await this.io.getSettings();
    await this.io.saveSettings(
      settingsWithoutSecrets({
        ...settings,
        selfSlug: this.selfSlug(),
      }) as typeof settings,
    );
  }
}
