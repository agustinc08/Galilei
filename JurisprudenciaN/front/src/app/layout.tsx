import type { Metadata } from 'next';
import { AuthProvider } from '@/hooks/use-auth';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sistema de Jurisprudencia Civil',
  description: 'Consulta pública y gestión interna de jurisprudencia civil',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
