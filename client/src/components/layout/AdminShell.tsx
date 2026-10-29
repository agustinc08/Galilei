'use client';

import { Link } from "@/lib/router-compat";
import { usePathname } from '@/lib/router-compat';
import { useEffect, useRef, useState } from 'react';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const active = activeDestination(pathname);
  const breadcrumb = breadcrumbLabel(active);

  useEffect(() => {
    const closeAfterHistoryNavigation = () => setMenuOpen(false);
    window.addEventListener('popstate', closeAfterHistoryNavigation);
    return () => window.removeEventListener('popstate', closeAfterHistoryNavigation);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const menuButton = menuButtonRef.current;
    sidebarRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      menuButton?.focus();
    };
  }, [menuOpen]);

  return (
    <div className={styles.appShell}>
      {menuOpen ? <button className={styles.drawerBackdrop} type="button" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} /> : null}
      <aside ref={sidebarRef} className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''}`}>
        <Link className={styles.brand} href="/galilei" aria-label="Galilei, inicio" onClick={() => setMenuOpen(false)}>
          <strong>Galilei</strong>
          <span>Jurisprudencia · Mi Sala / Juzgado · Mis documentos</span>
        </Link>

        <nav id="galilei-primary-navigation" className={styles.nav} aria-label="Navegación principal">
          <p className={styles.navSectionLabel}>TRABAJO</p>
          {mainDestinations.map((item) => {
            const isActive = active === item.key;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
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
                <Link className={styles.footerLink} href="/dashboard" onClick={() => setMenuOpen(false)}>Panel técnico</Link>
                <Link className={styles.footerLink} href="/admin/logs" onClick={() => setMenuOpen(false)}>Registros</Link>
              </> : null}
              <Link className={styles.footerLink} href="/jurisprudencia/ingreso" onClick={() => setMenuOpen(false)}>Ingreso de jurisprudencia</Link>
              <Link className={styles.footerLink} href="/citas-pendientes" onClick={() => setMenuOpen(false)}>Revisión de citas</Link>
              <Link className={styles.footerLink} href="/admin/jurisprudencia/ocr" onClick={() => setMenuOpen(false)}>Revisión de OCR</Link>
            </nav>
          ) : null}
          <div className={styles.accountGroup}>
            <p className={styles.footerSectionLabel}>CUENTA</p>
            <strong className={styles.accountName}>{user ? `${user.nombre} ${user.apellido ?? ''}`.trim() : 'Sesión activa'}</strong>
            <Button variant="secondary" onClick={() => { setMenuOpen(false); logout(); }}>Cerrar sesión</Button>
          </div>
        </div>
        </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            ref={menuButtonRef}
            className={styles.menuButton}
            type="button"
            aria-label={menuOpen ? 'Cerrar navegación' : 'Abrir navegación'}
            aria-expanded={menuOpen}
            aria-controls="galilei-primary-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">☰</span><span>Menú</span>
          </button>
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
