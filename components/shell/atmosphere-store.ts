// Власне фото атмосфери живе тільки в IndexedDB цього пристрою і ніколи не потрапляє в D1.
const DB_NAME = 'work-os-atmosphere';
const STORE = 'photo';
const KEY = 'current';
const MAX_SIDE = 2560;
export const ATMOSPHERE_PHOTO_EVENT = 'work-os:atmosphere-photo';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB недоступна.'));
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => { resolve(request.result); db.close(); };
    request.onerror = () => { reject(request.error ?? new Error('Не вдалося звернутися до сховища.')); db.close(); };
  }));
}

export async function loadAtmospherePhoto(): Promise<Blob | null> {
  try {
    const value = await run<unknown>('readonly', (store) => store.get(KEY));
    return value instanceof Blob ? value : null;
  } catch {
    return null;
  }
}

export async function clearAtmospherePhoto(): Promise<void> {
  await run('readwrite', (store) => store.delete(KEY));
  window.dispatchEvent(new Event(ATMOSPHERE_PHOTO_EVENT));
}

/** Стискає до ≤ 2560px WebP і зберігає на пристрої. */
export async function saveAtmospherePhoto(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) throw new Error('Оберіть зображення.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('Не вдалося прочитати зображення.'));
      node.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не може підготувати зображення.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!blob) throw new Error('Не вдалося стиснути зображення.');
    await run('readwrite', (store) => store.put(blob, KEY));
    window.dispatchEvent(new Event(ATMOSPHERE_PHOTO_EVENT));
  } finally {
    URL.revokeObjectURL(url);
  }
}
