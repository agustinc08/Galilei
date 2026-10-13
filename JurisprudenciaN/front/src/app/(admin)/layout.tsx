import { AdminShell } from '@/components/layout/AdminShell';
import { ProtectedContent } from '@/components/layout/ProtectedContent';

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ProtectedContent>
      <AdminShell>{children}</AdminShell>
    </ProtectedContent>
  );
}
