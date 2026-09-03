    // ============================================================
    // APP LOGIC
    // ============================================================

    // Caminhos locais do Tesseract.js (sem depender de CDN/Internet)
    const TESSERACT_PATHS = {
      workerPath: 'tesseract/worker.min.js',
      corePath: 'tesseract/core',
      langPath: 'tesseract/lang-data',
      gzip: true
    };

    const $ = id => document.getElementById(id);
    const KEY = "paleteflow-pro-v2";
    const EMPTY_STATE = { items: [], image: null, rotation: 0 };

    function loadState() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { ...EMPTY_STATE };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return { ...EMPTY_STATE };
        return {
          ...EMPTY_STATE,
          ...parsed,
          items: Array.isArray(parsed.items) ? parsed.items : []
        };
      } catch (err) {
        console.warn("Dados salvos inválidos; iniciando operação vazia.", err);
        return { ...EMPTY_STATE };
      }
    }

    let state = loadState();

    // Limpeza de compatibilidade: versões anteriores podiam ter salvo
    // itens do CD2. Como este aplicativo opera no CD1, esses registros
    // não devem continuar aparecendo depois da atualização.
    let removedCD2OnLoad = 0;

    // ============================================================
    // FILA DE IMAGENS PARA PROCESSAMENTO EM LOTE
    // ============================================================
    let imageQueue = [];
    let isProcessing = false;

    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
      "'": "&#039;" }[m]));

    // ============================================================
    // FUNÇÃO PARA ABREVIAR NOME DA IMAGEM
    // ============================================================
    function shortenFileName(filename, maxLength = 20) {
      if (!filename) return 'Imagem';
      // Remove extensão para contar apenas o nome
      const name = filename.replace(/\.[^.]+$/, '');
      const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';

      if (name.length <= maxLength) {
        return filename;
      }

      // Mantém o início e o fim do nome, com elipse no meio
      const start = name.slice(0, Math.floor(maxLength / 2) - 2);
      const end = name.slice(-Math.floor(maxLength / 2) + 1);
      return start + '…' + end + ext;
    }

    // ============================================================
    // FUNÇÃO PARA EXTRAIR RUA, BLOCO E NÍVEL
    // ============================================================
    function extractLocationParts(location) {
      if (!location) return null;

      const match = location.match(/(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)/);
      if (match) {
        return {
          street: match[1].trim(),
          block: match[2].trim(),
          level: match[3].trim(),
          full: `${match[1]}-${match[2]}-${match[3]}`
        };
      }

      const matchTwo = location.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (matchTwo) {
        return {
          street: matchTwo[1].trim(),
          block: '00',
          level: matchTwo[2].trim(),
          full: `${matchTwo[1]}-${matchTwo[2]}`
        };
      }

      const numbers = location.match(/\d+/g);
      if (numbers && numbers.length >= 3) {
        return {
          street: numbers[0] || '00',
          block: numbers[1] || '00',
          level: numbers[2] || '00',
          full: `${numbers[0]}-${numbers[1]}-${numbers[2]}`
        };
      }

      if (numbers && numbers.length === 2) {
        return {
          street: numbers[0] || '00',
          block: '00',
          level: numbers[1] || '00',
          full: `${numbers[0]}-${numbers[1]}`
        };
      }

      if (numbers && numbers.length === 1) {
        return {
          street: numbers[0],
          block: '00',
          level: '00',
          full: numbers[0]
        };
      }

      return null;
    }

    function parseLocation(location) {
      const defaultResult = { street: '00', block: '00', level: '00', full: location || '' };
      if (!location) return defaultResult;
      const extracted = extractLocationParts(location);
      return extracted || defaultResult;
    }

    function sortItemsIntelligently(items) {
      return items.slice().sort((a, b) => {
        const locA = parseLocation(a.location);
        const locB = parseLocation(b.location);
        const streetA = parseInt(locA.street) || 0;
        const streetB = parseInt(locB.street) || 0;
        if (streetA !== streetB) return streetA - streetB;
        const blockA = parseInt(locA.block) || 0;
        const blockB = parseInt(locB.block) || 0;
        if (blockA !== blockB) return blockA - blockB;
        const levelA = parseInt(locA.level) || 0;
        const levelB = parseInt(locB.level) || 0;
        if (levelA !== levelB) return levelA - levelB;
        const numA = parseInt(String(a.no || '').replace(/\D/g, '')) || 0;
        const numB = parseInt(String(b.no || '').replace(/\D/g, '')) || 0;
        return numA - numB;
      });
    }

    function applySortAndSave() {
      state.items = sortItemsIntelligently(state.items);
      save();
    }

    function save() {
      localStorage.setItem(KEY, JSON.stringify(state));
      $("saveBadge").textContent = "● Salvo";
      render();
    }

    // ============================================================
    // RENDER
    // ============================================================
    function render() {
      const q = $("search").value.toLowerCase().trim();
      const f = $("filter").value;

      const sortedItems = sortItemsIntelligently(state.items);

      const total = sortedItems.length;
      const done = sortedItems.filter(x => x.done).length;
      const pending = total - done;
      const pct = total ? Math.round(done / total * 100) : 0;

      $("total").textContent = total;
      $("done").textContent = done;
      $("pending").textContent = pending;
      $("pct").textContent = pct + "%";
      $("pct2").textContent = pct + "%";
      $("mainProgress").style.width = pct + "%";

      // Na visão principal ("Todos"), itens já confirmados ficam ocultos
      // para deixar somente o que ainda precisa ser separado.
      // Eles continuam salvos e podem ser consultados pelo filtro "Separados".
      const filtered = sortedItems.filter(x =>
        (!q || [x.no, x.location, x.code, x.batch, x.product].join(" ").toLowerCase().includes(q)) &&
        (f === "done" ? x.done : !x.done)
      );

      if (filtered.length === 0) {
        $("list").innerHTML =
          `<div class="empty">${total ? 'Nenhum item corresponde à pesquisa.' : 'Nenhum palete cadastrado.<br>Envie uma foto ou adicione um item.'}</div>`;
        return;
      }

      const streetGroups = {};
      filtered.forEach(item => {
        const loc = parseLocation(item.location);
        const streetKey = loc.street;
        if (!streetGroups[streetKey]) {
          streetGroups[streetKey] = [];
        }
        streetGroups[streetKey].push({ ...item, parsedLoc: loc });
      });

      const sortedStreetKeys = Object.keys(streetGroups).sort((a, b) => parseInt(a) - parseInt(b));

      let html = '';
      sortedStreetKeys.forEach(streetKey => {
        const itemsInStreet = streetGroups[streetKey];
        const totalInStreet = itemsInStreet.length;
        const doneInStreet = itemsInStreet.filter(x => x.done).length;

        const blockGroups = {};
        itemsInStreet.forEach(item => {
          const blockKey = item.parsedLoc.block;
          if (!blockGroups[blockKey]) {
            blockGroups[blockKey] = [];
          }
          blockGroups[blockKey].push(item);
        });

        const sortedBlockKeys = Object.keys(blockGroups).sort((a, b) => parseInt(a) - parseInt(b));

        html += `
          <div class="street-group">
            <div class="street-header">
              <span class="street-label">📦 Rua ${esc(streetKey)}</span>
              <span class="street-badge">${doneInStreet}/${totalInStreet} separados</span>
              <span class="street-count">${totalInStreet} itens</span>
            </div>
        `;

        sortedBlockKeys.forEach(blockKey => {
          const itemsInBlock = blockGroups[blockKey];
          const totalInBlock = itemsInBlock.length;
          const doneInBlock = itemsInBlock.filter(x => x.done).length;

          html += `
            <div class="block-group">
              <div class="block-header">
                <span class="block-label">📋 Bloco ${esc(blockKey)}</span>
                <span class="block-badge">${doneInBlock}/${totalInBlock}</span>
                <span class="block-count">${totalInBlock} itens</span>
              </div>
          `;

          const sortedByLevel = itemsInBlock.sort((a, b) => {
            const levelA = parseInt(a.parsedLoc.level) || 0;
            const levelB = parseInt(b.parsedLoc.level) || 0;
            if (levelA !== levelB) return levelA - levelB;
            const numA = parseInt(String(a.no || '').replace(/\D/g, '')) || 0;
            const numB = parseInt(String(b.no || '').replace(/\D/g, '')) || 0;
            return numA - numB;
          });

          sortedByLevel.forEach(x => {
            const doneClass = x.done ? 'done' : '';
            const confirmText = x.done ? 'Separado' : 'Confirmar';
            const confirmClass = x.done ? 'done' : '';
            const loc = x.parsedLoc;

            html += `
              <div class="item ${doneClass}" data-id="${x.id}">
                <button class="check" data-a="toggle" data-id="${x.id}">${x.done ? '✓' : ''}</button>
                <div class="item-info">
                  <div class="item-no">#${esc(x.no || 'SEM Nº')}</div>
                  <div class="location-grid">
                    <div class="location-group">
                      <span class="loc-label street-label">Rua</span>
                      <span class="loc-value street-value">${esc(loc.street)}</span>
                    </div>
                    <span class="loc-separator-vertical">·</span>
                    <div class="location-group">
                      <span class="loc-label block-label">Bloco</span>
                      <span class="loc-value block-value">${esc(loc.block)}</span>
                    </div>
                    <span class="loc-separator-vertical">·</span>
                    <div class="location-group">
                      <span class="loc-label level-label">Nível</span>
                      <span class="loc-value level-value">${esc(loc.level)}</span>
                    </div>
                  </div>
                  <div class="item-meta">
                    ${x.code ? '<span class="code">🏷️ ' + esc(x.code) + '</span>' : ''}
                    ${x.batch ? '<span class="batch">📦 ' + esc(x.batch) + '</span>' : ''}
                    ${x.product ? ' · <span class="product">' + esc(x.product) + '</span>' : ''}
                  </div>
                </div>
                <div class="item-actions">
                  <button class="btn-confirm ${confirmClass}" data-a="toggle" data-id="${x.id}">
                    <span class="icon">${x.done ? '✓' : '✅'}</span>
                    ${confirmText}
                  </button>
                  <button class="mini-btn" data-a="edit" data-id="${x.id}">✎</button>
                  <button class="mini-btn danger" data-a="delete" data-id="${x.id}">×</button>
                </div>
              </div>
            `;
          });

          html += `</div>`;
        });

        html += `</div>`;
      });

      $("list").innerHTML = html;
    }

    function setStatus(t) { $("status").textContent = t; }

    // ============================================================
    // GERENCIAMENTO DA FILA DE IMAGENS
    // ============================================================
    function renderImageQueue() {
      const container = $("imageList");
      if (imageQueue.length === 0) {
        container.innerHTML = '';
        $("batchCount").textContent = '0';
        $("batchOcrBtn").disabled = true;
        $("ocrBtn").disabled = true;
        return;
      }

      let html = '';
      imageQueue.forEach((img, index) => {
        const statusClass = img.status || 'pending';
        const statusText = {
          pending: '⏳ Aguardando',
          processing: '🔄 Processando',
          done: '✅ Concluído',
          error: '❌ Erro'
        } [statusClass] || '⏳ Aguardando';

        // Nome abreviado para exibição
        const displayName = shortenFileName(img.name, 18);
        const typeLabel = img.kind === 'pdf-text' || img.kind === 'pdf-image' ? 'PDF' : (img.kind === 'docx-text' ? 'DOCX' : (img.kind === 'doc' ? 'DOC' : 'IMG'));

        html += `
          <div class="image-item" data-index="${index}">
            <img class="thumb" src="${img.data}" alt="Imagem ${index + 1}">
            <span class="image-name" title="${esc(img.name)}">${esc(displayName)}</span>
            <span class="image-status ${statusClass}">${typeLabel} · ${statusText}</span>
            <button class="remove-image-btn" data-index="${index}" title="Remover">✕</button>
          </div>
        `;
      });

      container.innerHTML = html;
      const total = imageQueue.length;
      const pendingCount = imageQueue.filter(i => i.status === 'pending').length;
      $("batchCount").textContent = pendingCount;
      $("batchOcrBtn").disabled = isProcessing || pendingCount === 0;

      const hasPending = pendingCount > 0;
      $("ocrBtn").disabled = isProcessing || !hasPending;

      container.querySelectorAll('.remove-image-btn').forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.index);
          if (!isProcessing || imageQueue[idx]?.status === 'done' || imageQueue[idx]?.status === 'error') {
            imageQueue.splice(idx, 1);
            renderImageQueue();
            updateStatusFromQueue();
          } else {
            alert('Não é possível remover uma imagem em processamento.');
          }
        };
      });
    }

    function updateStatusFromQueue() {
      const pending = imageQueue.filter(i => i.status === 'pending' || i.status === 'processing').length;
      const done = imageQueue.filter(i => i.status === 'done').length;
      const error = imageQueue.filter(i => i.status === 'error').length;
      if (imageQueue.length === 0) {
        setStatus('Nenhuma imagem na fila.');
        $("ocrProgress").style.width = '0%';
        return;
      }
      const total = imageQueue.length;
      const processed = done + error;
      const pct = Math.round((processed / total) * 100);
      $("ocrProgress").style.width = pct + '%';
      setStatus(`${processed}/${total} imagens processadas. ${done} OK, ${error} com erro.`);
      if (processed === total && !isProcessing) {
        setStatus(`✅ Todas as ${total} imagens foram processadas!`);
        $("batchOcrBtn").disabled = true;
        $("ocrBtn").disabled = true;
      }
    }

    // ============================================================
    // ADICIONAR IMAGENS À FILA
    // ============================================================
    const DOC_ICON = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
        <rect width="96" height="96" rx="18" fill="#182132"/>
        <path d="M28 14h28l16 16v52H28z" fill="#2f6fed"/>
        <path d="M56 14v18h18" fill="#6ea1ff"/>
        <path d="M38 48h24M38 60h24M38 72h16" stroke="white" stroke-width="5" stroke-linecap="round"/>
      </svg>`);

    function getFileKind(file) {
      const name = (file?.name || '').toLowerCase();
      if (file?.type?.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(name)) return 'image';
      if (file?.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
      if (file?.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) return 'docx';
      if (file?.type === 'application/msword' || name.endsWith('.doc')) return 'doc';
      return 'unknown';
    }

    function addQueueItem(name, data, extra = {}) {
      imageQueue.push({
        id: uid(),
        name,
        data: data || DOC_ICON,
        status: 'pending',
        result: null,
        ...extra
      });
    }

    async function addPdfToQueue(file) {
      if (window.pdfjsReady) await window.pdfjsReady;
      if (!window.pdfjsLib) {
        throw new Error('O leitor de PDF não conseguiu iniciar. Feche/reabra o PaleteFlow com Internet uma vez e tente selecionar o PDF novamente.');
      }

      const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      let added = 0;

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);

        // IMPORTANTE: PDF não usa mais a extração direta de texto como caminho
        // principal. Muitos PDFs de etiquetas têm texto fragmentado em vários
        // objetos/colunas; o getTextContent() pode alterar a ordem e fazer o
        // parseOCR perder itens. Renderizamos a página como imagem e usamos
        // exatamente o mesmo pipeline de OCR das fotos, que já é mais preciso.
        //
        // A escala é calculada dinamicamente (não fixa) porque PDFs gerados
        // por apps de scanner (Adobe Scan e afins) costumam declarar o
        // tamanho "físico" da página bem menor do que a foto de alta
        // resolução que embutem dentro — com uma escala fixa, a página
        // renderizada saía minúscula e ilegível para o OCR nesses PDFs.
        // Calculamos a escala pra sempre atingir ~2800px no lado maior,
        // não importa o tamanho declarado da página.
        const baseViewport = page.getViewport({ scale: 1 });
        const TARGET_LONG_SIDE = 2800;
        const longSide = Math.max(baseViewport.width, baseViewport.height);
        let scale = TARGET_LONG_SIDE / longSide;
        scale = Math.min(Math.max(scale, 1), 20); // nunca reduz abaixo do padrão, nem amplia de forma absurda
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        await page.render({ canvasContext: ctx, viewport }).promise;

        addQueueItem(`${file.name} · Página ${pageNumber}`, canvas.toDataURL('image/jpeg', 0.92), {
          kind: 'pdf-image',
          preExtractedRows: null
        });
        added++;
      }

      return added;
    }

    async function addDocxToQueue(file) {
      if (window.mammothReady) await window.mammothReady;
      if (!window.mammoth) {
        throw new Error('O leitor de DOCX não está disponível. Abra o PaleteFlow uma vez com Internet para concluir o cache offline.');
      }
      const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      const text = result.value || '';
      const rows = parseOCR(text);
      addQueueItem(file.name, DOC_ICON, {
        kind: 'docx-text',
        preExtractedRows: rows,
        documentText: text
      });
      return rows.length;
    }

    async function addDocumentsToQueue(files) {
      const fileArray = Array.from(files || []).filter(Boolean);
      if (fileArray.length === 0) {
        setStatus('Nenhum arquivo selecionado.');
        return;
      }

      let added = 0;
      let unsupported = 0;
      let errors = 0;

      for (const file of fileArray) {
        const kind = getFileKind(file);
        try {
          if (kind === 'image') {
            const data = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = e => resolve(e.target.result);
              reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
              reader.readAsDataURL(file);
            });
            addQueueItem(file.name, data, { kind: 'image', preExtractedRows: null });
            added++;
          } else if (kind === 'pdf') {
            added += await addPdfToQueue(file);
          } else if (kind === 'docx') {
            await addDocxToQueue(file);
            added++;
          } else if (kind === 'doc') {
            unsupported++;
          } else {
            unsupported++;
          }
        } catch (err) {
          console.error('Erro ao ler arquivo:', file.name, err);
          errors++;
          addQueueItem(file.name, DOC_ICON, { kind: 'error', preExtractedRows: [], error: err?.message || String(err), status: 'error' });
        }
      }

      renderImageQueue();
      updateStatusFromQueue();

      const messages = [];
      if (added) messages.push(`${added} arquivo(s) na fila`);
      if (unsupported) messages.push(`${unsupported} formato(s) não suportado(s)`);
      if (errors) messages.push(`${errors} com erro`);
      setStatus(messages.join(' · ') || 'Nenhum arquivo válido encontrado.');

      if (unsupported && fileArray.some(f => getFileKind(f) === 'doc')) {
        setTimeout(() => setStatus('⚠️ Arquivos .DOC antigos não podem ser lidos diretamente no navegador. Salve-os como .DOCX e tente novamente.'), 1200);
      }
    }

    function addImagesToQueue(files) {
      addDocumentsToQueue(files);
    }

    // ============================================================
    // EXTRAÇÃO FOCADA: LOCALIZAÇÃO (HRW), CÓDIGO (F...) E LOTE (H...)
    // ============================================================
    // Estratégia: o OCR às vezes lê a etiqueta intercalada (item por item)
    // e às vezes agrupada por coluna (todas as posições primeiro, depois
    // todos os códigos/lotes). Em ambos os casos a ORDEM de aparição no
    // texto corresponde à ordem real dos itens — por isso extraímos cada
    // campo separadamente (em toda a extensão do texto) e casamos pela
    // posição (1º com 1º, 2º com 2º...), em vez de depender de proximidade
    // de linha.
    function parseOCR(text) {
      if (!text) return [];

      // Captura opcionalmente o número do item (ex: "0001") que vem antes do HRW.
      // Entre "HRW" e o primeiro número, tolera até 3 caracteres de ruído do OCR
      // (ex: "HRW $02-165-03" — símbolos que às vezes aparecem por erro de leitura)
      const locRegex = /(?:(\d{4})\s+)?HRW\W{0,3}(\d{1,3})\s*[-–]\s*(\d{1,3})\s*[-–]\s*(\d{1,3})/gi;
      // Código do palete: sempre um "F" seguido só de números (ex: F00002287)
      const codeRegex = /\bF\d{6,}\b/gi;
      // Lote do palete: "H" seguido de um número (ex: H8JH1102). O \d logo
      // após o H evita confundir com "HRW" (que é H + letra, não H + número)
      const loteRegex = /\bH\d[A-Z0-9]{3,}\b/gi;

      const locMatches = [...text.matchAll(locRegex)];
      const codes = [...text.matchAll(codeRegex)].map(m => m[0].toUpperCase());
      const lotes = [...text.matchAll(loteRegex)].map(m => m[0].toUpperCase());

      const out = [];
      locMatches.forEach((m, i) => {
        const itemNo = m[1]; // número real do item, se o OCR conseguiu ler
        const location = `${m[2]}-${m[3]}-${m[4]}`;
        const code = codes[i] || '';
        const no = itemNo || (code ? code.replace(/\D/g, '') : String(i + 1).padStart(4, '0'));
        out.push({ no, location, code, batch: lotes[i] || '', product: '' });
      });

      const seen = new Set();
      return out.filter(x => {
        const key = normalizeLocationKey(x.location);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // ============================================================
    // PRÉ-PROCESSAMENTO DE IMAGEM PARA MELHORAR O OCR
    // ============================================================
    // Gera uma versão otimizada da foto: escala de cinza, aumento de
    // resolução (se a imagem for pequena), nitidez e binarização
    // automática (preto e branco puro). Isso ajuda o OCR a ler texto
    // com sombra, baixo contraste ou desfoque leve.
    function preprocessImageForOCR(dataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const maxDim = Math.max(img.width, img.height);
            const targetMax = 2500;
            // Redimensiona SEMPRE pro tamanho alvo — tanto amplia fotos
            // pequenas quanto reduz fotos de câmera em altíssima resolução
            // (12+ megapixels), que processam bem mais devagar no OCR sem
            // ganho real de precisão acima desse tamanho.
            let scale = targetMax / maxDim;
            scale = Math.min(scale, 2.5); // evita ampliar demais e borrar
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;
            const n = w * h;
            const gray = new Uint8ClampedArray(n);

            // 1. Escala de cinza (luminância)
            for (let i = 0; i < n; i++) {
              const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
              gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
            }

            // 2. Nitidez (realce de bordas com kernel simples)
            const sharp = new Uint8ClampedArray(n);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
                  sharp[idx] = gray[idx];
                  continue;
                }
                sharp[idx] = gray[idx] * 5 - gray[idx - w] - gray[idx + w] - gray[idx - 1] - gray[idx + 1];
              }
            }

            // 3. Aumento de contraste (stretch)
            let min = 255, max = 0;
            for (let i = 0; i < n; i++) {
              if (sharp[i] < min) min = sharp[i];
              if (sharp[i] > max) max = sharp[i];
            }
            const range = Math.max(1, max - min);
            const contrasted = new Uint8ClampedArray(n);
            for (let i = 0; i < n; i++) contrasted[i] = ((sharp[i] - min) / range) * 255;

            // 4. Binarização automática (método de Otsu)
            const hist = new Array(256).fill(0);
            for (let i = 0; i < n; i++) hist[contrasted[i]]++;
            let sumTotal = 0;
            for (let t = 0; t < 256; t++) sumTotal += t * hist[t];
            let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
            for (let t = 0; t < 256; t++) {
              wB += hist[t];
              if (wB === 0) continue;
              const wF = n - wB;
              if (wF === 0) break;
              sumB += t * hist[t];
              const mB = sumB / wB;
              const mF = (sumTotal - sumB) / wF;
              const varBetween = wB * wF * (mB - mF) * (mB - mF);
              if (varBetween > maxVar) { maxVar = varBetween; threshold = t; }
            }

            // 5. Aplica o resultado de volta na imagem
            for (let i = 0; i < n; i++) {
              const v = contrasted[i] > threshold ? 255 : 0;
              data[i * 4] = v;
              data[i * 4 + 1] = v;
              data[i * 4 + 2] = v;
              data[i * 4 + 3] = 255;
            }
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error('Falha ao carregar imagem para pré-processamento'));
        img.src = dataUrl;
      });
    }

    // Mescla dois conjuntos de itens extraídos (original + otimizada), sem duplicar
    function normalizeLocationKey(location) {
      return String(location || '')
        .toUpperCase()
        .replace(/[^0-9]/g, '');
    }

    function mergeExtractedRows(preferred, fallback) {
      const seen = new Set();
      const out = [];
      [...preferred, ...fallback].forEach(x => {
        const normalizedLocation = normalizeLocationKey(x.location);
        const key = normalizedLocation || (x.code || x.batch || x.no);
        if (!seen.has(key)) { seen.add(key); out.push(x); }
      });
      return out;
    }

    // Roda o OCR na imagem original E numa versão otimizada, juntando os
    // resultados — cada versão tende a acertar itens que a outra erra.
    // ============================================================
    // WORKER DE OCR PERSISTENTE
    // Antes, cada foto recriava o motor do Tesseract do zero (carregando
    // ~18MB de novo toda vez). Agora o worker é criado uma única vez e
    // reaproveitado em todas as fotos da sessão — muito mais rápido,
    // principalmente processando várias fotos em lote.
    // ============================================================
    let ocrWorkerPromise = null;
    let currentOcrProgressCallback = null;

    async function getOcrWorker() {
      if (!ocrWorkerPromise) {
        ocrWorkerPromise = Tesseract.createWorker('por+eng', 1, {
          ...TESSERACT_PATHS,
          logger: m => {
            if (m.status === "recognizing text" && currentOcrProgressCallback) {
              currentOcrProgressCallback(Math.round(m.progress * 100));
            }
          }
        }).then(async worker => {
          // PSM 6 = bloco único e uniforme de texto. É mais rápido que o
          // modo automático (padrão) porque pula a etapa de análise de
          // layout da página — ideal aqui, já que as listas de separação
          // são sempre um bloco de texto corrido, sem colunas complexas.
          await worker.setParameters({ tessedit_pageseg_mode: '6' });
          return worker;
        });
      }
      return ocrWorkerPromise;
    }

    async function recognizeWithPreprocessing(img, onProgress) {
      const worker = await getOcrWorker();
      currentOcrProgressCallback = onProgress;

      // Roda primeiro só a versão TRATADA (mais rápido e já é a mais precisa).
      // Só faz uma segunda passada (mais lenta) na imagem ORIGINAL se a
      // tratada não encontrar nenhum item — isso evita rodar dois OCRs
      // pesados ao mesmo tempo, o que trava celulares mais fracos.
      const processedDataUrl = await preprocessImageForOCR(img.data);
      const resProcessed = await worker.recognize(processedDataUrl);
      const rowsProcessed = parseOCR(resProcessed.data.text || "");
      if (rowsProcessed.length > 0) return rowsProcessed;

      // Fallback: nada encontrado na versão tratada, tenta a original
      const resOriginal = await worker.recognize(img.data);
      const rowsOriginal = parseOCR(resOriginal.data.text || "");
      return mergeExtractedRows(rowsProcessed, rowsOriginal);
    }


    // A localização (rua/bloco/nível) identifica o item.
    // Se a mesma foto/etiqueta for reconhecida novamente, não criamos
    // outra linha para a mesma localização. A normalização também faz
    // 02-165-03, 02/165/03 e "02 - 165 - 03" serem considerados iguais.
    // ============================================================
    // FILTRO DE SETOR - CD1 / CD2
    // Regra operacional:
    //   Rua 1 até Rua 6  -> CD1
    //   Rua acima de 6   -> CD2
    //
    // O PaleteFlow trabalha com a localização no formato
    // Rua-Bloco-Nível (ex.: 02-165-03). Portanto, a PRIMEIRA parte
    // numérica é a rua e determina o setor.
    //
    // Registros do CD2 não entram na lista do CD1. Eles são
    // simplesmente ignorados no cadastro e contabilizados para que
    // o usuário receba um aviso na tela.
    // ============================================================
    function getSectorFromLocation(location) {
      // Usa a mesma regra de leitura da localização do restante do app:
      // o PRIMEIRO número de Rua-Bloco-Nível é a rua.
      const raw = String(location || '').trim();
      // Aceita 07-165-03, 07/165/03 e variações com espaços.
      const direct = raw.match(/^\s*(\d{1,3})\s*[-–/]\s*(\d{1,3})\s*[-–/]\s*(\d{1,3})/);
      const parts = direct ? { street: direct[1], block: direct[2], level: direct[3] } : parseLocation(raw);
      const street = Number.parseInt(parts?.street, 10);
      if (!Number.isFinite(street)) return null;

      return {
        street,
        sector: street > 6 ? 'CD2' : 'CD1'
      };
    }

    // Remove do estado qualquer item antigo que pertença ao CD2.
    // Isso é importante porque apenas bloquear novos OCRs não elimina
    // registros que já tinham sido salvos por uma versão anterior.
    function removeExistingCD2Items() {
      const before = state.items.length;
      state.items = state.items.filter(item => getSectorFromLocation(item.location)?.sector !== 'CD2');
      removedCD2OnLoad = before - state.items.length;
      if (removedCD2OnLoad > 0) {
        state.items = sortItemsIntelligently(state.items);
        localStorage.setItem(KEY, JSON.stringify(state));
      }
    }

    // Mostra no próprio app, item por item, qual setor foi identificado.
    // Isso deixa visível quando uma rua > 6 foi reconhecida e bloqueada.
    function showSectorResults(rows, sourceName = '') {
      const box = $('sectorResults');
      if (!box) return;
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        box.innerHTML = '';
        return;
      }

      const title = sourceName
        ? `🔎 Setor identificado — ${esc(sourceName)}`
        : '🔎 Setor identificado';

      box.innerHTML = `<div class="sector-results-title">${title}</div>` + list.map((x, i) => {
        const info = getSectorFromLocation(x.location);
        const sector = info?.sector || 'NÃO IDENTIFICADO';
        const cls = sector === 'CD2' ? 'cd2' : 'cd1';
        const action = sector === 'CD2' ? '🚫 IGNORADO — outro setor' : '✅ CADASTRADO — CD1';
        return `<div class="sector-result ${cls}">
          <span class="location">${esc(x.location || 'Sem localização')}</span>
          <span class="sector">${action}</span>
        </div>`;
      }).join('');
    }

    function addRowsToState(rows) {
      const keys = new Set(
        state.items
          .map(x => normalizeLocationKey(x.location))
          .filter(Boolean)
      );

      let added = 0;
      let duplicates = 0;
      let otherSector = 0;

      (rows || []).forEach(x => {
        const sectorInfo = getSectorFromLocation(x.location);

        // Se a rua for maior que 6, pertence ao CD2.
        // O aplicativo atual é tratado como CD1, então não cadastra.
        if (sectorInfo?.sector === 'CD2') {
          otherSector++;
          return;
        }

        const normalizedLocation = normalizeLocationKey(x.location);
        const key = normalizedLocation || (x.code || x.batch || x.no);

        if (!key) return;

        if (!keys.has(key)) {
          state.items.push({
            ...x,
            id: uid(),
            done: false,
            sector: sectorInfo?.sector || 'CD1'
          });
          keys.add(key);
          added++;
        } else {
          duplicates++;
        }
      });

      if (added > 0 || duplicates > 0) applySortAndSave();
      return { added, duplicates, otherSector };
    }

    // Executa a migração uma vez ao carregar a aplicação.
    removeExistingCD2Items();

    async function processQueueItem(img, onProgress) {
      if (Array.isArray(img.preExtractedRows)) {
        onProgress?.(100);
        return img.preExtractedRows;
      }
      return recognizeWithPreprocessing(img, onProgress);
    }

    async function processSingleOCR() {
      if (isProcessing) return;

      const pendingIndex = imageQueue.findIndex(i => i.status === 'pending');
      if (pendingIndex === -1) {
        setStatus('Nenhuma imagem pendente para processar.');
        return;
      }

      const img = imageQueue[pendingIndex];
      isProcessing = true;
      $("ocrBtn").disabled = true;
      $("batchOcrBtn").disabled = true;

      img.status = 'processing';
      renderImageQueue();
      setStatus(`🔄 Reconhecendo ${img.name}...`);

      try {
        const rows = await processQueueItem(img, pct => {
          setStatus(`🔄 Reconhecendo ${img.name}... ${pct}%`);
        });
        img.status = 'done';
        img.result = rows;
        showSectorResults(rows, img.name);

        const result = addRowsToState(rows);

        if (rows.length === 0) {
          setStatus(`⚠️ ${img.name} processado, mas nenhum item foi reconhecido. Tente tirar a foto de novo (foco/luz).`);
        } else if (result.otherSector > 0 || result.duplicates > 0) {
          const sectorMsg = result.otherSector > 0 ? ` 🚫 ${result.otherSector} item(ns) do CD2 ignorado(s) (rua acima de 6).` : '';
          const dupMsg = result.duplicates > 0 ? ` ⚠️ ${result.duplicates} duplicado(s) ignorado(s).` : '';
          setStatus(`✅ ${img.name} processado! ${result.added} item(ns) adicionado(s).${dupMsg}${sectorMsg}`);
        } else {
          setStatus(`✅ ${img.name} processado! ${result.added} item(ns) adicionado(s).`);
        }

      } catch (e) {
        console.error('Erro no OCR da imagem:', img.name, e);
        img.status = 'error';
        img.error = e.message;
        setStatus(`❌ Erro ao processar ${img.name}`);
      }

      isProcessing = false;
      currentOcrProgressCallback = null;
      renderImageQueue();
      updateStatusFromQueue();
      render();
    }

    // ============================================================
    // PROCESSAMENTO EM LOTE - OCR SEQUENCIAL ESTÁVEL
    // ============================================================
    async function processBatchOCR() {
      if (isProcessing) return;
      const pendingImages = imageQueue.filter(i => i.status === 'pending');
      if (pendingImages.length === 0) {
        setStatus('Todas as imagens já foram processadas.');
        renderImageQueue();
        return;
      }

      // Um único worker do Tesseract é reutilizado. Processar uma foto por vez
      // é mais estável em celulares e evita que o callback de progresso de uma
      // foto sobrescreva o de outra.
      isProcessing = true;
      $("batchOcrBtn").disabled = true;
      $("ocrBtn").disabled = true;
      setStatus(`🔄 Processando ${pendingImages.length} imagens...`);

      for (let index = 0; index < pendingImages.length; index++) {
        const img = pendingImages[index];
        img.status = 'processing';
        renderImageQueue();

        try {
          const rows = await processQueueItem(img, pct => {
            setStatus(`🔄 ${index + 1}/${pendingImages.length} · ${img.name} · ${pct}%`);
          });
          img.status = 'done';
          img.result = rows;
          showSectorResults(rows, img.name);

          const result = addRowsToState(rows);
          img.addedCount = result.added;
          img.duplicateCount = result.duplicates;
          img.otherSectorCount = result.otherSector;

          if (result.duplicates > 0 || result.otherSector > 0) {
            const dupMsg = result.duplicates > 0 ? ` · ⚠️ ${result.duplicates} duplicado(s) ignorado(s)` : '';
            const sectorMsg = result.otherSector > 0 ? ` · 🚫 ${result.otherSector} do CD2 ignorado(s)` : '';
            setStatus(`🔄 ${index + 1}/${pendingImages.length} · ${img.name} · ${result.added} adicionado(s)${dupMsg}${sectorMsg}`);
          }
        } catch (e) {
          console.error('Erro no OCR da imagem:', img.name, e);
          img.status = 'error';
          img.error = e?.message || String(e);
        }

        currentOcrProgressCallback = null;
        renderImageQueue();
        updateStatusFromQueue();
      }

      isProcessing = false;
      currentOcrProgressCallback = null;
      renderImageQueue();
      updateStatusFromQueue();
      render();

      const doneCount = imageQueue.filter(i => i.status === 'done').length;
      const errorCount = imageQueue.filter(i => i.status === 'error').length;
      const totalItemsFound = imageQueue
        .filter(i => i.status === 'done')
        .reduce((sum, i) => sum + (i.result ? i.result.length : 0), 0);
      const imagesWithNoItems = imageQueue.filter(i => i.status === 'done' && (!i.result || i.result.length === 0)).length;
      const totalAdded = imageQueue
        .filter(i => i.status === 'done')
        .reduce((sum, i) => sum + (Number(i.addedCount) || 0), 0);
      const totalDuplicates = imageQueue
        .filter(i => i.status === 'done')
        .reduce((sum, i) => sum + (Number(i.duplicateCount) || 0), 0);
      const totalOtherSector = imageQueue
        .filter(i => i.status === 'done')
        .reduce((sum, i) => sum + (Number(i.otherSectorCount) || 0), 0);

      if (totalItemsFound === 0 && doneCount > 0) {
        setStatus(`⚠️ ${doneCount} imagens processadas, mas nenhum item foi reconhecido. Tente fotos com mais luz/foco.`);
      } else if (imagesWithNoItems > 0) {
        const dupMsg = totalDuplicates > 0 ? ` ⚠️ ${totalDuplicates} item(ns) duplicado(s) ignorado(s).` : '';
        const sectorMsg = totalOtherSector > 0 ? ` 🚫 ${totalOtherSector} item(ns) do CD2 ignorado(s) (rua acima de 6).` : '';
        setStatus(`✅ ${totalAdded} item(ns) adicionados. ${totalItemsFound} reconhecidos em ${doneCount} imagens.${dupMsg}${sectorMsg} ⚠️ ${imagesWithNoItems} foto(s) sem nenhum item reconhecido.`);
      } else if (totalDuplicates > 0 || totalOtherSector > 0) {
        const dupMsg = totalDuplicates > 0 ? ` ⚠️ ${totalDuplicates} item(ns) duplicado(s) ignorado(s).` : '';
        const sectorMsg = totalOtherSector > 0 ? ` 🚫 ${totalOtherSector} item(ns) do CD2 ignorado(s) (rua acima de 6).` : '';
        setStatus(`✅ Processamento concluído! ${totalAdded} item(ns) adicionados.${dupMsg}${sectorMsg} ${errorCount} com erro.`);
      } else {
        setStatus(`✅ Processamento concluído! ${totalAdded} item(ns) adicionados em ${doneCount} imagens. ${errorCount} com erro.`);
      }
    }

    // ============================================================
    // CORREÇÃO DE LAYOUT APÓS VOLTAR DA CÂMERA (bug conhecido de
    // WebView Android: alguns navegadores não recalculam o layout
    // direito ao voltar da câmera nativa, deixando a página com
    // medidas "congeladas" e conteúdo cortado até algo forçar um
    // redesenho)
    // ============================================================
    function forceLayoutReflow() {
      requestAnimationFrame(() => {
        // Remonta a tag de viewport (corrige WebViews que ficam com a
        // largura "congelada" errada após abrir a câmera). Não mexemos
        // no display do body aqui de propósito: isso reiniciava as
        // animações de entrada da página inteira, o que podia deixar
        // itens da lista "presos" invisíveis se disparasse num momento
        // ruim (ex: tela apagando durante o processamento do OCR).
        const viewportMeta = document.querySelector('meta[name="viewport"]');
        if (viewportMeta) {
          const content = viewportMeta.getAttribute('content');
          viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1');
          requestAnimationFrame(() => viewportMeta.setAttribute('content', content));
        }

        window.scrollTo(0, window.scrollY);
        window.dispatchEvent(new Event('resize'));
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) forceLayoutReflow();
    });

    window.addEventListener('pageshow', forceLayoutReflow);

    // ============================================================
    // MANTER A TELA SEMPRE LIGADA ENQUANTO O APP ESTIVER ABERTO
    // Usa a Wake Lock API do navegador. Se o aparelho/navegador não
    // suportar, o app continua funcionando normalmente, só sem esse
    // recurso (nada quebra por causa disso).
    // ============================================================
    let wakeLock = null;

    async function requestWakeLock() {
      if (!('wakeLock' in navigator)) return; // navegador não suporta, ignora silenciosamente
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      } catch (err) {
        console.warn('Não foi possível manter a tela ligada:', err.message);
      }
    }

    // A tela só pode ser mantida ligada enquanto a aba está visível — o
    // navegador libera o wake lock automaticamente ao trocar de app, então
    // reativamos assim que o usuário volta pro PaleteFlow.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') requestWakeLock();
    });

    requestWakeLock();

    // ============================================================
    // EVENTOS DE UPLOAD
    // ============================================================
    $("galleryInput").onchange = e => {
      const files = e.target.files;
      if (files.length > 0) {
        addImagesToQueue(files);
      }
      e.target.value = '';
      forceLayoutReflow();
    };

    $("cameraInput").onchange = e => {
      const files = e.target.files;
      if (files.length > 0) {
        addImagesToQueue(files);
      }
      e.target.value = '';
      forceLayoutReflow();
    };

    $("ocrBtn").onclick = processSingleOCR;
    $("batchOcrBtn").onclick = processBatchOCR;

    // ============================================================
    // MODAL
    // ============================================================
    function openEdit(x) {
      const dialog = $("dialog");
      if (dialog.open) dialog.close();
      $("dialogTitle").textContent = x ? "Editar palete" : "Adicionar palete";
      $("editId").value = x?.id || "";
      $("no").value = x?.no || "";
      $("location").value = x?.location || "";
      $("code").value = x?.code || "";
      $("batch").value = x?.batch || "";
      $("product").value = x?.product || "";
      $("dialog").showModal();
    }

    $("addBtn").onclick = $("addBtn2").onclick = () => openEdit(null);
    $("cancel").onclick = () => $("dialog").close();

    $("form").onsubmit = e => {
      e.preventDefault();
      let id = $("editId").value;
      let obj = {
        no: $("no").value.trim(),
        location: $("location").value.trim(),
        code: $("code").value.trim(),
        batch: $("batch").value.trim(),
        product: $("product").value.trim()
      };
      if (!obj.no && !obj.location) return alert("Informe o número ou a localização.");

      const extracted = extractLocationParts(obj.location);
      if (extracted) {
        obj.location = extracted.full;
      }

      if (id) {
        const existing = state.items.find(x => x.id === id);
        if (!existing) return alert("Este item não existe mais. Recarregue a lista e tente novamente.");
        Object.assign(existing, obj);
      } else {
        state.items.push({ ...obj, id: uid(), done: false });
      }

      applySortAndSave();
      $("dialog").close();
    };

    // ============================================================
    // EVENTOS DA LISTA
    // ============================================================
    $("list").onclick = e => {
      let b = e.target.closest("button");
      if (!b) return;
      let x = state.items.find(x => x.id === b.dataset.id);
      if (!x) return;

      if (b.dataset.a === "toggle") {
        x.done = !x.done;

        // Salva imediatamente sem redesenhar a lista. Assim, quando o usuário
        // confirma um item, ele permanece visível durante o pequeno efeito
        // visual e depois desaparece da lista principal.
        state.items = sortItemsIntelligently(state.items);
        localStorage.setItem(KEY, JSON.stringify(state));
        $("saveBadge").textContent = "● Salvo";

        const itemEl = b.closest('.item');
        if (x.done && itemEl) {
          itemEl.classList.remove('just-confirmed');
          void itemEl.offsetWidth;
          itemEl.classList.add('just-confirmed');
          setTimeout(render, 600);
        } else {
          render();
        }
      }
      if (b.dataset.a === "delete") {
        if (!confirm("Excluir este palete?")) return;
        state.items = state.items.filter(i => i.id !== x.id);
        applySortAndSave();
        render();
      }
      if (b.dataset.a === "edit") openEdit(x);
    };

    // ============================================================
    // FILTROS E PESQUISA
    // ============================================================
    $("search").oninput = render;
    $("filter").onchange = render;

    // ============================================================
    // EXPORTAR
    // ============================================================
    function download(name, data, type) {
      let a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    $("csv").onclick = () => {
      const sorted = sortItemsIntelligently(state.items);
      let rows = [
        ["Item", "Localização", "Rua", "Bloco", "Nível", "Código", "Lote", "Produto", "Status"],
        ...sorted.map(x => {
          const loc = parseLocation(x.location);
          return [x.no, x.location, loc.street, loc.block, loc.level, x.code || '', x.batch || '', x.product || '', x.done ?
            "SEPARADO" : "PENDENTE"
          ];
        })
      ];
      download("paleteflow-lista.csv", "\ufeff" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(";")).join("\n"), "text/csv;charset=utf-8");
    };

    $("json").onclick = () => {
      const sorted = sortItemsIntelligently(state.items);
      const exportState = { ...state, items: sorted };
      download("paleteflow-backup.json", JSON.stringify(exportState, null, 2), "application/json");
    };

    // ============================================================
    // LIMPAR
    // ============================================================
    $("clear").onclick = () => {
      if (confirm("Limpar toda a operação salva?")) {
        state = { ...EMPTY_STATE };
        imageQueue = [];
        localStorage.removeItem(KEY);
        location.reload();
      }
    };

    // ============================================================
    // DRAG & DROP
    // ============================================================
    const dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--blue-primary)';
      dropZone.style.background = 'var(--bg-card-hover)';
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = 'var(--border-color)';
      dropZone.style.background = 'var(--bg-secondary)';
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--border-color)';
      dropZone.style.background = 'var(--bg-secondary)';
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const supportedFiles = Array.from(files).filter(f => getFileKind(f) !== 'unknown');
        if (supportedFiles.length > 0) {
          addDocumentsToQueue(supportedFiles);
        } else {
          setStatus('Arraste imagens, PDF ou DOCX.');
        }
      }
    });

    // ============================================================
    // INICIALIZAÇÃO
    // ============================================================
    if (state.items.length > 0) {
      state.items = sortItemsIntelligently(state.items);
      localStorage.setItem(KEY, JSON.stringify(state));
    }
    render();
    renderImageQueue();
    updateStatusFromQueue();
