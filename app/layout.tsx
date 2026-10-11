import type { Metadata, Viewport } from 'next';
import { Atmosphere } from '@/components/shell/atmosphere';
import { PwaRegistration } from '@/components/pwa-registration';
import { RunnerActivityBeacon } from '@/components/runner-activity-beacon';
import { ServerSync } from '@/components/server-sync';
import { THEME_BOOT_SCRIPT } from '@/components/shell/theme-provider';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

export const metadata: Metadata = {
  title: 'Work OS',
  description: 'Приватна робоча панель для чатів, лідів і публікацій з аналітикою.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Work OS',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Work OS',
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#07080A',
  colorScheme: 'dark light',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk" data-theme="night" data-atmosphere="fog" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <TooltipProvider>
          <ToastProvider>
            <Atmosphere />
            <PwaRegistration />
            <ServerSync />
            <RunnerActivityBeacon />
            <div className="relative z-10">{children}</div>
          </ToastProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
