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
import type { PersonLocation } from "../models";

export interface MapPin {
  slug: string;
  title: string;
  location: PersonLocation;
}

@Component({
  selector: "app-people-map",
  template: `<div class="map-root" #root role="application" aria-label="People map"></div>`,
  styleUrl: "./people-map.component.css",
})
export class PeopleMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild("root") root?: ElementRef<HTMLDivElement>;
  @Input() pins: MapPin[] = [];
  @Input() pending: { latitude: number; longitude: number } | null = null;
  @Input() selectedSlug: string | null = null;
  @Input() clickToDrop = true;
  @Input() focus: { latitude: number; longitude: number; zoom?: number } | null = null;
  @Output() readonly dropPin = new EventEmitter<{ latitude: number; longitude: number }>();
  @Output() readonly openPerson = new EventEmitter<string>();

  private map?: L.Map;
  private markers = L.layerGroup();
  private pendingMarker?: L.Marker;
  private ready = false;

  ngAfterViewInit(): void {
    const host = this.root?.nativeElement;
    if (!host) return;
    this.map = L.map(host, {
      zoomControl: true,
      attributionControl: true,
    }).setView([20, 8], 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);
    this.markers.addTo(this.map);
    this.map.on("click", (event: L.LeafletMouseEvent) => {
      if (!this.clickToDrop) return;
      this.dropPin.emit({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });
    this.ready = true;
    this.redraw();
    this.applyFocus(true);
    queueMicrotask(() => this.map?.invalidateSize());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.ready) return;
    if (changes["pins"] || changes["pending"] || changes["selectedSlug"]) {
      this.redraw();
    }
    if (changes["focus"]) {
      this.applyFocus(false);
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = undefined;
  }

  private redraw(): void {
    if (!this.map) return;
    this.markers.clearLayers();
    for (const pin of this.pins) {
      const kind = pin.slug === this.selectedSlug ? "active" : "person";
      const marker = L.marker([pin.location.latitude, pin.location.longitude], {
        icon: pinIcon(kind),
        title: pin.title,
      });
      marker.bindTooltip(pin.title + (pin.location.address ? ` — ${pin.location.address}` : ""));
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        this.openPerson.emit(pin.slug);
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

function pinIcon(kind: "person" | "active" | "pending"): L.DivIcon {
  return L.divIcon({
    className: `skuffen-pin skuffen-pin-${kind}`,
    html: "<span></span>",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}
