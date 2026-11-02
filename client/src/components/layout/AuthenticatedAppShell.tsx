'use client';

import { useEffect } from 'react';
import { usePathname } from '@/lib/router-compat';
import { useAuth } from '@/hooks/use-auth';
import { AdminShell } from './AdminShell';

function isPrintRoute(pathname: string) {
  return pathname === '/consulta/imprimir' || /^\/sentencias\/[^/]+\/imprimir$/u.test(pathname);
}

function setPageMetadata(title: string, description: string) {
  document.title = title;
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', description);
  document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.setAttribute('content', title);
  document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.setAttribute('content', description);
}

export function AuthenticatedAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    const isLogin = pathname === '/login';
    const title = isLogin ? 'Acceso interno | Galilei' : 'Galilei';
    const description = isLogin
      ? 'Acceso interno para el personal autorizado de la Cámara Nacional de Apelaciones en lo Civil.'
      : 'Herramientas internas de jurisprudencia, trabajo documental y administración según el perfil de acceso.';
    setPageMetadata(title, description);
    return () => setPageMetadata(
      'Jurisprudencia Civil | Cámara Nacional de Apelaciones en lo Civil',
      'Consultá fallos y sumarios publicados por la Cámara Nacional de Apelaciones en lo Civil.',
    );
  }, [pathname]);

  if (isLoading || !user || pathname === '/login' || isPrintRoute(pathname)) {
    return <>{children}</>;
  }

  return <AdminShell>{children}</AdminShell>;
}
