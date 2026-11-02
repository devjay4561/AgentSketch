/** One tooltip, no animation loop. Nearby controls skip the initial hover delay. */
export function setupUIFeedback() {
  const root = document.documentElement;
  const tooltip = document.createElement('div');
  tooltip.id = 'tool-tooltip'; tooltip.className = 'tool-tooltip'; tooltip.role = 'tooltip'; tooltip.hidden = true;
  document.body.append(tooltip);
  let owner: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastShown = -Infinity;
  document.querySelectorAll<HTMLElement>('button[title], .canvas-option[title]').forEach(el => {
    el.dataset.tooltip = el.title; el.removeAttribute('title');
  });
  const targetFor = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
  function hide() {
    clearTimeout(timer);
    if (!tooltip.hidden) lastShown = performance.now();
    tooltip.hidden = true;
    owner?.removeAttribute('aria-describedby'); owner = null;
  }
  function show(el: HTMLElement) {
    if (!el.isConnected || el.matches(':disabled')) return;
    owner = el; tooltip.textContent = el.dataset.tooltip ?? ''; tooltip.hidden = false;
    el.setAttribute('aria-describedby', tooltip.id);
    const box = el.getBoundingClientRect(), rail = Boolean(el.closest('.tools-rail'));
    const x = rail ? box.right + 16 : box.left + (box.width - tooltip.offsetWidth) / 2;
    const y = rail ? box.top + (box.height - tooltip.offsetHeight) / 2 : box.bottom + 9;
    tooltip.style.left = `${Math.max(8, Math.min(x, innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(y, innerHeight - tooltip.offsetHeight - 8))}px`;
    lastShown = performance.now();
  }
  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse' || event.buttons) return;
    const el = targetFor(event.target);
    if (!el || el === targetFor(event.relatedTarget)) return;
    hide();
    timer = setTimeout(() => show(el), performance.now() - lastShown < 750 ? 0 : 450);
  });
  document.addEventListener('pointerout', event => {
    if (targetFor(event.target) !== targetFor(event.relatedTarget)) hide();
  });
  document.addEventListener('pointerdown', () => { root.dataset.input = 'pointer'; hide(); }, true);
  document.addEventListener('keydown', () => { root.dataset.input = 'keyboard'; hide(); }, true);
  document.addEventListener('focusin', event => {
    const el = targetFor(event.target); if (root.dataset.input === 'keyboard' && el) show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}
