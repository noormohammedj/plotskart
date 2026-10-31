/* Boxes that scroll sideways (tab strips, tables, charts) fade out at the edge that has more to show, so a cut-off
   "Location &" reads as "swipe for more" instead of a broken layout. Watches the page for boxes as screens change. */
const BOXES = '.seg, .tbl-wrap, .chart-wrap';

function mark(el: HTMLElement) {
  const more = el.scrollWidth - el.clientWidth;
  el.classList.toggle('more-l', more > 2 && el.scrollLeft > 2);
  el.classList.toggle('more-r', more > 2 && el.scrollLeft < more - 2);
}

export function watchScrollHints() {
  const seen = new WeakSet<HTMLElement>();
  const ro = new ResizeObserver((es) => es.forEach((e) => mark(e.target as HTMLElement)));
  const scan = () => document.querySelectorAll<HTMLElement>(BOXES).forEach((el) => {
    if (seen.has(el)) return mark(el);
    seen.add(el);
    el.addEventListener('scroll', () => mark(el), { passive: true });
    ro.observe(el);
    mark(el);
  });
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }).observe(document.body, { childList: true, subtree: true });
  scan();
}
