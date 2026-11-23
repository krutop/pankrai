// ปั่นไกล service worker: keeps the app shell available offline.
// Page loads go to the network first (so updates show at once) and fall back to the saved copy when offline.
// Map tiles, routing, Firebase and other services on other sites are never cached here.
const CACHE = 'pankrai-shell-v3', SHARE = 'pankrai-share';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon-32.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== SHARE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Files shared from other apps (Android share sheet, e.g. a bike computer app's FIT/GPX export) arrive as a POST
// to ./share-target: keep them in a cache and open the app, which imports them.
self.addEventListener('fetch', e => {
  const r = e.request, u0 = new URL(r.url);
  if (r.method === 'POST' && u0.origin === location.origin && u0.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try { const fd = await r.formData(), c = await caches.open(SHARE); let i = 0;
        for (const f of fd.getAll('file')) { if (f && f.size) await c.put(new Request('./shared/' + Date.now() + '-' + (i++) + '/' + encodeURIComponent(f.name || 'file')), new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } })); }
      } catch (err) {}
      return Response.redirect('./?share=1', 303);
    })());
    return;
  }
  if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', cp)); return res; })
      .catch(() => caches.match('./index.html').then(m => m || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(r).then(m => { const net = fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; }).catch(() => m); return m || net; }));
});
