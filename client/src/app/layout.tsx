import { AuthProvider } from '@/hooks/use-auth';
import { AuthenticatedAppShell } from '@/components/layout/AuthenticatedAppShell';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import './globals.css';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      <AuthenticatedAppShell>{children}</AuthenticatedAppShell>
    </AuthProvider>
  );
}
