(() => {
  'use strict';

  const configKey = 'shanghai-flashcards-v2';
  const byId = (id) => document.getElementById(id);
  const tabs = byId('lesson-list');
  const lessonPicker = byId('lesson-picker');
  const lessonPickerSummary = byId('lesson-picker-summary');
  const lessonOptions = byId('lesson-options');
  const currentLessonName = byId('lesson-current');
  const currentLessonArt = byId('lesson-current-art');
  const styleSelect = byId('style-select');
  const cards = byId('cards');
  const stage = byId('deck-stage');
  const learn = stage.closest('.learn');
  const cardNav = byId('card-nav');
  const previousCard = byId('previous-card');
  const nextCard = byId('next-card');
  const voice = byId('voice');
  const status = byId('audio-status');
  const heroArt = Array.from(document.querySelectorAll('[data-hero-art]'));
  const buttons = Array.from(document.querySelectorAll('[data-accent], [data-view]'));
  const styles = Array.from(styleSelect.options, (option) => option.value);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const speaker = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/></svg>';
  const saved = readSettings();
  const bundledStyle = window.flashcardBundledStyle;
  const portraitLayout = !window.flashcardAssets || Boolean(bundledStyle);
  const requestedUnit = new URLSearchParams(window.location.search).get('unit');
  const requestedStyle = bundledStyle || new URLSearchParams(window.location.search).get('style');
  const requestedLesson = window.lessons.findIndex(([label]) => label === 'Unit ' + requestedUnit);
  const previousLesson = Number.isInteger(saved.lesson) && window.lessons[saved.lesson] ? saved.lesson : 1;
  let lessonIndex = requestedLesson >= 0 ? requestedLesson : previousLesson;
  let accent = saved.accent === 'us' ? 'us' : 'uk';
  let style = styles.includes(requestedStyle) ? requestedStyle : styles.includes(saved.style) ? saved.style : 'textbook';
  let view = saved.view === 'grid' ? 'grid' : 'focus';
  let cardIndex = 0;
  let artworkRequest;
  let scrollTimer;
  let focusWasScrolled = false;
  let compactCards = false;
  const cardScenes = new WeakMap();
  const sceneLoads = new WeakMap();
  const decodedScenes = new WeakSet();
  const returnPreloads = new WeakSet();
  const lessonArtwork = new Map();
  // Each line is one row in the navigation preview images.
  const previewRows = [
    'dad mum grandpa grandma morning afternoon evening good-morning',
    'good-afternoon good-evening hello friend welcome name hi pencil',
    'ruler eraser pencil-case book schoolbag pack my blackboard',
    'desk door chair floor classroom clean on-duty eye',
    'nose face ear mouth brother sister me family',
    'warm happy love cat horse dog hen bee',
    'animal helpful fly-away come-back bird hill flap-wings wash',
    'take-a-photo tie-shoelaces one two three four five six'
  ];
  const previewWordIndexes = new Map(previewRows.join(' ').split(' ').map((word, index) => [word, index]));
  const lessonWords = window.lessons.map((lesson) => lesson[5].map(([word]) => wordKey(word)));
  // Place each unit's opening portrait and first grid row before the rest of the grid.
  const readableKeys = [...new Set([
    ...lessonWords.flatMap((words) => ['focus:' + words[0], ...words.slice(0, 2).map((word) => 'grid:' + word)]),
    ...lessonWords.flatMap((words) => words.map((word) => 'grid:' + word))
  ])];
  let navigationPreview;
  let navigationPreviewSources;
  const warmUrls = new Set();
  let speculativeStyle;
  let navigationIntent;
  let focusedStyleWarm;
  let hidden = false;
  let activeCard = null;
  let playback = 0;

  function readSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(configKey));
      if (stored) return stored;
      const prior = JSON.parse(localStorage.getItem('shanghai-flashcards-v1')) || {};
      return {lesson: prior.lesson, accent: prior.accent};
    }
    catch { return {}; }
  }

  function saveSettings() {
    try { localStorage.setItem(configKey, JSON.stringify({lesson: lessonIndex, accent, style, view, card: cardIndex})); }
    catch { /* 微信隐私设置禁用存储时仍可学习。 */ }
  }

  function make(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function assetUrl(path) {
    const embedded = window.flashcardAssets?.[path];
    if (embedded) return embedded;
    if (/^assets\/(?:scenes|scenes-card(?:-lite|-webp)?)\/pig\/face\.(?:avif|webp)$/.test(path) ||
        /^assets\/scenes-grid-packs\/pig\/5\.(?:avif|webp)\.bin$/.test(path)) return path + '?v=6';
    if (/^assets\/scenes-card-(?:lite|webp)\/cute\//.test(path)) return path + '?v=5';
    const revised = /^assets\/scenes-card(?:-lite|-webp)\//.test(path) || path.startsWith('assets/scenes-card/cute/') ||
      /^assets\/scenes-card(?:-lite|-webp)?\/pig\//.test(path);
    return revised ? path + '?v=4' : path;
  }

  function wordKey(word) {
    return word.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/ +/g, '-');
  }

  function image(key, className, kind) {
    const node = make('img', className);
    node.alt = '';
    node.decoding = 'async';
    node.dataset.image = key;
    if (kind) node.dataset.artKind = kind;
    return node;
  }

  function cardAssetPaths(scenePath) {
    const webp = window.hdSceneAssetPaths?.[scenePath];
    if (!webp) return [];
    if (window.flashcardAssets) return [webp];
    const lighterWebp = webp.replace('scenes-card/', 'scenes-card-webp/');
    if (!compactCards) return [lighterWebp];
    const avif = webp.replace('scenes-card/', 'scenes-card-lite/').replace(/\.webp$/, '.avif');
    return [avif, lighterWebp];
  }

  function usesPortraitArt(node) {
    return node?.dataset.sceneView === 'focus' && portraitLayout;
  }

  function applyArt(node, onFailure, packedSource) {
    const isScene = node.dataset.artKind === 'scene';
    const key = node.dataset.image || node.dataset.heroArt;
    const imageStyle = node.dataset.sceneStyle || style;
    const directory = isScene ? 'scenes/' + imageStyle : imageStyle;
    const path = 'assets/' + directory + '/' + key + '.webp';
    const standardPath = window.sceneAssetPaths?.[path] || path;
    const sources = isScene && node.dataset.sceneView === 'focus' ? cardAssetPaths(path) : [];
    if (packedSource) sources.unshift(packedSource);
    const portraitOnly = usesPortraitArt(node);
    if (!portraitOnly) sources.push(standardPath);
    const sourcePath = sources[0];
    if (!sourcePath) {
      onFailure?.();
      return;
    }
    if (node.dataset.appliedStyle === imageStyle && node.dataset.appliedPath === sourcePath) return;
    let attempt = 0;
    node.onerror = () => {
      const fallback = sources[++attempt];
      if (fallback) {
        node.src = assetUrl(fallback);
        return;
      }
      if (portraitOnly) {
        if (attempt === sources.length) {
          // A separate cache key lets the portrait recover from a stale or failed response.
          const url = assetUrl(sources[sources.length - 1]);
          node.src = url + (url.includes('?') ? '&' : '?') + 'retry=1';
          return;
        }
        node.onerror = null;
        onFailure?.();
        return;
      }
      const fallbackKey = isScene
        ? window.lessons.flatMap((lesson) => lesson[5]).find((word) => wordKey(word[0]) === key)?.[2].split(' ')[0]
        : key;
      node.onerror = null;
      if (fallbackKey) {
        node.onerror = () => {
          node.onerror = null;
          onFailure?.();
        };
        node.src = assetUrl('assets/' + imageStyle + '/' + fallbackKey + '.webp');
      } else {
        onFailure?.();
      }
    };
    node.src = assetUrl(sourcePath);
    node.dataset.appliedStyle = imageStyle;
    node.dataset.appliedPath = sourcePath;
  }

  function clearPlaying() {
    if (activeCard) activeCard.classList.remove('playing');
    activeCard = null;
  }

  function stop() {
    playback += 1;
    voice.onended = null;
    voice.onerror = null;
    voice.pause();
    clearPlaying();
    status.hidden = true;
  }

  function speak(card, word) {
    stop();
    const current = playback;
    const filename = wordKey(word);
    const onFailure = () => {
      if (current !== playback) return;
      clearPlaying();
      status.textContent = '发音没加载成功，请检查网络后再点一次。';
      status.hidden = false;
    };
    activeCard = card;
    card.classList.add('playing');
    voice.onended = () => {
      if (current === playback) clearPlaying();
    };
    voice.onerror = onFailure;
    voice.src = assetUrl('assets/audio/' + accent + '/' + filename + '.mp3');
    // Keep play() in the tap handler so WeChat and Safari accept the gesture.
    const result = voice.play();
    if (result && result.catch) result.catch(onFailure);
  }

  function renderCard([word, meaning], index) {
    const node = make('button', 'card');
    node.type = 'button';
    const art = make('span', 'card-art');
    art.setAttribute('aria-hidden', 'true');
    cardScenes.set(node, {art, word: wordKey(word), index, images: new Map()});
    const copy = make('span', 'card-copy');
    const english = make('span', 'word', word);
    english.lang = 'en';
    const icon = make('span', 'speaker');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = speaker;
    icon.appendChild(make('span', 'speaker-label', '听发音'));
    copy.append(english, make('span', 'meaning', meaning), icon);
    node.append(art, copy);
    node.addEventListener('click', () => {
      if (view === 'focus' && Math.abs(cards.scrollLeft - cardOffset(index)) > 8) return;
      setCard(index);
      if (view === 'focus' && ['error', 'preview-only'].includes(node.dataset.imageState)) artworkRequest?.promote(index);
      speak(node, word);
    });
    return node;
  }

  function updateSettings() {
    document.documentElement.dataset.art = style;
    styleSelect.value = style;
    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', String(
        button.dataset.accent === accent || button.dataset.view === view
      ));
    });
  }

  function updateDecorativeArt() {
    for (const node of [...heroArt, ...tabs.querySelectorAll('img'), ...lessonOptions.querySelectorAll('img')]) {
      node.fetchPriority = 'low';
      applyArt(node);
    }
    applyArt(currentLessonArt);
  }

  function makeScene(word, mode, imageStyle) {
    const node = image(word, 'scene-art', 'scene');
    node.dataset.sceneView = mode;
    node.dataset.sceneStyle = imageStyle;
    node.loading = 'eager';
    return node;
  }

  function sceneFor(card, mode, imageStyle) {
    const {word, images} = cardScenes.get(card);
    const key = mode + ':' + imageStyle;
    const preloaded = mode === 'focus' && focusedStyleWarm?.card === card
      ? focusedStyleWarm.images.get(imageStyle) : null;
    const node = images.get(key) || preloaded || makeScene(word, mode, imageStyle);
    // Keep both layouts and the most recently used styles for this lesson.
    images.delete(key);
    images.set(key, node);
    const sameView = [...images.keys()].filter((cached) => cached.startsWith(mode + ':'));
    if (sameView.length > (mode === 'focus' ? 2 : 3)) images.delete(sameView[0]);
    return node;
  }

  function loadScene(node, priority, packedImage) {
    const pending = sceneLoads.get(node);
    if (decodedScenes.has(node)) return pending.promise;
    if (node.fetchPriority !== 'high' || priority === 'high') node.fetchPriority = priority;
    if (pending) {
      if (priority === 'high') pending.tryOtherPortrait?.();
      return pending.promise;
    }
    const request = {};
    sceneLoads.set(node, request);
    request.promise = new Promise((resolve) => {
      let settled = false;
      let started = false;
      let packPending = Boolean(packedImage);
      let directFailed = false;
      let fallbackTimer;
      let portraitTimer;
      let otherPortrait;
      const finish = (success) => {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        clearTimeout(portraitTimer);
        if (otherPortrait) otherPortrait.removeAttribute('src');
        node.removeEventListener('load', ready);
        if (success) decodedScenes.add(node);
        else {
          delete node.dataset.appliedPath;
          sceneLoads.delete(node);
        }
        resolve(success);
      };
      const ready = async () => {
        const source = node.src;
        try { await node.decode(); } catch { /* A loaded image can still be displayed. */ }
        if (settled) return;
        if (node.src !== source) {
          node.addEventListener('load', ready, {once: true});
          return;
        }
        if (node.naturalWidth && usesPortraitArt(node) && node.naturalWidth * 4 !== node.naturalHeight * 3) {
          node.addEventListener('load', ready, {once: true});
          node.onerror();
          return;
        }
        finish(node.naturalWidth > 0);
      };
      request.cancel = () => {
        if (settled) return;
        node.onerror = null;
        node.removeAttribute('src');
        finish(false);
      };
      request.tryOtherPortrait = () => {
        if (portraitTimer || !usesPortraitArt(node) || !compactCards || navigator.connection?.saveData ||
            navigationPreview?.style !== node.dataset.sceneStyle) return;
        const first = node.src;
        if (!/\.avif(?:\?|$)/.test(first)) return;
        const stillWaiting = () => !settled && node.src === first && !(node.complete && node.naturalWidth);
        portraitTimer = setTimeout(() => {
          if (!stillWaiting()) return;
          const path = 'assets/scenes/' + node.dataset.sceneStyle + '/' + node.dataset.image + '.webp';
          const [, webp] = cardAssetPaths(path);
          if (!webp) return;
          // Keep the original request in flight and use the other format only if it arrives first.
          otherPortrait = new Image();
          otherPortrait.onload = () => {
            if (stillWaiting() && otherPortrait.naturalWidth * 4 === otherPortrait.naturalHeight * 3) {
              node.src = otherPortrait.src;
            }
          };
          otherPortrait.src = assetUrl(webp);
        }, 550);
      };
      const load = (source) => {
        if (settled) return;
        started = true;
        node.addEventListener('load', ready, {once: true});
        applyArt(node, () => {
          if (packPending) directFailed = true;
          else finish(false);
        }, source);
      };
      if (packedImage) {
        if (priority !== 'low') fallbackTimer = setTimeout(load, priority === 'high' ? 180 : 360);
        packedImage.then((source) => {
          packPending = false;
          clearTimeout(fallbackTimer);
          if (!started || (source && !(node.complete && node.naturalWidth))) load(source);
          else if (directFailed) finish(false);
        });
      } else {
        load();
        if (priority === 'high') request.tryOtherPortrait();
      }
    });
    return request.promise;
  }

  function watchPackProgress(pack) {
    clearTimeout(pack.stallTimer);
    pack.stallTimer = setTimeout(() => pack.controller.abort(), pack.idleTimeout || 2500);
  }

  async function readArtworkPack(response, pack) {
    const stream = response.body?.getReader?.();
    let chunk = stream ? new Uint8Array() : new Uint8Array(await response.arrayBuffer());
    async function take(size) {
      const bytes = new Uint8Array(size);
      for (let offset = 0; offset < size;) {
        if (!chunk.length) {
          const next = stream && await stream.read();
          if (!next || next.done) throw new Error('Incomplete artwork pack');
          chunk = next.value;
          watchPackProgress(pack);
        }
        const count = Math.min(size - offset, chunk.length);
        bytes.set(chunk.subarray(0, count), offset);
        chunk = chunk.subarray(count);
        offset += count;
      }
      return bytes;
    }
    try {
      const header = new DataView((await take(4)).buffer);
      const tableSize = header.getUint32(0, true);
      if (!tableSize || tableSize > 4096) throw new Error('Invalid artwork index');
      const files = JSON.parse(new TextDecoder().decode(await take(tableSize)));
      if (files.length !== pack.words.length || files.some((file, index) => file.word !== pack.words[index])) {
        throw new Error('Wrong lesson artwork');
      }
      for (const [index, {size}] of files.entries()) {
        if (!Number.isInteger(size) || size <= 0 || size > 200000) throw new Error('Invalid artwork size');
        const bytes = await take(size);
        if (pack.controller.signal.aborted) return;
        const url = URL.createObjectURL(new Blob([bytes], {type: 'image/' + pack.format}));
        pack.urls.push(url);
        pack.ownerUrls?.add(url);
        pack.resolve[index](url);
      }
      if (stream) await stream.read();
    } finally {
      if (stream) stream.cancel().catch(() => {});
    }
  }

  function gridPackFor(lesson, imageStyle, priority) {
    if (window.flashcardAssets || !window.fetch || !window.AbortController || !window.TextDecoder || !URL.createObjectURL) return;
    const active = lesson.index === lessonIndex && imageStyle === style;
    const existing = lesson.packs.get(imageStyle);
    if (existing) {
      if (active) existing.active = true;
      return existing;
    }
    const pack = {lesson, imageStyle, format: compactCards ? 'avif' : 'webp', active, controller: new AbortController(), urls: [], ownerUrls: lesson.urls, resolve: []};
    pack.words = lesson.deck.map((card) => cardScenes.get(card).word);
    pack.images = pack.words.map(() => new Promise((resolve) => pack.resolve.push(resolve)));
    lesson.packs.set(imageStyle, pack);
    const path = 'assets/scenes-grid-packs/' + imageStyle + '/' + lesson.index + '.' + pack.format + '.bin';
    watchPackProgress(pack);
    pack.done = fetch(assetUrl(path), {priority, signal: pack.controller.signal})
      .then(async (response) => {
        if (!response.ok) return false;
        await readArtworkPack(response, pack);
        return !pack.controller.signal.aborted;
      })
      .catch(() => false)
      .then((complete) => {
        if (!complete && lesson.packs.get(imageStyle) === pack) lesson.packs.delete(imageStyle);
      })
      .finally(() => {
        clearTimeout(pack.stallTimer);
        pack.finished = true;
        pack.resolve.forEach((resolve) => resolve(null));
      });
    return pack;
  }

  function discardGridPack(pack, keepUrls = false) {
    if (pack.lesson.packs.get(pack.imageStyle) === pack) pack.lesson.packs.delete(pack.imageStyle);
    pack.controller.abort();
    if (!keepUrls) pack.urls.forEach((url) => {
      URL.revokeObjectURL(url);
      pack.lesson.urls.delete(url);
    });
  }

  function loadCardScene(lesson, card, node, priority) {
    const packedImage = node.dataset.sceneView === 'grid' && !sceneLoads.has(node)
      ? gridPackFor(lesson, node.dataset.sceneStyle, priority)?.images[cardScenes.get(card).index] : null;
    return loadScene(node, priority, packedImage);
  }

  function stopSpeculation(nextStyle) {
    if (!speculativeStyle || speculativeStyle.style === nextStyle) return;
    speculativeStyle.controller.abort();
    const {pack} = speculativeStyle;
    if (pack && !pack.active && !pack.finished) discardGridPack(pack);
    speculativeStyle = undefined;
  }

  function releaseFocusedStyles(keepDecoded = false) {
    if (!focusedStyleWarm) return;
    const {card, images} = focusedStyleWarm;
    const used = cardScenes.get(card).images;
    for (const [imageStyle, node] of images) {
      if (keepDecoded && decodedScenes.has(node)) continue;
      if (used.get('focus:' + imageStyle) !== node) sceneLoads.get(node)?.cancel();
      images.delete(imageStyle);
    }
    if (!keepDecoded) focusedStyleWarm = undefined;
  }

  function prewarmFocusedStyles(request) {
    if (artworkRequest !== request || request.mode !== 'focus' || window.flashcardAssets ||
        navigator.connection?.saveData) return;
    const card = request.deck[cardIndex];
    if (focusedStyleWarm?.card !== card) {
      releaseFocusedStyles();
      focusedStyleWarm = {card, images: new Map()};
    }
    const warm = focusedStyleWarm;
    if (warm.request === request) return warm.promise;
    warm.request = request;
    const {word, images} = cardScenes.get(card);
    const start = styles.indexOf(request.style);
    const remaining = styles.slice(start + 1).concat(styles.slice(0, start));
    // Warm the lightweight illustrations first so they are ready even on a slow link.
    const pig = remaining.indexOf('pig');
    if (pig > 0) remaining.unshift(remaining.splice(pig, 1)[0]);
    const worker = async () => {
      while (remaining.length && artworkRequest === request && focusedStyleWarm === warm) {
        const imageStyle = remaining.shift();
        const node = images.get('focus:' + imageStyle) || warm.images.get(imageStyle) ||
          makeScene(word, 'focus', imageStyle);
        warm.images.set(imageStyle, node);
        await loadScene(node, 'low');
      }
    };
    warm.promise = Promise.all([worker(), worker()]);
    return warm.promise;
  }

  async function prewarmGridStyles(request) {
    if (request.warming || artworkRequest !== request || window.flashcardAssets ||
        !window.fetch || !window.AbortController || navigator.connection?.saveData) return;
    request.warming = true;
    const start = styles.indexOf(request.style);
    const others = styles.slice(start + 1).concat(styles.slice(0, start));
    for (const imageStyle of others) {
      if (artworkRequest !== request) return;
      const {word} = cardScenes.get(request.deck[cardIndex]);
      const [single] = cardAssetPaths('assets/scenes/' + imageStyle + '/' + word + '.webp');
      const url = single && assetUrl(single);
      const pack = gridPackFor(request.lesson, imageStyle, 'low');
      const controller = new AbortController();
      const job = {style: imageStyle, pack, controller};
      speculativeStyle = job;
      const warm = !url || warmUrls.has(url) ? null :
        fetch(url, {cache: 'force-cache', priority: 'low', signal: controller.signal}).then(async (response) => {
          if (!response.ok) return;
          await response.arrayBuffer();
          warmUrls.add(url);
        }).catch(() => {});
      await Promise.all([pack?.done, warm]);
      if (speculativeStyle === job) speculativeStyle = undefined;
    }
  }

  function stopLessonDownloads(lesson) {
    for (const pack of lesson.packs.values()) {
      if (!pack.finished) discardGridPack(pack, true);
    }
    for (const card of lesson.deck) {
      for (const node of cardScenes.get(card).images.values()) sceneLoads.get(node)?.cancel();
    }
  }

  function getLessonArtwork(index) {
    if (lessonArtwork.has(index)) return lessonArtwork.get(index);
    const lesson = {index, deck: window.lessons[index][5].map(renderCard), packs: new Map(), urls: new Set()};
    lessonArtwork.set(index, lesson);
    // Keep the visible unit and the three most recent or prepared units.
    if (lessonArtwork.size > 4) {
      const oldest = [...lessonArtwork.values()].find((entry) => entry.index !== lessonIndex);
      stopLessonDownloads(oldest);
      oldest.urls.forEach((url) => URL.revokeObjectURL(url));
      lessonArtwork.delete(oldest.index);
    }
    return lesson;
  }

  function prewarmView(index, mode, selected = 0) {
    if (window.flashcardAssets || navigator.connection?.saveData || !navigator.onLine || !window.lessons[index]) return;
    const lesson = getLessonArtwork(index);
    if (mode === 'grid') {
      const imageStyle = style;
      const pack = gridPackFor(lesson, imageStyle, 'low');
      if (!pack) return;
      return Promise.all(pack.images.map((image, position) => image.then((url) => {
        if (!url || pack.controller.signal.aborted || style !== imageStyle) return;
        const node = sceneFor(lesson.deck[position], 'grid', imageStyle);
        return loadScene(node, 'low', Promise.resolve(url));
      })));
    }
    const card = lesson.deck[selected];
    return loadScene(sceneFor(card, 'focus', style), 'low');
  }

  function prewarmNavigation(request) {
    if (request.navigationWarm || window.flashcardAssets || navigator.connection?.saveData) return request.navigationWarm;
    // The visible art is ready. Prepare the other view and the adjacent units in the current view.
    const {index} = request.lesson;
    const otherView = request.mode === 'focus' ? 'grid' : 'focus';
    const warm = async () => {
      await prewarmView(index, otherView, cardIndex);
      for (const target of [index + 1, index - 1]) {
        if (artworkRequest !== request) return;
        await prewarmView(target, request.mode);
      }
    };
    request.navigationWarm = warm();
    return request.navigationWarm;
  }

  function prepareNavigationOnIntent(button, index, mode) {
    const warm = () => {
      const targetIndex = index ?? lessonIndex;
      const targetMode = mode ?? view;
      if (targetIndex !== lessonIndex || targetMode !== view) {
        prewarmView(targetIndex, targetMode, index === undefined ? cardIndex : 0);
      }
    };
    const prepare = (delay) => {
      clearTimeout(navigationIntent);
      if (delay) navigationIntent = setTimeout(warm, delay);
      else warm();
    };
    button.addEventListener('pointerenter', () => prepare(90));
    button.addEventListener('pointerleave', () => clearTimeout(navigationIntent));
    button.addEventListener('focus', () => prepare(90));
    button.addEventListener('pointerdown', () => prepare(0));
  }

  function refreshNavigationArtwork(preview) {
    if (navigationPreview !== preview || preview.refreshPending) return;
    preview.refreshPending = true;
    requestAnimationFrame(() => {
      preview.refreshPending = false;
      if (navigationPreview === preview) artworkRequest?.refreshPreviews?.();
    });
  }

  function loadNavigationPreview() {
    if (window.flashcardAssets || navigationPreview?.style === style) return;
    const previousPack = navigationPreview?.pack;
    if (previousPack) {
      previousPack.controller.abort();
      previousPack.urls.forEach((url) => URL.revokeObjectURL(url));
    }
    const preview = {style, readable: new Map()};
    navigationPreview = preview;
    const embedded = byId('navigation-preview-data');
    if (embedded) {
      if (!navigationPreviewSources) {
        try { navigationPreviewSources = JSON.parse(embedded.textContent); }
        catch { navigationPreviewSources = {}; }
      }
      const encoded = navigationPreviewSources[style];
      if (encoded) {
        const image = new Image();
        image.onload = () => {
          if (navigationPreview !== preview || image.naturalWidth !== 384 ||
              image.naturalHeight !== previewRows.length * 96) return;
          preview.atlas = image;
          refreshNavigationArtwork(preview);
        };
        image.src = 'data:image/webp;base64,' + encoded;
      }
    }
    if (navigator.connection?.saveData || !window.fetch || !window.AbortController || !window.TextDecoder || !URL.createObjectURL) return;
    let preloaded = window.navigationReadablePreload;
    delete window.navigationReadablePreload;
    if (preloaded && preloaded.theme !== style) {
      preloaded.controller.abort();
      preloaded = undefined;
    }
    const controller = preloaded?.controller || new AbortController();
    const pack = {controller, format: 'webp', idleTimeout: 6000, urls: [], words: readableKeys};
    pack.resolve = readableKeys.map((key) => (url) => {
      preview.readable.set(key, url);
      refreshNavigationArtwork(preview);
    });
    preview.pack = pack;
    watchPackProgress(pack);
    const response = preloaded?.response || fetch(assetUrl('assets/navigation-readable/' + style + '.bin'), {
      priority: 'low', signal: controller.signal
    });
    response.then((result) => result?.ok && readArtworkPack(result, pack)).catch(() => {})
      .finally(() => clearTimeout(pack.stallTimer));
  }

  function readableScene(card, node) {
    const preview = navigationPreview;
    if (preview?.style !== node.dataset.sceneStyle) return;
    const key = node.dataset.sceneView + ':' + node.dataset.image;
    const url = preview.readable.get(key);
    if (!url) return;
    const scene = cardScenes.get(card);
    if (scene.readable?.src !== url) {
      const image = makeScene(node.dataset.image, node.dataset.sceneView, node.dataset.sceneStyle);
      scene.readable = image;
      image.onload = () => refreshNavigationArtwork(preview);
      image.src = url;
    }
    if (scene.readable.complete && scene.readable.naturalWidth) return scene.readable;
  }

  function previewScene(card, node) {
    if (!navigationPreview?.atlas || navigationPreview.style !== node.dataset.sceneStyle) return;
    const index = previewWordIndexes.get(node.dataset.image);
    if (index === undefined) return;
    const scene = cardScenes.get(card);
    const portrait = node.dataset.sceneView === 'focus';
    const tile = 48;
    const key = node.dataset.sceneView + ':' + navigationPreview.style;
    if (scene.previewKey === key) return scene.preview;
    const canvas = scene.preview || make('canvas', 'scene-art');
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.width = portrait ? tile * 3 / 4 : tile;
    canvas.height = portrait ? tile : tile * 3 / 4;
    const row = Math.floor(index / 8) + (portrait ? previewRows.length : 0);
    context.drawImage(navigationPreview.atlas, index % 8 * tile, row * tile, canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height);
    canvas.dataset.sceneView = node.dataset.sceneView;
    canvas.dataset.sceneStyle = node.dataset.sceneStyle;
    scene.preview = canvas;
    scene.previewKey = key;
    return canvas;
  }

  function visibleArt() {
    const focused = view === 'focus';
    const deck = Array.from(cards.children);
    deck.forEach((card, index) => {
      const current = index === cardIndex;
      card.tabIndex = !focused || current ? 0 : -1;
      if (focused && !current) card.setAttribute('aria-hidden', 'true');
      else card.removeAttribute('aria-hidden');
    });
    if (!deck.length) return;
    if (artworkRequest?.first === deck[0] && artworkRequest.mode === view && artworkRequest.style === style) {
      if (focused) artworkRequest.promote(cardIndex);
      else loadScene(sceneFor(deck[cardIndex], 'focus', style), 'low');
      return;
    }
    stopSpeculation(focused ? undefined : style);
    if (!focused) releaseFocusedStyles(true);
    if (focusedStyleWarm?.card === deck[cardIndex]) {
      for (const [imageStyle, node] of focusedStyleWarm.images) {
        if (imageStyle !== style && !decodedScenes.has(node)) sceneLoads.get(node)?.cancel();
      }
    }
    const images = deck.map((card) => sceneFor(card, view, style));
    const previous = artworkRequest;
    const request = {first: deck[0], style, mode: view, images, deck, lesson: getLessonArtwork(lessonIndex)};
    artworkRequest = request;
    if (previous && (previous.first !== request.first || previous.style !== style)) {
      const newLesson = previous.first !== request.first;
      const outdatedPack = previous.lesson.packs.get(previous.style);
      if (outdatedPack && !outdatedPack.finished) discardGridPack(outdatedPack, true);
      for (const card of previous.deck) {
        for (const node of cardScenes.get(card).images.values()) {
          if (newLesson || (node.dataset.sceneStyle !== style && !returnPreloads.has(node))) {
            sceneLoads.get(node)?.cancel();
          }
        }
      }
    } else if (focused && previous?.mode === 'grid') {
      previous.images.forEach((node) => sceneLoads.get(node)?.cancel());
    } else if (!focused && previous?.mode === 'focus') {
      // The grid is visible now. Keep nearby single cards warm without competing for every card.
      previous.images.forEach((node, index) => {
        if (Math.abs(index - cardIndex) > 1) sceneLoads.get(node)?.cancel();
      });
    }
    const order = deck.map((_, index) => index);

    function showScene(index) {
      const card = deck[index];
      const {art} = cardScenes.get(card);
      const next = images[index];
      if (decodedScenes.has(next)) {
        card.classList.toggle('portrait-art', next.naturalHeight > next.naturalWidth);
        if (art.firstElementChild !== next) art.replaceChildren(next);
        delete card.dataset.imageState;
        return;
      }
      const displayed = art.firstElementChild;
      const nearby = !focused || Math.abs(index - cardIndex) <= 1;
      const readable = nearby && readableScene(card, next);
      if (readable) {
        if (displayed !== readable) art.replaceChildren(readable);
        card.dataset.imageState = 'readable';
        return;
      }
      const failed = ['error', 'preview-only'].includes(card.dataset.imageState);
      const preview = nearby && previewScene(card, next);
      if (preview) {
        if (displayed !== preview) art.replaceChildren(preview);
        card.dataset.imageState = failed ? 'preview-only' : 'switching';
        return;
      }
      if (art.firstElementChild !== next) art.replaceChildren(next);
      card.dataset.imageState = failed ? 'error' : 'loading';
    }

    // When the grid is already available at mobile viewing size, give quick switches
    // a chance to finish before asking the network for every original image.
    const preview = navigationPreview;
    const waitForGridDetails = !focused && preview?.style === request.style && deck.every((card) =>
      preview.readable.has('grid:' + cardScenes.get(card).word)) ? new Promise((resolve) => setTimeout(resolve, 180)) : null;
    const loadVisible = async (index, priority) => {
      if (waitForGridDetails) await waitForGridDetails;
      if (artworkRequest !== request) return;
      const ready = await loadCardScene(request.lesson, deck[index], images[index], priority);
      if (artworkRequest !== request) return;
      if (ready) showScene(index);
      else if (deck[index].dataset.imageState && deck[index].dataset.imageState !== 'readable') {
        const scene = cardScenes.get(deck[index]);
        deck[index].dataset.imageState = scene.preview && scene.art.firstElementChild === scene.preview ? 'preview-only' : 'error';
      }
    };
    request.refreshPreviews = () => order.forEach((index) => {
      if (['loading', 'switching', 'preview-only', 'error'].includes(deck[index].dataset.imageState)) showScene(index);
    });
    order.forEach(showScene);
    if (focused) {
      request.promote = async (index) => {
        showScene(index);
        await loadVisible(index, 'high');
        if (artworkRequest !== request || cardIndex !== index) return;
        if (!request.ready) {
          request.ready = true;
          setTimeout(() => {
            if (artworkRequest === request) updateDecorativeArt();
          }, 180);
        }
        Promise.resolve(prewarmNavigation(request)).then(() => {
          if (cardIndex === index) prewarmFocusedStyles(request);
        });
        // Keep nearby cards ready for swipes. Grid packs are loaded in grid view.
        if (navigator.connection?.saveData) return;
        setTimeout(() => {
          if (artworkRequest !== request || cardIndex !== index) return;
          if (index > 0) loadVisible(index - 1, 'low');
          if (index + 1 < deck.length) loadVisible(index + 1, 'low');
        }, 180);
      };
      request.promote(cardIndex);
      return;
    }

    const nearSelection = [...order].sort((a, b) => Math.abs(a - cardIndex) - Math.abs(b - cardIndex));
    const warmFocusCard = (index, keepOnStyleChange = false) => {
      const node = sceneFor(deck[index], 'focus', request.style);
      if (!keepOnStyleChange) loadScene(node, 'low');
      else {
        // Keep just the selected card warm for returning to single view.
        returnPreloads.add(node);
        loadScene(node, 'low').then(() => returnPreloads.delete(node));
      }
    };
    const early = order.slice(0, 2).map((index) => loadVisible(index, 'high'));
    const remaining = order.slice(2).map((index) => loadVisible(index, 'auto'));
    early[0].then(() => {
      if (artworkRequest === request) warmFocusCard(cardIndex, true);
    });
    Promise.all([...early, ...remaining]).then(() => {
      if (artworkRequest !== request) return;
      request.ready = true;
      prewarmNavigation(request);
      // Let the selected style finish rendering before warming offscreen artwork.
      setTimeout(() => {
        if (artworkRequest !== request) return;
        nearSelection.slice(1, 3).forEach((index) => warmFocusCard(index));
        updateDecorativeArt();
      }, 180);
    });
  }

  function updateCardNav() {
    cardNav.hidden = view !== 'focus';
    previousCard.disabled = cardIndex === 0;
    nextCard.disabled = cardIndex + 1 >= cards.children.length;
    byId('card-position').textContent = (cardIndex + 1) + ' / ' + cards.children.length;
  }

  function cardOffset(index) {
    if (index === 0) return 0;
    return cards.children[index].offsetLeft - cards.firstElementChild.offsetLeft;
  }

  function setCard(index) {
    if (cardIndex === index) return;
    const shouldKeepFocus = cards.children[cardIndex] === document.activeElement;
    stop();
    releaseFocusedStyles();
    cardIndex = index;
    visibleArt();
    updateCardNav();
    if (shouldKeepFocus && view === 'focus') cards.children[index].focus({preventScroll: true});
    saveSettings();
  }

  function alignCard(smooth = false) {
    if (view !== 'focus') return;
    cards.scrollTo({left: cardOffset(cardIndex), behavior: smooth && !reducedMotion.matches ? 'smooth' : 'auto'});
  }

  function moveCard(offset) {
    const index = cardIndex + offset;
    if (!cards.children[index]) return;
    setCard(index);
    alignCard(true);
  }

  function renderView() {
    clearTimeout(scrollTimer);
    const singleCard = view === 'focus';
    const wasSingleCard = cards.classList.contains('focus');
    if (!singleCard && wasSingleCard) focusWasScrolled = cards.scrollLeft !== 0;
    const needsAlignment = singleCard && (cardIndex !== 0 || wasSingleCard || focusWasScrolled);
    learn.classList.toggle('single-card', singleCard);
    stage.classList.toggle('focus-stage', singleCard);
    cards.classList.toggle('focus', singleCard);
    cards.classList.toggle('portrait-cards', singleCard && portraitLayout);
    visibleArt();
    updateCardNav();
    updateSettings();
    if (needsAlignment) alignCard();
  }

  function chooseLesson(index, start = 0) {
    stop();
    releaseFocusedStyles();
    stopSpeculation();
    clearTimeout(navigationIntent);
    for (const lesson of lessonArtwork.values()) {
      if (lesson.index !== index) stopLessonDownloads(lesson);
    }
    lessonIndex = index;
    const artwork = getLessonArtwork(index);
    lessonArtwork.delete(index);
    lessonArtwork.set(index, artwork);
    const [label, title, english, page, icon, words] = window.lessons[lessonIndex];
    learn.classList.toggle('counting-lesson', icon === 'numbers');
    cardIndex = Number.isInteger(start) && words[start] ? start : 0;
    byId('lesson-number').textContent = label;
    byId('lesson-title').textContent = title;
    byId('lesson-english').textContent = english;
    byId('lesson-count').textContent = words.length + ' 张卡片';
    byId('textbook-link').href = 'https://zhiquai.github.io/shanghai-english-reader/#' + page;
    byId('previous').disabled = index === 0;
    byId('next').disabled = index === window.lessons.length - 1;
    lessonPicker.open = false;
    currentLessonName.textContent = label + ' · ' + title;
    if (currentLessonArt.dataset.image !== icon) {
      currentLessonArt.dataset.image = icon;
      delete currentLessonArt.dataset.appliedStyle;
    }
    for (const list of [tabs, lessonOptions]) {
      Array.from(list.children).forEach((tab, i) => {
        if (i === index) tab.setAttribute('aria-current', 'true');
        else tab.removeAttribute('aria-current');
      });
    }
    if (cards.firstElementChild !== artwork.deck[0]) cards.replaceChildren(...artwork.deck);
    renderView();
    loadNavigationPreview();
    saveSettings();
  }

  function lessonButton([label, title, , , icon], index, mobile = false) {
    const button = make('button', 'unit');
    button.type = 'button';
    const thumbnail = image(icon, 'unit-icon');
    thumbnail.loading = 'lazy';
    button.append(thumbnail, make('span', 'unit-name', title), make('span', 'unit-tag', label));
    prepareNavigationOnIntent(button, index);
    button.addEventListener('click', () => {
      chooseLesson(index);
      if (mobile) lessonPickerSummary.focus({preventScroll: true});
    });
    return button;
  }

  window.lessons.forEach((lesson, index) => {
    tabs.appendChild(lessonButton(lesson, index));
    lessonOptions.appendChild(lessonButton(lesson, index, true));
  });

  document.addEventListener('click', (event) => {
    if (lessonPicker.open && !lessonPicker.contains(event.target)) lessonPicker.open = false;
  });
  lessonPicker.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !lessonPicker.open) return;
    event.preventDefault();
    lessonPicker.open = false;
    lessonPickerSummary.focus({preventScroll: true});
  });
  styleSelect.addEventListener('change', () => {
    if (style === styleSelect.value || !styles.includes(styleSelect.value)) return;
    style = styleSelect.value;
    if (bundledStyle) {
      saveSettings();
      window.location.assign(new URL(style + '.html', window.location.href));
      return;
    }
    visibleArt();
    loadNavigationPreview();
    updateSettings();
    saveSettings();
  });
  styleSelect.addEventListener('pointerdown', () => {
    if (artworkRequest?.ready) {
      if (view === 'focus') prewarmFocusedStyles(artworkRequest);
      else prewarmGridStyles(artworkRequest);
    }
  });
  buttons.filter((button) => button.dataset.view).forEach((button) => {
    prepareNavigationOnIntent(button, undefined, button.dataset.view);
  });
  buttons.forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.accent && button.dataset.accent !== accent) {
      stop();
      accent = button.dataset.accent;
    }
    if (button.dataset.view && button.dataset.view !== view) {
      view = button.dataset.view;
      renderView();
    } else {
      updateSettings();
    }
    saveSettings();
  }));

  function syncCardToScroll() {
    if (view !== 'focus') return;
    const {scrollLeft} = cards;
    let nearest = 0;
    let distance = Math.abs(scrollLeft - cardOffset(nearest));
    for (let index = 1; index < cards.children.length; index += 1) {
      const nextDistance = Math.abs(scrollLeft - cardOffset(index));
      if (nextDistance < distance) {
        nearest = index;
        distance = nextDistance;
      }
    }
    setCard(nearest);
  }
  cards.addEventListener('scroll', () => {
    if (view !== 'focus') return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(syncCardToScroll, 100);
  }, {passive: true});
  cards.addEventListener('scrollend', () => {
    clearTimeout(scrollTimer);
    syncCardToScroll();
  });
  previousCard.addEventListener('click', () => moveCard(-1));
  nextCard.addEventListener('click', () => moveCard(1));
  cards.addEventListener('keydown', (event) => {
    if (view !== 'focus' || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    moveCard(event.key === 'ArrowRight' ? 1 : -1);
  });
  window.addEventListener('resize', () => alignCard());
  window.addEventListener('online', () => {
    if (view === 'focus' && ['error', 'preview-only'].includes(cards.children[cardIndex]?.dataset.imageState)) {
      artworkRequest?.promote(cardIndex);
    }
  });

  const recall = byId('recall');
  recall.addEventListener('click', () => {
    hidden = !hidden;
    cards.classList.toggle('masked', hidden);
    recall.setAttribute('aria-pressed', String(hidden));
    recall.textContent = hidden ? '显示中文' : '隐藏中文';
  });

  function move(offset) {
    chooseLesson(lessonIndex + offset);
    byId('lesson-title').scrollIntoView({block: 'start'});
  }
  byId('previous').addEventListener('click', () => move(-1));
  byId('next').addEventListener('click', () => move(1));
  async function loadFirstLesson() {
    loadNavigationPreview();
    if (!window.flashcardAssets) {
      const probe = new Image();
      probe.src = 'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAAB0AAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAlbWRhdBIACgc4ADaQENBpMhAZQmMEwAA0AACQQMkcYIpq';
      try {
        await probe.decode();
        compactCards = probe.naturalWidth === 2;
      } catch { /* Use WebP when the browser cannot decode AVIF. */ }
    }
    if (bundledStyle) {
      byId('fast-loading')?.remove();
      document.body.classList.remove('fast-loading');
    }
    chooseLesson(lessonIndex, requestedLesson >= 0 ? 0 : saved.card);
  }
  loadFirstLesson();
})();
