import { Injectable } from "@angular/core";
import { DEMO_PARK_HIT, demoGeocodeHit, isDemoMode } from "../demo-mode";

export interface GeocodeHit {
  label: string;
  latitude: number;
  longitude: number;
}

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

@Injectable({ providedIn: "root" })
export class GeocodeService {
  private lastCall = 0;

  async search(query: string): Promise<GeocodeHit[]> {
    const q = query.trim();
    if (!q) return [];
    if (isDemoMode()) {
      return [demoGeocodeHit(q)];
    }
    await this.throttle();
    const url = new URL(NOMINATIM_SEARCH);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "5");
    url.searchParams.set("addressdetails", "0");
    const rows = await this.fetchJson<NominatimHit[]>(url);
    return (Array.isArray(rows) ? rows : [])
      .map((row) => this.toHit(row))
      .filter((hit): hit is GeocodeHit => hit !== null);
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodeHit | null> {
    if (isDemoMode()) {
      return { ...DEMO_PARK_HIT, latitude, longitude };
    }
    await this.throttle();
    const url = new URL(NOMINATIM_REVERSE);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("zoom", "16");
    const row = await this.fetchJson<NominatimHit>(url);
    return this.toHit(row, latitude, longitude);
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Address search is unavailable (${response.status}). Tiles and geocode use the public internet; people data stays on this machine.`);
    }
    return (await response.json()) as T;
  }

  private toHit(row: NominatimHit | null | undefined, fallbackLat?: number, fallbackLng?: number): GeocodeHit | null {
    if (!row) return null;
    const latitude = Number(row.lat ?? fallbackLat);
    const longitude = Number(row.lon ?? fallbackLng);
    const label = typeof row.display_name === "string" ? row.display_name.trim() : "";
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !label) return null;
    return { label, latitude, longitude };
  }

  private async throttle(): Promise<void> {
    const wait = Math.max(0, 1100 - (Date.now() - this.lastCall));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastCall = Date.now();
  }
}

interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
}
