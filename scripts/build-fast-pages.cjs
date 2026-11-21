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

async function build() {
  const [html, css, words, app] = await Promise.all(['index.html', 'style.css', 'words.js', 'app.js'].map(read));
  const {window} = vm.runInNewContext(words + '\n;({window})', {window: {}});
  const keys = [...new Set(window.lessons.flatMap((lesson) => lesson[5].map(([word]) => wordKey(word))))];
  const icons = [...new Set([
    ...window.lessons.map((lesson) => lesson[4]),
    ...Array.from(html.matchAll(/data-hero-art="([^"]+)"/g), ([, icon]) => icon)
  ])];
  const themes = Array.from(html.matchAll(/<option value="([a-z]+)"/g), ([, theme]) => theme);
  const destination = path.join(root, 'fast');
  await fs.mkdir(destination, {recursive: true});

  for (const theme of themes) {
    const assets = {};
    for (const word of keys) {
      const portrait = `assets/scenes-card-webp/${theme}/${word}.webp`;
      const landscape = `assets/scenes/${theme}/${word}.webp`;
      const [single, grid] = await Promise.all([
        sharp(path.join(root, portrait)).resize({width: 480, withoutEnlargement: true}).webp({quality: 53, effort: 6}).toBuffer(),
        sharp(path.join(root, landscape)).resize({width: 320, withoutEnlargement: true}).webp({quality: 52, effort: 6}).toBuffer()
      ]);
      assets[`assets/scenes-card/${theme}/${word}.webp`] = dataUrl(single);
      assets[landscape] = dataUrl(grid);
    }
    for (const icon of icons) {
      const file = `assets/${theme}/${icon}.webp`;
      assets[file] = dataUrl(await sharp(path.join(root, file)).resize({width: 96, withoutEnlargement: true}).webp({quality: 55}).toBuffer());
    }

    const boot = inlineScript(`window.flashcardBundledStyle = ${JSON.stringify(theme)};\n` +
      `window.flashcardAssets = ${JSON.stringify(assets, null, 2)};\n` + words + '\n' + app);
    const result = html
      .replace(/<head>/, '<head>\n  <base href="../">')
      .replace(/<link rel="icon"[^>]+>/, () => `<link rel="icon" href="${assets[`assets/${theme}/book.webp`]}" type="image/webp">`)
      .replace(/<link rel="stylesheet"[^>]+>/, () => `<style>\n${css}\nbody.fast-loading > main { display: none; }\n#fast-loading { padding: 14px 0; }\n</style>`)
      .replace(/\s*<script src="words\.js[^>]*><\/script>\s*<script src="app\.js[^>]*><\/script>\s*<script>[\s\S]*?<\/script>/, '')
      .replace('<body>', '<body class="fast-loading">')
      .replace('<main class="wrap">', '<p id="fast-loading" class="wrap" role="status">正在一次下载此风格的全部卡图。完成后可直接切换单元和视图。</p>\n  <main class="wrap">')
      .replace(/<script id="navigation-preview-data"[\s\S]*?<\/script>/, () => boot);
    if (result.includes('src="app.js') || result.includes('id="navigation-preview-data"') || !result.includes('window.flashcardAssets =')) {
      throw new Error(`Could not generate the single-file version for ${theme}`);
    }
    await fs.writeFile(path.join(destination, theme + '.html'), result);
    console.log(`${theme}: ${keys.length * 2} card images, ${gzipSync(result).length} bytes when compressed`);
  }
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
