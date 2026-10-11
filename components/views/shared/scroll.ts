/** Найближчий предок, що справді прокручується (overflow-y: auto чи scroll). Предки з overflow: hidden — це рамка, її не рухаємо. */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/**
 * Гортає лише скрол-контейнер елемента, а не всіх предків, як це робить `scrollIntoView`
 * (він міг зсунути рамку застосунку з overflow: hidden). На телефоні гортається сторінка з відступом під липкою шапкою.
 */
export function scrollToNode(node: HTMLElement | null, { block = 'start' }: { block?: 'start' | 'center' } = {}) {
  if (!node) return;
  const scroller = scrollParent(node);
  const sticky = scroller ? 0 : document.querySelector<HTMLElement>('header')?.getBoundingClientRect().height ?? 0;
  const gap = 12;
  if (scroller) {
    const delta = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const centered = block === 'center' ? (scroller.clientHeight - node.offsetHeight) / 2 : gap;
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + delta - centered), behavior: smooth() });
    return;
  }
  const centered = block === 'center' ? (window.innerHeight - node.offsetHeight) / 2 : sticky + gap;
  window.scrollTo({ top: Math.max(0, window.scrollY + node.getBoundingClientRect().top - centered), behavior: smooth() });
}
