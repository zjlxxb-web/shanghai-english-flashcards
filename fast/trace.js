(() => {
  'use strict';

  const cards = document.getElementById('cards');
  const style = document.getElementById('style-select');
  const panel = document.getElementById('trace-panel') || document.createElement('div');
  const result = document.getElementById('trace-result') || document.createElement('textarea');
  const copy = document.getElementById('trace-copy') || document.createElement('button');
  const label = document.getElementById('trace-status') || document.createElement('span');
  const entries = [];
  let current;
  let frame;

  if (!panel.isConnected) {
    panel.style.cssText = 'position:fixed;z-index:9999;bottom:12px;bottom:calc(12px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);white-space:nowrap;padding:5px;background:white;color:#171717;border:1px solid #333;border-radius:8px;font:13px sans-serif';
    result.style.cssText = 'width:min(82vw,420px);height:9em';
    result.hidden = true;
    result.readOnly = true;
    result.setAttribute('aria-label', '闪卡诊断记录');
    copy.type = 'button';
    copy.textContent = '复制诊断';
    copy.style.cssText = 'min-height:36px;padding:4px 10px;background:#253778;color:white;border:0;border-radius:6px;font:700 14px sans-serif';
    panel.append(label, copy, result);
    document.body.append(panel);
  }

  function snapshot() {
    const focus = cards.classList.contains('focus');
    const list = focus ? [...cards.children].filter((card) => !card.hasAttribute('aria-hidden')) : [...cards.children];
    const first = list[0];
    const ready = list.filter((card) => {
      const image = card.querySelector('img.scene-art');
      return image?.naturalWidth >= 224 && image.dataset.sceneStyle === style.value &&
        !card.dataset.imageState;
    }).length;
    return {
      view: focus ? 'focus' : 'grid',
      unit: document.getElementById('lesson-number').textContent,
      word: first?.querySelector('.word')?.textContent,
      style: style.value,
      art: ready + '/' + list.length
    };
  }

  function time() {
    return Math.round(performance.now() - current.start);
  }

  function record(type, data) {
    if (!current || current.events.length >= 45) return;
    current.events.push({ms: time(), type, ...data});
  }

  function end(reason) {
    if (!current) return;
    clearTimeout(current.deadline);
    cancelAnimationFrame(frame);
    record(reason);
    entries.push({action: current.action, events: current.events});
    if (entries.length > 12) entries.shift();
    label.textContent = '已记录 ' + entries.length + ' 次 ';
    current = undefined;
  }

  function sample(timestamp) {
    if (!current) return;
    if (current.lastFrame && timestamp - current.lastFrame >= 75) {
      record('frame-gap', {duration: Math.round(timestamp - current.lastFrame)});
    }
    current.lastFrame = timestamp;
    frame = requestAnimationFrame(sample);
  }

  function observeCards() {
    if (!current) return;
    const state = snapshot();
    const key = JSON.stringify(state);
    if (key !== current.key) {
      record('card', state);
      current.key = key;
    }
  }

  function start(action) {
    end('next-action');
    current = {action, start: performance.now(), events: []};
    record('before', snapshot());
    current.deadline = setTimeout(() => end('end'), 8000);
    frame = requestAnimationFrame(sample);
  }

  function actionFor(target) {
    if (target.closest('#style-select')) return 'style';
    if (target.closest('#lesson-options button, #lesson-list button, #previous, #next')) return 'unit';
    if (target.closest('#previous-card, #next-card')) return 'arrow';
    if (target.closest('[data-view]')) return 'view';
    if (target.closest('#cards.focus')) return 'swipe';
  }

  document.addEventListener('pointerdown', (event) => {
    const action = actionFor(event.target);
    if (action) start(action);
  }, {capture: true, passive: true});
  document.addEventListener('pointerup', () => record('pointer-up'), {capture: true, passive: true});
  document.addEventListener('click', (event) => {
    const action = actionFor(event.target);
    if (!action || action === 'swipe') return;
    if (current?.action !== action) start(action);
    const lag = performance.now() - event.timeStamp;
    record('click', {dispatchDelay: lag >= 0 && lag < 10000 ? Math.round(lag) : undefined});
  }, true);
  style.addEventListener('change', () => {
    if (current?.action !== 'style') start('style');
    record('change', {style: style.value});
  }, true);
  const observer = new MutationObserver(observeCards);
  observer.observe(cards, {subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'aria-hidden', 'data-image-state']});
  cards.addEventListener('scroll', () => {
    if (!current || current.scrolling) return;
    current.scrolling = true;
    record('scroll-start');
  }, {passive: true});
  cards.addEventListener('scrollend', () => {
    if (!current) return;
    current.scrolling = false;
    record('scroll-end');
  }, {passive: true});
  if (window.PerformanceObserver?.supportedEntryTypes?.includes('resource')) {
    new PerformanceObserver((batch) => {
      for (const resource of batch.getEntries()) {
        if (!current || resource.startTime < current.start || !resource.name.includes('/assets/')) continue;
        const file = new URL(resource.name).pathname.split('/').slice(-3).join('/');
        if (/scenes|fast-lesson-packs/.test(file)) record('resource', {file, duration: Math.round(resource.duration)});
      }
    }).observe({type: 'resource'});
  }

  copy.addEventListener('click', async () => {
    end('copy');
    result.value = JSON.stringify({
      page: location.pathname.split('/').pop(),
      bundle: window.flashcardBundledStyle,
      viewport: [innerWidth, innerHeight],
      browser: navigator.userAgent,
      entries
    }, null, 2);
    try {
      await navigator.clipboard.writeText(result.value);
      label.textContent = '已复制 ';
    } catch {
      result.hidden = false;
      result.select();
      label.textContent = '请长按复制 ';
    }
  });
  label.textContent = '可以开始操作';
  copy.disabled = false;
})();
