import '../styles/globals.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: {
    default: 'Camv | Video conferencing built for real connection',
    template: '%s | Camv',
  },
  description: 'Camv is a video conferencing app built for real-time audio and video experiences.',
  twitter: {
    creator: '@camv',
    site: '@camv',
    card: 'summary_large_image',
  },
  openGraph: {
    url: 'https://camv.co',
    images: [
      {
        url: '/images/camv-meet-open-graph.png',
        width: 1500,
        height: 750,
        type: 'image/png',
      },
    ],
    siteName: 'Camv',
  },
  icons: {
    icon: {
      rel: 'icon',
      url: '/favicon.ico',
    },
    apple: [
      {
        rel: 'apple-touch-icon',
        url: '/images/camv-apple-touch.png',
        sizes: '180x180',
      },
      { rel: 'mask-icon', url: '/images/camv-safari-pinned-tab.svg', color: '#102A5C' },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#102A5C',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body data-lk-theme="default">
        <Toaster />
        {children}
      </body>
    </html>
  );
}
