import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { DIORAMA_MENU_LABEL } from "./services/imagine";
import {
  IDENTITY_TRANSFORM,
  type ImagePreview,
  type PreviewTransform,
  panPreview,
  pointerDistance,
  pointerMidpoint,
  previewImageSrc,
  stepPreviewZoom,
  wheelPreviewZoom,
  zoomPreview,
} from "./image-preview";

@Component({
  selector: "app-image-preview",
  templateUrl: "./image-preview.component.html",
  styleUrl: "./image-preview.component.css",
})
export class ImagePreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild("stage") stage?: ElementRef<HTMLElement>;
  @Input({ required: true }) preview!: ImagePreview;
  @Input() dioramaBusy = false;
  @Input() dioramaLabel = DIORAMA_MENU_LABEL;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly imagine = new EventEmitter<void>();

  transform: PreviewTransform = IDENTITY_TRANSFORM;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch:
    | { distance: number; start: PreviewTransform; mid: { x: number; y: number } }
    | null = null;
  private lastPan: { x: number; y: number } | null = null;
  private wheelBound = false;

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
    }
  }

  ngAfterViewInit(): void {
    const host = this.stage?.nativeElement;
    if (!host || this.wheelBound) return;
    host.addEventListener("wheel", this.onWheel, { passive: false });
    this.wheelBound = true;
  }

  ngOnDestroy(): void {
    this.stage?.nativeElement.removeEventListener("wheel", this.onWheel);
    this.wheelBound = false;
  }

  close(): void {
    this.closed.emit();
  }

  onBackdrop(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-image-preview-chrome]")) return;
    if (target.closest("[data-image-preview-photo]")) return;
    this.close();
  }

  zoomBy(direction: 1 | -1): void {
    const host = this.stage?.nativeElement;
    const originX = (host?.clientWidth ?? 0) / 2;
    const originY = (host?.clientHeight ?? 0) / 2;
    this.transform = stepPreviewZoom(this.transform, direction, originX, originY);
  }

  onDblClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.transform.scale > 1) {
      this.transform = IDENTITY_TRANSFORM;
      return;
    }
    this.transform = zoomPreview(this.transform, 2.5, event.clientX, event.clientY);
  }

  onPointerDown(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        distance: pointerDistance(a, b),
        start: { ...this.transform },
        mid: pointerMidpoint(a, b),
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
      this.transform = panPreview(
        this.transform,
        event.clientX - this.lastPan.x,
        event.clientY - this.lastPan.y,
      );
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

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.transform = wheelPreviewZoom(this.transform, event.deltaY, event.clientX, event.clientY);
  };
}
