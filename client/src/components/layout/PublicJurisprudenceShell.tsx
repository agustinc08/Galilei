'use client';

import { Link, usePathname } from '@/lib/router-compat';
import styles from './public-jurisprudence.module.css';

function isImmersiveDocumentRoute(pathname: string) {
  return /^\/fallos\/[^/]+$/u.test(pathname) || /^\/consulta\/sentencia\/[^/]+\/documento$/u.test(pathname);
}

export function PublicJurisprudenceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isImmersiveDocumentRoute(pathname) || pathname === '/consulta/imprimir') {
    return <>{children}</>;
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Jurisprudencia Civil, inicio">
          <strong>Jurisprudencia Civil</strong>
          <span>Cámara Nacional de Apelaciones en lo Civil</span>
        </Link>
        <Link className={styles.internalAccess} href="/login">Acceso interno</Link>
      </header>
      {children}
    </div>
  );
}
