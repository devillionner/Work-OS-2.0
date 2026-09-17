import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { PwaRegistration } from '@/components/pwa-registration';
import { ServerSync } from '@/components/server-sync';
import { UpdateBootHandoffCleanup } from '@/components/update-boot-handoff';
import { ViewPersistence } from '@/components/view-persistence';
import { APP_BUILD_ID } from '@/lib/build-id';
import './globals.css';
import './design-polish.css';
import './update-motion.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

const updateBootScript = `try{if(sessionStorage.getItem('work-os:pending-build')===${JSON.stringify(APP_BUILD_ID)})document.documentElement.setAttribute('data-work-os-update-boot','1')}catch{}`;

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
    <html lang="uk" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable}`}>
        <script dangerouslySetInnerHTML={{ __html: updateBootScript }} />
        <div className="app-update-backdrop app-update-boot-shell" aria-hidden="true">
          <div className="app-update-card" data-phase="boot">
            <div className="app-update-brand">W</div>
            <div className="app-update-icon"><span className="app-update-boot-spinner" /></div>
            <p className="eyebrow">Work OS</p>
            <h2>Завершуємо оновлення</h2>
            <p className="app-update-description">Ще мить — повертаємо ваш екран.</p>
            <div className="app-update-progress"><span style={{ width: '100%' }} /></div>
            <ol className="app-update-steps">
              <li className="is-complete"><span>✓</span>Готуємо оновлення</li>
              <li className="is-complete"><span>✓</span>Оновлюємо файли</li>
              <li className="is-current"><span>3</span>Повертаємо до роботи</li>
            </ol>
            <small className="app-update-note">Поточний розділ і позиція сторінки збережуться автоматично.</small>
          </div>
        </div>
        <PwaRegistration />
        <UpdateBootHandoffCleanup />
        <ServerSync />
        <ViewPersistence />
        {children}
      </body>
    </html>
  );
}
