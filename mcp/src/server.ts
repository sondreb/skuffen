#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { defaultBundleRoot, OkfBundle } from "./bundle.ts";
import { publicPersonView } from "./redact.ts";

const bundle = new OkfBundle(defaultBundleRoot());
bundle.ensure();

const tools = [
  {
    name: "list_people",
    description: "List people in the local Skuffen OKF bundle. Default output redacts emails and phones.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_people",
    description: "Search people by name, description, or note titles. Emails and phones are redacted.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "get_person",
    description: "Get one person and related notes/social/photos/documents. Emails and phones are redacted unless include_sensitive is true.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        include_sensitive: { type: "boolean" },
      },
      required: ["slug"],
    },
  },
  {
    name: "create_person",
    description: "Create a Person concept in the local OKF bundle.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        givenName: { type: "string" },
        familyName: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_person",
    description: "Update an existing Person concept.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        givenName: { type: "string" },
        familyName: { type: "string" },
        body: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    name: "add_note",
    description: "Add a Note concept linked to a person.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["slug", "title", "body"],
    },
  },
  {
    name: "add_social_profile",
    description: "Add a SocialProfile concept linked to a person.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        network: { type: "string" },
        url: { type: "string" },
        handle: { type: "string" },
      },
      required: ["slug", "network", "url"],
    },
  },
  {
    name: "add_document",
    description:
      "Attach a local file as a Document concept (file bytes + markdown). Kind is document. Never uploads the file.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        filePath: { type: "string" },
        kind: { type: "string", description: "document (default)" },
        note: { type: "string" },
      },
      required: ["slug", "title", "filePath"],
    },
  },
  {
    name: "link_document",
    description: "Link an existing Document to another person already in the local bundle.",
    inputSchema: {
      type: "object",
      properties: {
        docSlug: { type: "string" },
        slug: { type: "string" },
      },
      required: ["docSlug", "slug"],
    },
  },
  {
    name: "set_person_location",
    description: "Set or replace a person's local Place pin (lat/lng/address) in the OKF bundle. Does not upload the graph.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        address: { type: "string" },
        latitude: { type: "number" },
        longitude: { type: "number" },
        source: { type: "string" },
      },
      required: ["slug", "latitude", "longitude"],
    },
  },
  {
    name: "add_relation",
    description:
      "Add a typed relation between two local people (family, business, other). Writes both cards. Does not upload the graph.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        relatedSlug: { type: "string" },
        kind: { type: "string", description: "family | business | other" },
        role: { type: "string", description: "partner, parent, child, sibling, colleague, manager, client, friend, neighbor, or free text" },
      },
      required: ["slug", "relatedSlug", "kind", "role"],
    },
  },
  {
    name: "remove_relation",
    description: "Remove a typed relation between two local people. Writes both cards. Does not upload.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        relatedSlug: { type: "string" },
        kind: { type: "string" },
        role: { type: "string" },
      },
      required: ["slug", "relatedSlug", "kind", "role"],
    },
  },
  {
    name: "clear_person_location",
    description: "Remove a person's local Place pin from the OKF bundle.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "recent_log",
    description: "Return recent OKF log.md entries for the bundle.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
] as const;

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "list_people":
      return bundle.listPeople().map((person) => publicPersonView(person as unknown as Record<string, unknown>));
    case "search_people":
      return bundle
        .searchPeople(String(args.query ?? ""))
        .map((person) => publicPersonView(person as unknown as Record<string, unknown>));
    case "get_person": {
      const person = bundle.getPerson(String(args.slug ?? ""));
      if (!person) throw new Error("Person not found");
      return args.include_sensitive ? person : publicPersonView(person as unknown as Record<string, unknown>);
    }
    case "create_person":
      return publicPersonView(
        bundle.createPerson({
          title: String(args.title ?? ""),
          description: optional(args.description),
          givenName: optional(args.givenName),
          familyName: optional(args.familyName),
        }) as unknown as Record<string, unknown>,
      );
    case "update_person":
      return publicPersonView(
        bundle.updatePerson(String(args.slug ?? ""), {
          title: optional(args.title),
          description: optional(args.description),
          givenName: optional(args.givenName),
          familyName: optional(args.familyName),
          body: optional(args.body),
        }) as unknown as Record<string, unknown>,
      );
    case "add_note":
      return publicPersonView(
        bundle.addNote(String(args.slug ?? ""), String(args.title ?? ""), String(args.body ?? "")) as unknown as Record<string, unknown>,
      );
    case "add_document":
      return publicPersonView(
        bundle.addDocument({
          slug: String(args.slug ?? ""),
          title: String(args.title ?? ""),
          filePath: String(args.filePath ?? ""),
          kind: optional(args.kind),
          note: optional(args.note),
        }) as unknown as Record<string, unknown>,
      );
    case "link_document":
      return publicPersonView(
        bundle.linkDocument(String(args.docSlug ?? ""), String(args.slug ?? "")) as unknown as Record<string, unknown>,
      );
    case "add_social_profile":
      return publicPersonView(
        bundle.addSocial(
          String(args.slug ?? ""),
          String(args.network ?? ""),
          String(args.url ?? ""),
          optional(args.handle),
        ) as unknown as Record<string, unknown>,
      );
    case "set_person_location":
      return publicPersonView(
        bundle.setLocation(String(args.slug ?? ""), {
          address: optional(args.address),
          latitude: Number(args.latitude),
          longitude: Number(args.longitude),
          source: args.source === "pin" || args.source === "search" ? args.source : undefined,
        }) as unknown as Record<string, unknown>,
      );
    case "add_relation":
      return publicPersonView(
        bundle.addRelation(String(args.slug ?? ""), {
          relatedSlug: String(args.relatedSlug ?? ""),
          kind: args.kind === "family" || args.kind === "business" || args.kind === "other" ? args.kind : "other",
          role: String(args.role ?? ""),
        }) as unknown as Record<string, unknown>,
      );
    case "remove_relation":
      return publicPersonView(
        bundle.removeRelation(String(args.slug ?? ""), {
          relatedSlug: String(args.relatedSlug ?? ""),
          kind: args.kind === "family" || args.kind === "business" || args.kind === "other" ? args.kind : "other",
          role: String(args.role ?? ""),
        }) as unknown as Record<string, unknown>,
      );
    case "clear_person_location":
      return publicPersonView(bundle.clearLocation(String(args.slug ?? "")) as unknown as Record<string, unknown>);
    case "recent_log":
      return bundle.recentLog(typeof args.limit === "number" ? args.limit : 20);
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function serveStdio(): Promise<void> {
  const server = new Server({ name: "skuffen", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
  await server.connect(new StdioServerTransport());
}

function serveHttp(port: number): void {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, bundle: bundle.root }));
      return;
    }
    if (req.method === "GET" && req.url === "/tools") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(tools));
      return;
    }
    if (req.method === "POST" && req.url === "/tools") {
      const body = await readBody(req);
      try {
        const parsed = JSON.parse(body || "{}") as { name?: string; arguments?: Record<string, unknown> };
        const result = await callTool(String(parsed.name ?? ""), parsed.arguments ?? {});
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ result }));
      } catch (error) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  httpServer.listen(port, "127.0.0.1", () => {
    console.error(`Skuffen MCP HTTP on http://127.0.0.1:${port} (bundle ${bundle.root})`);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const httpFlag = process.argv.findIndex((arg) => arg === "--http");
const httpPort = httpFlag >= 0 ? Number(process.argv[httpFlag + 1] ?? 8787) : undefined;

if (httpPort) {
  serveHttp(httpPort);
  if (!process.argv.includes("--http-only")) {
    void serveStdio();
  }
} else {
  void serveStdio();
}
