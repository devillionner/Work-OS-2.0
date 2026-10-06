'use client';

import { useRef } from 'react';
import { ImagePlus, Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type WhatsAppAutopostImage = { fileName:string; contentType:string; sizeBytes:number; sha256:string; updatedAt:number };
export type WhatsAppAutopostProgress = { total:number; done:number; pending:number; claimed:number; sent:number; failed:number; cancelled:number; running:boolean };

// Operator request 2026-10-06: the autopost settings used to sit inline above the «Для публікації» queue, and
// the caption field alone pushed the whole queue below the fold. They are a setup step, not something to read
// on every visit, so they live in a dialog now — the queue row keeps a one-line summary of what is set.
export function WhatsappAutopostDialog({
  open, onClose, image, imageLoaded, caption, captionLoaded, busy, queueSize, progress,
  onCaptionChange, onUploadImage, onRemoveImage, onSaveCaption, onClearCaption, onStart, onStop, finalFocus,
}:{
  open:boolean;
  onClose:()=>void;
  image:WhatsAppAutopostImage|null;
  imageLoaded:boolean;
  caption:string;
  captionLoaded:boolean;
  busy:boolean;
  queueSize:number;
  progress:WhatsAppAutopostProgress|null;
  onCaptionChange:(value:string)=>void;
  onUploadImage:(file:File)=>void;
  onRemoveImage:()=>void;
  onSaveCaption:()=>void;
  onClearCaption:()=>void;
  onStart:()=>void;
  onStop:()=>void;
  finalFocus?:()=>HTMLElement|null;
}) {
  const fileInput=useRef<HTMLInputElement|null>(null);
  const ready=imageLoaded&&Boolean(image)&&captionLoaded;
  const running=progress?.running===true;

  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy)onClose();}}>
    <DialogContent className="whatsapp-autopost-dialog" finalFocus={finalFocus}>
      <DialogHeader>
        <DialogTitle>Автопублікація черги</DialogTitle>
        <DialogDescription>
          Work OS сам підбере матеріали й поставить до 30 чатів у чергу з підтвердженням відправки.
          Профілі вручну підтверджувати не потрібно — якщо правила вже підтверджені, Work OS їх врахує.
        </DialogDescription>
      </DialogHeader>

      {progress&&progress.total>0&&<section className="whatsapp-autopost-progress" aria-label="Прогрес автопоста">
        <div className="whatsapp-autopost-progress-head">
          <strong>{running?'Автопост виконується':'Автопост завершено'}</strong>
          <span>{`${progress.done} з ${progress.total}`}</span>
        </div>
        <progress max={Math.max(1,progress.total)} value={progress.done} aria-label="Опубліковано чатів" />
        <small className="muted-note">
          {`Відправлено ${progress.sent}`}
          {progress.failed?` · не вдалося ${progress.failed}`:''}
          {progress.pending||progress.claimed?` · лишилось ${progress.pending+progress.claimed}`:''}
          {progress.cancelled?` · скасовано ${progress.cancelled}`:''}
        </small>
      </section>}

      <div className="whatsapp-autopost-photo">
        <strong>Фото</strong>
        <span className="muted-note">{image
          ? `«${image.fileName}» буде додано до кожного повідомлення, текст піде підписом.`
          : 'Без фото автопост не запуститься — додайте одне зображення.'}</span>
        <div className="lead-actions">
          <input ref={fileInput} className="sr-only" type="file" accept="image/*" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)onUploadImage(file);}} />
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>fileInput.current?.click()}>
            <ImagePlus data-icon="inline-start"/>{image?'Замінити фото':'Додати фото'}
          </Button>
          {image&&<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onRemoveImage}>Прибрати фото</Button>}
        </div>
      </div>

      <label className="chat-publish-search" htmlFor="whatsapp-autopost-caption">
        <span>Текст автопоста</span>
        <Textarea id="whatsapp-autopost-caption" rows={8} maxLength={4000} disabled={busy||!captionLoaded}
          value={caption} onChange={event=>onCaptionChange(event.target.value)}
          placeholder="Вставте текст, який має піти під фото. Залиште порожнім — Work OS візьме текст із Library." />
        <small className="muted-note">{caption.trim()
          ? 'Цей текст буде використано як підпис до фото для нових автопостів.'
          : 'Поле порожнє — для кожного чату Work OS використає відповідний текст із Library.'}</small>
      </label>
      <div className="lead-actions">
        <Button type="button" size="sm" variant="outline" disabled={busy||!captionLoaded} onClick={onSaveCaption}>Зберегти текст</Button>
        {caption&&<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClearCaption}>Очистити текст</Button>}
      </div>

      <div className="dialog-actions">
        <Button variant="outline" disabled={busy} onClick={onClose}>Закрити</Button>
        {running
          ? <Button variant="outline" disabled={busy} onClick={onStop}><Square data-icon="inline-start"/>Зупинити автопост</Button>
          : <Button disabled={busy||!ready} onClick={onStart}>
              <Send data-icon="inline-start"/>{busy?'Ставимо в чергу…':queueSize?`Автопост черги (${queueSize})`:'Автопост черги'}
            </Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
