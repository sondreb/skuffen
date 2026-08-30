import { Injectable, signal } from "@angular/core";
import { isTauri, IoService } from "./io.service";
import {
  browserUpdateDecision,
  evaluateUpdate,
  type UpdateDecision,
} from "./update";

@Injectable({ providedIn: "root" })
export class UpdateService {
  readonly result = signal<UpdateDecision | null>(null);
  readonly busy = signal(false);
  readonly installing = signal(false);

  constructor(private readonly io: IoService) {}

  async check(): Promise<UpdateDecision> {
    if (!isTauri()) {
      const decision = browserUpdateDecision();
      this.result.set(decision);
      return decision;
    }
    this.busy.set(true);
    try {
      const runtime = await this.io.desktopRuntimeInfo();
      const release = await this.io.githubPublishedRelease();
      const decision = evaluateUpdate(runtime.version, release, runtime);
      this.result.set(decision);
      return decision;
    } catch (error) {
      const decision: UpdateDecision = {
        kind: "error",
        currentVersion: "",
        message: error instanceof Error ? error.message : String(error),
      };
      this.result.set(decision);
      return decision;
    } finally {
      this.busy.set(false);
    }
  }

  async install(): Promise<UpdateDecision> {
    const current = this.result();
    if (!isTauri()) return this.check();
    if (!current?.asset) {
      const decision: UpdateDecision = {
        kind: "error",
        currentVersion: current?.currentVersion ?? "",
        message: "No installer is ready to download.",
      };
      this.result.set(decision);
      return decision;
    }
    this.installing.set(true);
    try {
      await this.io.downloadAndRunInstaller(current.asset.url, current.asset.name);
      const decision: UpdateDecision = {
        ...current,
        message: `Installing ${current.latestVersion ?? current.asset.name}. Skuffen will close, then reopen.`,
      };
      this.result.set(decision);
      return decision;
    } catch (error) {
      const decision: UpdateDecision = {
        kind: "error",
        currentVersion: current.currentVersion,
        latestVersion: current.latestVersion,
        notes: current.notes,
        asset: current.asset,
        message: error instanceof Error ? error.message : String(error),
      };
      this.result.set(decision);
      return decision;
    } finally {
      this.installing.set(false);
    }
  }
}
