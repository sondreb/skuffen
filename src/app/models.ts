export type ProviderId = "grok" | "gemini";

export interface Settings {
  bundleRoot?: string | null;
  preferredProvider?: ProviderId | null;
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
}

export interface FactSuggestion {
  id: string;
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
