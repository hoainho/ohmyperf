export const CWV_INLINE_SCRIPT = `
(() => {
  if (window.__ohmyperfCwv) return;
  const state = { lcp: undefined, cls: 0, inp: undefined, fcp: undefined, ttfb: undefined };
  window.__ohmyperfCwv = state;

  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav && typeof nav.responseStart === 'number' && typeof nav.startTime === 'number') {
      state.ttfb = nav.responseStart - nav.startTime;
    }
  } catch (_) {}

  function safeObserve(type, cb, opts) {
    try {
      const po = new PerformanceObserver(cb);
      po.observe(Object.assign({ type }, opts || {}));
      return po;
    } catch (_) {
      return null;
    }
  }

  safeObserve('paint', (entries) => {
    for (const e of entries.getEntries()) {
      if (e.name === 'first-contentful-paint') {
        state.fcp = e.startTime;
      }
    }
  }, { buffered: true });

  safeObserve('largest-contentful-paint', (entries) => {
    const list = entries.getEntries();
    const last = list[list.length - 1];
    if (last) state.lcp = last.startTime;
  }, { buffered: true });

  safeObserve('layout-shift', (entries) => {
    for (const e of entries.getEntries()) {
      if (!e.hadRecentInput) {
        state.cls += e.value;
      }
    }
  }, { buffered: true });

  safeObserve('event', (entries) => {
    for (const e of entries.getEntries()) {
      const dur = e.duration;
      if (typeof dur === 'number' && (state.inp === undefined || dur > state.inp)) {
        state.inp = dur;
      }
    }
  }, { buffered: true, durationThreshold: 16 });
})();
` as const;
