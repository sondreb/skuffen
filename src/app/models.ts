export type ProviderId = "grok" | "gemini";
export type FollowInterval = "daily" | "weekly" | "monthly";
export type SuggestionSource = "ask" | "research" | "follow";

export interface FollowRecord {
  slug: string;
  interval: FollowInterval;
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastError?: string | null;
}

export interface StoredProposal {
  id: string;
  slug: string;
  source: "research" | "follow";
  createdAt: string;
  suggestions: FactSuggestion[];
}

export interface Settings {
  bundleRoot?: string | null;
  preferredProvider?: ProviderId | null;
  follows?: FollowRecord[];
  proposals?: StoredProposal[];
}

export interface VaultStatus {
  available: boolean;
  unlocked: boolean;
  encrypted: boolean;
  keyBackend?: "os-keychain" | "file-fallback" | "none" | string;
  message?: string;
}

export interface PersonView {
  id: string;
  slug: string;
  path: string;
  title: string;
  description?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
  body: string;
  notes: Array<{ id: string; path: string; title: string; body: string }>;
  social: Array<{
    id: string;
    path: string;
    title: string;
    network?: string;
    handle?: string;
    url?: string;
  }>;
  photos: Array<{ id: string; path: string; title: string; resource?: string }>;
  location?: PersonLocation;
  documents: Array<{
    id: string;
    slug: string;
    path: string;
    title: string;
    resource?: string;
    kind?: string;
    note?: string;
    subjects: string[];
  }>;
}

export interface PersonLocation {
  path: string;
  title: string;
  address?: string;
  latitude: number;
  longitude: number;
  source?: string;
}

export interface FactSuggestion {
  id: string;
  source?: SuggestionSource;
  kind: "note" | "social" | "field";
  title: string;
  body?: string;
  network?: string;
  url?: string;
  handle?: string;
  field?: "description" | "body";
  value?: string;
}

export interface ProviderStatus {
  grokOauth: boolean;
  grokApiKey: boolean;
  geminiApiKey: boolean;
  preferred: ProviderId;
}
