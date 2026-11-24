// ปั่นไกล — Strava token exchange (Cloudflare Worker)
// The browser app cannot keep a Strava client secret, so this small worker holds it and does three things only:
//   POST /token        { code } or { refresh_token }  → Strava OAuth token response
//   POST /deauthorize  { access_token }               → disconnects the athlete
//   GET  /api/<path>   (Authorization: Bearer …)      → read-only Strava API calls the app needs
//   GET  /expand?u=<maps.app.goo.gl link>             → the full Google Maps link it points to (so the app can read the place's position)
// Nothing is stored here. Set these in the worker's settings (Variables and Secrets):
//   STRAVA_CLIENT_ID      your Strava API application's Client ID
//   STRAVA_CLIENT_SECRET  its Client Secret (add it as a Secret, never in code)
//   ALLOWED_ORIGINS       https://krutop.github.io   (comma-separated if more than one)
const API_PATHS = [/^athlete$/, /^athlete\/activities$/, /^activities\/\d+\/streams$/];
export default {
  async fetch(req, env) {
    const allow = (env.ALLOWED_ORIGINS || 'https://krutop.github.io').split(',').map(s => s.trim());
    const origin = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': allow.includes(origin) ? origin : allow[0], 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
    const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allow.includes(origin)) return json({ error: 'origin not allowed' }, 403);
    const url = new URL(req.url);
    if (url.pathname === '/token' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const body = { client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET };
      if (typeof b.code === 'string' && b.code) { body.code = b.code; body.grant_type = 'authorization_code'; }
      else if (typeof b.refresh_token === 'string' && b.refresh_token) { body.refresh_token = b.refresh_token; body.grant_type = 'refresh_token'; }
      else return json({ error: 'code or refresh_token required' }, 400);
      const r = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: 'strava', message: t.message || 'token request failed' }, r.status);
      return json({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at,
        athlete: t.athlete ? { id: t.athlete.id, firstname: t.athlete.firstname, lastname: t.athlete.lastname } : undefined });
    }
    if (url.pathname === '/deauthorize' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (!b.access_token) return json({ error: 'access_token required' }, 400);
      const r = await fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', headers: { Authorization: 'Bearer ' + b.access_token } });
      return json({ ok: r.ok }, r.ok ? 200 : r.status);
    }
    if (url.pathname.startsWith('/api/') && req.method === 'GET') {
      const path = url.pathname.slice(5);
      if (!API_PATHS.some(re => re.test(path))) return json({ error: 'path not allowed' }, 404);
      const auth = req.headers.get('Authorization') || '';
      if (!/^Bearer \S+$/.test(auth)) return json({ error: 'missing token' }, 401);
      const r = await fetch('https://www.strava.com/api/v3/' + path + url.search, { headers: { Authorization: auth } });
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/expand' && req.method === 'GET') {
      // follow a Google Maps short link (redirects only, nothing else is fetched or kept)
      let u = url.searchParams.get('u') || '';
      const ok = x => { try { const h = new URL(x).hostname; return /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/.test(h); } catch (e) { return false; } };
      if (!ok(u)) return json({ error: 'only Google Maps short links' }, 400);
      for (let i = 0; i < 6; i++) {
        const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (pankrai link expander)' } });
        const loc = r.headers.get('Location');
        if (!loc || r.status < 300 || r.status > 399) break;
        u = new URL(loc, u).toString();
        const h = new URL(u).hostname;
        if (/^consent\.google\./.test(h)) { const c = new URL(u).searchParams.get('continue'); if (c) u = c; break; }
        if (/google\.[a-z.]+$/.test(h) && /\/maps/.test(new URL(u).pathname)) break;
      }
      return json({ url: u });
    }
    return json({ error: 'not found' }, 404);
  }
};
