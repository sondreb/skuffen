import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from "@angular/core";
import type { PersonView } from "../models";
import {
  galleryInitials,
  galleryPhotoUrl,
  type PeopleGalleryMode,
} from "./people-gallery";

type GalleryTile = {
  slug: string;
  title: string;
  photoSrc: string | null;
  initials: string;
};

type LeaveTile = GalleryTile & {
  top: number;
  left: number;
  width: number;
  height: number;
};

const MOTION_MS = 320;
const MOTION_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

@Component({
  selector: "app-people-gallery",
  template: `
    <div
      class="gallery-root"
      [attr.data-people-gallery-layout]="mode"
      [attr.data-people-gallery-count]="visible.length"
    >
      <div class="gallery-grid" [attr.data-mode]="mode">
        @for (tile of visible; track tile.slug) {
          <button
            type="button"
            class="gallery-tile"
            [class.is-enter]="entering.has(tile.slug)"
            [class.is-active]="tile.slug === selectedSlug"
            [attr.data-people-gallery-thumb]="tile.slug"
            [attr.aria-label]="tile.title"
            (click)="openPerson.emit(tile.slug)"
            (keydown.enter)="openPerson.emit(tile.slug)"
          >
            <span class="gallery-thumb">
              @if (tile.photoSrc) {
                <img [src]="tile.photoSrc" alt="" />
              } @else {
                <span class="gallery-initials">{{ tile.initials }}</span>
              }
            </span>
            <span class="gallery-caption">{{ tile.title }}</span>
          </button>
        }
      </div>
      @for (tile of leaving; track tile.slug) {
        <button
          type="button"
          class="gallery-tile is-leave"
          tabindex="-1"
          aria-hidden="true"
          [attr.data-people-gallery-leaving]="tile.slug"
          [style.top.px]="tile.top"
          [style.left.px]="tile.left"
          [style.width.px]="tile.width"
          [style.height.px]="tile.height"
        >
          <span class="gallery-thumb">
            @if (tile.photoSrc) {
              <img [src]="tile.photoSrc" alt="" />
            } @else {
              <span class="gallery-initials">{{ tile.initials }}</span>
            }
          </span>
          <span class="gallery-caption">{{ tile.title }}</span>
        </button>
      }
    </div>
  `,
  styleUrl: "./people-gallery.component.css",
})
export class PeopleGalleryComponent implements OnChanges, OnDestroy {
  @Input() people: PersonView[] = [];
  @Input() mode: PeopleGalleryMode = "large";
  @Input() selectedSlug: string | null = null;
  @Output() readonly openPerson = new EventEmitter<string>();

  visible: GalleryTile[] = [];
  leaving: LeaveTile[] = [];
  entering = new Set<string>();

  private leaveTimer?: ReturnType<typeof setTimeout>;
  private enterTimer?: ReturnType<typeof setTimeout>;
  private layoutFirst: Map<string, DOMRect> | null = null;

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["people"]) {
      this.reconcilePeople();
      return;
    }
    if (changes["mode"] && !changes["mode"].firstChange) {
      this.layoutFirst = this.measure();
      requestAnimationFrame(() => {
        if (this.layoutFirst) this.playFlip(this.layoutFirst);
        this.layoutFirst = null;
      });
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.leaveTimer);
    clearTimeout(this.enterTimer);
  }

  private reconcilePeople(): void {
    const next = this.people.map((person) => this.toTile(person));
    const first = this.measure();
    const prevSlugs = this.visible.map((tile) => tile.slug);
    const nextSlugs = next.map((tile) => tile.slug);
    const nextSet = new Set(nextSlugs);
    const reduced = this.reducedMotion();

    const leaving: LeaveTile[] = [];
    if (!reduced) {
      for (const tile of this.visible) {
        if (nextSet.has(tile.slug)) continue;
        const box = first.get(tile.slug);
        if (!box) continue;
        leaving.push({
          ...tile,
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
        });
      }
    }

    this.visible = next;
    this.leaving = leaving;
    this.entering = new Set(nextSlugs.filter((slug) => !prevSlugs.includes(slug)));
    this.cdr.detectChanges();

    requestAnimationFrame(() => {
      this.playFlip(first);
      this.clearEnteringSoon();
    });
    this.scheduleLeaveClear();
  }

  private toTile(person: PersonView): GalleryTile {
    return {
      slug: person.slug,
      title: person.title,
      photoSrc: galleryPhotoUrl(person),
      initials: galleryInitials(person.title),
    };
  }

  private measure(): Map<string, DOMRect> {
    const map = new Map<string, DOMRect>();
    const root = this.host.nativeElement;
    for (const el of root.querySelectorAll<HTMLElement>("[data-people-gallery-thumb]")) {
      if (el.classList.contains("is-leave")) continue;
      const slug = el.getAttribute("data-people-gallery-thumb");
      if (!slug) continue;
      map.set(slug, el.getBoundingClientRect());
    }
    return map;
  }

  private playFlip(first: Map<string, DOMRect>): void {
    if (this.reducedMotion() || first.size === 0) return;
    const root = this.host.nativeElement;
    for (const el of root.querySelectorAll<HTMLElement>("[data-people-gallery-thumb]")) {
      if (el.classList.contains("is-leave")) continue;
      const slug = el.getAttribute("data-people-gallery-thumb");
      if (!slug) continue;
      const before = first.get(slug);
      if (!before) continue;
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      const sx = after.width ? before.width / after.width : 1;
      const sy = after.height ? before.height / after.height : 1;
      if (
        Math.abs(dx) < 0.5 &&
        Math.abs(dy) < 0.5 &&
        Math.abs(sx - 1) < 0.02 &&
        Math.abs(sy - 1) < 0.02
      ) {
        continue;
      }
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transform: "none" },
        ],
        { duration: MOTION_MS, easing: MOTION_EASE },
      );
    }
  }

  private clearEnteringSoon(): void {
    clearTimeout(this.enterTimer);
    this.enterTimer = setTimeout(() => {
      this.entering = new Set();
      this.cdr.markForCheck();
    }, MOTION_MS);
  }

  private scheduleLeaveClear(): void {
    clearTimeout(this.leaveTimer);
    const wait = this.reducedMotion() ? 0 : MOTION_MS;
    this.leaveTimer = setTimeout(() => {
      this.leaving = [];
      this.cdr.markForCheck();
    }, wait);
  }

  private reducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
}
