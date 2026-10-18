'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { gsap, prefersReducedMotion, useGSAP } from '@/components/motion/gsap';
import { Draggable } from '@/components/motion/draggable';
import { Flip } from '@/components/motion/flip';

export type DropInfo = {
  id: string;
  fromGroup: string;
  toGroup: string;
  /** Запис, перед яким стає перетягнутий; `null` — у кінець групи. */
  beforeId: string | null;
};

const TOUCH_HOLD_MS = 380;
const TOUCH_SLOP_PX = 10;

/**
 * Перетягування карток із зміною порядку: GSAP Draggable + Flip, як у дошці лідів. Мишею й стилусом картка береться одразу
 * (після 6 px руху), пальцем — довгим натисканням (≈0,4 с), інакше сторінка прокручується. Елементи мають `data-sort-id` і
 * `data-sort-group` (група = колонка чи сітка); місце вставки визначається за карткою під вказівником. Перед зміною порядку
 * в стані викликайте `capture()`: Flip плавно переставить картки.
 */
export function useDragSort({ root, enabled, itemSelector = '[data-sort-id]', signature, dragClickables = false, onClick, onDrop }: {
  root: RefObject<HTMLElement | null>;
  enabled: boolean;
  itemSelector?: string;
  /** Змінюється, коли склад чи порядок карток змінився: Draggable пересоздаються. */
  signature: string;
  /** Картка сама є кнопкою відкриття: тоді натискання на кнопках усередині теж можуть почати перетягування. */
  dragClickables?: boolean;
  /** Клік без перетягування (лише разом із `dragClickables`; інакше відкриває власна кнопка картки). */
  onClick?: (id: string) => void;
  onDrop: (drop: DropInfo) => void;
}) {
  const flip = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const latestDrop = useRef(onDrop);
  const latestClick = useRef(onClick);
  useEffect(() => { latestDrop.current = onDrop; latestClick.current = onClick; });

  const capture = () => {
    flip.current = Flip.getState(root.current?.querySelectorAll(itemSelector) ?? []);
  };

  useLayoutEffect(() => {
    if (!flip.current) return;
    const state = flip.current;
    flip.current = null;
    Flip.from(state, { duration: prefersReducedMotion() ? 0.01 : 0.24, ease: 'power3.out' });
  });

  useGSAP(() => {
    const container = root.current;
    if (!container || !enabled) return;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const items = gsap.utils.toArray<HTMLElement>(itemSelector, container);
    const clearOver = () => container.querySelectorAll('[data-over]').forEach((node) => node.removeAttribute('data-over'));

    /**
     * Куди вставити: картка під вказівником (перед нею чи після) або кінець групи під вказівником. Тягнута картка сама лежить
     * під вказівником і сама несе `data-sort-group`, тож ні вона, ні її вміст не враховуються: інакше порожня колонка
     * завжди «відповідала» б групою тягнутої картки, і перенос на інший етап повертався назад.
     */
    const targetAt = (dragged: HTMLElement, x: number, y: number): { group: string; beforeId: string | null; over: HTMLElement | null } | null => {
      const nodes = document.elementsFromPoint(x, y).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== dragged && !dragged.contains(node) && container.contains(node));
      const overItem = nodes.find((node) => node.matches(itemSelector));
      // Група — контейнер колонки чи сітки (елемент із `data-sort-group`, що не є карткою).
      const groupNode = overItem
        ? overItem.parentElement?.closest<HTMLElement>('[data-sort-group]') ?? null
        : nodes.find((node) => node.dataset.sortGroup !== undefined && !node.matches(itemSelector)) ?? null;
      if (!groupNode) return null;
      const group = groupNode.dataset.sortGroup ?? '';
      if (!overItem) return { group, beforeId: null, over: null };
      const box = overItem.getBoundingClientRect();
      // У сітці з кількох колонок «до» чи «після» визначає горизонталь у межах рядка, у колонці — вертикаль.
      const sameRow = y >= box.top && y <= box.bottom;
      const after = sameRow && box.width < groupNode.getBoundingClientRect().width * 0.8 ? x > box.left + box.width / 2 : y > box.top + box.height / 2;
      if (!after) return { group, beforeId: overItem.dataset.sortId ?? null, over: overItem };
      const siblings = [...groupNode.querySelectorAll<HTMLElement>(itemSelector)].filter((node) => node !== dragged);
      const next = siblings[siblings.indexOf(overItem) + 1];
      return { group, beforeId: next?.dataset.sortId ?? null, over: overItem };
    };

    /** Точка вказівника в координатах вікна (для elementsFromPoint), незалежно від прокрутки сторінки. */
    const pointOf = (self: unknown) => {
      const drag = self as { pointerEvent?: Event; pointerX: number; pointerY: number };
      const event = drag.pointerEvent as (MouseEvent | TouchEvent | undefined);
      if (event && 'clientX' in event) return { x: event.clientX, y: event.clientY };
      const touch = event && 'changedTouches' in event ? event.changedTouches[0] : undefined;
      if (touch) return { x: touch.clientX, y: touch.clientY };
      return { x: drag.pointerX - window.scrollX, y: drag.pointerY - window.scrollY };
    };

    const instances = items.map((item) => {
      const press = { x: 0, y: 0, timer: 0 };
      const settle = () => gsap.to(item, { x: 0, y: 0, scale: 1, duration: prefersReducedMotion() ? 0.01 : 0.24, ease: 'expo.out' });
      const instance = Draggable.create(item, {
        type: 'x,y',
        zIndexBoost: true,
        dragClickables,
        minimumMovement: 6,
        onPress: () => { gsap.to(item, { scale: prefersReducedMotion() ? 1 : 1.02, duration: 0.16 }); item.classList.add('shadow-float'); },
        onDrag: function () {
          clearOver();
          const point = pointOf(this);
          targetAt(item, point.x, point.y)?.over?.setAttribute('data-over', 'true');
        },
        onRelease: () => { gsap.to(item, { scale: 1, duration: 0.16 }); item.classList.remove('shadow-float'); },
        onClick: () => latestClick.current?.(item.dataset.sortId ?? ''),
        onDragEnd: function () {
          const point = pointOf(this);
          const target = targetAt(item, point.x, point.y);
          clearOver();
          if (coarse) instance.disable();
          const id = item.dataset.sortId ?? '';
          const fromGroup = item.dataset.sortGroup ?? '';
          if (!target || (target.beforeId === id)) { settle(); return; }
          capture();
          gsap.set(item, { x: 0, y: 0, rotation: 0, scale: 1 });
          latestDrop.current({ id, fromGroup, toGroup: target.group, beforeId: target.beforeId });
        },
      })[0];
      if (coarse) {
        // Палець: без довгого натискання картка не береться (сторінка прокручується); після нього перетягування стартує вручну.
        instance.disable();
        const cancel = () => window.clearTimeout(press.timer);
        const onDown = (event: PointerEvent) => {
          if (event.pointerType === 'mouse') return;
          press.x = event.clientX; press.y = event.clientY;
          cancel();
          press.timer = window.setTimeout(() => {
            instance.enable();
            instance.startDrag(event);
            navigator.vibrate?.(12);
          }, TOUCH_HOLD_MS);
        };
        const onMove = (event: PointerEvent) => { if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TOUCH_SLOP_PX) cancel(); };
        item.style.touchAction = 'pan-y';
        item.addEventListener('pointerdown', onDown);
        item.addEventListener('pointermove', onMove);
        item.addEventListener('pointerup', cancel);
        item.addEventListener('pointercancel', cancel);
        item.addEventListener('contextmenu', (event) => event.preventDefault());
        return () => { cancel(); item.removeEventListener('pointerdown', onDown); item.removeEventListener('pointermove', onMove); item.removeEventListener('pointerup', cancel); item.removeEventListener('pointercancel', cancel); instance.kill(); };
      }
      return () => instance.kill();
    });
    return () => instances.forEach((dispose) => dispose());
  }, { scope: root, dependencies: [signature, enabled, itemSelector, dragClickables] });

  return { capture };
}
