'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { StatusMessage } from '../ui/StatusMessage';

type Props = {
  children: React.ReactNode;
  allowedRoles?: string[];
  redirectTo?: string;
};

export function ProtectedContent({
  children,
  allowedRoles,
  redirectTo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, user } = useAuth();
  const role = user?.rol.nombre ?? '';
  const routeRoles = pathname === '/corpus'
    ? ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA']
    : pathname.startsWith('/admin/logs')
    ? ['ADMIN']
    : pathname.startsWith('/dashboard') || pathname.startsWith('/estadisticas')
      ? ['ADMIN', 'OPERADOR']
      : pathname.startsWith('/revision')
        ? ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA']
        : pathname.startsWith('/digesto')
          ? ['ADMIN', 'OPERADOR', 'DIGESTO']
          : pathname.startsWith('/jurisprudencia') || pathname.startsWith('/sentencias') || pathname.startsWith('/sumarios')
            ? ['ADMIN', 'OPERADOR', 'JURISPRUDENCIA']
            : undefined;
  const effectiveRoles = allowedRoles ?? routeRoles;
  const isAllowed =
    !effectiveRoles?.length || (user ? effectiveRoles.includes(user.rol.nombre) : false);

  useEffect(() => {
    if (!isLoading && isAuthenticated && !isAllowed && redirectTo) {
      router.replace(redirectTo);
    }
  }, [isAllowed, isAuthenticated, isLoading, redirectTo, router]);

  if (isLoading) {
    return <LoadingSpinner label="Cargando sesión..." />;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!isAllowed) {
    return (
      <StatusMessage
        variant="error"
        title="No autorizado"
        message="No tienes permisos para acceder a esta sección."
      />
    );
  }

  return <>{children}</>;
}
