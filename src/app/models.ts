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
  /** Sorted `slug-a|slug-b` pairs the user dismissed or kept both. */
  dismissedMerges?: string[];
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

export type PersonField = "title" | "description" | "body" | "email" | "phone" | "givenName" | "familyName";

export interface FactSuggestion {
  id: string;
  source?: SuggestionSource;
  kind: "note" | "social" | "field" | "photo";
  title: string;
  body?: string;
  network?: string;
  url?: string;
  handle?: string;
  field?: PersonField;
  value?: string;
}

export interface ProposedFact {
  id: string;
  checked: boolean;
  suggestion: FactSuggestion;
}

export interface NameResearchProposal {
  query: string;
  facts: ProposedFact[];
}

export type MergeOverlapKind = "email" | "phone" | "social";

export interface MergeOverlap {
  kind: MergeOverlapKind;
  value: string;
  label: string;
}

export type MergeChoiceKind = "field" | "note" | "social" | "photo" | "place" | "document";

export interface MergeFieldChoice {
  id: string;
  keep: boolean;
  kind: MergeChoiceKind;
  field?: PersonField;
  label: string;
  value: string;
  sourceSlug: string;
  noteTitle?: string;
  noteBody?: string;
  network?: string;
  url?: string;
  handle?: string;
  photoPath?: string;
  photoResource?: string;
  photoTitle?: string;
  place?: PersonLocation;
  documentSlug?: string;
}

export interface MergeProposal {
  id: string;
  keeperSlug: string;
  incomingSlug: string;
  keeperTitle: string;
  incomingTitle: string;
  overlaps: MergeOverlap[];
  fields: MergeFieldChoice[];
}

export interface ProviderStatus {
  grokOauth: boolean;
  grokApiKey: boolean;
  geminiApiKey: boolean;
  preferred: ProviderId;
}
