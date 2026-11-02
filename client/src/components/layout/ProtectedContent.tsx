'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from '@/lib/router-compat';
import { useAuth } from '@/hooks/use-auth';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { StatusMessage } from '../ui/StatusMessage';

type Props = {
  children: React.ReactNode;
  allowedRoles?: string[];
  redirectTo?: string;
};

function rolesForPath(pathname: string) {
  if (pathname.startsWith('/admin/logs')) return ['ADMIN'];
  if (pathname === '/corpus' || pathname.startsWith('/corpus/')) {
    return ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA'];
  }
  if (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/estadisticas') ||
    pathname.startsWith('/archivos') ||
    pathname.startsWith('/favoritos') ||
    pathname.startsWith('/busquedas-guardadas') ||
    pathname.startsWith('/institutos-juridicos') ||
    pathname.startsWith('/normas')
  ) {
    return ['ADMIN', 'OPERADOR'];
  }
  if (pathname.startsWith('/documentos')) {
    return ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA'];
  }
  if (
    pathname.startsWith('/revision') ||
    pathname.startsWith('/citas-pendientes')
  ) {
    return ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA'];
  }
  if (pathname.startsWith('/digesto')) return ['ADMIN', 'OPERADOR', 'DIGESTO'];
  if (pathname.startsWith('/jurisprudencia')) {
    return ['ADMIN', 'OPERADOR', 'LECTOR', 'REVISOR', 'JURISPRUDENCIA', 'DIGESTO'];
  }
  if (pathname.startsWith('/sentencias') || pathname.startsWith('/sumarios')) {
    return ['ADMIN', 'OPERADOR', 'JURISPRUDENCIA'];
  }
  return undefined;
}

export function ProtectedContent({
  children,
  allowedRoles,
  redirectTo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, user } = useAuth();
  const routeRoles = rolesForPath(pathname);
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
