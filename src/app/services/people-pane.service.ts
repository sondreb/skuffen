import { DOCUMENT } from "@angular/common";
import { Injectable, inject, signal } from "@angular/core";
import { IoService } from "./io.service";
import {
  collapsedFromSettings,
  defaultCollapsedForWidth,
  resolvePeoplePaneCollapsed,
} from "./people-pane";
import { settingsWithoutSecrets } from "./research";

@Injectable({ providedIn: "root" })
export class PeoplePaneService {
  private readonly io = inject(IoService);
  private readonly document = inject(DOCUMENT);

  readonly collapsed = signal(false);
  readonly filterOpen = signal(false);
  private pinned = false;

  private readonly onWindowResize = () => {
    if (this.pinned) return;
    this.collapsed.set(defaultCollapsedForWidth(this.windowWidth()));
  };

  constructor() {
    this.document.defaultView?.addEventListener("resize", this.onWindowResize);
    this.collapsed.set(defaultCollapsedForWidth(this.windowWidth()));
  }

  async load(): Promise<void> {
    const settings = await this.io.getSettings();
    const stored = collapsedFromSettings(settings);
    this.pinned = stored !== null;
    this.collapsed.set(resolvePeoplePaneCollapsed(stored, this.windowWidth()));
    if (this.collapsed()) this.filterOpen.set(false);
  }

  async toggle(): Promise<void> {
    await this.setCollapsed(!this.collapsed());
  }

  async setCollapsed(next: boolean): Promise<void> {
    this.pinned = true;
    this.collapsed.set(next);
    this.filterOpen.set(false);
    await this.persist();
  }

  openFilter(): void {
    this.filterOpen.set(true);
  }

  toggleFilter(): void {
    this.filterOpen.update((open) => !open);
  }

  closeFilter(): void {
    this.filterOpen.set(false);
  }

  private windowWidth(): number {
    return this.document.defaultView?.innerWidth ?? 0;
  }

  private async persist(): Promise<void> {
    const settings = await this.io.getSettings();
    await this.io.saveSettings(
      settingsWithoutSecrets({
        ...settings,
        peoplePaneCollapsed: this.collapsed(),
      }) as typeof settings,
    );
  }
}
