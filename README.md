# VidWords YouTube MCP Server

**A hosted [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI agent read YouTube videos — and cite the exact second it got the answer from.**

[![MCP Registry](https://img.shields.io/badge/MCP_Registry-com.vidwords%2Fyoutube-blue)](https://registry.modelcontextprotocol.io)
[![Docs](https://img.shields.io/badge/docs-vidwords.com-4f46e5)](https://vidwords.com/resources/youtube-mcp-server?utm_source=github&utm_medium=readme&utm_campaign=mcp)

A language model cannot watch a video. Point it at this endpoint and it gains nine tools for
searching transcripts, reading a video's **frames** — slides, charts, demos, on-screen text — and
answering questions with citations that are verified before you see them.

No integration code. No scraping. No proxy pool.

```
POST https://vidwords.com/mcp
Authorization: Basic <your-api-token>
```

Remote-only and hosted — there is nothing to install or self-host. This repository is the public
manifest, configuration reference and issue tracker for that endpoint.

---

## Quick start

**Most clients need no token at all.** The server speaks OAuth, so the client registers itself,
sends you to VidWords to sign in, and stores a credential it refreshes on its own. You can create
the account during that sign-in step. The free plan includes monthly credits and 10 Watch minutes,
so you can wire this up and use it before paying anything.

### claude.ai, ChatGPT and Claude Desktop — add a connector, nothing to paste

Add this as a custom connector:

```
https://vidwords.com/mcp
```

The host registers itself, sends you to VidWords to sign in, and shows a consent screen naming
exactly what it is asking for. Registration alone grants nothing — access begins only when a
signed-in person clicks **Approve**, and live connections can be revoked from your API page with
immediate effect.

### Claude Code

```bash
claude mcp add --transport http vidwords https://vidwords.com/mcp
```

Then type `/mcp` in a session and choose **Authenticate**.

### Cursor — `.cursor/mcp.json`

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

## A static token instead

For CI, a container, or a client with no OAuth support, authenticate with a header. Create an
account at **[vidwords.com/register](https://vidwords.com/register?utm_source=github&utm_medium=readme&utm_campaign=mcp)**,
**verify your email**, then copy the token from your profile.

### Claude Code

```bash
claude mcp add --transport http vidwords https://vidwords.com/mcp \
  --header "Authorization: Basic YOUR_API_TOKEN"
```

### Claude Desktop — `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vidwords": {
      "type": "http",
      "url": "https://vidwords.com/mcp",
      "headers": { "Authorization": "Basic YOUR_API_TOKEN" }
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
               "--header", "Authorization:Basic YOUR_API_TOKEN"]
    }
  }
}
```

Ready-made config files live in [`examples/`](./examples).

---

## The nine tools

| Tool | What it does | Cost |
| --- | --- | --- |
| `search_transcript` | Find where a video discusses something. Takes one video **or a list of up to 25**, so one call can answer a question across a whole channel. Returns the matching moments with timestamps, quoted context, and `youtube.com/watch?v=…&t=…s` deep links. | 1 credit per video |
| `get_transcript` | Full transcript text for up to 25 videos in one call. | 1 credit per video |
| `list_channel_videos` | Resolve a channel handle, URL or `UC…` id to its recent uploads. | Free · Starter and up |
| `list_watchlists` | The account's Radar watchlists and how much each has recorded. | Free |
| `watchlist_activity` | Newest uploads Radar has recorded for one watchlist. | Free |
| `account` | Plan and remaining credits, so the agent can price a job before running it. | Free |
| `analyze_video` | Start a frame-level analysis — slides, charts, demos and on-screen text, not just captions. Returns an `analysisId` immediately. | Watch minutes |
| `get_analysis` | Read a finished analysis: chapters, key points, timestamped evidence. | Free |
| `ask_video` | Ask a question against a finished analysis. Citations are verified against stored evidence or dropped. | 1 Watch question |

### Prefer `search_transcript` over `get_transcript`

Both cost one credit per video, so there is no billing reason to choose. The reason is context.
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
anything is fetched, so a typo costs no credit — it never silently widens to the whole video.

### One call across a channel

`search_transcript` accepts a list, which is how you answer "what has this channel said about
X" without a round trip per video. Get the ids from `list_channel_videos` first:

```json
{ "video": ["VIDEO_ID_1", "VIDEO_ID_2", "VIDEO_ID_3"], "query": "pricing" }
```

Each video is billed at the usual 1 credit, and one unavailable video is reported in its own
row rather than failing the call — the others were fetched and charged for, so you still get
them.

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
- **Credits are one pool** shared with the REST API and the website. One credit is one transcript.
  Frame analysis draws Watch minutes instead, and a run refused before it starts costs nothing.
- **Rate limit: 30 requests / 10s** — deliberately looser than the REST API's 5, because the server
  is stateless and a client re-runs `initialize` before every call. `analyze_video` has its own
  ceiling of 10 starts per minute, shared with the REST route.
- **RapidAPI tokens are refused here.** That identity is metered per call and has no account
  behind it, neither of which survives a tool-calling session. Use a VidWords API token.
- **Stateless by design.** No resumable SSE streams, no session to delete; every tool answers in
  one shot. `GET` and `DELETE` return a JSON-RPC error rather than an HTML 404.
- **Captions have to exist.** For a video with no caption track, a signed-in account can transcribe
  from audio instead — priced by length, quoted before you spend.

Full numbers: [pricing](https://vidwords.com/pricing?utm_source=github&utm_medium=readme&utm_campaign=mcp).

---

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
