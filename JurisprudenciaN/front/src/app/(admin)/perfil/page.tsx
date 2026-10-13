'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useAuth } from '@/hooks/use-auth';
import { formatDate } from '@/lib/utils';

export default function PerfilPage() {
  const { user, isLoading, refreshUser, changeContraseña, logout } = useAuth();
  const [currentPassword, setCurrentContraseña] = useState('');
  const [newPassword, setNewContraseña] = useState('');
  const [repeatPassword, setRepeatContraseña] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void refreshUser();
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
      setSuccess('Contrasena actualizada correctamente.');
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
        title="Perfil"
        description="Datos de la cuenta y seguridad."
        actions={
          <>
            <Link href="/dashboard">
              <Button variant="secondary">Volver al dashboard</Button>
            </Link>
            <Button variant="secondary" onClick={logout}>
              Cerrar sesión
            </Button>
          </>
        }
      />

      <div className={styles.columns}>
        <Card>
          <div className={styles.section}>
            <strong>Mi cuenta</strong>
            <div className={styles.listGrid}>
              <div className={styles.listItem}><strong>Nombre</strong><span>{user.nombre}</span></div>
              <div className={styles.listItem}><strong>Apellido</strong><span>{user.apellido || '-'}</span></div>
              <div className={styles.listItem}><strong>Correo electrónico</strong><span>{user.email}</span></div>
              <div className={styles.listItem}><strong>Rol</strong><span>{user.rol.nombre}</span></div>
              <div className={styles.listItem}><strong>Estado</strong><span>{user.activo ? 'Activo' : 'Inactivo'}</span></div>
              <div className={styles.listItem}><strong>Fecha de creacion</strong><span>{formatDate(user.createdAt)}</span></div>
              <div className={styles.listItem}><strong>Ultimo acceso</strong><span>{user.ultimoAcceso ? formatDate(user.ultimoAcceso) : '-'}</span></div>
            </div>
          </div>
        </Card>

        <Card>
          <form className={styles.section} onSubmit={handleSubmit}>
            <strong>Cambiar contraseña</strong>
            {error ? (
              <StatusMessage variant="error" title="No se pudo cambiar" message={error} />
            ) : null}
            {success ? (
              <StatusMessage variant="success" title="Cambio aplicado" message={success} />
            ) : null}
            <Input
              label="Contrasena actual"
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
              {saving ? 'Guardando...' : 'Cambiar contraseña'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
