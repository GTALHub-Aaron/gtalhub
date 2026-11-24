/* Mirror Magic offline support.
   First visit with internet: saves the app, its icons and its font on the device.
   After that the app opens without internet. When online, it still fetches the newest page first,
   so updates show up on the next launch. Bump VERSION whenever these files change. */
const VERSION = 'mirror-magic-v1';
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;800&display=swap';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

async function cacheFont(cache) {
  try {
    const res = await fetch(FONT_CSS);
    if (!res.ok) return;
    const css = await res.clone().text();
    await cache.put(FONT_CSS, res);
    const files = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(files.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && cache.put(u, r)).catch(() => {})));
  } catch (e) { /* offline during install: the font is picked up on a later online visit */ }
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => { await c.addAll(CORE); await cacheFont(c); }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('mirror-magic-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: use the saved copy, fetch and save it if missing
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(VERSION).then(async c => (await c.match(req)) ||
      fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;

  // The app page: newest version when online (gives up after 4 s), saved copy when offline
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(caches.open(VERSION).then(c =>
      Promise.race([fetch(req), timeout(4000)])
        .then(r => { if (r.ok) c.put('./index.html', r.clone()); return r; })
        .catch(async () => (await c.match('./index.html')) || (await c.match('./')) || Response.error())));
    return;
  }

  // Icons and manifest: saved copy first, refreshed in the background
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
