import type { Metadata } from 'next';
import { AuthProvider } from '@/hooks/use-auth';
import { AuthenticatedAppShell } from '@/components/layout/AuthenticatedAppShell';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Galilei',
  description: 'Jurisprudencia, documentos de tu dependencia y tus documentos personales.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>
          <AuthenticatedAppShell>{children}</AuthenticatedAppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
