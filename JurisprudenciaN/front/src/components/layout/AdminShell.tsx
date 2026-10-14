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
  { href: '/jurisprudencia', label: 'Jurisprudencia', roles: ['ADMIN', 'OPERADOR', 'LECTOR', 'REVISOR', 'JURISPRUDENCIA', 'DIGESTO'] },
  { href: '/digesto', label: 'Digesto', roles: ['ADMIN', 'OPERADOR', 'DIGESTO'] },
  { href: '/corpus', label: 'Documentos', roles: ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA'] },
  { href: '/spaces', label: 'Mi espacio', roles: ['ADMIN', 'OPERADOR', 'LECTOR', 'REVISOR', 'JURISPRUDENCIA', 'DIGESTO'] },
  { href: '/personal', label: 'Mis documentos', roles: ['ADMIN', 'OPERADOR', 'LECTOR', 'REVISOR', 'JURISPRUDENCIA', 'DIGESTO'] },
  { href: '/revision', label: 'Revisión', roles: ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA'] },
  { href: '/estadisticas', label: 'Estado', roles: ['ADMIN', 'OPERADOR'] },
  { href: '/perfil', label: 'Perfil', roles: ['ADMIN', 'OPERADOR', 'LECTOR', 'REVISOR', 'JURISPRUDENCIA', 'DIGESTO'] },
  { href: '/admin/logs', label: 'Administración', roles: ['ADMIN'] },
];

const roleLabels: Record<string, string> = {
  ADMIN: 'Administración', OPERADOR: 'Operación', LECTOR: 'Consulta',
  REVISOR: 'Revisión', JURISPRUDENCIA: 'Jurisprudencia', DIGESTO: 'Digesto',
};

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
            <strong>Buscador Jurídico Civil</strong>
            <span>Jurisprudencia · Digesto · Documentos</span>
        </div>

        <nav className={styles.nav}>
          {navItems.filter((item) => item.roles.includes(user?.rol.nombre ?? '')).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                styles.navLink,
                pathname.startsWith(item.href) && styles.navLinkActive,
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Button variant="secondary" onClick={logout}>
          Cerrar sesión
        </Button>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <strong>Buscador Jurídico Civil</strong>
          </div>
          <div className={styles.topbarMeta}>
            <strong>
              {user?.nombre} {user?.apellido ?? ''}
            </strong>
            <span>{user ? roleLabels[user.rol.nombre] ?? 'Usuario' : ''}</span>
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
