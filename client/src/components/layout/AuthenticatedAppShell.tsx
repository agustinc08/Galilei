'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { AdminShell } from './AdminShell';

function isPrintRoute(pathname: string) {
  return pathname === '/consulta/imprimir' || /^\/sentencias\/[^/]+\/imprimir$/u.test(pathname);
}

export function AuthenticatedAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();

  if (isLoading || !user || pathname === '/login' || isPrintRoute(pathname)) {
    return <>{children}</>;
  }

  return <AdminShell>{children}</AdminShell>;
}
