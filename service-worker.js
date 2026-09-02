// PaleteFlow — Service Worker
// Faz cache do app (HTML/CSS/JS) e do motor de OCR (Tesseract.js)
// para que tudo funcione 100% offline após a primeira visita.
//
// Estratégia:
// - Arquivos "leves" do app (html/css/js/manifest/ícones): busca sempre a
//   versão mais nova na rede primeiro. Se não tiver Internet, usa o cache.
//   Isso garante que qualquer atualização enviada ao GitHub apareça na
//   próxima vez que o app for aberto, sem precisar limpar o cache manual.
// - Arquivos "pesados" do motor de OCR (tesseract/): raramente mudam, então
//   usa cache primeiro (mais rápido e evita baixar ~18 MB de novo à toa).

const CACHE_VERSION = 'paleteflow-v6-duplicates-noticeoffline-docs';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './vendor/mammoth-loader.js',
  './vendor/pdf-loader.mjs',
  './vendor/README.txt',

  // Tesseract.js — motor de OCR
  './tesseract/tesseract.min.js',
  './tesseract/worker.min.js',
  './tesseract/core/tesseract-core-simd-lstm.wasm.js',
  './tesseract/core/tesseract-core-simd-lstm.wasm',
  './tesseract/core/tesseract-core-lstm.wasm.js',
  './tesseract/core/tesseract-core-lstm.wasm',

  // Dados de idioma (português e inglês)
  './tesseract/lang-data/por.traineddata.gz',
  './tesseract/lang-data/eng.traineddata.gz'
];

// Bibliotecas de documentos. O Service Worker baixa estas bibliotecas uma vez
// durante a instalação (quando houver Internet) e as grava sob URLs locais.
// Assim, PDF/DOCX continuam funcionando sem Internet depois da primeira
// instalação/atualização do aplicativo.
const REMOTE_VENDOR = [
  ['https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.12.2/mammoth.browser.min.js', './vendor/mammoth.browser.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs', './vendor/pdf.min.mjs'],
  ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs', './vendor/pdf.worker.min.mjs']
];

// Arquivos pesados e imutáveis do motor de OCR — usam cache primeiro
const CACHE_FIRST_PATTERN = /\/tesseract\//;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(ASSETS_TO_CACHE);

    // Tenta pré-carregar as bibliotecas de documentos. Se uma CDN estiver
    // indisponível, a instalação não falha: elas serão buscadas na próxima
    // abertura com Internet.
    await Promise.all(REMOTE_VENDOR.map(async ([remoteUrl, localPath]) => {
      try {
        const response = await fetch(remoteUrl, { mode: 'cors', cache: 'no-cache' });
        if (response.ok) await cache.put(new Request(new URL(localPath, self.location).href), response);
      } catch (error) {
        console.warn('[PaleteFlow] Não foi possível pré-carregar', remoteUrl, error);
      }
    }));
  })());
  self.skipWaiting();
});

// Remove caches de versões antigas quando uma nova é publicada
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const isHeavyAsset = CACHE_FIRST_PATTERN.test(event.request.url);
  const isLocalVendor = /\/vendor\/(mammoth\.browser\.min\.js|pdf\.min\.mjs|pdf\.worker\.min\.mjs)$/.test(new URL(event.request.url).pathname);

  if (isLocalVendor) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        const pathname = new URL(event.request.url).pathname;
        const match = REMOTE_VENDOR.find(([, localPath]) => new URL(localPath, self.location).pathname === pathname);
        if (!match) return fetch(event.request);
        return fetch(match[0], { mode: 'cors' }).then(async (response) => {
          if (response && response.ok) {
            const cache = await caches.open(CACHE_VERSION);
            await cache.put(event.request, response.clone());
          }
          return response;
        });
      })
    );
    return;
  }

  if (isHeavyAsset) {
    // Cache primeiro (motor de OCR raramente muda)
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Rede primeiro (app shell): garante que atualizações apareçam sempre
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request)) // sem Internet: usa o cache
  );
});
