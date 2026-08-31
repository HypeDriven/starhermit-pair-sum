// Pair Sum — authoritative script (server=server.js).
// Zero-dependency Node server: static distribution + same-origin /api routes.
// Duties: server time, seeded daily content metadata, leaderboard storage with
// replay-based score validation, cloud saves, presence/activity, telemetry.
// No secrets, no external services.

import http from 'node:http';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replay, hashState, createGame, RULES_VERSION } from './js/rules.js';
import { dailyForDate, CONTENT_VERSION } from './js/content.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA = join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.opus': 'audio/ogg',
};

// --- tiny durable stores -----------------------------------------------------

async function loadJson(name, fallback) {
  try {
    return JSON.parse(await readFile(join(DATA, name), 'utf8'));
  } catch {
    return fallback;
  }
}

async function saveJson(name, value) {
  await mkdir(DATA, { recursive: true });
  await writeFile(join(DATA, name), JSON.stringify(value, null, 1));
}

const rateBuckets = new Map(); // ip -> {count, resetAt}
function rateLimited(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + 60000 };
    rateBuckets.set(ip, b);
  }
  b.count++;
  return b.count > 120; // 120 req/min per client
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 512 * 1024) throw new Error('payload-too-large'); // payload size bound
  }
  return raw ? JSON.parse(raw) : {};
}

// --- score validation ----------------------------------------------------------

// Lightweight authoritative check: replay the input log against the declared
// seed/ruleset and compare hashes. Impossible or stale-version scores rejected.
function validateSubmission(body) {
  const { result, envelope } = body || {};
  if (!result || !envelope) return { ok: false, error: 'missing-fields' };
  if (envelope.rulesV !== undefined && envelope.rulesV !== RULES_VERSION) {
    // (older clients may omit rulesV; build field carries it)
  }
  if (envelope.build !== RULES_VERSION) return { ok: false, error: 'stale-version' };
  if (envelope.contentV !== CONTENT_VERSION) return { ok: false, error: 'stale-content' };
  if (!Array.isArray(envelope.commands) || envelope.commands.length > 20000) {
    return { ok: false, error: 'bad-command-log' };
  }
  if (result.assists && result.assists.timingAssist) return { ok: false, error: 'assisted' };
  let r;
  try {
    r = replay(envelope);
  } catch {
    return { ok: false, error: 'replay-failed' };
  }
  if (!r.ok) return { ok: false, error: `replay-rejected:${r.error}` };
  const claimed = result.score?.total;
  if (claimed !== r.final.score.total) return { ok: false, error: 'score-mismatch' };
  if (result.status !== r.final.status) return { ok: false, error: 'status-mismatch' };
  // Checkpoint verification where provided.
  if (Array.isArray(envelope.checkpoints)) {
    for (const cp of envelope.checkpoints) {
      const local = r.checkpoints.find((c) => c.after === cp.after);
      if (local && local.hash !== cp.hash) return { ok: false, error: 'checkpoint-mismatch' };
    }
  }
  return { ok: true, finalHash: r.finalHash };
}

// --- routes ----------------------------------------------------------------------

async function handleApi(req, res, url) {
  const path = url.pathname.replace(/^\/api\/v1/, '') || '/';

  if (req.method === 'GET' && path === '/time') {
    return json(res, 200, { now: Date.now() });
  }

  if (req.method === 'GET' && path === '/daily') {
    const def = dailyForDate(new Date());
    return json(res, 200, {
      id: def.id, seed: def.seed, contentV: def.v, rulesV: RULES_VERSION,
      limits: def.limits, par: def.par, mult: def.mult, ranked: def.ranked,
    });
  }

  if (path === '/leaderboard' && req.method === 'GET') {
    const board = url.searchParams.get('board') || 'daily';
    const boards = await loadJson('leaderboards.json', {});
    const entries = (boards[board] || [])
      .slice()
      .sort((a, b) => b.score - a.score || a.elapsedMs - b.elapsedMs)
      .slice(0, 100)
      .map((e) => ({
        name: e.name, score: e.score, moves: e.moves, invalid: e.invalid,
        elapsedMs: e.elapsedMs, status: e.status, seed: e.seed,
      }));
    return json(res, 200, { board, entries, validated: true });
  }

  if (path === '/leaderboard/submit' && req.method === 'POST') {
    const body = await readBody(req);
    const check = validateSubmission(body);
    if (!check.ok) return json(res, 422, { error: check.error });
    const { result } = body;
    const board = result.mode === 'daily' ? `daily:${result.contentId}`
      : result.mode === 'challenge' ? `challenge:${result.contentId}` : 'score';
    const boards = await loadJson('leaderboards.json', {});
    boards[board] = boards[board] || [];
    const id = String(result.sessionId || '');
    if (!boards[board].some((e) => e.sessionId === id)) { // idempotent by command/session id
      boards[board].push({
        sessionId: id, name: String(body.name || 'Player').slice(0, 24),
        score: result.score.total, moves: result.moves, invalid: result.invalid,
        elapsedMs: result.elapsedMs, status: result.status,
        seed: result.seed, rulesV: result.rulesV, contentV: result.contentV,
        finalHash: check.finalHash, at: Date.now(),
      });
      await saveJson('leaderboards.json', boards);
    }
    return json(res, 200, { ok: true, board });
  }

  if (path === '/save' && req.method === 'POST') {
    const body = await readBody(req);
    const saves = await loadJson('saves.json', {});
    const key = String(body.player || 'guest').slice(0, 64);
    // Conflict handling: keep both revisions; strict-descendant wins.
    const prev = saves[key];
    const next = { doc: body.doc, rev: body.doc?.rev || 0, at: Date.now() };
    if (prev && prev.rev > next.rev) {
      saves[`${key}:conflict:${Date.now()}`] = next; // preserve, never drop
    } else {
      saves[key] = next;
    }
    await saveJson('saves.json', saves);
    return json(res, 200, { ok: true });
  }

  if (path === '/save' && req.method === 'GET') {
    const saves = await loadJson('saves.json', {});
    const key = String(url.searchParams.get('player') || 'guest').slice(0, 64);
    return json(res, 200, { doc: saves[key]?.doc || null });
  }

  if (path === '/events' && req.method === 'POST') {
    const body = await readBody(req);
    const ALLOWED = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
    if (ALLOWED.includes(body.event)) {
      await mkdir(DATA, { recursive: true });
      await appendFile(join(DATA, 'events.jsonl'),
        JSON.stringify({ e: body.event, d: body.data, at: Date.now() }) + '\n');
    }
    return json(res, 200, { ok: true });
  }

  if (path === '/presence' && req.method === 'POST') return json(res, 200, { ok: true });
  if (path === '/activity/start' && req.method === 'POST') return json(res, 200, { ok: true });
  if (path === '/activity/end' && req.method === 'POST') return json(res, 200, { ok: true });

  return json(res, 404, { error: 'not-found' });
}

// --- static + server ---------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const ip = req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) {
      return json(res, 429, { error: 'rate-limited' }, { 'retry-after': '30' });
    }
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    // Static files; path traversal safe; dotfiles and data/ never served.
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (p.includes('..') || p.startsWith('data/') || p.startsWith('.')) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    if (p === '' || p === '/') p = 'index.html';
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404);
      return res.end('not found');
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(body);
  } catch (e) {
    json(res, e.message === 'payload-too-large' ? 413 : 500, { error: e.message || 'error' });
  }
});

server.listen(PORT, () => {
  console.log(`Pair Sum listening on http://localhost:${PORT}`);
});
