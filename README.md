# VidWords YouTube MCP Server

**A hosted [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI agent read YouTube videos — and cite the exact second it got the answer from.**

[![MCP Registry](https://img.shields.io/badge/MCP_Registry-com.vidwords%2Fyoutube-blue)](https://registry.modelcontextprotocol.io)
[![Docs](https://img.shields.io/badge/docs-vidwords.com-4f46e5)](https://vidwords.com/resources/youtube-mcp-server?utm_source=github&utm_medium=readme&utm_campaign=mcp)

[![Add to Cursor](https://img.shields.io/badge/Add_to-Cursor-000000?style=for-the-badge)](https://cursor.com/en/install-mcp?name=vidwords&config=eyJ1cmwiOiJodHRwczovL3ZpZHdvcmRzLmNvbS9tY3AifQ%3D%3D)
[![Add to VS Code](https://img.shields.io/badge/Add_to-VS_Code-0098FF?style=for-the-badge)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522vidwords%2522%252C%2522type%2522%253A%2522http%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fvidwords.com%252Fmcp%2522%257D)

A language model cannot watch a video. Point it at this endpoint and it gains twelve tools for
searching transcripts, searching the videos you have already saved, reading a video's **frames** —
slides, charts, demos, on-screen text — and answering questions with citations that are verified
before you see them.

No integration code. No scraping. No proxy pool.

```
https://vidwords.com/mcp
```

That URL is the whole configuration. Clients sign in over OAuth — no key to find or paste — and
headless ones can send `Authorization: Basic <your-api-token>` instead.

Remote-only and hosted — there is nothing to install or self-host. This repository is the public
manifest, configuration reference and issue tracker for that endpoint.

---

## Quick start

**Most clients need no token at all.** The server speaks OAuth, so the client registers itself,
sends you to VidWords to sign in, and stores a credential it refreshes on its own. You can create
the account during that sign-in step. The free plan includes 25 Cloud Requests and 200 AI Units a
month, so you can wire this up and use it before paying anything.

### Claude (claude.ai and Claude Desktop)

1. **Customize → Connectors**, then **+ Add → Add custom connector**.
2. URL: `https://vidwords.com/mcp`
3. Under the OAuth client options choose **Register automatically**. VidWords registers each
   connector itself (dynamic client registration), so Claude's default "published identity"
   option will not connect.
4. Connect, sign in to VidWords, and approve.

On a Team or Enterprise plan an owner adds it first, under **Organization settings → Connectors →
Add → Custom → Web**; members then connect from **Customize → Connectors**.

### ChatGPT

1. On chatgpt.com, open **[Plugins](https://chatgpt.com/plugins)**, select **+**, then **Add custom MCP server**.
2. Name: `VidWords` · Server URL: `https://vidwords.com/mcp` · Authentication: **OAuth**.
3. Accept the risk warning and select **Create as a plugin**, then sign in to VidWords and approve.
4. **Install** the new plugin, then type `@` in a chat and pick VidWords.

Do this on the web; on a workspace account an admin may need to allow custom MCP servers.

Either way, the host registers itself, sends you to VidWords to sign in, and shows a consent
screen naming exactly what it is asking for. Registration alone grants nothing — access begins
only when a signed-in person clicks **Approve**, and live connections can be revoked from the
[API & MCP page](https://vidwords.com/api-keys?utm_source=github&utm_medium=readme&utm_campaign=mcp)
with immediate effect.

### Claude Desktop from a config file

`claude_desktop_config.json` only runs **local (stdio)** servers — a remote `url` entry there is
not supported (and has been reported to wipe the file's `mcpServers` section). To declare the
server in the file anyway, bridge it with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote),
which runs the same sign-in flow in your browser — still nothing to paste:

```json
{
  "mcpServers": {
    "vidwords": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://vidwords.com/mcp"]
    }
  }
}
```

Quit and reopen Claude Desktop after editing the file.

### Claude Code

```bash
claude mcp add --transport http vidwords https://vidwords.com/mcp
```

Then type `/mcp` in a session and choose **Authenticate**.

### Cursor — one click, or `.cursor/mcp.json`

Use the **Add to Cursor** button above, or:

```json
{
  "mcpServers": {
    "vidwords": {
      "url": "https://vidwords.com/mcp"
    }
  }
}
```

Cursor shows the server as **Needs login** — click that once and it runs the OAuth flow in your
browser. Because this file carries no secret, it is safe to commit, which the header form below
is not.

### VS Code

Use the **Add to VS Code** button above, or put this in `.vscode/mcp.json`:

```json
{
  "servers": {
    "vidwords": { "type": "http", "url": "https://vidwords.com/mcp" }
  }
}
```

VS Code asks you to sign in the first time the server starts.

### Codex CLI

```bash
codex mcp add vidwords --url https://vidwords.com/mcp
codex mcp login vidwords
```

## A static token instead

For CI, a container, or a client with no OAuth support, authenticate with a header. Create an
account at **[vidwords.com/register](https://vidwords.com/register?utm_source=github&utm_medium=readme&utm_campaign=mcp)**,
**verify your email**, then create a key on the
[API & MCP page](https://vidwords.com/api-keys?utm_source=github&utm_medium=readme&utm_campaign=mcp).
A key's value is shown once, when it is created.

### Claude Code

```bash
claude mcp add --transport http vidwords https://vidwords.com/mcp \
  --header "Authorization: Basic YOUR_API_TOKEN"
```

### Claude Desktop — `claude_desktop_config.json`

The same `mcp-remote` bridge as above, with the key instead of the sign-in. Keep the key in
`env`: Claude Desktop on Windows (and Cursor, and the Codex CLI) do not escape spaces inside
`args`, so `Basic YOUR_API_TOKEN` written there splits in two — the `mcp-remote` README's own
workaround:

```json
{
  "mcpServers": {
    "vidwords": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://vidwords.com/mcp",
               "--header", "Authorization:${VIDWORDS_MCP_AUTH}"],
      "env": { "VIDWORDS_MCP_AUTH": "Basic YOUR_API_TOKEN" }
    }
  }
}
```

### Cursor — `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "vidwords": {
      "url": "https://vidwords.com/mcp",
      "headers": { "Authorization": "Basic YOUR_API_TOKEN" }
    }
  }
}
```

Keep this out of version control, or use `~/.cursor/mcp.json` instead — the header holds a live
credential.

### Codex CLI — `~/.codex/config.toml`

```toml
[mcp_servers.vidwords]
url = "https://vidwords.com/mcp"
env_http_headers = { "Authorization" = "VIDWORDS_MCP_AUTH" }
```

```bash
export VIDWORDS_MCP_AUTH="Basic YOUR_API_TOKEN"
```

> Do **not** use `bearer_token_env_var`. It is the obvious-looking field, but it sends
> `Authorization: Bearer <value>` and this server authenticates with **Basic**.

### Clients without custom-header support, and Docker

This repository also ships a small **stdio proxy** (`src/index.js`) that speaks MCP on
stdin/stdout and forwards tool calls to the hosted endpoint. Use it when your client cannot
send a custom HTTP header, or when you want the server in a container:

```json
{
  "mcpServers": {
    "vidwords": {
      "command": "npx",
      "args": ["-y", "github:haljishi/vidwords-mcp"],
      "env": { "VIDWORDS_API_TOKEN": "YOUR_API_TOKEN" }
    }
  }
}
```

> Run straight from this repository — the proxy is not published to npm, so a
> bare `npx @vidwords/mcp` will not resolve.

```bash
docker build -t vidwords-mcp .
docker run --rm -i -e VIDWORDS_API_TOKEN=YOUR_API_TOKEN vidwords-mcp
```

The tool schemas are declared inline in the proxy, so `initialize` and `tools/list` answer
without any credentials and the upstream is not contacted until a tool is actually called.
A call without `VIDWORDS_API_TOKEN` returns a readable error rather than failing the
handshake. `VIDWORDS_MCP_URL` overrides the endpoint if you are pointing at a non-production
instance.

The generic [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge works too:

```json
{
  "mcpServers": {
    "vidwords": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://vidwords.com/mcp",
               "--header", "Authorization:${VIDWORDS_MCP_AUTH}"],
      "env": { "VIDWORDS_MCP_AUTH": "Basic YOUR_API_TOKEN" }
    }
  }
}
```

Ready-made config files live in [`examples/`](./examples).

---

## The twelve tools

Two balances pay for them: a **Cloud Request** fetches one video's transcript, and **AI Units**
pay for reading frames and for transcribing audio — a fresh frame analysis spends one of each kind:
1 Cloud Request for its transcript, plus AI Units per minute of video. A video the account has already fetched is in
its Library, and **reading it again is free** — another time range, another page, a search after a
fetch. Every metered result reports what it `charged`.

| Tool | What it does | Cost |
| --- | --- | --- |
| `search_transcript` | Find where a video discusses something. Takes one video **or a list of up to 25**, so one call can answer a question across a whole channel. Returns the matching moments with timestamps, quoted context, and `youtube.com/watch?v=…&t=…s` deep links. Optional `from`/`to`. | 1 Cloud Request per new video |
| `get_transcript` | Transcript text for up to 25 videos, or the span between two timecodes. `lang` picks a caption track, `maxChars` pages a long transcript, `source: "audio"` transcribes the speech itself. | 1 Cloud Request per new video |
| `search_library` | Full-text search across every transcript the account has already saved, with timestamps and deep links. | Free |
| `list_library` | The account's saved videos, newest first. | Free |
| `list_languages` | The caption tracks a video has, and which are auto-generated (the speech) versus uploaded (possibly translations). | Free |
| `list_channel_videos` | Resolve a channel handle, URL or `UC…` id to its recent uploads. | 1 Cloud Request · Starter and up |
| `list_watchlists` | The account's Radar watchlists and how much each has recorded. | Free |
| `watchlist_activity` | Newest uploads Radar has recorded for one watchlist. | Free |
| `account` | Plan and both balances, so the agent can price a job before running it. | Free |
| `analyze_video` | Start a frame-level analysis — slides, charts, demos and on-screen text, not just captions. Returns an `analysisId` immediately. `mode` is `quick`, `smart`, `deep` or `auto`; Deep runs on any plan with enough AI Units. `estimateOnly: true` returns the price instead, without starting anything. | 1 Cloud Request, then AI Units per minute: Quick 2.8, Standard 4, Deep 30 · estimate free |
| `get_analysis` | Read a finished analysis: chapters, key points, timestamped evidence. `waitSeconds` (up to 25) holds the call until it is ready instead of polling. | Free |
| `ask_video` | Ask a question against a finished analysis. Citations are verified against stored evidence or dropped. | 6 AI Units per question |

### Check the Library first

`search_library` and `list_library` read what the account already has, for nothing. An agent
that searches the Library before fetching a video again answers "what did that interview I
watched last week say about pricing" without spending anything, and without the round trip.

### Prefer `search_transcript` over `get_transcript`

Both cost one Cloud Request per new video, so there is no billing reason to choose. The reason is context.
Ask "what did this two-hour interview say about pricing?" and `get_transcript` returns roughly
20,000 words, of which perhaps 300 are about pricing — those 300 now compete for attention with
19,700 that are not, and the answer gets worse, slower and more expensive to generate.

`search_transcript` returns only the matching stretches, each with a deep link. Reach for
`get_transcript` when you genuinely want the whole text: an export, a diff, a corpus.

### Ask for a span, not a whole video

Both transcript tools take optional `from` and `to` timecodes — seconds (`615`), `m:ss`
(`10:20`) or `h:mm:ss` (`1:02:13`):

```json
{ "videos": ["dQw4w9WgXcQ"], "from": "10:20", "to": "11:00" }
```

These are the same formats the tools print back, so a timestamp out of one answer can be
pasted straight into the next question. A timecode that cannot be parsed is refused before
anything is fetched, so a typo costs nothing — it never silently widens to the whole video.

### Page a long transcript instead of guessing ranges

`get_transcript` takes `maxChars`. A result cut short says `truncated: true` and carries
`nextFrom`, the second to continue from; pass it back as `from`. The cut always lands between
captions, and every page after the first is a re-read of a video already in the Library — free.

```json
{ "videos": ["dQw4w9WgXcQ"], "maxChars": 20000 }
```

### Which language you got, and why

A caption track's language is not necessarily the language spoken. An **auto-generated** track
transcribes the speech; an **uploaded** one may be a translation — some videos carry a dozen
community translations and no track in the language actually spoken. So every transcript says
why it is the track it is:

- `selectionReason`: `requested`, `spoken_language` (it matches the speech), `caption_fallback`
  (no track is known to match the speech — English, if present, was picked for readability),
  `translated` or `audio_transcription`.
- `spokenLanguage`: the language being spoken when it is known, otherwise `null` — not a guess.
- `lang` asks for a track. If the video has none in that language, `get_transcript` answers
  `language_unavailable` with the `availableLanguages` it does have, and charges nothing.
- `source: "audio"` transcribes what is said instead of reading captions — the way to get the
  original words when every caption is a translation. It is priced like any audio transcription
  (3 AI Units per minute of video, on top of the Cloud Request) and passing it is the consent.

`list_languages` answers the same question for free, from what is already stored.

### One call across a channel

`search_transcript` accepts a list, which is how you answer "what has this channel said about
X" without a round trip per video. Get the ids from `list_channel_videos` first:

```json
{ "video": ["VIDEO_ID_1", "VIDEO_ID_2", "VIDEO_ID_3"], "query": "pricing" }
```

Each new video is billed at the usual 1 Cloud Request, and one unavailable video is reported in
its own row rather than failing the call — the others were fetched and charged for, so you still
get them.

### It reads the picture, not only the captions

`analyze_video` looks at slides, charts, code samples and on-screen text that is never spoken
aloud. `ask_video` then answers against that stored analysis, and **every citation is checked
before you see it**: a visual claim has to match a frame that was actually recorded, a spoken
claim has to land on a real transcript segment. Anything that fails is dropped, and when nothing
survives the answer says the evidence is insufficient rather than producing a confident guess.

That is occasionally annoying — a refusal is a worse demo than a fluent answer — and it is the
only version of this feature that is safe to put in front of an agent, because an agent repeats
what it is told without the scepticism a human reader applies.

---

## Auth, cost and limits

- **If you pasted a token: `Basic`, not `Bearer`.** The token is sent as-is; you do not base64-encode
  a `user:pass` pair. Clients that signed in carry their own credential and this does not apply.
- **Verify your email first.** Until you click the verification link every call returns `403`
  with `{"error":"email_unverified"}` — the most common first-call failure on a new account.
- **Balances are shared** with the REST API and the website. One Cloud Request is one new
  transcript; frame analysis spends 1 Cloud Request plus AI Units, and audio transcription spends
  AI Units on top of its Cloud Request. A run refused before it
  starts costs nothing, and `analyze_video` with `estimateOnly: true` quotes the price for free.
- **Rate limit per minute, by plan:** Free 60, Starter 200, Pro 500, Team 1,000 requests. The
  server is stateless, so a client re-runs `initialize` before every call and one tool call is
  several requests. `analyze_video` has its own ceiling of 10 starts per minute, shared with the
  REST route.
- **RapidAPI tokens are refused here.** That identity is metered per call and has no account
  behind it, neither of which survives a tool-calling session. Use a VidWords API token.
- **Stateless by design.** No resumable SSE streams, no session to delete; every tool answers in
  one shot. `GET` and `DELETE` return a JSON-RPC error rather than an HTML 404.
- **No captions, or the wrong ones.** For a video with no caption track, pass
  `transcribeAudio: true` to transcribe it from the audio; to replace captions that exist (all
  uploaded translations, say), pass `source: "audio"`. Both are paid features, priced per minute
  of video, and never run without being asked for.

Full numbers: [pricing](https://vidwords.com/pricing?utm_source=github&utm_medium=readme&utm_campaign=mcp).

---

## Prompts

The server also publishes three prompts, which clients such as Claude show as ready-made actions.
Each tells the model which tools to use and in what order, cheapest first.

| Prompt | Arguments | What it does |
| --- | --- | --- |
| `summarize_video` | `video` | A timestamped summary of one video, read the cheapest way available. |
| `research_channel` | `channel`, `topic` | What a channel has said about a topic, with cited moments. |
| `find_in_my_library` | `topic` | Searches everything already saved — free. |

## Agent skill

[`skills/youtube-transcripts/SKILL.md`](skills/youtube-transcripts/SKILL.md) is a drop-in agent
skill for this server — tool selection, timecode spans, channel-wide search, the cost table and
the error codes worth acting on, in the format Claude and compatible agents load directly.

Copy the folder into your agent's skills directory:

```bash
git clone --depth 1 https://github.com/haljishi/vidwords-mcp
cp -r vidwords-mcp/skills/youtube-transcripts ~/.claude/skills/
```

It assumes the MCP server is configured (see Quick start). The point of it is that an assistant
which has read the skill knows to reach for `search_transcript` with a timecode span instead of
pulling a whole two-hour transcript into its context.

## Documentation

- [Agent skill (SKILL.md)](skills/youtube-transcripts/SKILL.md)
- [YouTube MCP server — overview](https://vidwords.com/resources/youtube-mcp-server?utm_source=github&utm_medium=readme&utm_campaign=mcp)
- [Setup in Claude Code](https://vidwords.com/resources/youtube-mcp-claude-code?utm_source=github&utm_medium=readme&utm_campaign=mcp)
- [Setup in Claude Desktop](https://vidwords.com/resources/youtube-mcp-claude?utm_source=github&utm_medium=readme&utm_campaign=mcp)
- [Setup in Cursor](https://vidwords.com/resources/youtube-mcp-cursor?utm_source=github&utm_medium=readme&utm_campaign=mcp)
- [Setup in ChatGPT](https://vidwords.com/resources/youtube-mcp-chatgpt?utm_source=github&utm_medium=readme&utm_campaign=mcp)
- [Setup in Codex CLI](https://vidwords.com/resources/youtube-mcp-codex?utm_source=github&utm_medium=readme&utm_campaign=mcp)
- [REST API documentation](https://vidwords.com/api-docs?utm_source=github&utm_medium=readme&utm_campaign=mcp)

## Support

Open an issue here for anything about the MCP surface — a tool that misbehaves, a client whose
config we have not documented, a schema that could be clearer. Account and billing questions go to
[support](https://vidwords.com/contact?utm_source=github&utm_medium=readme&utm_campaign=mcp).

## License

The contents of this repository (documentation and configuration examples) are MIT licensed. The
hosted service itself is proprietary and governed by the
[VidWords terms](https://vidwords.com/terms?utm_source=github&utm_medium=readme&utm_campaign=mcp).

---

Independent product; not affiliated with YouTube or Google.
