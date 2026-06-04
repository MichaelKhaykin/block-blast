// Block Blast — tiny shared-leaderboard backend (Cloudflare Worker).
// Stores each player's best score in Workers KV under a single key.
//   GET  /            -> { "<name>": { best, at }, ... }
//   POST / {name,best}-> upserts the higher score, returns the full board
// CORS is open so the static game (any origin) can call it.
const KEY = 'scores';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (request.method === 'GET') {
      const data = (await env.SCORES.get(KEY)) || '{}';
      return new Response(data, { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'bad json' }, 400);
      }
      const name = String(body.name || '').trim().slice(0, 24);
      const best = Math.max(0, Math.min(100000000, Math.floor(Number(body.best) || 0)));
      if (!name) return json({ error: 'name required' }, 400);

      const board = JSON.parse((await env.SCORES.get(KEY)) || '{}');
      const prev = (board[name] && board[name].best) || 0;
      if (best >= prev) board[name] = { best, at: Date.now() };
      await env.SCORES.put(KEY, JSON.stringify(board));
      return json(board);
    }

    return json({ error: 'method not allowed' }, 405);
  },
};
