'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from '@/lib/router-compat';
import { useAuth } from '@/hooks/use-auth';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { StatusMessage } from '../ui/StatusMessage';
import { canAccessAdvancedJurisprudenceSearch } from '@/lib/jurisprudence-search-access';

type Props = {
  children: React.ReactNode;
  allowedRoles?: string[];
  redirectTo?: string;
};

function rolesForPath(pathname: string) {
  if (pathname === '/busqueda-avanzada' || pathname.startsWith('/busqueda-avanzada/')) {
    return ['JURISPRUDENCIA'];
  }
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
  const effectiveRedirectTo =
    redirectTo ??
    (pathname === '/busqueda-avanzada' || pathname.startsWith('/busqueda-avanzada/')
      ? '/busqueda'
      : undefined);
  const isAllowed =
    !effectiveRoles?.length ||
    (user
      ? effectiveRoles.includes(user.rol.nombre) &&
        (pathname !== '/busqueda-avanzada' ||
          canAccessAdvancedJurisprudenceSearch(user.rol.nombre))
      : false);

  useEffect(() => {
    if (!isLoading && isAuthenticated && !isAllowed && effectiveRedirectTo) {
      router.replace(effectiveRedirectTo);
    }
  }, [effectiveRedirectTo, isAllowed, isAuthenticated, isLoading, router]);

  if (isLoading) {
    return <LoadingSpinner label="Cargando sesión..." />;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!isAllowed) {
    if (effectiveRedirectTo) {
      return <LoadingSpinner label="Abriendo búsqueda común..." />;
    }
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
