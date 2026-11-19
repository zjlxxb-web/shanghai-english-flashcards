(() => {
  'use strict';

  const configKey = 'shanghai-flashcards-v2';
  const byId = (id) => document.getElementById(id);
  const tabs = byId('lesson-list');
  const select = byId('lesson-select');
  const styleSelect = byId('style-select');
  const cards = byId('cards');
  const stage = byId('deck-stage');
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
  let scrollTimer;
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
    return window.flashcardAssets?.[path] || path;
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

  function applyArt(node) {
    if (node.dataset.appliedStyle === style) return;
    const isScene = node.dataset.artKind === 'scene';
    const key = node.dataset.image || node.dataset.heroArt;
    const directory = isScene ? 'scenes/' + style : style;
    const path = 'assets/' + directory + '/' + key + '.webp';
    const source = assetUrl(window.sceneAssetPaths?.[path] || path);
    node.onerror = () => {
      node.onerror = null;
      const fallbackKey = isScene
        ? window.lessons.flatMap((lesson) => lesson[5]).find((word) => wordKey(word[0]) === key)?.[2].split(' ')[0]
        : key;
      if (fallbackKey) {
        const fallback = assetUrl('assets/' + style + '/' + fallbackKey + '.webp');
        if (node.src !== fallback) node.src = fallback;
        if (isScene) node.parentElement.style.setProperty('--scene-fill', 'url("' + fallback + '")');
      }
    };
    node.src = source;
    if (isScene) node.parentElement.style.setProperty('--scene-fill', 'url("' + source + '")');
    node.dataset.appliedStyle = style;
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
    art.appendChild(image(wordKey(word), 'scene-art', 'scene'));
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
    heroArt.forEach(applyArt);
    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', String(
        button.dataset.accent === accent || button.dataset.view === view
      ));
    });
  }

  function visibleArt() {
    Array.from(cards.children).forEach((card, index) => {
      const focused = view === 'focus';
      const current = index === cardIndex;
      card.tabIndex = !focused || current ? 0 : -1;
      if (focused && !current) card.setAttribute('aria-hidden', 'true');
      else card.removeAttribute('aria-hidden');
      card.querySelectorAll('img[data-image]').forEach((node) => {
        if (!focused || Math.abs(index - cardIndex) <= 1) applyArt(node);
        else if (node.dataset.appliedStyle && node.dataset.appliedStyle !== style) {
          node.removeAttribute('src');
          if (node.dataset.artKind === 'scene') node.parentElement.style.removeProperty('--scene-fill');
          delete node.dataset.appliedStyle;
        }
      });
    });
  }

  function updateCardNav() {
    cardNav.hidden = view !== 'focus';
    previousCard.disabled = cardIndex === 0;
    nextCard.disabled = cardIndex + 1 >= cards.children.length;
    byId('card-position').textContent = (cardIndex + 1) + ' / ' + cards.children.length;
  }

  function cardOffset(index) {
    return cards.children[index].offsetLeft - cards.firstElementChild.offsetLeft;
  }

  function setCard(index) {
    if (cardIndex === index) return;
    const shouldKeepFocus = cards.children[cardIndex] === document.activeElement;
    stop();
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
    stage.classList.toggle('focus-stage', view === 'focus');
    cards.classList.toggle('focus', view === 'focus');
    visibleArt();
    updateCardNav();
    updateSettings();
    alignCard();
  }

  function chooseLesson(index, start = 0) {
    stop();
    lessonIndex = index;
    const [label, title, english, page, , words] = window.lessons[lessonIndex];
    cardIndex = Number.isInteger(start) && words[start] ? start : 0;
    byId('lesson-number').textContent = label;
    byId('lesson-title').textContent = title;
    byId('lesson-english').textContent = english;
    byId('lesson-count').textContent = words.length + ' 张卡片';
    byId('textbook-link').href = 'https://zhiquai.github.io/shanghai-english-reader/#' + page;
    byId('previous').disabled = index === 0;
    byId('next').disabled = index === window.lessons.length - 1;
    select.value = String(index);
    Array.from(tabs.children).forEach((tab, i) => {
      if (i === index) tab.setAttribute('aria-current', 'true');
      else tab.removeAttribute('aria-current');
    });
    cards.textContent = '';
    words.forEach((word, i) => cards.appendChild(renderCard(word, i)));
    renderView();
    saveSettings();
  }

  window.lessons.forEach(([label, title, , , icon], index) => {
    const button = make('button', 'unit');
    button.type = 'button';
    const thumbnail = image(icon, 'unit-icon');
    thumbnail.loading = 'lazy';
    applyArt(thumbnail);
    button.append(thumbnail, make('span', 'unit-name', title), make('span', 'unit-tag', label));
    button.addEventListener('click', () => chooseLesson(index));
    tabs.appendChild(button);
    const option = make('option', '', label + ' · ' + title);
    option.value = String(index);
    select.appendChild(option);
  });

  select.addEventListener('change', () => chooseLesson(Number(select.value)));
  styleSelect.addEventListener('change', () => {
    style = styleSelect.value;
    tabs.querySelectorAll('img[data-image]').forEach(applyArt);
    visibleArt();
    updateSettings();
    saveSettings();
  });
  buttons.forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.accent && button.dataset.accent !== accent) {
      stop();
      accent = button.dataset.accent;
    }
    if (button.dataset.view) {
      view = button.dataset.view;
      renderView();
    }
    updateSettings();
    saveSettings();
  }));

  cards.addEventListener('scroll', () => {
    if (view !== 'focus') return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (view !== 'focus') return;
      let nearest = 0;
      for (let index = 1; index < cards.children.length; index += 1) {
        if (Math.abs(cards.scrollLeft - cardOffset(index)) < Math.abs(cards.scrollLeft - cardOffset(nearest))) nearest = index;
      }
      setCard(nearest);
    }, 100);
  }, {passive: true});
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
  chooseLesson(lessonIndex, requestedLesson >= 0 ? 0 : saved.card);
})();
