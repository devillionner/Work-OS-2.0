import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { PwaRegistration } from '@/components/pwa-registration';
import { ServerSync } from '@/components/server-sync';
import './globals.css';
import './design-polish.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Work OS 2.0',
  description: 'Приватний помічник для постингу, лідів, звітів і статистики.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Work OS',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Work OS',
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#111111',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <body className={`${sans.variable} ${mono.variable}`}>
        <PwaRegistration />
        <ServerSync />
        {children}
      </body>
    </html>
  );
}
