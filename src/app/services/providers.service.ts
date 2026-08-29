import { Injectable, signal } from "@angular/core";
import { GoogleGenAI } from "@google/genai";
import { actorAgent } from "../../../packages/okf/src/index";
import type { FactSuggestion, PersonView, ProviderId, ProviderStatus } from "../models";
import { IoService } from "./io.service";

const GROK_API_KEY = "grok_api_key";
const GROK_OAUTH = "grok_oauth";
const GEMINI_API_KEY = "gemini_api_key";
const GROK_MODEL = "grok-4-latest";
const GEMINI_MODEL = "gemini-2.5-flash";

@Injectable({ providedIn: "root" })
export class ProvidersService {
  readonly status = signal<ProviderStatus>({
    grokOauth: false,
    grokApiKey: false,
    geminiApiKey: false,
    preferred: "grok",
  });
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly suggestions = signal<FactSuggestion[]>([]);

  constructor(private readonly io: IoService) {}

  async refresh(): Promise<void> {
    const settings = await this.io.getSettings();
    const grokKey = await this.io.secretGet(GROK_API_KEY);
    const geminiKey = await this.io.secretGet(GEMINI_API_KEY);
    const oauth = await this.io.grokOauthStatus();
    this.status.set({
      grokOauth: oauth.connected,
      grokApiKey: Boolean(grokKey),
      geminiApiKey: Boolean(geminiKey),
      preferred: settings.preferredProvider === "gemini" ? "gemini" : "grok",
    });
  }

  grokConnected(): boolean {
    const s = this.status();
    return s.grokOauth || s.grokApiKey;
  }

  geminiConnected(): boolean {
    return this.status().geminiApiKey;
  }

  availableProviders(): ProviderId[] {
    const ids: ProviderId[] = [];
    if (this.grokConnected()) ids.push("grok");
    if (this.geminiConnected()) ids.push("gemini");
    return ids;
  }

  activeProvider(): ProviderId | null {
    const available = this.availableProviders();
    if (available.length === 0) return null;
    const preferred = this.status().preferred;
    return available.includes(preferred) ? preferred : available[0];
  }

  async setPreferred(provider: ProviderId): Promise<void> {
    const settings = await this.io.getSettings();
    await this.io.saveSettings({ ...settings, preferredProvider: provider });
    await this.refresh();
  }

  async saveGrokApiKey(key: string): Promise<void> {
    await this.io.secretSet(GROK_API_KEY, key.trim());
    await this.refresh();
  }

  async saveGeminiApiKey(key: string): Promise<void> {
    await this.io.secretSet(GEMINI_API_KEY, key.trim());
    await this.refresh();
  }

  async clearGrok(): Promise<void> {
    await this.io.secretDelete(GROK_API_KEY);
    await this.io.grokOauthLogout();
    await this.refresh();
  }

  async clearGemini(): Promise<void> {
    await this.io.secretDelete(GEMINI_API_KEY);
    await this.refresh();
  }

  async signInGrok(): Promise<void> {
    this.error.set(null);
    try {
      await this.io.grokOauthLogin();
      await this.refresh();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  async suggest(person: PersonView): Promise<void> {
    const provider = this.activeProvider();
    if (!provider) {
      this.error.set("Connect Grok or Gemini first.");
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.suggestions.set([]);
    try {
      const prompt = this.promptFor(person);
      const text = provider === "grok" ? await this.askGrok(prompt) : await this.askGemini(prompt);
      this.suggestions.set(parseSuggestions(text));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy.set(false);
    }
  }

  actorForActive(): string {
    const provider = this.activeProvider() ?? "grok";
    return actorAgent(provider, provider === "grok" ? GROK_MODEL : GEMINI_MODEL);
  }

  clearSuggestions(): void {
    this.suggestions.set([]);
  }

  reject(id: string): void {
    this.suggestions.update((items) => items.filter((item) => item.id !== id));
  }

  private promptFor(person: PersonView): string {
    const notes = person.notes.map((n) => `- ${n.title}: ${n.body.slice(0, 280)}`).join("\n") || "(none)";
    const social =
      person.social.map((s) => `- ${s.network ?? "profile"} ${s.handle ?? ""} ${s.url ?? ""}`).join("\n") || "(none)";
    return [
      "You help a local-only personal CRM called Skuffen.",
      "Suggest at most 5 structured facts about this one person.",
      "Do not ask for or assume the rest of the people-graph.",
      "Return ONLY JSON: {\"suggestions\":[{\"kind\":\"note\"|\"social\"|\"field\",\"title\":\"\",\"body\":\"\",\"network\":\"\",\"url\":\"\",\"handle\":\"\",\"field\":\"description\"|\"body\",\"value\":\"\"}]}",
      `Name: ${person.title}`,
      `Description: ${person.description ?? ""}`,
      `About:\n${person.body}`,
      `Existing notes:\n${notes}`,
      `Existing social:\n${social}`,
    ].join("\n");
  }

  private async grokToken(): Promise<string> {
    const key = await this.io.secretGet(GROK_API_KEY);
    if (key) return key;
    const raw = await this.io.secretGet(GROK_OAUTH);
    if (!raw) throw new Error("Grok is not connected");
    const parsed = JSON.parse(raw) as { access_token?: string; accessToken?: string };
    const token = parsed.access_token || parsed.accessToken;
    if (!token) throw new Error("Grok OAuth token missing");
    return token;
  }

  private async askGrok(prompt: string): Promise<string> {
    const token = await this.grokToken();
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        temperature: 0.3,
        messages: [
          { role: "system", content: "You return compact JSON only. Never request the full people-graph." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Grok API ${response.status}: ${await response.text()}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? "";
  }

  private async askGemini(prompt: string): Promise<string> {
    const apiKey = await this.io.secretGet(GEMINI_API_KEY);
    if (!apiKey) throw new Error("Gemini API key missing");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });
    return response.text ?? "";
  }
}

function parseSuggestions(text: string): FactSuggestion[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return [];
  const parsed = JSON.parse(text.slice(start, end + 1)) as {
    suggestions?: Array<Partial<FactSuggestion>>;
  };
  return (parsed.suggestions ?? []).map((item, index) => ({
    id: `${Date.now()}-${index}`,
    kind: item.kind === "social" || item.kind === "field" ? item.kind : "note",
    title: String(item.title ?? "Suggestion"),
    body: item.body,
    network: item.network,
    url: item.url,
    handle: item.handle,
    field: item.field === "body" ? "body" : item.field === "description" ? "description" : undefined,
    value: item.value,
  }));
}
