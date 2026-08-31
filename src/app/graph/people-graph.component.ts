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
import type { GraphPersonNode, GraphRelationEdge } from "./graph-edges";
import { graphKindLabel, layoutPeopleGraph } from "./graph-edges";

type DrawnNode = GraphPersonNode & { x: number; y: number; initial: string };
type DrawnEdge = GraphRelationEdge & {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

@Component({
  selector: "app-people-graph",
  template: `
    <div class="graph-root" #root>
      <svg
        class="graph-canvas"
        role="application"
        [attr.aria-label]="ariaLabel"
        [attr.viewBox]="'0 0 ' + width + ' ' + height"
        (wheel)="onWheel($event)"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp()"
        (pointercancel)="onPointerUp()"
      >
        <g [attr.transform]="sceneTransform">
          @for (edge of drawnEdges; track edge.id) {
            <line
              class="graph-edge"
              [class.graph-edge-family]="edge.kind === 'family'"
              [class.graph-edge-business]="edge.kind === 'business'"
              [class.graph-edge-other]="edge.kind === 'other'"
              [class.graph-edge-knows]="edge.kind === 'knows'"
              [class.graph-edge-introduced]="edge.kind === 'introduced-by'"
              [attr.x1]="edge.x1"
              [attr.y1]="edge.y1"
              [attr.x2]="edge.x2"
              [attr.y2]="edge.y2"
              [attr.data-graph-edge]="edge.id"
              [attr.data-graph-kind]="edge.kind"
            >
              <title>{{ edge.from.title }} · {{ kindWord(edge.kind) }} · {{ edge.to.title }}</title>
            </line>
          }
          @for (node of drawnNodes; track node.slug) {
            <g
              class="graph-node"
              [class.graph-node-active]="node.slug === selectedSlug"
              [attr.transform]="'translate(' + node.x + ' ' + node.y + ')'"
              [attr.tabindex]="0"
              role="button"
              [attr.aria-label]="node.title"
              (keydown.enter)="openPerson.emit(node.slug)"
              (keydown.space)="$event.preventDefault(); openPerson.emit(node.slug)"
            >
              <circle class="graph-node-disk" r="22" />
              <text class="graph-node-initial" y="1">{{ node.initial }}</text>
              <text class="graph-node-label" y="38">{{ node.title }}</text>
              <circle class="graph-node-hit" r="28" [attr.data-graph-node]="node.slug" />
            </g>
          }
        </g>
      </svg>
      <div class="graph-zoom" aria-label="Zoom">
        <button type="button" class="graph-zoom-btn" (click)="zoomBy(1.15)" aria-label="Zoom in">+</button>
        <button type="button" class="graph-zoom-btn" (click)="zoomBy(1 / 1.15)" aria-label="Zoom out">−</button>
      </div>
    </div>
  `,
  styleUrl: "./people-graph.component.css",
})
export class PeopleGraphComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild("root") root?: ElementRef<HTMLDivElement>;
  @Input() nodes: GraphPersonNode[] = [];
  @Input() edges: GraphRelationEdge[] = [];
  @Input() selectedSlug: string | null = null;
  @Input() ariaLabel = "Who knows who";
  @Output() readonly openPerson = new EventEmitter<string>();

  width = 1000;
  height = 700;
  drawnNodes: DrawnNode[] = [];
  drawnEdges: DrawnEdge[] = [];
  panX = 0;
  panY = 0;
  scale = 1;

  private resize?: ResizeObserver;
  private dragging = false;
  private dragMoved = false;
  private nodeTarget: string | null = null;
  private startX = 0;
  private startY = 0;
  private startPanX = 0;
  private startPanY = 0;

  get sceneTransform(): string {
    return `translate(${this.panX} ${this.panY}) scale(${this.scale})`;
  }

  ngAfterViewInit(): void {
    const host = this.root?.nativeElement;
    if (!host) return;
    this.resize = new ResizeObserver(() => {
      this.measure();
      this.redraw(true);
    });
    this.resize.observe(host);
    this.measure();
    this.redraw(true);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["nodes"] || changes["edges"]) {
      this.redraw(true);
    }
  }

  ngOnDestroy(): void {
    this.resize?.disconnect();
    this.resize = undefined;
  }

  kindWord(kind: string): string {
    return graphKindLabel(kind);
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    this.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
  }

  zoomBy(factor: number): void {
    this.zoomAt(this.width / 2, this.height / 2, factor);
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.target;
    const node =
      target instanceof Element ? target.closest("[data-graph-node]") : null;
    this.nodeTarget = node?.getAttribute("data-graph-node") ?? null;
    this.dragging = true;
    this.dragMoved = false;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startPanX = this.panX;
    this.startPanY = this.panY;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (Math.hypot(dx, dy) > 4) this.dragMoved = true;
    if (this.nodeTarget && !this.dragMoved) return;
    this.panX = this.startPanX + dx;
    this.panY = this.startPanY + dy;
  }

  onPointerUp(): void {
    if (this.nodeTarget && !this.dragMoved) {
      this.openPerson.emit(this.nodeTarget);
    }
    this.dragging = false;
    this.nodeTarget = null;
  }

  private zoomAt(originX: number, originY: number, factor: number): void {
    const next = clamp(this.scale * factor, 0.4, 3);
    const worldX = (originX - this.panX) / this.scale;
    const worldY = (originY - this.panY) / this.scale;
    this.scale = next;
    this.panX = originX - worldX * next;
    this.panY = originY - worldY * next;
  }

  private measure(): void {
    const host = this.root?.nativeElement;
    if (!host) return;
    this.width = Math.max(host.clientWidth, 1);
    this.height = Math.max(host.clientHeight, 1);
  }

  private redraw(resetView: boolean): void {
    const width = this.width || 1000;
    const height = this.height || 700;
    const placed = layoutPeopleGraph(
      this.nodes.map((node) => node.slug),
      width,
      height,
    );
    this.drawnNodes = this.nodes.map((node) => {
      const point = placed.get(node.slug) ?? { x: width / 2, y: height / 2 };
      return {
        ...node,
        x: point.x,
        y: point.y,
        initial: initialFor(node.title),
      };
    });
    const bySlug = new Map(this.drawnNodes.map((node) => [node.slug, node]));
    this.drawnEdges = this.edges.flatMap((edge) => {
      const from = bySlug.get(edge.from.slug);
      const to = bySlug.get(edge.to.slug);
      if (!from || !to) return [];
      return [{ ...edge, x1: from.x, y1: from.y, x2: to.x, y2: to.y }];
    });
    if (resetView) {
      this.panX = 0;
      this.panY = 0;
      this.scale = 1;
    }
  }
}

function initialFor(title: string): string {
  const letter = title.trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
