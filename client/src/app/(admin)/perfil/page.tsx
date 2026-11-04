'use client';

import { Link } from "@/lib/router-compat";
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { Rol } from '@/types/auth';
import styles from './perfil.module.css';

type WorkspaceMembership = {
  id: string;
  code: string;
  name: string;
  type: string;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
};

const GLOBAL_ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrador global',
  OPERADOR: 'Operación',
  LECTOR: 'Consulta',
  REVISOR: 'Revisión',
  JURISPRUDENCIA: 'Jurisprudencia',
  DIGESTO: 'Digesto',
};

const WORKSPACE_ROLE_LABEL: Record<WorkspaceMembership['role'], string> = {
  ADMIN: 'Responsable de la dependencia',
  EDITOR: 'Edición',
  VIEWER: 'Consulta',
};

function displayRole(role: Rol) {
  return GLOBAL_ROLE_LABEL[role.nombre] ?? 'Usuario';
}

function initials(name: string, surname?: string | null) {
  const first = name.trim().split(/\s+/u).filter(Boolean)[0] ?? '';
  const last = surname?.trim().split(/\s+/u).filter(Boolean).at(-1) ?? '';
  const letters = last ? `${first[0] ?? ''}${last[0] ?? ''}` : Array.from(first).slice(0, 2).join('');
  return letters.toLocaleUpperCase('es-AR') || 'U';
}

function dependencyBadge(workspace: WorkspaceMembership) {
  const compact = workspace.code.toLocaleUpperCase('es-AR').replace(/[^A-Z0-9]/gu, '');
  if (/^S(?:ALA)?[A-Z0-9]/u.test(compact)) return `S${compact.replace(/^S(?:ALA)?/u, '').slice(0, 1)}`;
  if (/^J(?:UZGADO)?\d/u.test(compact)) return `J${compact.match(/\d/u)?.[0] ?? ''}`;
  return compact.slice(0, 2) || workspace.type.slice(0, 2).toLocaleUpperCase('es-AR');
}

export default function PerfilPage() {
  const { user, isLoading, refreshUser, changeContraseña, logout } = useAuth();
  const [currentPassword, setCurrentContraseña] = useState('');
  const [newPassword, setNewContraseña] = useState('');
  const [repeatPassword, setRepeatContraseña] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);

  const userInitials = useMemo(() => user ? initials(user.nombre, user.apellido) : '', [user]);

  useEffect(() => {
    void refreshUser();
    let active = true;
    void api.get<WorkspaceMembership[]>('/workspaces/mine').then((rows) => {
      if (active) setWorkspaces(rows);
    }).catch(() => {
      if (active) setWorkspacesError('No pudimos cargar las dependencias asociadas a tu cuenta.');
    }).finally(() => {
      if (active) setWorkspacesLoading(false);
    });
    return () => { active = false; };
  }, [refreshUser]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }

    if (newPassword !== repeatPassword) {
      setError('La repetición de la nueva contraseña no coincide.');
      return;
    }

    setSaving(true);
    try {
      await changeContraseña({ currentPassword, newPassword });
      setCurrentContraseña('');
      setNewContraseña('');
      setRepeatContraseña('');
      setSuccess('Contraseña actualizada correctamente.');
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : 'No se pudo cambiar la contraseña.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !user) {
    return <LoadingSpinner label="Cargando usuario..." />;
  }

  return (
    <div className={styles.section}>
      <PageHeader
        title="Mi perfil"
        description="Tu identidad, el acceso asignado y la seguridad de la cuenta."
        actions={
          <>
            <Link href="/galilei">
              <Button variant="secondary">Volver a Galilei</Button>
            </Link>
            <Button variant="secondary" onClick={logout}>
              Cerrar sesión
            </Button>
          </>
        }
      />

      <div className={styles.profileGrid}>
        <Card className={styles.identityCard}>
          <div className={styles.identityHeader}>
            <div className={styles.initialsAvatar} aria-hidden="true">{userInitials}</div>
            <div><h2>{[user.nombre, user.apellido].filter(Boolean).join(' ')}</h2><p>{user.email}</p></div>
          </div>
          <dl className={styles.identityDetails}>
            <div><dt>Acceso general</dt><dd>{displayRole(user.rol)}</dd></div>
            <div><dt>Estado de la cuenta</dt><dd><span className={user.activo ? styles.activeStatus : styles.inactiveStatus}>{user.activo ? 'Activo' : 'Inactivo'}</span></dd></div>
            <div><dt>Fecha de creación</dt><dd>{user.createdAt ? formatDate(user.createdAt) : 'No disponible'}</dd></div>
            <div><dt>Último acceso</dt><dd>{user.ultimoAcceso ? formatDate(user.ultimoAcceso) : 'No disponible'}</dd></div>
          </dl>
          <p className={styles.profilePrivacy}>Los roles, permisos y pertenencia a dependencias son administrados por personal autorizado.</p>
        </Card>

        <Card className={styles.membershipCard}>
          <div className={styles.membershipHeader}><h2>Mis dependencias</h2><p>El permiso se aplica dentro de cada Sala o Juzgado.</p></div>
          {workspacesError ? <StatusMessage variant="error" title="Dependencias no disponibles" message={workspacesError} /> : null}
          {workspacesLoading ? <p role="status">Cargando tus dependencias…</p> : workspaces.length ? (
            <ul className={styles.membershipList}>
              {workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <span className={styles.dependencyBadge} aria-hidden="true">{dependencyBadge(workspace)}</span>
                  <div><strong>{workspace.name}</strong><span>{workspace.type === 'SALA' ? 'Sala' : workspace.type === 'JUZGADO' ? 'Juzgado' : 'Dependencia'} · {WORKSPACE_ROLE_LABEL[workspace.role]}</span></div>
                </li>
              ))}
            </ul>
          ) : !workspacesError ? <p className={styles.noMemberships}>No tenés una Sala o Juzgado asociado a esta cuenta.</p> : null}
        </Card>

        <Card className={styles.passwordCard}>
          <form className={styles.passwordForm} onSubmit={handleSubmit}>
            <div><h2>Seguridad</h2><p>Cambiá tu contraseña desde este formulario protegido.</p></div>
            {error ? (
              <StatusMessage variant="error" title="No se pudo cambiar" message={error} />
            ) : null}
            {success ? (
              <StatusMessage variant="success" title="Cambio aplicado" message={success} />
            ) : null}
            <Input
              label="Contraseña actual"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentContraseña(event.target.value)}
              required
            />
            <Input
              label="Nueva contraseña"
              type="password"
              value={newPassword}
              minLength={8}
              onChange={(event) => setNewContraseña(event.target.value)}
              required
            />
            <Input
              label="Repetir nueva contraseña"
              type="password"
              value={repeatPassword}
              minLength={8}
              onChange={(event) => setRepeatContraseña(event.target.value)}
              required
            />
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : 'Cambiar contraseña'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
