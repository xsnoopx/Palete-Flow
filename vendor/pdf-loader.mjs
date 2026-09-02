/* PaleteFlow local/offline loader for PDF.js.
 * The Service Worker serves the two PDF.js files from local cache.
 */
const MAIN = './vendor/pdf.min.mjs';
const WORKER = './vendor/pdf.worker.min.mjs';

async function importLocal(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Biblioteca PDF.js indisponível. Abra o PaleteFlow uma vez com Internet para concluir o cache offline.');
  const source = await res.text();
  const blob = new Blob([source], { type: 'text/javascript' });
  return URL.createObjectURL(blob);
}

try {
  const moduleUrl = await importLocal(MAIN);
  const pdfjsLib = await import(moduleUrl);
  URL.revokeObjectURL(moduleUrl);
  const workerUrl = await importLocal(WORKER);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  window.pdfjsLib = pdfjsLib;
  window.pdfjsReady = Promise.resolve(pdfjsLib);
} catch (error) {
  window.pdfjsReady = Promise.reject(error);
  window.pdfjsReady.catch(err => console.warn('[PaleteFlow] PDF.js:', err));
}
