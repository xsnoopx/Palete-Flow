/* PaleteFlow local/offline loader for Mammoth.js.
 * The Service Worker serves vendor/mammoth.browser.min.js from its local cache.
 * On first installation the SW downloads it once while online; subsequent use is offline.
 */
(function () {
  const src = './vendor/mammoth.browser.min.js';
  window.mammothReady = (async () => {
    if (window.mammoth) return window.mammoth;
    const res = await fetch(src, { cache: 'no-store' });
    if (!res.ok) throw new Error('Biblioteca DOCX indisponível. Abra o PaleteFlow uma vez com Internet para concluir o cache offline.');
    const code = await res.text();
    const script = document.createElement('script');
    script.textContent = code + '\n//# sourceURL=paleteflow-vendor-mammoth.js';
    document.head.appendChild(script);
    if (!window.mammoth) throw new Error('Mammoth.js não inicializou.');
    return window.mammoth;
  })();
  window.mammothReady.catch(err => console.warn('[PaleteFlow] Mammoth:', err));
})();
