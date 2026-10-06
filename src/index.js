#!/usr/bin/env node
/**
 * VidWords MCP proxy.
 *
 * Exposes the hosted VidWords MCP server (https://vidwords.com/mcp) as a local
 * stdio server, for Docker deployments and for clients that cannot send a custom
 * HTTP header.
 *
 * Tool schemas are declared inline, so `initialize` and `tools/list` answer
 * without any credentials — the upstream endpoint is not contacted until a tool
 * is actually called. `tools/call` forwards to the upstream with
 * `Authorization: Basic ${VIDWORDS_API_TOKEN}`.
 *
 * TOOLS and PROMPTS below are the upstream server's own `tools/list` and
 * `prompts/list` answers, copied verbatim — same names, parameters, bounds,
 * defaults, descriptions and annotations — so calls round-trip without remapping
 * and an agent reads the same guidance (prices, when to use each tool) either way.
 * Hand-maintained copies drifted: this file still offered a single-video
 * search_transcript with no time range long after upstream took a list and
 * from/to. When upstream changes, re-capture both lists rather than editing here.
 *
 * Most users do not need this file: point your client straight at
 * https://vidwords.com/mcp with the Authorization header, or use OAuth from
 * claude.ai and ChatGPT. See the README.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const UPSTREAM_URL = process.env.VIDWORDS_MCP_URL || 'https://vidwords.com/mcp';
const API_TOKEN = process.env.VIDWORDS_API_TOKEN;

// Captured from POST https://vidwords.com/mcp tools/list and prompts/list, 2026-10-06.
const TOOLS = [
  {
    "name": "search_transcript",
    "title": "Search video transcripts",
    "description": "Search one or many YouTube videos for a phrase or topic and return the matching moments with timestamps and deep links you can cite. Costs 1 Cloud Request per video (the transcript is fetched to search it). Use this instead of get_transcript when the user asks what a video says about something — pass a list to answer \"what does this channel say about X\" in a single call (get the ids from list_channel_videos first).",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "video": {
          "description": "A YouTube video URL or 11-character id, or a list of them (max 25 per call)",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "minItems": 1,
              "maxItems": 25,
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "videos": {
          "description": "Alias for \"video\".",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "minItems": 1,
              "maxItems": 25,
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "query": {
          "type": "string",
          "minLength": 1,
          "description": "Words to find. All terms must appear near each other; not a strict phrase match."
        },
        "contextSegments": {
          "default": 1,
          "description": "How many caption segments of surrounding context to include with each match.",
          "type": "integer",
          "minimum": 0,
          "maximum": 5
        },
        "from": {
          "description": "Only search from this point on. Seconds (\"615\"), \"m:ss\" (\"10:20\") or \"h:mm:ss\".",
          "type": "string"
        },
        "to": {
          "description": "Only search up to this point. Same formats as \"from\".",
          "type": "string"
        },
        "transcribeAudio": {
          "description": "Allow transcribing the AUDIO of videos that have no captions. Off by default because it is priced by duration — 3 AI Units per minute of video, on top of the Cloud Request — so a batch of long captionless videos can spend a large share of the account’s monthly allowance in one call. Left off, such a video is reported as having no transcript and nothing is charged for it.",
          "type": "boolean"
        }
      },
      "required": [
        "query"
      ]
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": true
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "get_transcript",
    "title": "Get full video transcripts",
    "description": "Fetch the complete transcript text for one or more YouTube videos, or just the part between two timecodes. Costs 1 Cloud Request per video the account does not already have; re-reading a video already in its library (another time range, another page) is free, and each result reports what it `charged`. Prefer search_transcript when you only need the parts about a specific topic — full transcripts of long videos are large and mostly irrelevant to the question. When the user names a time span (\"what was said between 10:20 and 11:00\"), pass from/to rather than fetching the whole thing.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "videos": {
          "minItems": 1,
          "maxItems": 25,
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "YouTube video URLs or ids (max 25 per call)"
        },
        "lang": {
          "default": "",
          "description": "Caption language code, e.g. \"en\", \"es\". Omit for the video's default track. If the video has no track in that language the result is a `language_unavailable` error listing `availableLanguages`, and nothing is charged — retry with one of those codes. Every result says why its track was chosen: `selectionReason` \"caption_fallback\" means no track is known to match the speech (uploaded tracks are often translations), so do not report its `language` as the language spoken in the video.",
          "type": "string"
        },
        "from": {
          "description": "Start of the span to return. Seconds (\"615\"), \"m:ss\" (\"10:20\") or \"h:mm:ss\" (\"1:02:13\").",
          "type": "string"
        },
        "to": {
          "description": "End of the span to return. Same formats as \"from\".",
          "type": "string"
        },
        "maxChars": {
          "description": "Return at most this many characters per video, cut on a caption boundary. A cut result has `truncated: true` and `nextFrom` (seconds): pass that as `from` to read the next page — free, since the video is then already in the library.",
          "type": "integer",
          "minimum": 1000,
          "maximum": 200000
        },
        "transcribeAudio": {
          "description": "Allow transcribing the AUDIO of videos that have no captions. Off by default because it is priced by duration — 3 AI Units per minute of video, on top of the Cloud Request — so a batch of long captionless videos can spend a large share of the account’s monthly allowance in one call. Left off, such a video is reported as having no transcript and nothing is charged for it.",
          "type": "boolean"
        },
        "source": {
          "description": "\"audio\" transcribes what is SPOKEN even when captions exist — use it when the captions are uploaded translations rather than the speech (selectionReason \"caption_fallback\", or a language_unavailable error saying none is auto-generated). Paid: 3 AI Units per minute of video plus the Cloud Request, and it is itself the consent to spend that. The result's spokenLanguage is the language detected; `lang` does not translate it.",
          "type": "string",
          "enum": [
            "captions",
            "audio"
          ]
        }
      },
      "required": [
        "videos"
      ]
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": true
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "list_channel_videos",
    "title": "List a channel’s recent videos",
    "description": "Resolve a YouTube channel handle, URL or id to its recent uploads. Costs 1 Cloud Request. Requires the Starter plan or higher.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "channel": {
          "type": "string",
          "description": "Channel @handle, URL, or UC… id"
        }
      },
      "required": [
        "channel"
      ]
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": true
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "list_languages",
    "title": "List a video’s caption languages",
    "description": "The caption tracks a video has — language code, name, and whether it is auto-generated — so you can pass the right `lang` to get_transcript instead of guessing. An auto-generated track transcribes the speech; an uploaded one may be a translation. Free, and answers only from a stored tracklist; a video without one reports known:false rather than costing a Cloud Request.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "videos": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "minItems": 1,
              "maxItems": 25,
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ],
          "description": "A YouTube video URL or 11-character id, or a list of them (max 25 per call)"
        }
      },
      "required": [
        "videos"
      ]
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "search_library",
    "title": "Search my saved transcripts",
    "description": "Full-text search across every transcript this account has already saved, returning the matching moments with timestamps and deep links. Free — no Cloud Request, no AI Units. Try this FIRST when the user asks about something they have watched or researched before, and before fetching a video again with get_transcript or search_transcript.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 2,
          "maxLength": 200,
          "description": "Words to find. Accepts quoted phrases, OR, and a leading minus to exclude a word."
        },
        "limit": {
          "default": 8,
          "description": "How many videos to return (max 20), best match first.",
          "type": "integer",
          "minimum": 1,
          "maximum": 20
        },
        "page": {
          "default": 1,
          "description": "Page of results, starting at 1.",
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        }
      },
      "required": [
        "query"
      ]
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "list_library",
    "title": "List my saved videos",
    "description": "The videos this account has saved, newest first, with title, channel, language and whether the transcript is searchable with search_library. Free. Use it to see what the user already has before fetching anything; page with `before` set to the last item’s `savedAtMs`.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "limit": {
          "default": 20,
          "description": "How many videos to return (max 100).",
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "before": {
          "description": "Only videos saved before this time (milliseconds since epoch) — the `savedAtMs` of the last item on the previous page.",
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        }
      }
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "list_watchlists",
    "title": "List Radar watchlists",
    "description": "The account’s Radar watchlists — the YouTube channels it monitors for new uploads — with how many new videos each has recorded. Free.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {}
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "watchlist_activity",
    "title": "Recent uploads on a watchlist",
    "description": "The most recent videos Radar has recorded for one watchlist, newest first. Free. Pair with search_transcript to answer questions about what those videos said.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "watchlistId": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991,
          "description": "Watchlist id from list_watchlists"
        },
        "limit": {
          "default": 20,
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        }
      },
      "required": [
        "watchlistId"
      ]
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "account",
    "title": "Plan and usage balances",
    "description": "The plan, Cloud Request balance and AI Processing balance for the calling token. Free. Check this before a large batch so you can tell the user what a job will cost instead of failing partway through it.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {}
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "analyze_video",
    "title": "Analyze a video’s frames and speech",
    "description": "Start a deep visual analysis of a YouTube video: chapters, key moments, on-screen text and evidence tied to exact timestamps. Reads the picture, not just the captions, so it can answer questions about a slide, chart or demo the transcript never mentions. Standard Watch spends 3 AI Units per minute of video; Deep uses 30. Before a long video or a Deep run, call it with estimateOnly: true — free — and tell the user the price. Returns immediately with an analysisId; analysis takes minutes, so call get_analysis with waitSeconds rather than polling in a tight loop. If the video was analyzed before, it comes back ready at once.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "video": {
          "type": "string",
          "description": "YouTube video URL or 11-character video id"
        },
        "mode": {
          "default": "smart",
          "description": "Detail level. \"auto\" picks one from the video’s length and visual pace. \"deep\" needs a Pro or Team plan.",
          "type": "string",
          "enum": [
            "quick",
            "smart",
            "deep",
            "auto"
          ]
        },
        "partial": {
          "default": false,
          "description": "If the video is longer than the plan allows, analyze only the first allowed minutes and charge for those instead of refusing.",
          "type": "boolean"
        },
        "estimateOnly": {
          "default": false,
          "description": "Return what this run WOULD cost — AI Units, Cloud Requests, whether audio transcription may be added, the balance, and the refusal a start would give — without starting it or charging anything.",
          "type": "boolean"
        }
      },
      "required": [
        "video"
      ]
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": true
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "get_analysis",
    "title": "Read a finished video analysis",
    "description": "Fetch the analysis started by analyze_video. Free. Pass waitSeconds (up to 25) to have the server hold the call until the analysis finishes or the wait runs out, instead of polling repeatedly. While status is \"queued\" or \"processing\" the analysis field is absent — call again. When \"ready\" it contains the summary, chapters, key points and timestamped evidence.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "analysisId": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991,
          "description": "The analysisId returned by analyze_video"
        },
        "waitSeconds": {
          "default": 0,
          "description": "Hold the call up to this many seconds (max 25) while the analysis is still running.",
          "type": "integer",
          "minimum": 0,
          "maximum": 25
        }
      },
      "required": [
        "analysisId"
      ]
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "ask_video",
    "title": "Ask a question about an analyzed video",
    "description": "Ask a question against a finished analysis and get an answer whose citations are verified against the stored evidence: a visual claim must match a real recorded frame and a spoken one a real transcript segment, or it is dropped. When nothing survives, the answer says the evidence is insufficient rather than guessing. Spends one Watch question from the plan.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "analysisId": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991,
          "description": "The analysisId returned by analyze_video"
        },
        "question": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000
        }
      },
      "required": [
        "analysisId",
        "question"
      ]
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  }
];

const PROMPTS = [
  {
    "name": "summarize_video",
    "title": "Summarize a YouTube video",
    "description": "A timestamped summary of one video, reading it the cheapest way available.",
    "arguments": [
      {
        "name": "video",
        "description": "YouTube URL or 11-character video id",
        "required": true
      }
    ]
  },
  {
    "name": "research_channel",
    "title": "What does a channel say about a topic?",
    "description": "Find what a YouTube channel has said about a topic, with cited moments.",
    "arguments": [
      {
        "name": "channel",
        "description": "Channel @handle, URL or UC… id",
        "required": true
      },
      {
        "name": "topic",
        "description": "What to look for",
        "required": true
      }
    ]
  },
  {
    "name": "find_in_my_library",
    "title": "Find something in my saved videos",
    "description": "Search everything already saved to the VidWords Library — free.",
    "arguments": [
      {
        "name": "topic",
        "description": "What to look for",
        "required": true
      }
    ]
  }
];

/**
 * The upstream is stateless, so there is no session to keep alive; we still
 * cache one connected client so a run of calls does not re-handshake each time,
 * and drop it on any failure so the next call reconnects cleanly.
 */
let upstream = null;

async function getUpstream() {
  if (upstream) return upstream;
  const transport = new StreamableHTTPClientTransport(new URL(UPSTREAM_URL), {
    requestInit: { headers: { Authorization: `Basic ${API_TOKEN}` } },
  });
  const client = new Client({ name: 'vidwords-mcp-proxy', version: '1.1.0' }, { capabilities: {} });
  await client.connect(transport);
  upstream = client;
  return client;
}

const server = new Server({ name: 'vidwords-youtube', version: '1.1.0' }, { capabilities: { tools: {}, prompts: {} } });

const MISSING_TOKEN =
  'VIDWORDS_API_TOKEN is not set. Create a free account at https://vidwords.com/register, ' +
  'verify your email, then copy the token from your profile and pass it to this server as ' +
  'the VIDWORDS_API_TOKEN environment variable.';

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// Listed inline like the tools; the TEXT of a prompt is upstream's, so a get is
// forwarded — the prompts name live tools and prices, which only upstream knows.
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (!API_TOKEN) throw new Error(MISSING_TOKEN);
  try {
    const client = await getUpstream();
    return await client.getPrompt({ name: request.params.name, arguments: request.params.arguments ?? {} });
  } catch (err) {
    upstream = null; // force a fresh handshake next time
    throw err;
  }
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!API_TOKEN) {
    return {
      isError: true,
      content: [{ type: 'text', text: MISSING_TOKEN }],
    };
  }
  try {
    const client = await getUpstream();
    return await client.callTool({
      name: request.params.name,
      arguments: request.params.arguments ?? {},
    });
  } catch (err) {
    upstream = null; // force a fresh handshake next time
    return {
      isError: true,
      content: [{ type: 'text', text: `VidWords upstream error: ${err?.message ?? String(err)}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
