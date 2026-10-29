'use client';

import { Link } from "@/lib/router-compat";
import { usePathname } from '@/lib/router-compat';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { Button } from '../ui/Button';
import styles from './layout.module.css';

const mainDestinations = [
  { href: '/consulta', label: '⚖ Jurisprudencia', key: 'jurisprudencia' },
  { href: '/spaces', label: '🏛 Mi Sala / Juzgado', key: 'spaces' },
  { href: '/personal', label: '🔒 Mis documentos', key: 'personal' },
  { href: '/colecciones', label: '📚 Mis colecciones', key: 'collections' },
] as const;

function activeDestination(pathname: string) {
  if (pathname.startsWith('/spaces')) return 'spaces';
  if (pathname.startsWith('/personal')) return 'personal';
  if (pathname.startsWith('/colecciones')) return 'collections';
  if (
    pathname.startsWith('/consulta') ||
    pathname.startsWith('/fallos') ||
    pathname.startsWith('/jurisprudencia') ||
    pathname.startsWith('/sentencias') ||
    pathname.startsWith('/sumarios') ||
    pathname.startsWith('/revision') ||
    pathname.startsWith('/admin/jurisprudencia/ocr')
  ) {
    return 'jurisprudencia';
  }
  return null;
}

function breadcrumbLabel(key: string | null) {
  return mainDestinations.find((item) => item.key === key)?.label.replace(/^\S+\s/u, '') ?? null;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const { user, logout } = useAuth();
  const active = activeDestination(pathname);
  const breadcrumb = breadcrumbLabel(active);

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/galilei" aria-label="Galilei, inicio">
          <strong>Galilei</strong>
          <span>Jurisprudencia · Mi Sala / Juzgado · Mis documentos</span>
        </Link>

        <nav className={styles.nav} aria-label="Navegación principal">
          <p className={styles.navSectionLabel}>TRABAJO</p>
          {mainDestinations.map((item) => {
            const isActive = active === item.key;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(styles.navLink, isActive && styles.navLinkActive)}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          {user?.rol.nombre === 'ADMIN' || ['OPERADOR', 'JURISPRUDENCIA', 'REVISOR'].includes(user?.rol.nombre ?? '') ? (
            <nav className={styles.managementNav} aria-label="Gestión">
              <p className={styles.footerSectionLabel}>GESTIÓN</p>
              {user?.rol.nombre === 'ADMIN' ? <>
                <Link className={styles.footerLink} href="/dashboard">Panel técnico</Link>
                <Link className={styles.footerLink} href="/admin/logs">Registros</Link>
              </> : null}
              <Link className={styles.footerLink} href="/jurisprudencia/ingreso">Ingreso de jurisprudencia</Link>
              <Link className={styles.footerLink} href="/citas-pendientes">Revisión de citas</Link>
              <Link className={styles.footerLink} href="/admin/jurisprudencia/ocr">Revisión de OCR</Link>
            </nav>
          ) : null}
          <div className={styles.accountGroup}>
            <p className={styles.footerSectionLabel}>CUENTA</p>
            <strong className={styles.accountName}>{user ? `${user.nombre} ${user.apellido ?? ''}`.trim() : 'Sesión activa'}</strong>
            <Button variant="secondary" onClick={logout}>Cerrar sesión</Button>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <nav className={styles.breadcrumbs} aria-label="Migas de pan">
            <Link href="/galilei">Galilei</Link>
            {breadcrumb ? <><span aria-hidden="true">›</span><span aria-current="page">{breadcrumb}</span></> : null}
          </nav>
          <strong className={styles.userName}>{user?.nombre} {user?.apellido ?? ''}</strong>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
