'use client';

import { Link } from "@/lib/router-compat";
import { usePathname } from '@/lib/router-compat';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { Button } from '../ui/Button';
import styles from './layout.module.css';

const mainDestinations = [
  { href: '/consulta', label: 'Jurisprudencia', key: 'jurisprudencia', icon: 'research' },
  { href: '/spaces', label: 'Mi Sala / Juzgado', key: 'spaces', icon: 'workspace' },
  { href: '/personal', label: 'Mis documentos', key: 'personal', icon: 'personal' },
  { href: '/colecciones', label: 'Mis colecciones', key: 'collections', icon: 'collections' },
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
  return mainDestinations.find((item) => item.key === key)?.label ?? null;
}

function NavigationIcon({ name }: { name: (typeof mainDestinations)[number]['icon'] }) {
  const paths = {
    research: <><path d="M7 3.75h7l4 4v12.5H7z" /><path d="M14 3.75v4h4M10 12h5M10 15.5h5" /></>,
    workspace: <><path d="M3.75 20.25h16.5M5.5 20.25V6.5l6.5-3 6.5 3v13.75" /><path d="M9 8.5h.01M15 8.5h.01M9 12h.01M15 12h.01M10 20v-4h4v4" /></>,
    personal: <><path d="M3.75 7.25h6l1.75 2h8.75v10.5H3.75z" /><path d="M3.75 7.25V5.5h7l1.5 1.75" /></>,
    collections: <><path d="M5 5.25h13.5M5 9.75h13.5M5 14.25h8.5M5 18.75h8.5" /><path d="M3.75 3.75h16.5v17H3.75z" /></>,
  };

  return <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
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
    const focusFirstLink = window.setTimeout(() => {
      sidebarRef.current?.querySelector<HTMLElement>('#galilei-primary-navigation a')?.focus();
    }, 200);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.clearTimeout(focusFirstLink);
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
                <NavigationIcon name={item.icon} />
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
