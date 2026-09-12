/* PaleteFlow PDF.js loader: online-first bootstrap + offline cache. */
const LOCAL_MAIN = './vendor/pdf.min.mjs';
const LOCAL_WORKER = './vendor/pdf.worker.min.mjs';
const REMOTE_MAIN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const REMOTE_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

async function getSource(localUrl, remoteUrl) {
  // Primeiro tenta o arquivo local (Service Worker/cache).
  try {
    const local = await fetch(localUrl, { cache: 'no-store' });
    if (local.ok) return await local.text();
  } catch (_) {}

  // Se ainda não houver cache, baixa uma vez com Internet e grava no cache local.
  const remote = await fetch(remoteUrl, { mode: 'cors', cache: 'no-cache' });
  if (!remote.ok) throw new Error('Não foi possível carregar o motor PDF. Abra o PaleteFlow com Internet e tente novamente.');
  const clone = remote.clone();
  const source = await remote.text();
  try {
    const cache = await caches.open('paleteflow-v6-offline-docs');
    await cache.put(new Request(new URL(localUrl, location.href).href), clone);
  } catch (_) {}
  return source;
}

async function sourceToModule(source) {
  const blob = new Blob([source], { type: 'text/javascript' });
  return URL.createObjectURL(blob);
}

try {
  const mainSource = await getSource(LOCAL_MAIN, REMOTE_MAIN);
  const moduleUrl = await sourceToModule(mainSource);
  const pdfjsLib = await import(moduleUrl);
  URL.revokeObjectURL(moduleUrl);

  const workerSource = await getSource(LOCAL_WORKER, REMOTE_WORKER);
  const workerUrl = await sourceToModule(workerSource);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  window.pdfjsLib = pdfjsLib;
  window.pdfjsReady = Promise.resolve(pdfjsLib);
} catch (error) {
  console.error('[PaleteFlow] PDF.js:', error);
  window.pdfjsReady = Promise.reject(error);
  window.pdfjsReady.catch(() => {});
}
