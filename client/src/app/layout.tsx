import { AuthProvider } from '@/hooks/use-auth';
import { AuthenticatedAppShell } from '@/components/layout/AuthenticatedAppShell';
import { ComparisonSelectionProvider } from '@/components/comparison/ComparisonSelection';
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
      <ComparisonSelectionProvider>
        <AuthenticatedAppShell>{children}</AuthenticatedAppShell>
      </ComparisonSelectionProvider>
    </AuthProvider>
  );
}
