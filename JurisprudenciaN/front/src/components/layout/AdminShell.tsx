'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { Button } from '../ui/Button';
import styles from './layout.module.css';

const navItems = [
  { href: '/dashboard', label: 'Inicio', roles: ['ADMIN', 'OPERADOR'] },
  { href: '/busqueda-avanzada', label: 'Buscar', roles: ['ADMIN', 'OPERADOR', 'LECTOR', 'REVISOR', 'JURISPRUDENCIA', 'DIGESTO'] },
  { href: '/jurisprudencia', label: 'Jurisprudencia', roles: ['ADMIN', 'OPERADOR', 'JURISPRUDENCIA'] },
  { href: '/digesto', label: 'Digesto', roles: ['ADMIN', 'OPERADOR', 'DIGESTO'] },
  { href: '/corpus', label: 'Documentos', roles: ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA'] },
  { href: '/spaces', label: 'Mi espacio', roles: ['ADMIN', 'OPERADOR', 'LECTOR', 'REVISOR', 'JURISPRUDENCIA', 'DIGESTO'] },
  { href: '/revision', label: 'Revisión', roles: ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA'] },
  { href: '/estadisticas', label: 'Estado', roles: ['ADMIN', 'OPERADOR'] },
  { href: '/consulta', label: 'Consulta pública', roles: ['ADMIN', 'OPERADOR', 'LECTOR', 'REVISOR', 'JURISPRUDENCIA', 'DIGESTO'] },
  { href: '/perfil', label: 'Perfil', roles: ['ADMIN', 'OPERADOR', 'LECTOR', 'REVISOR', 'JURISPRUDENCIA', 'DIGESTO'] },
  { href: '/admin/logs', label: 'Administración', roles: ['ADMIN'] },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const visibleNavItems = navItems.filter((item) =>
    item.roles.includes(user?.rol.nombre ?? ''),
  );
  const activeNavItem = visibleNavItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <strong>Buscador Jurídico Civil</strong>
          <span>Jurisprudencia · Digesto · Documentos</span>
        </div>

        <nav className={styles.nav} aria-label="Navegación principal">
          {visibleNavItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(styles.navLink, isActive && styles.navLinkActive)}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <Button variant="secondary" onClick={logout}>
            Cerrar sesión
          </Button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.sectionName}>
            {activeNavItem?.label ?? 'Buscador Jurídico Civil'}
          </div>
          <div className={styles.topbarMeta}>
            <strong>
              {user?.nombre} {user?.apellido ?? ''}
            </strong>
            <span>{user?.rol.nombre}</span>
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
