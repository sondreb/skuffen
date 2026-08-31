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
import L from "leaflet";
import type { PersonLocation, RelationKind } from "../models";
import type { MapRelationEdge } from "./map-edges";

export interface MapPin {
  slug: string;
  title: string;
  location: PersonLocation;
  /** First-class Place vs leftover people/{slug}/place.md pin. */
  kind?: "place" | "person";
}

@Component({
  selector: "app-people-map",
  template: `<div class="map-root" #root role="application" [attr.aria-label]="ariaLabel"></div>`,
  styleUrl: "./people-map.component.css",
})
export class PeopleMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild("root") root?: ElementRef<HTMLDivElement>;
  @Input() pins: MapPin[] = [];
  @Input() edges: MapRelationEdge[] = [];
  @Input() pending: { latitude: number; longitude: number } | null = null;
  @Input() selectedSlug: string | null = null;
  @Input() clickToDrop = true;
  @Input() focus: { latitude: number; longitude: number; zoom?: number } | null = null;
  @Input() ariaLabel = "People map";
  @Output() readonly dropPin = new EventEmitter<{ latitude: number; longitude: number }>();
  @Output() readonly openPerson = new EventEmitter<string>();
  @Output() readonly openPlace = new EventEmitter<string>();
  @Output() readonly openPin = new EventEmitter<MapPin>();

  private map?: L.Map;
  private markers = L.layerGroup();
  private lines = L.layerGroup();
  private pendingMarker?: L.Marker;
  private ready = false;
  private resize?: ResizeObserver;

  ngAfterViewInit(): void {
    const host = this.root?.nativeElement;
    if (!host) return;
    this.map = L.map(host, {
      zoomControl: false,
      attributionControl: true,
    }).setView([20, 8], 2);
    this.map.attributionControl.setPosition("bottomleft");
    L.control.zoom({ position: "bottomright" }).addTo(this.map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);
    this.lines.addTo(this.map);
    this.markers.addTo(this.map);
    this.map.on("click", (event: L.LeafletMouseEvent) => {
      if (!this.clickToDrop) return;
      this.dropPin.emit({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });
    this.resize = new ResizeObserver(() => {
      this.map?.invalidateSize();
    });
    this.resize.observe(host);
    this.ready = true;
    this.redraw();
    this.applyFocus(true);
    queueMicrotask(() => this.map?.invalidateSize());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.ready) return;
    if (changes["pins"] || changes["edges"] || changes["pending"] || changes["selectedSlug"]) {
      this.redraw();
    }
    if (changes["focus"]) {
      this.applyFocus(false);
    }
  }

  ngOnDestroy(): void {
    this.resize?.disconnect();
    this.resize = undefined;
    this.map?.remove();
    this.map = undefined;
  }

  private redraw(): void {
    if (!this.map) return;
    this.lines.clearLayers();
    this.markers.clearLayers();
    for (const edge of this.edges) {
      const line = L.polyline(
        [
          [edge.from.latitude, edge.from.longitude],
          [edge.to.latitude, edge.to.longitude],
        ],
        {
          className: `skuffen-edge skuffen-edge-${edge.kind}`,
          color: edgeColor(edge.kind),
          weight: edge.kind === "family" ? 3 : 2,
          opacity: 0.85,
          dashArray: dashFor(edge.kind),
          interactive: false,
        },
      );
      line.bindTooltip(`${edge.from.title} · ${kindWord(edge.kind)} · ${edge.to.title}`);
      line.on("add", () => tagEdge(line, edge.id, edge.kind));
      line.addTo(this.lines);
      tagEdge(line, edge.id, edge.kind);
    }
    for (const pin of this.pins) {
      const selected = pin.slug === this.selectedSlug;
      const markerKind = selected ? "active" : pin.kind === "place" ? "place" : "person";
      const marker = L.marker([pin.location.latitude, pin.location.longitude], {
        icon: pinIcon(markerKind, pin.slug, pin.kind),
        title: pin.title,
      });
      marker.bindTooltip(pin.title + (pin.location.address ? ` — ${pin.location.address}` : ""));
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        this.openPin.emit(pin);
        if (pin.kind === "place") this.openPlace.emit(pin.slug);
        else this.openPerson.emit(pin.slug);
      });
      marker.addTo(this.markers);
    }
    if (this.pendingMarker) {
      this.pendingMarker.remove();
      this.pendingMarker = undefined;
    }
    if (this.pending) {
      this.pendingMarker = L.marker([this.pending.latitude, this.pending.longitude], {
        icon: pinIcon("pending"),
        title: "Pending pin",
        zIndexOffset: 800,
      }).addTo(this.map);
    }
    if (!this.focus && !this.pending && this.pins.length > 0) {
      const bounds = L.latLngBounds(this.pins.map((pin) => [pin.location.latitude, pin.location.longitude]));
      if (this.pins.length === 1) {
        this.map.setView(bounds.getCenter(), 12);
      } else {
        this.map.fitBounds(bounds.pad(0.2));
      }
    }
    this.map.invalidateSize();
  }

  private applyFocus(immediate: boolean): void {
    if (!this.map || !this.focus) return;
    const zoom = this.focus.zoom ?? Math.max(this.map.getZoom(), 13);
    if (immediate) {
      this.map.setView([this.focus.latitude, this.focus.longitude], zoom);
    } else {
      this.map.flyTo([this.focus.latitude, this.focus.longitude], zoom, { duration: 0.6 });
    }
  }
}

function tagEdge(line: L.Polyline, id: string, kind: RelationKind): void {
  const path = line.getElement();
  if (!path) return;
  path.setAttribute("data-map-edge", id);
  path.setAttribute("data-map-kind", kind);
}

function pinIcon(kind: "person" | "place" | "active" | "pending", slug?: string, pinKind?: string): L.DivIcon {
  const pinAttr = slug ? ` data-map-pin="${escapeAttr(slug)}"` : "";
  const kindAttr = pinKind ? ` data-map-pin-kind="${escapeAttr(pinKind)}"` : "";
  return L.divIcon({
    className: `skuffen-pin skuffen-pin-${kind}`,
    html: `<span${pinAttr}${kindAttr}></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function token(name: string, fallback: string): string {
  if (typeof getComputedStyle === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function edgeColor(kind: RelationKind): string {
  if (kind === "family") return token("--accent", "#c4b4a0");
  if (kind === "business") return token("--accent-soft", "#d8cbb8");
  return token("--mute", "#9a9288");
}

function dashFor(kind: RelationKind): string | undefined {
  if (kind === "business") return "8 6";
  if (kind === "other") return "2 7";
  return undefined;
}

function kindWord(kind: RelationKind): string {
  if (kind === "family") return "Family";
  if (kind === "business") return "Business";
  return "Other";
}
