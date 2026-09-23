/**
 * Service Worker：只缓存应用外壳（采集端 V1 没有后端，接口无从谈起）。
 *
 * 采集端是房主在手机上填需求单的地方，装到主屏幕之后要能断网打开：草稿本来就存在
 * 本机（Taro storage → localStorage / wx.storage），外壳缓存住就够了。
 *
 * 与现场端的差别只有一处：**文档请求走网络优先**。房主可能今天填一半、过几天回来接着填，
 * 缓存优先会让它一直看到旧版本；静态资源带哈希，走缓存优先即可。
 * 路径一律相对 SW 自己的作用域，部署在 /<repo>/app/ 这类子路径下也能装。
 * 缓存名带版本号，升级时旧缓存会被清掉。
 */
const CACHE = 'zx-intake-v1';
const SCOPE = self.registration.scope;
const at = (p) => new URL(p, SCOPE).href;
const SHELL = [at('./'), at('index.html'), at('manifest.webmanifest'), at('icon-192.png'), at('icon-512.png')];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 文档：网络优先，断网回落缓存
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached ?? caches.match(at('index.html'))),
        ),
    );
    return;
  }

  // 其余同源 GET（带哈希的静态资源）：缓存优先
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
