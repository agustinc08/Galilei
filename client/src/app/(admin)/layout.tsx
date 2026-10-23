import { ProtectedContent } from '@/components/layout/ProtectedContent';

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ProtectedContent>
      {children}
    </ProtectedContent>
  );
}
