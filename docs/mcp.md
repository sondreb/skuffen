# Local MCP for Skuffen

Skuffen exposes the same OKF v0.2 people-graph the desktop app writes. There is no separate database.

Desktop Skuffen stores the live people-graph as plaintext markdown+YAML. MCP reads that folder. Leftover AES-256-GCM files from older builds need `SKUFFEN_OKF_KEY` (the base64 wrapping key from the OS credential store, service `me.grok.skuffen`, account `okf-master-key`) so MCP can decrypt them once and rewrite plaintext. Without that key, leftover ciphertext fails closed and the file is not changed. Never put the key, the graph, or tokens in a cloud MCP config.

Default bundle locations (override with `SKUFFEN_BUNDLE`):

- Linux: `~/.local/share/me.grok.skuffen/people-graph`
- macOS: `~/Library/Application Support/me.grok.skuffen/people-graph`
- Windows: `%APPDATA%/me.grok.skuffen/people-graph`

## Tools

| Tool | Purpose |
| --- | --- |
| `list_people` | List people. Emails and phones are redacted. |
| `search_people` | Search name / description / note titles. Redacted. |
| `get_person` | One person plus notes, social, photos, documents, and location. Pass `include_sensitive: true` only when you must see raw contact fields. |
| `create_person` | Create a `Person` concept. |
| `update_person` | Update a `Person` concept. |
| `add_note` | Add a `Note`. |
| `add_social_profile` | Add a `SocialProfile`. |
| `add_document` | Attach a local file as a `Document` (bytes + concept markdown). Kind is `document`. |
| `link_document` | Link an existing `Document` to another person in the bundle. |
| `set_person_location` | Set a local `Place` pin (lat/lng/address). The graph is not uploaded. |
| `clear_person_location` | Remove that person's `Place` pin. |
| `recent_log` | Recent `log.md` lines. |

Default tool output never dumps raw phone numbers or email addresses.

Tools run only when the host invokes them. There is no background research loop, no unattended tool use, and no silent write to the people-graph from MCP.

## Cursor

Add to `.cursor/mcp.json` (or Cursor Settings → MCP):

```json
{
  "mcpServers": {
    "skuffen": {
      "command": "npx",
      "args": ["tsx", "mcp/src/server.ts"],
      "env": {
        "SKUFFEN_BUNDLE": "/absolute/path/to/people-graph"
      }
    }
  }
}
```

Run from the Skuffen repo root so `tsx` can resolve `mcp/src/server.ts`. After `npm install`, `npm run mcp` is the same stdio server.

## Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "skuffen": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/skuffen/mcp/src/server.ts"],
      "env": {
        "SKUFFEN_BUNDLE": "/absolute/path/to/people-graph"
      }
    }
  }
}
```

## Optional local HTTP

Same tools, on the existing loopback server only. There is no remote HTTP MCP.

```bash
npx tsx mcp/src/server.ts --http 8787 --http-only
```

Bind is `127.0.0.1` by default. `::1` is allowed via `--http-host ::1`. `0.0.0.0` / `::` are refused.

- Host must be loopback (`127.0.0.1`, `localhost`, `[::1]`). Other Host values are rejected (DNS rebinding).
- If `Origin` is sent, it must exactly match `http://<loopback>:<port>` (scheme+host+port). Prefix / `startsWith` is not used.
- `X-Forwarded-*` is ignored. This port is not behind a proxy.
- `POST` requires `Content-Type: application/json`. `text/plain` JSON-RPC is rejected.
- OS-credential tokens (service `me.grok.skuffen`) are not inbound HTTP auth.
- Request bodies are capped at 1 MiB.

- `GET /health` — bundle path
- `GET /tools` — tool list
- `POST /tools` — `{ "name": "list_people", "arguments": {} }`
