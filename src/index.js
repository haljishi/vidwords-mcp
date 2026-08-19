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
 * The schemas below mirror src/server/mcp.ts upstream exactly — same parameter
 * names, types, bounds and defaults — so calls round-trip without remapping. If
 * a tool changes upstream, change it here in the same commit.
 *
 * Most users do not need this file: point your client straight at
 * https://vidwords.com/mcp with the Authorization header, or use OAuth from
 * claude.ai and ChatGPT. See the README.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const UPSTREAM_URL = process.env.VIDWORDS_MCP_URL || 'https://vidwords.com/mcp';
const API_TOKEN = process.env.VIDWORDS_API_TOKEN;

const MAX_IDS = 25;
const ACTIVITY_MAX = 50;

/** Reads of public YouTube data: safe, but the answer changes over time. */
const YT_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
/** Reads of the caller's own account state — our database only. */
const ACCOUNT_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** Spends credits or Watch minutes. Not destructive, but not free either. */
const METERED = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const TOOLS = [
  {
    name: 'search_transcript',
    description:
      'Search one YouTube video for a phrase or topic and return the matching moments with ' +
      'timestamps and deep links you can cite. Costs 1 credit per video (the transcript is ' +
      'fetched to search it). Use this instead of get_transcript when the user asks what a ' +
      'video says about something.',
    annotations: { title: 'Search a video transcript', ...METERED },
    inputSchema: {
      type: 'object',
      properties: {
        video: { type: 'string', description: 'YouTube video URL or 11-character video id' },
        query: {
          type: 'string',
          minLength: 1,
          description: 'Words to find. All terms must appear near each other; not a strict phrase match.',
        },
        contextSegments: {
          type: 'integer',
          minimum: 0,
          maximum: 5,
          default: 1,
          description: 'How many caption segments of surrounding context to include with each match.',
        },
      },
      required: ['video', 'query'],
    },
  },
  {
    name: 'get_transcript',
    description:
      'Fetch the complete transcript text for one or more YouTube videos. Costs 1 credit per ' +
      'video. Prefer search_transcript when you only need the parts about a specific topic — ' +
      'full transcripts of long videos are large and mostly irrelevant to the question.',
    annotations: { title: 'Get full video transcripts', ...METERED },
    inputSchema: {
      type: 'object',
      properties: {
        videos: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: MAX_IDS,
          description: `YouTube video URLs or ids (max ${MAX_IDS} per call)`,
        },
        lang: { type: 'string', default: 'en', description: 'Preferred caption language code, e.g. "en", "es".' },
      },
      required: ['videos'],
    },
  },
  {
    name: 'list_channel_videos',
    description:
      'Resolve a YouTube channel handle, URL or id to its recent uploads. Free — no credits are ' +
      'spent. Requires the Starter plan or higher.',
    annotations: { title: 'List a channel’s recent videos', ...YT_READ },
    inputSchema: {
      type: 'object',
      properties: { channel: { type: 'string', description: 'Channel @handle, URL, or UC… id' } },
      required: ['channel'],
    },
  },
  {
    name: 'list_watchlists',
    description:
      'The account’s Radar watchlists — the YouTube channels it monitors for new uploads — with ' +
      'how many new videos each has recorded. Free.',
    annotations: { title: 'List Radar watchlists', ...ACCOUNT_READ },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'watchlist_activity',
    description:
      'The most recent videos Radar has recorded for one watchlist, newest first. Free. Pair with ' +
      'search_transcript to answer questions about what those videos said.',
    annotations: { title: 'Recent uploads on a watchlist', ...ACCOUNT_READ },
    inputSchema: {
      type: 'object',
      properties: {
        watchlistId: { type: 'integer', description: 'Watchlist id from list_watchlists' },
        limit: { type: 'integer', minimum: 1, maximum: ACTIVITY_MAX, default: 20 },
      },
      required: ['watchlistId'],
    },
  },
  {
    name: 'account',
    description:
      'The plan and credit balance for the calling token. Free. Check this before a large batch ' +
      'so you can tell the user what a job will cost instead of failing partway through it.',
    annotations: { title: 'Plan and remaining credits', ...ACCOUNT_READ },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'analyze_video',
    description:
      'Start a deep visual analysis of a YouTube video: chapters, key moments, on-screen ' +
      'text and evidence tied to exact timestamps. Reads the picture, not just the captions, ' +
      'so it can answer questions about a slide, chart or demo the transcript never mentions. ' +
      'Spends Watch minutes from the plan. Returns immediately with an analysisId — analysis ' +
      'takes minutes, so poll get_analysis rather than waiting. If the video was analyzed ' +
      'before, it comes back ready at once.',
    annotations: { title: 'Analyze a video’s frames and speech', ...METERED },
    inputSchema: {
      type: 'object',
      properties: {
        video: { type: 'string', description: 'YouTube video URL or 11-character video id' },
        mode: {
          type: 'string',
          enum: ['quick', 'smart', 'deep', 'auto'],
          default: 'smart',
          description:
            'Detail level. "auto" picks one from the video’s length and visual pace. "deep" needs a Pro or Advanced plan.',
        },
        partial: {
          type: 'boolean',
          default: false,
          description:
            'If the video is longer than the plan allows, analyze only the first allowed minutes and charge for those instead of refusing.',
        },
      },
      required: ['video'],
    },
  },
  {
    name: 'get_analysis',
    description:
      'Fetch the analysis started by analyze_video. Free. While status is "queued" or ' +
      '"processing" the analysis field is absent — poll again. When "ready" it contains the ' +
      'summary, chapters, key points and timestamped evidence.',
    annotations: { title: 'Read a finished video analysis', ...ACCOUNT_READ },
    inputSchema: {
      type: 'object',
      properties: { analysisId: { type: 'integer', description: 'The analysisId returned by analyze_video' } },
      required: ['analysisId'],
    },
  },
  {
    name: 'ask_video',
    description:
      'Ask a question against a finished analysis and get an answer whose citations are ' +
      'verified against the stored evidence: a visual claim must match a real recorded frame ' +
      'and a spoken one a real transcript segment, or it is dropped. When nothing survives, ' +
      'the answer says the evidence is insufficient rather than guessing. Spends one Watch ' +
      'question from the plan.',
    annotations: { title: 'Ask a question about an analyzed video', ...METERED },
    inputSchema: {
      type: 'object',
      properties: {
        analysisId: { type: 'integer', description: 'The analysisId returned by analyze_video' },
        question: { type: 'string', minLength: 1, maxLength: 2000 },
      },
      required: ['analysisId', 'question'],
    },
  },
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
  const client = new Client({ name: 'vidwords-mcp-proxy', version: '1.0.1' }, { capabilities: {} });
  await client.connect(transport);
  upstream = client;
  return client;
}

const server = new Server({ name: 'vidwords-youtube', version: '1.0.1' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!API_TOKEN) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            'VIDWORDS_API_TOKEN is not set. Create a free account at https://vidwords.com/register, ' +
            'verify your email, then copy the token from your profile and pass it to this server as ' +
            'the VIDWORDS_API_TOKEN environment variable.',
        },
      ],
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
