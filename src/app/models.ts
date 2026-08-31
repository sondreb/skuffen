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
  /**
   * Appearance: auto (follow OS), light, or dark.
   * Desktop source of truth is OS-backed settings.json — never OKF, never tokens.
   */
  theme?: "auto" | "light" | "dark" | null;
  /**
   * Left people pane: true = photo strip, false = names.
   * Unset follows window width (narrow defaults collapsed).
   * Desktop source of truth is OS-backed settings.json — never OKF, never tokens.
   */
  peoplePaneCollapsed?: boolean | null;
  /**
   * People list order: name-az (default) | name-za | updated | added | opened.
   * Local list order only — never a score. Not OKF. Never tokens.
   */
  peopleSort?: "name-az" | "name-za" | "updated" | "added" | "opened" | null;
  /**
   * Local last-opened ISO stamps by person slug. Not OKF. Never a score. Never tokens.
   */
  peopleLastOpened?: Record<string, string> | null;
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
  /** Local bundle path for the list avatar. Never http(s). */
  image?: string;
  /** Local data/blob for the list avatar. Never http(s). */
  imageSrc?: string;
  photos: Array<{
    id: string;
    path: string;
    title: string;
    resource?: string;
    at?: string;
    /** Local data/blob for the people list. Never http(s). */
    listSrc?: string;
  }>;
  location?: PersonLocation;
  /** Typed links to first-class Places (lives, works, met-at). */
  places: PersonPlaceLink[];
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
  /** Typed links to other local people. File path is identity. */
  relations: PersonRelation[];
  /** Local labels on this person.md. File path stays identity. */
  tags: string[];
  /** ISO from person.md generated.at — when the card was added. Not a score. */
  addedAt?: string;
  /** Latest local document stamp on this card. Recency only — not a score. */
  updatedAt?: string;
}

export type RelationKind = "family" | "business" | "other";

export interface PersonRelation {
  kind: RelationKind;
  role: string;
  slug: string;
  path: string;
  title: string;
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

export type PlaceLinkRole = "lives" | "works" | "met-at";

export interface PersonPlaceLink {
  role: PlaceLinkRole;
  slug: string;
  path: string;
  title: string;
  location?: PersonLocation;
}

export interface PlaceView {
  id: string;
  slug: string;
  path: string;
  title: string;
  notes: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  source?: string;
  location?: PersonLocation;
  files: Array<{
    id: string;
    path: string;
    title: string;
    resource?: string;
  }>;
  notesList: Array<{ id: string; path: string; title: string; body: string }>;
  people: Array<{ slug: string; title: string; role: PlaceLinkRole }>;
  documents: Array<{
    id: string;
    slug: string;
    path: string;
    title: string;
    resource?: string;
    kind?: string;
    subjects: string[];
  }>;
}

export type PersonField = "title" | "description" | "body" | "email" | "phone" | "givenName" | "familyName";

export interface FactSuggestion {
  id: string;
  source?: SuggestionSource;
  kind: "note" | "social" | "field" | "photo" | "relation" | "place" | "tag";
  title: string;
  body?: string;
  network?: string;
  url?: string;
  handle?: string;
  field?: PersonField;
  value?: string;
  relationKind?: RelationKind;
  relationRole?: string;
  relatedSlug?: string;
  placeName?: string;
  placeSlug?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  placeRole?: PlaceLinkRole;
  /** Proposed local person tag. Written only on Accept. */
  tag?: string;
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
