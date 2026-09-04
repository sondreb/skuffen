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
  ViewChild,
  inject,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { DIORAMA_MENU_LABEL } from "./services/imagine";
import {
  IDENTITY_TRANSFORM,
  type ImagePreview,
  type PreviewRect,
  type PreviewTransform,
  panPreview,
  pointerDistance,
  pointerMidpoint,
  previewImageSrc,
  previewOriginFromPointer,
  stepPreviewZoom,
  wheelPreviewZoomAtPointer,
  zoomPreview,
} from "./image-preview";

@Component({
  selector: "app-image-preview",
  imports: [MatButtonModule],
  templateUrl: "./image-preview.component.html",
  styleUrl: "./image-preview.component.css",
})
export class ImagePreviewComponent implements OnChanges, OnDestroy {
  @ViewChild("stage")
  set stage(ref: ElementRef<HTMLElement> | undefined) {
    this.bindWheel(ref?.nativeElement ?? null);
  }
  @Input({ required: true }) preview!: ImagePreview;
  @Input() dioramaBusy = false;
  @Input() dioramaLabel = DIORAMA_MENU_LABEL;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly imagine = new EventEmitter<void>();

  transform: PreviewTransform = IDENTITY_TRANSFORM;
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch:
    | { distance: number; start: PreviewTransform; mid: { x: number; y: number } }
    | null = null;
  private lastPan: { x: number; y: number } | null = null;
  private didPan = false;
  private stageEl: HTMLElement | null = null;

  get src(): string | null {
    return previewImageSrc(this.preview.src);
  }

  get showDiorama(): boolean {
    return Boolean(this.preview.diorama && this.src);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["preview"]) {
      this.transform = IDENTITY_TRANSFORM;
      this.pointers.clear();
      this.pinch = null;
      this.lastPan = null;
      this.didPan = false;
    }
  }

  ngOnDestroy(): void {
    this.bindWheel(null);
  }

  close(): void {
    this.closed.emit();
  }

  onBackdrop(event: MouseEvent): void {
    if (this.didPan) {
      this.didPan = false;
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-image-preview-chrome]")) return;
    if (target.closest("[data-image-preview-photo]")) return;
    this.close();
  }

  zoomBy(direction: 1 | -1): void {
    this.transform = stepPreviewZoom(this.transform, direction, 0, 0);
  }

  onDblClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.transform.scale > 1) {
      this.transform = IDENTITY_TRANSFORM;
      return;
    }
    const origin = this.originAt(event.clientX, event.clientY);
    this.transform = zoomPreview(this.transform, 2.5, origin.x, origin.y);
  }

  onPointerDown(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const mid = pointerMidpoint(a, b);
      this.pinch = {
        distance: pointerDistance(a, b),
        start: { ...this.transform },
        mid: this.originAt(mid.x, mid.y),
      };
      this.lastPan = null;
      return;
    }
    this.lastPan = this.transform.scale > 1 ? { x: event.clientX, y: event.clientY } : null;
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const distance = pointerDistance(a, b);
      const factor = this.pinch.distance ? distance / this.pinch.distance : 1;
      this.transform = zoomPreview(
        this.pinch.start,
        this.pinch.start.scale * factor,
        this.pinch.mid.x,
        this.pinch.mid.y,
      );
      return;
    }
    if (this.lastPan && this.transform.scale > 1) {
      const dx = event.clientX - this.lastPan.x;
      const dy = event.clientY - this.lastPan.y;
      if (dx || dy) this.didPan = true;
      this.transform = panPreview(this.transform, dx, dy);
      this.lastPan = { x: event.clientX, y: event.clientY };
    }
  }

  onPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      this.lastPan = null;
      return;
    }
    const remaining = [...this.pointers.values()][0];
    this.lastPan = this.transform.scale > 1 ? remaining : null;
  }

  transformCss(): string {
    const { scale, x, y } = this.transform;
    return `translate(${x}px, ${y}px) scale(${scale})`;
  }

  private bindWheel(host: HTMLElement | null): void {
    if (this.stageEl === host) return;
    this.stageEl?.removeEventListener("wheel", this.onWheel);
    this.stageEl = host;
    this.stageEl?.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private photoRect(): PreviewRect | null {
    const img = this.stageEl?.querySelector("[data-image-preview-photo]");
    if (!(img instanceof HTMLElement)) return null;
    const rect = img.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  private originAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.photoRect();
    if (!rect) return { x: 0, y: 0 };
    return previewOriginFromPointer(clientX, clientY, this.transform, rect);
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.photoRect();
    if (!rect) return;
    this.transform = wheelPreviewZoomAtPointer(
      this.transform,
      event.deltaY,
      event.clientX,
      event.clientY,
      rect,
    );
    this.cdr.detectChanges();
  };
}
