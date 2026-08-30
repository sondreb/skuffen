# Local MCP for Skuffen

Skuffen exposes the same OKF v0.2 people-graph the desktop app writes. There is no separate database.

Desktop Skuffen encrypts the live people-graph on disk. MCP can:

- Read an **exported plaintext OKF** folder (rail → Export plaintext OKF), or
- Read the live vault if you set `SKUFFEN_OKF_KEY` to the base64 wrapping key from the OS credential store (service `me.grok.skuffen`, account `okf-master-key`).

Without a key, an encrypted bundle fails closed. Never put the key, the graph, or tokens in a cloud MCP config.

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
| `add_document` | Attach a local file as a `Document` (bytes + concept markdown). Use `kind: land-plot` for land plots. |
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

Same tools, loopback only:

```bash
npx tsx mcp/src/server.ts --http 8787 --http-only
```

- `GET /health` — bundle path
- `GET /tools` — tool list
- `POST /tools` — `{ "name": "list_people", "arguments": {} }`
