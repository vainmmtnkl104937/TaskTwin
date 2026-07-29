import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@xyflow/react/dist/style.css';
import './globals.css';

export const metadata: Metadata = {
  description: 'TaskTwin local-first browser workflow automation',
  title: 'TaskTwin',
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
