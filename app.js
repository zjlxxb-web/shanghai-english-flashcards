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
  const requestedUnit = new URLSearchParams(window.location.search).get('unit');
  const requestedStyle = new URLSearchParams(window.location.search).get('style');
  const requestedLesson = window.lessons.findIndex(([label]) => label === 'Unit ' + requestedUnit);
  const previousLesson = Number.isInteger(saved.lesson) && window.lessons[saved.lesson] ? saved.lesson : 1;
  let lessonIndex = requestedLesson >= 0 ? requestedLesson : previousLesson;
  let accent = saved.accent === 'us' ? 'us' : 'uk';
  let style = styles.includes(requestedStyle) ? requestedStyle : styles.includes(saved.style) ? saved.style : 'textbook';
  let view = saved.view === 'grid' ? 'grid' : 'focus';
  let cardIndex = 0;
  let artworkRequest;
  let scrollTimer;
  let compactCards = false;
  const cardScenes = new WeakMap();
  const sceneLoads = new WeakMap();
  const decodedScenes = new WeakSet();
  const returnPreloads = new WeakSet();
  const gridPacks = new Map();
  const gridPackUrls = new Set();
  const warmUrls = new Set();
  let speculativeStyle;
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
    const revised = path.startsWith('assets/scenes-card/cute/') ||
      /^assets\/scenes-card(?:-lite|-webp)?\/pig\//.test(path);
    return revised ? path + '?v=2' : path;
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
    if (!compactCards) return [lighterWebp, webp];
    const avif = webp.replace('scenes-card/', 'scenes-card-lite/').replace(/\.webp$/, '.avif');
    return [avif, lighterWebp, webp];
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
    sources.push(standardPath);
    const sourcePath = sources[0];
    if (node.dataset.appliedStyle === imageStyle && node.dataset.appliedPath === sourcePath) return;
    let attempt = 0;
    node.onerror = () => {
      const fallback = sources[++attempt];
      if (fallback) {
        node.src = assetUrl(fallback);
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
    if (pending) return pending.promise;
    const request = {};
    sceneLoads.set(node, request);
    request.promise = new Promise((resolve) => {
      let settled = false;
      const finish = (success) => {
        if (settled) return;
        settled = true;
        node.removeEventListener('load', ready);
        if (success) decodedScenes.add(node);
        else {
          delete node.dataset.appliedPath;
          sceneLoads.delete(node);
        }
        resolve(success);
      };
      const ready = async () => {
        try { await node.decode(); } catch { /* A loaded image can still be displayed. */ }
        finish(node.naturalWidth > 0);
      };
      request.cancel = () => {
        if (settled) return;
        node.onerror = null;
        node.removeAttribute('src');
        finish(false);
      };
      const load = (source) => {
        if (settled) return;
        node.addEventListener('load', ready, {once: true});
        applyArt(node, () => finish(false), source);
      };
      if (packedImage) packedImage.then(load);
      else load();
    });
    return request.promise;
  }

  async function readGridPack(response, pack) {
    const stream = response.body?.getReader?.();
    let chunk = stream ? new Uint8Array() : new Uint8Array(await response.arrayBuffer());
    async function take(size) {
      const bytes = new Uint8Array(size);
      for (let offset = 0; offset < size;) {
        if (!chunk.length) {
          const next = stream && await stream.read();
          if (!next || next.done) throw new Error('Incomplete artwork pack');
          chunk = next.value;
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
        gridPackUrls.add(url);
        pack.resolve[index](url);
      }
      if (stream) await stream.read();
    } finally {
      if (stream) stream.cancel().catch(() => {});
    }
  }

  function gridPackFor(imageStyle, priority) {
    if (window.flashcardAssets || !window.fetch || !window.AbortController || !window.TextDecoder || !URL.createObjectURL) return;
    const active = imageStyle === style;
    const existing = gridPacks.get(imageStyle);
    if (existing) {
      if (active) existing.active = true;
      return existing;
    }
    const pack = {format: compactCards ? 'avif' : 'webp', active, controller: new AbortController(), urls: [], resolve: []};
    pack.words = Array.from(cards.children, (card) => cardScenes.get(card).word);
    pack.images = pack.words.map(() => new Promise((resolve) => pack.resolve.push(resolve)));
    gridPacks.set(imageStyle, pack);
    const path = 'assets/scenes-grid-packs/' + imageStyle + '/' + lessonIndex + '.' + pack.format + '.bin';
    pack.done = fetch(path, {priority, signal: pack.controller.signal})
      .then((response) => response.ok ? readGridPack(response, pack) : undefined)
      .catch(() => {})
      .finally(() => {
        pack.finished = true;
        pack.resolve.forEach((resolve) => resolve(null));
      });
    return pack;
  }

  function discardGridPack(imageStyle, pack, keepUrls = false) {
    gridPacks.delete(imageStyle);
    pack.controller.abort();
    if (!keepUrls) pack.urls.forEach((url) => {
      URL.revokeObjectURL(url);
      gridPackUrls.delete(url);
    });
  }

  function loadCardScene(card, node, priority) {
    const packedImage = node.dataset.sceneView === 'grid' && !sceneLoads.has(node)
      ? gridPackFor(node.dataset.sceneStyle, priority)?.images[cardScenes.get(card).index] : null;
    return loadScene(node, priority, packedImage);
  }

  function stopSpeculation(nextStyle) {
    if (!speculativeStyle || speculativeStyle.style === nextStyle) return;
    speculativeStyle.controller.abort();
    const {style: imageStyle, pack} = speculativeStyle;
    if (pack && !pack.active && !pack.finished) discardGridPack(imageStyle, pack);
    speculativeStyle = undefined;
  }

  function releaseFocusedStyles() {
    if (!focusedStyleWarm) return;
    const {card, images} = focusedStyleWarm;
    const used = cardScenes.get(card).images;
    for (const [imageStyle, node] of images) {
      if (used.get('focus:' + imageStyle) !== node) sceneLoads.get(node)?.cancel();
    }
    focusedStyleWarm = undefined;
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

  async function prewarmStyles(request) {
    if (request.warming || artworkRequest !== request || window.flashcardAssets ||
        !window.fetch || !window.AbortController || navigator.connection?.saveData) return;
    request.warming = true;
    // In single mode, prepare sharp versions of the visible word before other styles' grids.
    if (request.mode === 'focus') await prewarmFocusedStyles(request);
    const start = styles.indexOf(request.style);
    const others = styles.slice(start + 1).concat(styles.slice(0, start));
    for (const imageStyle of others) {
      if (artworkRequest !== request) return;
      const {word} = cardScenes.get(request.deck[cardIndex]);
      const [single] = cardAssetPaths('assets/scenes/' + imageStyle + '/' + word + '.webp');
      const url = single && assetUrl(single);
      const pack = gridPackFor(imageStyle, 'low');
      const controller = new AbortController();
      const job = {style: imageStyle, pack, controller};
      speculativeStyle = job;
      const warm = request.mode === 'focus' || !url || warmUrls.has(url) ? null :
        fetch(url, {cache: 'force-cache', priority: 'low', signal: controller.signal}).then(async (response) => {
          if (!response.ok) return;
          await response.arrayBuffer();
          warmUrls.add(url);
        }).catch(() => {});
      await Promise.all([pack?.done, warm]);
      if (speculativeStyle === job) speculativeStyle = undefined;
    }
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
      if (focused) {
        const request = artworkRequest;
        const index = cardIndex;
        request.promote(index).then(() => setTimeout(() => {
          if (artworkRequest === request && cardIndex === index) prewarmFocusedStyles(request);
        }, 180));
      }
      else loadScene(sceneFor(deck[cardIndex], 'focus', style), 'low');
      return;
    }
    stopSpeculation(style);
    if (focused && focusedStyleWarm?.card === deck[cardIndex]) {
      for (const [imageStyle, node] of focusedStyleWarm.images) {
        if (imageStyle !== style && !decodedScenes.has(node)) sceneLoads.get(node)?.cancel();
      }
    }
    const images = deck.map((card) => sceneFor(card, view, style));
    const previous = artworkRequest;
    const request = {first: deck[0], style, mode: view, images, deck};
    artworkRequest = request;
    if (previous && (previous.first !== request.first || previous.style !== style)) {
      const newLesson = previous.first !== request.first;
      const outdatedPack = gridPacks.get(previous.style);
      if (outdatedPack && !outdatedPack.finished) discardGridPack(previous.style, outdatedPack, true);
      for (const card of previous.deck) {
        for (const node of cardScenes.get(card).images.values()) {
          if (newLesson || (node.dataset.sceneStyle !== style && !returnPreloads.has(node))) {
            sceneLoads.get(node)?.cancel();
          }
        }
      }
    } else if (!focused && previous?.mode === 'focus') {
      // The grid is visible now. Keep nearby single cards warm without competing for every card.
      previous.images.forEach((node, index) => {
        if (Math.abs(index - cardIndex) > 1) sceneLoads.get(node)?.cancel();
      });
    }
    const order = deck.map((_, index) => index);
    const alternate = focused ? 'grid' : 'focus';
    const alternateOrder = [...order].sort((a, b) => Math.abs(a - cardIndex) - Math.abs(b - cardIndex));
    const foregroundOrder = focused ? alternateOrder : order;

    function showScene(index) {
      const card = deck[index];
      const {art} = cardScenes.get(card);
      const next = images[index];
      if (decodedScenes.has(next)) {
        if (art.firstElementChild !== next) art.replaceChildren(next);
        delete card.dataset.imageState;
        return;
      }
      const displayed = art.firstElementChild;
      // Single cards must never show a picture from an earlier style or grid state.
      if (!focused && displayed?.naturalWidth) {
        delete card.dataset.imageState;
        return;
      }
      if (art.firstElementChild !== next) art.replaceChildren(next);
      card.dataset.imageState = 'loading';
    }

    const loadVisible = (index, priority) => loadCardScene(deck[index], images[index], priority).then((ready) => {
      if (artworkRequest !== request) return;
      if (ready) showScene(index);
      else if (deck[index].dataset.imageState) deck[index].dataset.imageState = 'error';
    });
    request.promote = (index) => loadVisible(index, 'high');
    const warmOther = (index, optional = true) => {
      const node = sceneFor(deck[index], alternate, request.style);
      if (optional) loadCardScene(deck[index], node, 'low');
      else {
        // Keep just the selected card warm for returning to single view.
        returnPreloads.add(node);
        loadCardScene(deck[index], node, 'low').then(() => returnPreloads.delete(node));
      }
    };

    order.forEach(showScene);
    const urgent = foregroundOrder.slice(0, focused ? 1 : 2);
    const early = urgent.map((index) => loadVisible(index, 'high'));
    const loadRemaining = () => {
      if (artworkRequest !== request) return;
      const rest = foregroundOrder.slice(urgent.length);
      if (!focused) return Promise.all(rest.map((index) => loadVisible(index, 'auto')));
      const nearby = rest.slice(0, 2).map((index) => loadVisible(index, 'low'));
      return Promise.all(nearby).then(() => {
        if (artworkRequest === request) {
          prewarmFocusedStyles(request);
          return Promise.all(rest.slice(2).map((index) => loadVisible(index, 'low')));
        }
      });
    };
    const changingStyle = previous?.first === request.first && previous.style !== style;
    if (focused && !changingStyle) order.forEach((index) => warmOther(index));
    const remaining = focused ? Promise.all(early).then(loadRemaining) : loadRemaining();
    if (focused) {
      Promise.all(early).then(() => {
        if (changingStyle && artworkRequest === request) order.forEach((index) => warmOther(index));
      });
    } else {
      Promise.all(early).then(() => {
        if (artworkRequest === request) warmOther(alternateOrder[0], false);
      });
    }
    Promise.all([...early, remaining]).then(() => {
      if (artworkRequest !== request) return;
      request.ready = true;
      // Let the selected style finish rendering before warming offscreen artwork.
      setTimeout(() => {
        if (artworkRequest !== request) return;
        if (!focused) alternateOrder.slice(1, 3).forEach((index) => warmOther(index));
        updateDecorativeArt();
      }, 180);
      setTimeout(() => prewarmStyles(request), 350);
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
    learn.classList.toggle('single-card', singleCard);
    stage.classList.toggle('focus-stage', singleCard);
    cards.classList.toggle('focus', singleCard);
    visibleArt();
    updateCardNav();
    updateSettings();
    alignCard();
  }

  function chooseLesson(index, start = 0) {
    stop();
    releaseFocusedStyles();
    stopSpeculation();
    for (const [imageStyle, pack] of gridPacks) discardGridPack(imageStyle, pack);
    gridPackUrls.forEach((url) => URL.revokeObjectURL(url));
    gridPackUrls.clear();
    lessonIndex = index;
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
    cards.textContent = '';
    words.forEach((word, i) => cards.appendChild(renderCard(word, i)));
    renderView();
    saveSettings();
  }

  function lessonButton([label, title, , , icon], index, mobile = false) {
    const button = make('button', 'unit');
    button.type = 'button';
    const thumbnail = image(icon, 'unit-icon');
    thumbnail.loading = 'lazy';
    button.append(thumbnail, make('span', 'unit-name', title), make('span', 'unit-tag', label));
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
    if (style === styleSelect.value) return;
    style = styleSelect.value;
    visibleArt();
    updateSettings();
    saveSettings();
  });
  styleSelect.addEventListener('pointerdown', () => {
    if (artworkRequest?.ready) {
      if (view === 'focus') prewarmFocusedStyles(artworkRequest);
      else prewarmStyles(artworkRequest);
    }
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
    if (!window.flashcardAssets) {
      const probe = new Image();
      probe.src = 'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAAB0AAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAlbWRhdBIACgc4ADaQENBpMhAZQmMEwAA0AACQQMkcYIpq';
      try {
        await probe.decode();
        compactCards = probe.naturalWidth === 2;
      } catch { /* Use WebP when the browser cannot decode AVIF. */ }
    }
    chooseLesson(lessonIndex, requestedLesson >= 0 ? 0 : saved.card);
  }
  loadFirstLesson();
})();
