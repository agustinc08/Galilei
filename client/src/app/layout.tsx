import { AuthProvider } from '@/hooks/use-auth';
import { ComparisonSelectionProvider } from '@/components/comparison/ComparisonSelection';
import { EvolutionSelectionProvider } from '@/components/evolution/EvolutionSelection';
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
        <EvolutionSelectionProvider>
          {children}
        </EvolutionSelectionProvider>
      </ComparisonSelectionProvider>
    </AuthProvider>
  );
}
