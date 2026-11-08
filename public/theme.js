(() => {
  const root = document.documentElement;
  const btn = document.getElementById('theme');
  if (!btn) return;
  const current = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');
  const sync = () => btn.setAttribute('aria-checked', String(current() === 'dark'));

  function apply(next, x, y) {
    const set = () => {
      root.dataset.theme = next;
      try { localStorage.setItem('dl-theme', next); } catch {}
      sync();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return set();

    if (document.startViewTransition) {
      const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const vt = document.startViewTransition(set);
      vt.ready.then(() => root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 720, easing: 'cubic-bezier(.3, .1, .2, 1)', pseudoElement: '::view-transition-new(root)' }
      )).catch(() => {});
    } else {
      root.classList.add('theme-fade');
      set();
      setTimeout(() => root.classList.remove('theme-fade'), 600);
    }
  }

  btn.addEventListener('click', () => {
    const k = btn.querySelector('.knob').getBoundingClientRect();
    btn.classList.remove('tug');
    void btn.offsetWidth;
    btn.classList.add('tug');
    apply(current() === 'dark' ? 'light' : 'dark', k.left + k.width / 2, k.top + k.height / 2);
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', e => {
    let saved = null;
    try { saved = localStorage.getItem('dl-theme'); } catch {}
    if (!saved) { root.dataset.theme = e.matches ? 'dark' : 'light'; sync(); }
  });
  sync();
})();
