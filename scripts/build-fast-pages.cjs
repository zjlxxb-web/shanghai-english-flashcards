// Run with Node.js and sharp available on the module path.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const {gzipSync} = require('node:zlib');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');
const wordKey = (word) => word.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/ +/g, '-');
const dataUrl = (bytes) => 'data:image/webp;base64,' + bytes.toString('base64');
const inlineScript = (code) => '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';

function artworkPack(files) {
  const table = Buffer.from(JSON.stringify(files.map(({word, bytes}) => ({word, size: bytes.length}))));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(table.length);
  return Buffer.concat([size, table, ...files.map(({bytes}) => bytes)]);
}

async function build() {
  const [html, css, words, app, trace] = await Promise.all(
    ['index.html', 'style.css', 'words.js', 'app.js', 'fast/trace.js'].map(read)
  );
  const {window} = vm.runInNewContext(words + '\n;({window})', {window: {}});
  const keys = [...new Set(window.lessons.flatMap((lesson) => lesson[5].map(([word]) => wordKey(word))))];
  const icons = [...new Set([
    ...window.lessons.map((lesson) => lesson[4]),
    ...Array.from(html.matchAll(/data-hero-art="([^"]+)"/g), ([, icon]) => icon)
  ])];
  const themes = Array.from(html.matchAll(/<option value="([a-z]+)"/g), ([, theme]) => theme);
  const destination = path.join(root, 'fast');
  const bundleDirectory = 'assets/fast-style-data';
  const portraitDirectory = path.join(root, 'assets', 'fast-style-portraits');
  await Promise.all([destination, path.join(root, bundleDirectory), portraitDirectory].map((directory) => fs.mkdir(directory, {recursive: true})));
  // Inline the default lesson in both views and the opening portrait of each lesson.
  const defaultWords = new Set(window.lessons[1][5].map(([word]) => wordKey(word)));
  const openingWords = new Set(window.lessons.map((lesson) => wordKey(lesson[5][0][0])));
  const secondWords = window.lessons.flatMap((lesson) => lesson[5].slice(1, 2).map(([word]) => wordKey(word)));
  const portraitWords = new Set([...openingWords, ...secondWords, ...keys]);

  for (const theme of themes) {
    const assets = {};
    const deferred = {};
    const images = new Map();
    for (const word of keys) {
      const portrait = `assets/scenes-card-webp/${theme}/${word}.webp`;
      const landscape = `assets/scenes/${theme}/${word}.webp`;
      const [single, grid] = await Promise.all([
        sharp(path.join(root, portrait)).resize({width: 480, withoutEnlargement: true}).webp({quality: 53, effort: 6}).toBuffer(),
        sharp(path.join(root, landscape)).resize({width: 320, withoutEnlargement: true}).webp({quality: 52, effort: 6}).toBuffer()
      ]);
      const portraits = openingWords.has(word) || defaultWords.has(word) ? assets : deferred;
      portraits[`assets/scenes-card/${theme}/${word}.webp`] = dataUrl(single);
      const landscapes = defaultWords.has(word) ? assets : deferred;
      landscapes[landscape] = dataUrl(grid);
      images.set(word, {grid, focus: single});
    }
    for (const icon of icons) {
      const file = `assets/${theme}/${icon}.webp`;
      assets[file] = dataUrl(await sharp(path.join(root, file)).resize({width: 96, withoutEnlargement: true}).webp({quality: 55}).toBuffer());
    }

    const packDirectory = path.join(root, 'assets', 'fast-lesson-packs', theme);
    await fs.mkdir(packDirectory, {recursive: true});
    await Promise.all(window.lessons.flatMap((lesson, index) => ['grid', 'focus'].map(async (view) => {
      const files = lesson[5].map(([text]) => {
        const word = wordKey(text);
        return {word, bytes: images.get(word)[view]};
      });
      await fs.writeFile(path.join(packDirectory, index + '.' + view + '.webp.bin'), artworkPack(files));
    })));
    const portraits = Array.from(portraitWords, (word) => ({word, bytes: images.get(word).focus}));
    await fs.writeFile(path.join(portraitDirectory, theme + '.webp.bin'), artworkPack(portraits));

    const bundlePath = `${bundleDirectory}/${theme}.js`;
    await fs.writeFile(path.join(root, bundlePath),
      `Object.assign(window.flashcardAssets, ${JSON.stringify(deferred)});\nwindow.flashcardBundleReady = true;\n`);
    const boot = inlineScript(`window.flashcardBundledStyle = ${JSON.stringify(theme)};\n` +
      `window.flashcardDeferredBundle = ${JSON.stringify(bundlePath + '?v=1')};\n` +
      `window.flashcardAssets = ${JSON.stringify(assets, null, 2)};\n` + words + '\n' + app);
    const result = html
      .replace(/<head>/, '<head>\n  <base href="../">')
      .replace(/<link rel="icon"[^>]+>/, () => `<link rel="icon" href="${assets[`assets/${theme}/book.webp`]}" type="image/webp">`)
      .replace(/<link rel="stylesheet"[^>]+>/, () => `<style>\n${css}\nbody.fast-loading > main { display: none; }\n#fast-loading { padding: 14px 0; }\n</style>`)
      .replace(/\s*<script src="words\.js[^>]*><\/script>\s*<script src="app\.js[^>]*><\/script>\s*<script>[\s\S]*?<\/script>/, '')
      .replace('<body>', '<body class="fast-loading">')
      .replace('<main class="wrap">', '<p id="fast-loading" class="wrap" role="status">正在打开闪卡…</p>\n  <main class="wrap">')
      .replace(/<script id="navigation-preview-data"[\s\S]*?<\/script>/, (preview) => preview + '\n  ' + boot);
    const withOptionalTrace = result
      .replace('</body>', `<script>
  if (new URLSearchParams(location.search).has('trace')) {
    const script = document.createElement('script');
    script.src = 'fast/trace.js?v=2';
    document.body.append(script);
  }
</script>
</body>`);
    if (result.includes('src="app.js') || !result.includes('id="navigation-preview-data"') || !result.includes('window.flashcardAssets =')) {
      throw new Error(`Could not generate the single-file version for ${theme}`);
    }
    await fs.writeFile(path.join(destination, theme + '.html'), withOptionalTrace);
    if (theme === 'pig') {
      const diagnostic = result
        .replace('</title>', '（真机诊断）</title>')
        .replace('<body class="fast-loading">', `<body class="fast-loading">
  <section id="trace-panel" aria-label="闪卡真机诊断" style="position:sticky;top:0;z-index:9999;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 12px;background:#fff3bc;border-bottom:2px solid #253778;color:#171717">
    <strong>闪卡真机诊断</strong>
    <span id="trace-status" role="status">诊断启动中</span>
    <button id="trace-copy" type="button" disabled style="min-height:36px;padding:4px 10px;background:#253778;color:white;border:0;border-radius:6px;font:700 14px sans-serif">复制诊断</button>
    <textarea id="trace-result" aria-label="闪卡诊断记录" rows="7" readonly hidden style="flex-basis:100%"></textarea>
  </section>`)
        .replace('</body>', () => inlineScript(trace) + '\n</body>');
      await fs.writeFile(path.join(destination, 'diagnose.html'), diagnostic);
    }
    console.log(`${theme}: ${keys.length * 2} card images, ${gzipSync(withOptionalTrace).length} bytes when compressed`);
  }
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
