import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Work OS',
    short_name: 'Work OS',
    description: 'Приватна робоча панель для чатів, лідів і публікацій з аналітикою.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#07080A',
    theme_color: '#07080A',
    orientation: 'any',
    icons: [
      { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/pwa-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
