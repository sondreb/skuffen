export type ProviderId = "grok" | "gemini";
export type FollowInterval = "daily" | "weekly" | "monthly";
export type SuggestionSource = "ask" | "research" | "follow" | "capture";
export type MemoryTrust = "hostile-web" | "local";

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
  query?: string;
  source: SuggestionSource;
  createdAt: string;
  prompt?: string;
  trust?: MemoryTrust;
  suggestions: FactSuggestion[];
}

export interface Settings {
  bundleRoot?: string | null;
  preferredProvider?: ProviderId | null;
  follows?: FollowRecord[];
  proposals?: StoredProposal[];
  /** Sorted `slug-a|slug-b` pairs the user dismissed or kept both. */
  dismissedMerges?: string[];
  /** OKF paths of commitments the user dropped. Not OKF. Never stores tokens. */
  droppedCommitments?: string[];
  /** Inspectable log of what the model was told. Not OKF. Never stores tokens. */
  memoryLog?: AgentMemoryTurn[];
  /**
   * Local owner of this app copy. Person slug, not a Skuffen account.
   * Desktop source of truth is OS-backed settings.json — never localStorage, never tokens.
   */
  selfSlug?: string | null;
}

export interface AgentMemoryTurn {
  id: string;
  createdAt: string;
  slug?: string;
  query?: string;
  source: SuggestionSource;
  prompt: string;
  wanted: Array<{ id: string; title: string; kind: string; summary: string }>;
  trust: MemoryTrust;
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
  notes: Array<{ id: string; path: string; title: string; body: string; at?: string }>;
  social: Array<{
    id: string;
    path: string;
    title: string;
    network?: string;
    handle?: string;
    url?: string;
  }>;
  photos: Array<{ id: string; path: string; title: string; resource?: string; at?: string }>;
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
    at?: string;
  }>;
}

export interface PersonLocation {
  path: string;
  title: string;
  address?: string;
  latitude: number;
  longitude: number;
  source?: string;
  /** ISO stamp from the Place file when dated. */
  at?: string;
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
