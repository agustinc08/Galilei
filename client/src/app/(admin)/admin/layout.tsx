import { ProtectedContent } from '@/components/layout/ProtectedContent';

export default function AdminOnlyLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ProtectedContent allowedRoles={['ADMIN']} redirectTo="/dashboard">
      {children}
    </ProtectedContent>
  );
}
