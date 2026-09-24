import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Work OS 2.0',
    short_name: 'Work OS',
    description: 'Приватний робочий простір для чатів, лідів, звітів і статистики.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f5f5f3',
    theme_color: '#111111',
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
