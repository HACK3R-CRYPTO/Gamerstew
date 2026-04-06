import type { Metadata } from 'next';
import { Orbitron } from 'next/font/google';
import './globals.css';
import Providers from '@/components/providers';
import AppShell from '@/components/AppShell';

const orbitron = Orbitron({ subsets: ['latin'], variable: '--font-orbitron' });

export const metadata: Metadata = {
  title: 'GameArena',
  description: 'Competitive on-chain gaming on Celo',
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${orbitron.variable} font-(family-name:--font-orbitron) bg-[#05050f] text-white min-h-screen`}>
        <Providers>
          <AppShell>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
