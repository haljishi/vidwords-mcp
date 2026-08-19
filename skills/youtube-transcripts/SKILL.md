---
name: youtube-transcripts
description: Read and search YouTube videos through VidWords. Use when the user supplies a YouTube URL, a bare 11-character video id, a youtu.be or Shorts link, or a channel handle, and wants any of: the transcript or subtitles (TXT/SRT/VTT), what a video says about a topic, a quote with a citable timestamp, only the words spoken between two timecodes such as "10:20 to 11:00", or the same question answered across many videos in a channel or playlist.
---

# Reading YouTube videos

A model cannot watch a video, but it can read a transcript carrying timestamps it
is able to cite. So the useful unit here is not "a transcript" — it is a grounded
answer with a link the user can click and check.

Prefer returning **a quote plus its deep link** over a wall of text.

## Endpoint

Hosted MCP server, no integration code:

```
POST https://vidwords.com/mcp
Authorization: Basic <api-token>
```

`Basic`, **not** `Bearer`, and the token is not a base64 pair — send it verbatim.
Get one from https://vidwords.com/profile. Free tier included; the account's email
must be verified or every call returns 403.

There is a plain REST equivalent at `POST https://vidwords.com/api/transcripts`
if MCP is not available to you — see https://vidwords.com/api-docs.

## Choosing a tool

**`search_transcript` is the default.** Reach for it whenever the question is
"what does this video say about X".

```json
{ "video": "dQw4w9WgXcQ", "query": "pricing model" }
```

It returns the matching moments, each with `timestamp`, `startSeconds` and a
`youtube.com/watch?v=…&t=…s` url. Cite those urls.

`get_transcript` returns the whole text and costs the same. A two-hour interview
is ~20,000 words of which perhaps 300 answer the question, and the other 19,700
compete for your attention and degrade the answer. Use it only when the full text
is genuinely the deliverable: an export, a diff, a corpus.

```json
{ "videos": ["dQw4w9WgXcQ", "9bZkp7q19f0"], "lang": "en" }
```

## Ask for a span, not a whole video

Both tools take optional `from`/`to` timecodes. Accepted forms: seconds (`615`),
`m:ss` (`10:20`), `h:mm:ss` (`1:02:13`) — the same formats the tools print back,
so a timestamp from one answer can be pasted into the next question.

```json
{ "video": "dQw4w9WgXcQ", "query": "revenue", "from": "10:20", "to": "11:00" }
```

When the user names a time span, **pass it** rather than fetching everything and
filtering yourself. It is the same credit either way, but it keeps your context
clear and the reply focused.

A timecode that cannot be parsed is refused **before** anything is fetched, so a
typo costs nothing. It never silently widens to the whole video.

## One call across a channel

`search_transcript` accepts a list of up to 25 videos. Use it to answer "what has
this channel said about X" without a round trip per video:

```json
{ "video": ["ID_1", "ID_2", "ID_3"], "query": "acquisition" }
```

Get the ids from `list_channel_videos` first (free; needs a Starter plan or
better). Each video in the list bills the usual 1 credit. If one video is
unavailable it comes back as its own row with an `error` — the rest were fetched
and charged for, so read them rather than discarding the call.

## When the question is about something SHOWN, not said

`analyze_video` reads the video's **frames** — slides, charts, on-screen text,
demonstrations — and verifies every citation against stored evidence. Then
`get_analysis` reads the result and `ask_video` asks a question against it,
returning either an answer with verified citations or an explicit statement that
the evidence is insufficient. It will refuse rather than guess; treat a refusal as
the correct answer, not a failure to retry.

These spend Watch minutes rather than transcript credits, and analysis is
asynchronous: start the job, then poll `get_analysis` until `status` is `ready`.

## Costs, so you can budget

| call | cost |
|---|---|
| `search_transcript`, `get_transcript` | 1 credit per video |
| `list_channel_videos`, `list_watchlists`, `watchlist_activity`, `account`, `get_analysis` | free |
| `analyze_video` | Watch minutes |
| `ask_video` | 1 Watch question |

Failed lookups — no captions, invalid id — are free. Call `account` to read the
plan and remaining balance before a large job.

## Errors worth acting on

Errors arrive as readable JSON inside a successful tool result, so you can
recover instead of retrying blindly:

- `insufficient_credits` — carries `needed` and `available`. Tell the user the
  shortfall; do not retry the same call.
- `invalid_timecode` — carries `field` and `value`. Fix the timecode and retry.
- `invalid_id` — the string was not a YouTube URL or id. Re-read the user's input.
- `plan_required` — the account's plan does not include that call.
- `email_unverified` (HTTP 403) — the account exists but has not confirmed its
  email. Nothing can be spent until it does; say so rather than retrying.

## Limits, stated plainly

- Public videos with an accessible caption track. A video with captions disabled
  cannot be read at any price.
- Max 25 videos per call.
- Rate limit 30 requests / 10 seconds.
- Rows are the creator's words. Quoting and analysis are normal use; republishing
  a whole transcript as your own content is not.
- Not affiliated with YouTube or Google.
