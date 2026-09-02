# PaleteFlow · Separação Inteligente

Aplicativo web (PWA) para controle e separação inteligente de paletes, com
leitura de etiquetas por OCR (Tesseract.js), organização por localização
(rua/bloco/nível), exportação em CSV/JSON e uso offline via `localStorage`.

## Estrutura do projeto

```
.
├── index.html            # Estrutura da página
├── style.css             # Estilos (tema dark)
├── app.js                # Lógica do aplicativo (OCR, ordenação, CRUD, exportação)
├── manifest.json         # Manifesto do PWA
├── service-worker.js     # Cache offline (app + motor de OCR)
├── icon-192.png          # Ícone do app (192x192)
├── icon-512.png          # Ícone do app (512x512)
├── tesseract/            # Motor de OCR (Tesseract.js) hospedado localmente
│   ├── tesseract.min.js
│   ├── worker.min.js
│   ├── core/             # WebAssembly do motor (variantes com/sem SIMD)
│   └── lang-data/        # Dados de idioma: português (por) e inglês (eng)
└── README.md
```

## OCR 100% offline

O OCR (leitura das etiquetas) roda com [Tesseract.js](https://github.com/naptha/tesseract.js),
e **não depende mais de CDN/Internet** — todos os arquivos necessários
(motor, WebAssembly e dados de idioma português/inglês) já estão dentro da
pasta `tesseract/` e são referenciados localmente pelo `app.js`.

Para o app funcionar totalmente offline (inclusive o OCR) depois da primeira
visita, um **Service Worker** (`service-worker.js`) faz cache de todos esses
arquivos automaticamente. Ou seja:

1. Na primeira vez que o app for aberto, é preciso ter Internet (para o
   navegador baixar e cachear os arquivos, incluindo os ~18 MB do motor de
   OCR e dos dados de idioma).
2. Depois disso, o app — incluindo a leitura de etiquetas por OCR — funciona
   normalmente sem Internet, mesmo fechando e reabrindo o navegador.
3. Isso só funciona servindo os arquivos por **http(s)** (GitHub Pages,
   `python3 -m http.server`, etc.) — Service Workers não funcionam abrindo o
   `index.html` direto pelo navegador (`file://`).

## Como usar localmente

Como o app usa `fetch`/módulos e o `manifest.json`, o ideal é servir os
arquivos por um servidor local em vez de abrir o `index.html` direto pelo
navegador:

```bash
# Python
python3 -m http.server 8080

# ou Node
npx serve .
```

Depois acesse `http://localhost:8080`.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub e suba estes arquivos (veja abaixo).
2. No repositório, vá em **Settings → Pages**.
3. Em "Source", selecione a branch `main` e a pasta `/ (root)`.
4. Salve. Em alguns minutos o app estará disponível em
   `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

## Subindo para o GitHub via linha de comando

```bash
git init
git add .
git commit -m "Primeira versão do PaleteFlow"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/NOME-DO-REPOSITORIO.git
git push -u origin main
```

## Observações

- Os ícones (`icon-192.png` e `icon-512.png`) foram gerados como placeholder
  simples — substitua pela logo real do app quando quiser.
- O OCR usa a biblioteca [Tesseract.js](https://github.com/naptha/tesseract.js)
  carregada via CDN (não precisa instalar nada).
- Os dados ficam salvos no `localStorage` do navegador (por dispositivo).
