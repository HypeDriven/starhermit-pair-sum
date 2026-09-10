// Server integration tests: spawns the real server.js on an ephemeral port
// with an isolated data dir and exercises the API contract end to end:
// time, replay-validated leaderboard submit (including fabricated-board and
// spoofed-field rejection), board-name resolution, and token-keyed saves.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGame, applyCommand, listLegalPairs, hashState, serialize, RULES_VERSION,
} from '../js/rules.js';
import { dailyForDate, CHALLENGES, CONTENT_VERSION } from '../js/content.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let child;
let base;
let dataDir;

test.before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'pairsum-data-'));
  child = spawn(process.execPath, [join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: '0', PAIR_SUM_DATA: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const m = /http:\/\/localhost:(\d+)/.exec(buf);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`server exited early (${code}): ${buf}`)));
    setTimeout(() => reject(new Error('server did not announce its port')), 10000);
  });
});

test.after(async () => {
  child?.kill();
  await rm(dataDir, { recursive: true, force: true });
});

const api = async (path, opts = {}) => {
  const res = await fetch(`${base}/api/v1${path}`, {
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// Play a few legal pairs of the given def and build a genuine replay envelope.
function genuineSubmission(def, { pairs = 2, name = 'TESTER' } = {}) {
  let state = createGame(def);
  const commands = [];
  const checkpoints = [{ after: 0, hash: hashState(state) }];
  for (let i = 0; i < pairs; i++) {
    const legal = listLegalPairs(state);
    if (!legal.length) break;
    const cmd = { id: state.nextCmdId, at: state.elapsedMs + 1500, type: 'pair', a: legal[0].a, b: legal[0].b };
    const r = applyCommand(state, cmd);
    assert.ok(!r.error, r.error);
    state = r.state;
    commands.push(cmd);
    checkpoints.push({ after: cmd.id, hash: hashState(state) });
  }
  const giveUp = { id: state.nextCmdId, at: state.elapsedMs + 1500, type: 'giveUp' };
  state = applyCommand(state, giveUp).state;
  commands.push(giveUp);
  checkpoints.push({ after: giveUp.id, hash: hashState(state) });
  return {
    name,
    result: {
      status: state.status, reason: state.terminalReason,
      seed: def.seed, contentId: def.id, mode: def.mode,
      score: { ...state.score }, moves: state.moves,
      invalid: state.invalid, elapsedMs: state.elapsedMs,
      addRowsUsed: state.addRowsUsed, bestChain: state.bestChain,
      sessionId: `test-${Math.random().toString(36).slice(2)}`,
    },
    envelope: {
      schema: 1, build: RULES_VERSION, contentV: CONTENT_VERSION,
      contentId: def.id, seed: def.seed,
      init: {
        seed: def.seed, cols: def.cols, cells: def.cells,
        limits: def.limits, par: def.par, mult: def.mult,
        mode: def.mode, contentId: def.id, mechanics: def.mechanics,
      },
      initHash: checkpoints[0].hash,
      timestampOffset: 0, commands, checkpoints,
    },
  };
}

test('GET /time returns a server timestamp', async () => {
  const { status, body } = await api('/time');
  assert.equal(status, 200);
  assert.ok(Math.abs(body.now - Date.now()) < 60000);
});

test('genuine daily submission is accepted and listed on the daily board', async () => {
  const def = dailyForDate(new Date());
  const sub = genuineSubmission(def);
  const { status, body } = await api('/leaderboard/submit', { method: 'POST', body: sub });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.board, `daily:${def.id}`);

  // The plain 'daily' query the client makes must resolve to today's board.
  const board = await api('/leaderboard?board=daily');
  assert.equal(board.status, 200);
  const entry = board.body.entries.find((e) => e.name === 'TESTER');
  assert.ok(entry, 'submitted entry must appear on the daily board');
  assert.equal(entry.score, sub.result.score.total);
  assert.equal(entry.status, 'aborted');
});

test('fabricated board with a self-consistent replay is rejected', async () => {
  const def = dailyForDate(new Date());
  const sub = genuineSubmission(def);
  // Lie about the initial layout: same seed, trivially clearable cells.
  // Pick a fabricated pair that is guaranteed to differ from the real cells.
  const fabricated = def.cells[0] === 4 && def.cells[1] === 4 ? [3, 3] : [4, 4];
  sub.envelope.init.cells = fabricated.concat(def.cells.slice(2));
  const { status, body } = await api('/leaderboard/submit', { method: 'POST', body: sub });
  assert.equal(status, 422);
  assert.equal(body.error, 'content-mismatch');
});

test('client scoring and constraint changes are rejected even on the genuine board', async () => {
  const def = dailyForDate(new Date());
  for (const patch of [{ mult: 999 }, { limits: { moves: 9999 } }, { par: { timeMs: 99999999 } }, { mechanics: [] }]) {
    const sub = genuineSubmission({ ...def, ...patch });
    const response = await api('/leaderboard/submit', { method: 'POST', body: sub });
    assert.equal(response.status, 422);
    assert.equal(response.body.error, 'content-mismatch');
  }
});

test('client-declared result fields are replaced by the replayed state', async () => {
  const def = CHALLENGES[0].build();
  const sub = genuineSubmission(def);
  sub.result.moves = 99999;
  sub.result.invalid = -50;
  sub.result.elapsedMs = 0;
  const { status } = await api('/leaderboard/submit', { method: 'POST', body: sub });
  assert.equal(status, 200);
  const board = await api('/leaderboard?board=challenge');
  const entry = board.body.entries.find((e) => e.name === 'TESTER');
  assert.ok(entry, 'challenge board must aggregate challenge:<id> entries');
  assert.equal(entry.moves, 2);
  assert.equal(entry.invalid, 0);
  assert.ok(entry.elapsedMs > 0);
});

test('stale rules version is rejected', async () => {
  const def = dailyForDate(new Date());
  const sub = genuineSubmission(def);
  sub.envelope.build = RULES_VERSION + 999;
  const { status, body } = await api('/leaderboard/submit', { method: 'POST', body: sub });
  assert.equal(status, 422);
  assert.equal(body.error, 'stale-version');
});

test('saves are keyed by the bearer token, not a client-named player', async () => {
  const doc = { v: 1, rev: 1, totals: { pairs: 5 } };
  const a = { authorization: 'Bearer token-a' };
  const b = { authorization: 'Bearer token-b' };
  let r = await api('/save', { method: 'POST', headers: a, body: { game: 'pair-sum', doc, player: 'victim' } });
  assert.equal(r.status, 200);
  r = await api('/save?game=pair-sum', { headers: a });
  assert.equal(r.body.doc.totals.pairs, 5);
  r = await api('/save?game=pair-sum', { headers: b });
  assert.equal(r.body.doc, null, 'another token must not read the save');
  r = await api('/save?game=pair-sum&player=victim');
  assert.equal(r.body.doc, null, 'guest must not read a token-keyed save');
});

test('malformed JSON gets a 400, not a 500', async () => {
  const res = await fetch(`${base}/api/v1/leaderboard/submit`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"broken":',
  });
  assert.equal(res.status, 400);
});

test('static serving blocks traversal and dotfiles', async () => {
  // normalize() collapses leading ../ before the includes('..') check, so an
  // escaped path only resolves inside ROOT; the startsWith(ROOT) guard and
  // the dotfile/data/ prefixes are the effective protections.
  for (const p of ['/..%2f..%2f..%2f..%2fetc%2fpasswd', '/.git/config', '/data/saves.json']) {
    const res = await fetch(`${base}${p}`);
    assert.ok([403, 404].includes(res.status), `${p} -> ${res.status}`);
  }
  const ok = await fetch(`${base}/index.html`);
  assert.equal(ok.status, 200);
});
