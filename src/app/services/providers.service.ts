import { Injectable, signal } from "@angular/core";
import { GoogleGenAI } from "@google/genai";
import { actorAgent } from "../../../packages/okf/src/index";
import {
  demoNameResearchSuggestions,
  demoResearchPrompt,
  demoResearchSuggestions,
  isDemoMode,
} from "../demo-mode";
import type { FactSuggestion, PersonView, ProviderId, ProviderStatus, SuggestionSource } from "../models";
import type { GrokDevicePending, GrokOAuthStatus } from "./grok-oauth";
import {
  GROK_API_KEY_SECRET_KEY,
  GROK_OAUTH_SECRET_KEY,
  invokeErrorMessage,
  publicOauthPoll,
  publicOauthStatus,
} from "./grok-oauth";
import { IoService } from "./io.service";
import {
  applyPolishedTalkingPoints,
  buildPolishPrompt,
  demoPolishTalkingPoints,
  livePolishRequests,
  parsePolishedPoints,
  type MeetingBrief,
} from "./brief";
import {
  applyPolishedReconnectDraft,
  buildReconnectDraftPrompt,
  demoPolishReconnectDraft,
  liveReconnectDraftRequests,
  parseReconnectDraft,
  type ReconnectDraft,
  type ReconnectSuggestion,
} from "./shuffle";
import {
  buildCapturePrompt,
  demoCaptureItems,
  demoCapturePrompt,
  liveCaptureRequests,
  parseCaptureItems,
  type CaptureItem,
} from "./capture";
import {
  RESEARCH_SYSTEM,
  buildNameResearchPrompt,
  buildResearchPrompt,
  extractModelText,
  geminiResearchConfig,
  grokResearchRequest,
  parseSuggestions,
} from "./research";

const GROK_API_KEY = GROK_API_KEY_SECRET_KEY;
const GROK_OAUTH = GROK_OAUTH_SECRET_KEY;
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
  readonly signingIn = signal(false);
  readonly devicePending = signal<GrokDevicePending | null>(null);
  readonly error = signal<string | null>(null);
  readonly suggestions = signal<FactSuggestion[]>([]);
  readonly lastPrompt = signal<string | null>(null);

  constructor(private readonly io: IoService) {}

  async refresh(oauthOverride?: GrokOAuthStatus): Promise<void> {
    const settings = await this.io.getSettings();
    const grokKey = await this.io.secretGet(GROK_API_KEY);
    const geminiKey = await this.io.secretGet(GEMINI_API_KEY);
    const oauth = publicOauthStatus(oauthOverride ?? (await this.io.grokOauthStatus()));
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
    this.devicePending.set(null);
    this.signingIn.set(true);
    try {
      const pending = await this.io.grokOauthBegin();
      this.devicePending.set(pending);
      const oauth = await this.waitForGrokApproval(pending);
      this.devicePending.set(null);
      if (!oauth.connected) {
        this.error.set("Grok sign-in did not persist in the OS credential store.");
        return;
      }
      // Apply the poll result immediately. A follow-up status IPC can lag or use another shape.
      await this.refresh(oauth);
    } catch (error) {
      this.devicePending.set(null);
      this.error.set(invokeErrorMessage(error));
    } finally {
      this.signingIn.set(false);
    }
  }

  /** One-shot Rust polls. Sleep lives here so a blocking invoke cannot die after approval. */
  private async waitForGrokApproval(pending: GrokDevicePending): Promise<GrokOAuthStatus> {
    const lifetime = Math.max(pending.expiresIn || 1800, 1);
    const deadline = Date.now() + lifetime * 1000;
    let waitSecs = Math.max(pending.interval ?? 5, 0);
    while (Date.now() < deadline) {
      if (waitSecs > 0) await delay(waitSecs * 1000);
      const outcome = publicOauthPoll(await this.io.grokOauthPoll());
      if (outcome.state === "signedIn") {
        const oauth = publicOauthStatus(outcome);
        if (!oauth.connected) {
          throw new Error("Grok sign-in did not persist in the OS credential store.");
        }
        return oauth;
      }
      waitSecs = outcome.interval != null && Number.isFinite(outcome.interval) ? Math.max(outcome.interval, 0) : 5;
    }
    throw new Error("Grok sign-in expired. Try again.");
  }

  async suggest(person: PersonView): Promise<void> {
    if (isDemoMode()) {
      await this.applyDemoResearch("ask", person.title);
      return;
    }
    await this.runPrompt(person, "ask", false);
  }

  async research(person: PersonView): Promise<void> {
    if (isDemoMode()) {
      await this.applyDemoResearch("research", person.title);
      return;
    }
    await this.runPrompt(person, "research", true);
  }

  /** `?demo=1` only — paints a fake proposal panel. No keys, no network. */
  async applyDemoResearch(
    source: SuggestionSource = "research",
    personTitle = "Ada Demo",
    items = demoResearchSuggestions(source),
  ): Promise<FactSuggestion[]> {
    this.busy.set(true);
    this.error.set(null);
    this.suggestions.set([]);
    this.lastPrompt.set(null);
    await new Promise((resolve) => setTimeout(resolve, 400));
    this.lastPrompt.set(demoResearchPrompt(personTitle));
    this.suggestions.set(items);
    this.busy.set(false);
    return items;
  }

  async researchPerson(person: PersonView, source: SuggestionSource = "follow"): Promise<FactSuggestion[]> {
    if (isDemoMode()) {
      return demoResearchSuggestions(source);
    }
    const provider = this.activeProvider();
    if (!provider) {
      throw new Error("Connect Grok or Gemini first.");
    }
    const prompt = buildResearchPrompt(person);
    this.lastPrompt.set(prompt);
    const text =
      provider === "grok"
        ? await this.askGrok(prompt, true)
        : await this.askGemini(prompt, true);
    return parseSuggestions(text, source);
  }

  async researchName(name: string): Promise<FactSuggestion[]> {
    if (isDemoMode()) {
      return this.applyDemoResearch("research", name, demoNameResearchSuggestions(name));
    }
    const provider = this.activeProvider();
    if (!provider) {
      this.error.set("Connect Grok or Gemini first.");
      return [];
    }
    this.busy.set(true);
    this.error.set(null);
    this.suggestions.set([]);
    this.lastPrompt.set(null);
    try {
      const prompt = buildNameResearchPrompt(name);
      this.lastPrompt.set(prompt);
      const text =
        provider === "grok" ? await this.askGrok(prompt, true) : await this.askGemini(prompt, true);
      const parsed = parseSuggestions(text, "research");
      this.suggestions.set(parsed);
      return parsed;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      this.busy.set(false);
    }
  }

  private async runPrompt(person: PersonView, source: SuggestionSource, webSearch: boolean): Promise<void> {
    const provider = this.activeProvider();
    if (!provider) {
      this.error.set("Connect Grok or Gemini first.");
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.suggestions.set([]);
    this.lastPrompt.set(null);
    try {
      const prompt = webSearch ? buildResearchPrompt(person) : this.promptFor(person);
      this.lastPrompt.set(prompt);
      const text =
        provider === "grok"
          ? await this.askGrok(prompt, webSearch)
          : await this.askGemini(prompt, webSearch);
      this.suggestions.set(parseSuggestions(text, source));
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

  /**
   * Structure one capture. Demo stays offline. Live Grok/Gemini use
   * liveCaptureRequests (CAPTURE_SYSTEM chat, no tools, text only).
   * Never askGrok — that inherits RESEARCH_SYSTEM. Never send audio.
   */
  async captureNote(note: string): Promise<CaptureItem[]> {
    const text = note.trim();
    if (!text) return [];
    if (isDemoMode()) {
      this.busy.set(true);
      this.error.set(null);
      this.lastPrompt.set(null);
      await new Promise((resolve) => setTimeout(resolve, 400));
      this.lastPrompt.set(demoCapturePrompt(text));
      this.busy.set(false);
      return demoCaptureItems(text);
    }
    const provider = this.activeProvider();
    if (!provider) {
      this.error.set("Connect Grok or Gemini first.");
      return [];
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const prompt = buildCapturePrompt(text);
      this.lastPrompt.set(prompt);
      const live = liveCaptureRequests({ grokModel: GROK_MODEL, prompt });
      const raw =
        provider === "grok" ? await this.askGrokPolish(live.grok) : await this.askGeminiPolish(live.gemini);
      return parseCaptureItems(raw, text);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Optional polish. Demo and the no-provider path stay offline.
   * Live Grok/Gemini use livePolishRequests (BRIEF_SYSTEM chat, no tools).
   * Never askGrok — that inherits RESEARCH_SYSTEM.
   */
  async polishBrief(brief: MeetingBrief): Promise<MeetingBrief | null> {
    if (isDemoMode()) {
      return applyPolishedTalkingPoints(brief, demoPolishTalkingPoints(brief), false);
    }
    const provider = this.activeProvider();
    if (!provider) {
      this.error.set("Connect Grok or Gemini first. The local brief already works offline.");
      return null;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const prompt = buildPolishPrompt(brief);
      this.lastPrompt.set(prompt);
      const live = livePolishRequests({ grokModel: GROK_MODEL, prompt });
      const text =
        provider === "grok" ? await this.askGrokPolish(live.grok) : await this.askGeminiPolish(live.gemini);
      const points = parsePolishedPoints(text);
      if (!points.length) return brief;
      return applyPolishedTalkingPoints(brief, points, true);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      return brief;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Optional reconnect draft polish. Demo and the no-provider path stay offline.
   * Prompt includes only the one picked person. Never askGrok. Never send.
   */
  async polishReconnectDraft(
    suggestion: ReconnectSuggestion,
    draft: ReconnectDraft,
  ): Promise<ReconnectDraft | null> {
    if (isDemoMode()) {
      return applyPolishedReconnectDraft(draft, demoPolishReconnectDraft(draft), false);
    }
    const provider = this.activeProvider();
    if (!provider) {
      this.error.set("Connect Grok or Gemini first. The local draft already works offline.");
      return null;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const prompt = buildReconnectDraftPrompt(suggestion);
      this.lastPrompt.set(prompt);
      const live = liveReconnectDraftRequests({ grokModel: GROK_MODEL, prompt });
      const text =
        provider === "grok" ? await this.askGrokPolish(live.grok) : await this.askGeminiPolish(live.gemini);
      const polished = parseReconnectDraft(text);
      if (!polished) return draft;
      return applyPolishedReconnectDraft(draft, polished, true);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      return draft;
    } finally {
      this.busy.set(false);
    }
  }

  private promptFor(person: PersonView): string {
    const notes = person.notes.map((n) => `- ${n.title}: ${n.body.slice(0, 280)}`).join("\n") || "(none)";
    const social =
      person.social.map((s) => `- ${s.network ?? "profile"} ${s.handle ?? ""} ${s.url ?? ""}`).join("\n") || "(none)";
    return [
      "You help a local-only personal CRM called Skuffen.",
      "Suggest at most 8 structured facts about this one person, including contact details and public photo URLs when known.",
      "Do not ask for or assume the rest of the people-graph.",
      "Return ONLY JSON: {\"suggestions\":[{\"kind\":\"note\"|\"social\"|\"field\"|\"photo\",\"title\":\"\",\"body\":\"\",\"network\":\"\",\"url\":\"\",\"handle\":\"\",\"field\":\"title\"|\"description\"|\"body\"|\"email\"|\"phone\",\"value\":\"\"}]}",
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

  /** Dedicated polish chat. Never RESEARCH_SYSTEM, never web_search / tools. */
  private async askGrokPolish(request: {
    url: string;
    body: Record<string, unknown>;
  }): Promise<string> {
    const token = await this.grokToken();
    const response = await fetch(request.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request.body),
    });
    if (!response.ok) {
      throw new Error(`Grok API ${response.status}: ${await response.text()}`);
    }
    return extractModelText(await response.json());
  }

  private async askGeminiPolish(request: {
    contents: string;
    config: { systemInstruction: string };
  }): Promise<string> {
    const apiKey = await this.io.secretGet(GEMINI_API_KEY);
    if (!apiKey) throw new Error("Gemini API key missing");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: request.contents,
      config: request.config,
    });
    return response.text ?? "";
  }

  private async askGrok(prompt: string, webSearch = false): Promise<string> {
    const token = await this.grokToken();
    if (webSearch) {
      const response = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(grokResearchRequest(GROK_MODEL, prompt)),
      });
      if (!response.ok) {
        throw new Error(`Grok API ${response.status}: ${await response.text()}`);
      }
      return extractModelText(await response.json());
    }
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
          { role: "system", content: RESEARCH_SYSTEM },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Grok API ${response.status}: ${await response.text()}`);
    }
    return extractModelText(await response.json());
  }

  private async askGemini(prompt: string, webSearch = false): Promise<string> {
    const apiKey = await this.io.secretGet(GEMINI_API_KEY);
    if (!apiKey) throw new Error("Gemini API key missing");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: webSearch ? geminiResearchConfig() : undefined,
    });
    return response.text ?? "";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
