'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from '@/lib/router-compat';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { formatDateTime } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import type { Rol } from '@/types/auth';
import styles from './usuarios.module.css';

type WorkspaceRole = 'ADMIN' | 'EDITOR' | 'VIEWER';
type UserMembership = {
  role: WorkspaceRole;
  active: boolean;
  workspace: {
    id: string;
    active: boolean;
    dependency: { id: string; code: string; name: string; type: string; active: boolean };
  };
};
type AdminUser = {
  id: number;
  nombre: string;
  apellido: string | null;
  email: string;
  activo: boolean;
  rolId: number;
  createdAt: string;
  updatedAt: string;
  rol: Rol;
  workspaceMemberships: UserMembership[];
};
type UserAudit = {
  id: number;
  accion: string;
  descripcion: string | null;
  createdAt: string;
  usuario: { id: number; nombre: string; apellido: string | null; email: string };
};
type MyWorkspace = { id: string; role: WorkspaceRole };
type ApiList<T> = { data: T[] };

const PAGE_SIZE = 20;
const roleLabel: Record<string, string> = {
  ADMIN: 'Administrador',
  OPERADOR: 'Operador',
  LECTOR: 'Consulta',
  REVISOR: 'Revisor',
  JURISPRUDENCIA: 'Jurisprudencia',
  DIGESTO: 'Digesto',
};
const workspaceRoleLabel: Record<WorkspaceRole, string> = {
  ADMIN: 'Administrador del espacio',
  EDITOR: 'Editor',
  VIEWER: 'Consulta',
};

function displayName(user: Pick<AdminUser, 'nombre' | 'apellido'>) {
  return [user.nombre, user.apellido].filter(Boolean).join(' ');
}

function userMemberships(user: AdminUser) {
  return user.workspaceMemberships ?? [];
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [myWorkspaces, setMyWorkspaces] = useState<MyWorkspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [dependencyFilter, setDependencyFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [audit, setAudit] = useState<UserAudit[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState({ nombre: '', apellido: '', email: '', password: '', rolId: '' });
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const selectedUser = users.find((item) => item.id === selectedId) ?? null;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [usersResponse, rolesResponse, workspacesResponse] = await Promise.all([
        api.get<ApiList<AdminUser>>('/usuarios'),
        api.get<ApiList<Rol>>('/roles'),
        api.get<MyWorkspace[]>('/workspaces/mine'),
      ]);
      setUsers(usersResponse.data);
      setRoles(rolesResponse.data);
      setMyWorkspaces(workspacesResponse);
    } catch {
      setLoadError('No pudimos cargar la administración de usuarios. Verificá tu acceso y volvé a intentar.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void loadData(); });
    return () => window.cancelAnimationFrame(frame);
  }, [loadData]);

  const dependencies = useMemo(() => {
    const byId = new Map<string, { id: string; code: string; name: string }>();
    for (const item of users) {
      for (const membership of userMemberships(item)) {
        byId.set(membership.workspace.dependency.id, {
          id: membership.workspace.dependency.id,
          code: membership.workspace.dependency.code,
          name: membership.workspace.dependency.name,
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [users]);

  const filteredUsers = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('es');
    return users.filter((item) => {
      const memberships = userMemberships(item);
      const matchesTerm = !term || [
        displayName(item), item.email, String(item.id),
        ...memberships.map((membership) => `${membership.workspace.dependency.name} ${membership.workspace.dependency.code}`),
      ].some((value) => value.toLocaleLowerCase('es').includes(term));
      const matchesActive = activeFilter === 'ALL' || String(item.activo) === activeFilter;
      const matchesRole = roleFilter === 'ALL' || String(item.rolId) === roleFilter;
      const matchesDependency = dependencyFilter === 'ALL' || memberships.some(
        (membership) => membership.workspace.dependency.id === dependencyFilter,
      );
      return matchesTerm && matchesActive && matchesRole && matchesDependency;
    });
  }, [activeFilter, dependencyFilter, query, roleFilter, users]);

  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const visibleUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const loadAudit = useCallback(async (id: number) => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const response = await api.get<ApiList<UserAudit>>(`/usuarios/${id}/auditoria`);
      setAudit(response.data);
    } catch {
      setAuditError('No se pudo cargar la auditoría de esta cuenta.');
      setAudit([]);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const openDetail = (item: AdminUser) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(item.id);
    setSelectedRoleId(String(item.rolId));
    setNewPassword('');
    setAudit([]);
    void loadAudit(item.id);
  };

  const closeDetail = () => {
    setSelectedId(null);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDetail();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  useEffect(() => {
    if (selectedId === null) return;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[aria-label="Cerrar detalle"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId]);

  const refreshSelected = async (id: number) => {
    await loadData();
    await loadAudit(id);
    setSelectedId(id);
  };

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identity.rolId || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await api.post<{ data: AdminUser }>('/usuarios', {
        nombre: identity.nombre.trim(),
        apellido: identity.apellido.trim() || undefined,
        email: identity.email.trim(),
        password: identity.password,
        rolId: Number(identity.rolId),
        activo: true,
      });
      const created = response.data;
      setIdentity({ nombre: '', apellido: '', email: '', password: '', rolId: '' });
      setNotice('Usuario creado. La contraseña no se vuelve a mostrar.');
      await loadData();
      setSelectedId(created.id);
      setSelectedRoleId(String(created.rolId));
      await loadAudit(created.id);
    } catch {
      setNotice('No se pudo crear el usuario. Revisá el correo, el rol y los campos requeridos.');
    } finally {
      setBusy(false);
    }
  };

  const updateRole = async () => {
    if (!selectedUser || !selectedRoleId || Number(selectedRoleId) === selectedUser.rolId || busy) return;
    if (!window.confirm(`¿Cambiar el rol global de ${displayName(selectedUser)}?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.patch(`/usuarios/${selectedUser.id}`, { rolId: Number(selectedRoleId) });
      setNotice('Rol actualizado y registrado en auditoría.');
      await refreshSelected(selectedUser.id);
    } catch {
      setNotice('No se pudo actualizar el rol. El último administrador activo está protegido.');
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (item: AdminUser, active: boolean) => {
    if (busy || (item.id === currentUser?.id && !active)) return;
    const action = active ? 'reactivar' : 'desactivar';
    if (!window.confirm(`¿Querés ${action} la cuenta ${item.email}?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      if (active) await api.patch(`/usuarios/${item.id}`, { activo: true });
      else await api.delete(`/usuarios/${item.id}`);
      setNotice(`Cuenta ${active ? 'activada' : 'desactivada'} y acción registrada en auditoría.`);
      await refreshSelected(item.id);
    } catch {
      setNotice('No se pudo cambiar el estado. No podés desactivar tu propia cuenta ni el último administrador.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser || newPassword.length < 6 || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.post(`/usuarios/${selectedUser.id}/reset-password`, { newPassword });
      setNewPassword('');
      setNotice('Contraseña restablecida; no se muestra ni se conserva en el formulario.');
      await loadAudit(selectedUser.id);
    } catch {
      setNotice('No se pudo restablecer la contraseña.');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <LoadingSpinner label="Cargando usuarios…" />;
  if (loadError) return <StatusMessage variant="error" title="Administración no disponible" message={loadError} />;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Administración de usuarios"
        description="Consultá cuentas, roles globales y dependencias. Las acciones administrativas quedan auditadas."
      />
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      <Card>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Crear usuario</h2>
            <p>La contraseña inicial se ingresa de forma enmascarada y nunca se vuelve a mostrar.</p>
          </div>
        </div>
        <form className={styles.createForm} onSubmit={(event) => void createUser(event)}>
          <label>Nombre<input required minLength={2} maxLength={100} value={identity.nombre} onChange={(event) => setIdentity((value) => ({ ...value, nombre: event.target.value }))} /></label>
          <label>Apellido<input maxLength={100} value={identity.apellido} onChange={(event) => setIdentity((value) => ({ ...value, apellido: event.target.value }))} /></label>
          <label>Correo / identificador<input required type="email" maxLength={255} autoComplete="off" value={identity.email} onChange={(event) => setIdentity((value) => ({ ...value, email: event.target.value }))} /></label>
          <label>Contraseña inicial<input required type="password" minLength={6} maxLength={128} autoComplete="new-password" value={identity.password} onChange={(event) => setIdentity((value) => ({ ...value, password: event.target.value }))} /></label>
          <label>Rol global<select required value={identity.rolId} onChange={(event) => setIdentity((value) => ({ ...value, rolId: event.target.value }))}><option value="">Seleccionar rol</option>{roles.map((role) => <option key={role.id} value={role.id}>{roleLabel[role.nombre] ?? role.nombre}</option>)}</select></label>
          <Button type="submit" disabled={busy || !roles.length}>{busy ? 'Guardando…' : 'Crear cuenta'}</Button>
        </form>
        <p className={styles.helper}>El modelo actual no registra último acceso. La administración de membresías conserva las reglas propias de cada espacio.</p>
      </Card>

      <Card>
        <div className={styles.sectionHeader}>
          <div><h2>Cuentas</h2><p>{filteredUsers.length.toLocaleString('es-AR')} resultado(s)</p></div>
          <Button variant="secondary" onClick={() => void loadData()}>Actualizar</Button>
        </div>
        <div className={styles.filters}>
          <label>Buscar por nombre, correo, ID o dependencia<input aria-label="Buscar usuarios" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
          <label>Estado<select aria-label="Filtrar por estado" value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value); setPage(1); }}><option value="ALL">Todos</option><option value="true">Activos</option><option value="false">Inactivos</option></select></label>
          <label>Rol<select aria-label="Filtrar por rol" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }}><option value="ALL">Todos</option>{roles.map((role) => <option key={role.id} value={role.id}>{roleLabel[role.nombre] ?? role.nombre}</option>)}</select></label>
          <label>Dependencia<select aria-label="Filtrar por dependencia" value={dependencyFilter} onChange={(event) => { setDependencyFilter(event.target.value); setPage(1); }}><option value="ALL">Todas</option>{dependencies.map((dependency) => <option key={dependency.id} value={dependency.id}>{dependency.name}</option>)}</select></label>
        </div>
        {visibleUsers.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Nombre</th><th>Correo</th><th>Estado</th><th>Rol global</th><th>Dependencias</th><th>Acciones</th></tr></thead>
              <tbody>{visibleUsers.map((item) => <tr key={item.id}>
                <td data-label="Nombre">{displayName(item)} <span className={styles.userId}>ID {item.id}</span></td>
                <td data-label="Correo">{item.email}</td>
                <td data-label="Estado"><span className={item.activo ? styles.active : styles.inactive}>{item.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td data-label="Rol global">{roleLabel[item.rol.nombre] ?? item.rol.nombre}</td>
                <td data-label="Dependencias">{userMemberships(item).length ? userMemberships(item).map((membership) => <span className={styles.dependencyTag} key={membership.workspace.dependency.id}>{membership.workspace.dependency.name} · {workspaceRoleLabel[membership.role]}{!membership.active ? ' · inactiva' : ''}</span>) : 'Sin dependencias'}</td>
                <td data-label="Acciones"><div className={styles.rowActions}><Button variant="secondary" onClick={() => openDetail(item)}>Ver detalle</Button>{item.activo ? <Button variant="secondary" disabled={busy || item.id === currentUser?.id} onClick={() => void setActive(item, false)}>Desactivar</Button> : <Button variant="secondary" disabled={busy} onClick={() => void setActive(item, true)}>Activar</Button>}</div></td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No hay usuarios para estos filtros" description="Probá cambiar el texto o limpiar los filtros." />}
        {filteredUsers.length > PAGE_SIZE ? <nav className={styles.pagination} aria-label="Paginación de usuarios"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button><span>Página {page} de {pageCount}</span><Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Siguiente</Button></nav> : null}
      </Card>

      {selectedUser ? <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
        <dialog open ref={dialogRef} className={styles.dialog} aria-modal="true" aria-labelledby="user-detail-title" onKeyDown={handleDialogKeyDown}>
          <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>Cuenta ID {selectedUser.id}</p><h2 id="user-detail-title">{displayName(selectedUser)}</h2></div><button type="button" aria-label="Cerrar detalle" onClick={closeDetail}>×</button></div>
          <dl className={styles.identityGrid}><div><dt>Correo / identificador</dt><dd>{selectedUser.email}</dd></div><div><dt>Estado</dt><dd>{selectedUser.activo ? 'Activo' : 'Inactivo'}</dd></div><div><dt>Rol global</dt><dd>{roleLabel[selectedUser.rol.nombre] ?? selectedUser.rol.nombre}</dd></div><div><dt>Creado</dt><dd>{formatDateTime(selectedUser.createdAt)}</dd></div><div><dt>Último acceso</dt><dd>No disponible: el modelo actual no lo registra.</dd></div></dl>
          <section className={styles.detailSection}><h3>Rol global</h3><div className={styles.inlineForm}><label htmlFor="user-global-role">Cambiar rol</label><select id="user-global-role" value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}>{roles.map((role) => <option key={role.id} value={role.id}>{roleLabel[role.nombre] ?? role.nombre}</option>)}</select><Button disabled={busy || Number(selectedRoleId) === selectedUser.rolId} onClick={() => void updateRole()}>Guardar rol</Button></div></section>
          <section className={styles.detailSection}><h3>Dependencias y permisos</h3>{userMemberships(selectedUser).length ? <ul className={styles.memberships}>{userMemberships(selectedUser).map((membership) => {
            const actorWorkspace = myWorkspaces.find((item) => item.id === membership.workspace.id);
            const canManage = actorWorkspace?.role === 'ADMIN';
            return <li key={membership.workspace.dependency.id}><div><strong>{membership.workspace.dependency.name}</strong><span>{membership.workspace.dependency.code} · {membership.workspace.dependency.type}</span><span>{workspaceRoleLabel[membership.role]} · {membership.active && membership.workspace.active && membership.workspace.dependency.active ? 'Activa' : 'Inactiva'}</span></div>{canManage ? <Link href={`/spaces/manage?workspaceId=${encodeURIComponent(membership.workspace.id)}`}>Administrar membresía</Link> : null}</li>;
          })}</ul> : <p>Esta cuenta no tiene dependencias asignadas.</p>}</section>
          <section className={styles.detailSection}><h3>Restablecer contraseña</h3><form className={styles.inlineForm} onSubmit={(event) => void resetPassword(event)}><label htmlFor="user-new-password">Nueva contraseña (enmascarada)</label><input id="user-new-password" type="password" autoComplete="new-password" minLength={6} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><Button type="submit" disabled={busy || newPassword.length < 6}>Restablecer</Button></form></section>
          <section className={styles.detailSection}><h3>Auditoría reciente</h3>{auditLoading ? <p role="status">Cargando auditoría…</p> : auditError ? <p role="alert">{auditError}</p> : audit.length ? <ul className={styles.auditList}>{audit.map((entry) => <li key={entry.id}><strong>{entry.accion}</strong><span>{entry.descripcion ?? 'Sin detalle'}</span><time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)} · {displayName(entry.usuario)}</time></li>)}</ul> : <p>No hay acciones administrativas registradas para esta cuenta.</p>}</section>
          <footer className={styles.dialogActions}><Button variant="secondary" onClick={closeDetail}>Cerrar</Button>{selectedUser.activo ? <Button variant="secondary" disabled={busy || selectedUser.id === currentUser?.id} onClick={() => void setActive(selectedUser, false)}>Desactivar cuenta</Button> : <Button disabled={busy} onClick={() => void setActive(selectedUser, true)}>Activar cuenta</Button>}</footer>
        </dialog>
      </div> : null}
    </div>
  );
}
