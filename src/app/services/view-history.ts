/**
 * In-app view history (browser-style back/forward).
 * Memory only for this session — never OKF, never settings, never the people-graph.
 */

export type AppView = {
  panel: string;
  selectedSlug: string | null;
  selectedPlaceSlug: string | null;
};

export function viewsEqual(a: AppView, b: AppView): boolean {
  return (
    a.panel === b.panel &&
    a.selectedSlug === b.selectedSlug &&
    a.selectedPlaceSlug === b.selectedPlaceSlug
  );
}

export function snapshotView(input: {
  panel: string;
  selectedSlug?: string | null;
  selectedPlaceSlug?: string | null;
}): AppView {
  return {
    panel: input.panel,
    selectedSlug: input.selectedSlug ?? null,
    selectedPlaceSlug: input.selectedPlaceSlug ?? null,
  };
}

/** Small session stack. Does not persist. Does not write the people-graph. */
export class ViewHistory {
  private stack: AppView[] = [];
  private index = -1;

  current(): AppView | null {
    return this.index >= 0 ? this.stack[this.index]! : null;
  }

  canBack(): boolean {
    return this.index > 0;
  }

  canForward(): boolean {
    return this.index >= 0 && this.index < this.stack.length - 1;
  }

  /**
   * Record a move from `from` to `next`. Drops any forward entries (branch).
   * Same view is a no-op. Never touches disk.
   */
  push(from: AppView, next: AppView): AppView {
    if (viewsEqual(from, next)) {
      if (this.index < 0) {
        this.stack = [from];
        this.index = 0;
      }
      return next;
    }
    if (this.index < 0) {
      this.stack = [from, next];
      this.index = 1;
      return next;
    }
    if (!viewsEqual(this.stack[this.index]!, from)) {
      this.stack[this.index] = from;
    }
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(next);
    this.index = this.stack.length - 1;
    return next;
  }

  /** After a completed sheet (save/accept), keep the tip as the result, not the form. */
  replaceTip(view: AppView): void {
    if (this.index < 0) {
      this.stack = [view];
      this.index = 0;
      return;
    }
    this.stack[this.index] = view;
  }

  back(): AppView | null {
    if (!this.canBack()) return null;
    this.index -= 1;
    return this.stack[this.index]!;
  }

  forward(): AppView | null {
    if (!this.canForward()) return null;
    this.index += 1;
    return this.stack[this.index]!;
  }
}
