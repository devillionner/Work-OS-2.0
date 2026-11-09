'use client';

import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import type { PoolPreviewControls } from '@/components/views/platforms/autopost-panel';

/**
 * Рядок під чатом у «Переглянути чати партії»: який текст із пулу піде («Математика · діти · UA», перші слова) і, коли напрям не той,
 * чому. «Змінити» — вибір іншого вільного тексту лише для цього запуску; найкращі за напрямом чату стоять угорі.
 */
export function PoolTextLine({ chatId, preview }: { chatId: string; preview: PoolPreviewControls }) {
  const data = preview.data;
  if (!data?.active) return null;
  const item = data.items[chatId];
  if (data.scan.includes(chatId)) return <p className="m-0 pl-8 text-xs text-ink-3">Текст підберу після перевірки на гілки</p>;
  if (data.waiting.includes(chatId)) return <p className="m-0 pl-8 text-xs text-ink-2">Вільних текстів на сьогодні немає: чат піде завтра</p>;
  if (!item) return <p className="m-0 pl-8 text-xs text-ink-3">{preview.loading ? 'Підбираю текст…' : ''}</p>;
  const wanted = item.directions.map((direction) => direction.toLocaleLowerCase('uk'));
  const options = [...data.options].sort((a, b) => Number(wanted.includes(b.direction.toLocaleLowerCase('uk'))) - Number(wanted.includes(a.direction.toLocaleLowerCase('uk')))).slice(0, 60);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-8 text-xs text-ink-2">
      <span className="min-w-0 max-w-full truncate text-ink" title={item.snippet}>{item.snippet}</span>
      <span className="shrink-0">{item.label}{preview.manual[chatId] ? ' · вибрано вручну' : ''}</span>
      {item.note ? <span className="basis-full text-warn">{item.note}</span> : null}
      <Menu>
        <MenuTrigger render={<button type="button" aria-label={`Змінити текст для цього чату`} className="inline-flex min-h-7 items-center rounded-full px-2 text-xs text-ink underline decoration-line-strong underline-offset-4 hover:bg-raised [@media(pointer:coarse)]:min-h-11" />}>Змінити</MenuTrigger>
        <MenuContent align="start">
          {preview.manual[chatId] ? <MenuItem onClick={() => preview.choose(chatId, null)}>Повернути підібраний</MenuItem> : null}
          {options.length ? options.map((option) => (
            <MenuItem key={option.id} onClick={() => preview.choose(chatId, option.id)}>
              <span className="flex max-w-[min(26rem,80vw)] flex-col"><span className="truncate">{option.snippet}</span><span className="text-xs text-ink-3">{option.label}</span></span>
            </MenuItem>
          )) : <MenuItem disabled>Інших вільних текстів немає</MenuItem>}
        </MenuContent>
      </Menu>
    </div>
  );
}
