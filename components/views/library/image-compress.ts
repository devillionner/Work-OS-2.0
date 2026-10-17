const MAX_BYTES = 700 * 1024;

/** Стискає фото в браузері перед завантаженням: JPEG до 1600 px і приблизно 700 КБ; прозорість заливається білим. */
export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Обери зображення.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('Не вдалося прочитати зображення. Спробуй JPG або PNG.'));
      node.src = url;
    });
    for (const maxSide of [1600, 1280, 1024, 800]) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Браузер не може підготувати фото.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.7, 0.58]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= MAX_BYTES) return blob;
      }
    }
    throw new Error('Фото завелике навіть після стискання. Обери інше зображення.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
