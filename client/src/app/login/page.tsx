'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api';
import styles from '@/components/layout/layout.module.css';

const subscribeHydration = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function LoginPage() {
  const { login, isAuthenticated, isLoading, authNotice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mounted = useSyncExternalStore(
    subscribeHydration,
    getClientSnapshot,
    getServerSnapshot,
  );

  if (!mounted) {
    return (
      <main className={styles.authCenter}>
        <section className={styles.authCard} aria-busy="true">
          <LoadingSpinner label="Preparando acceso..." />
        </section>
      </main>
    );
  }

  if (isLoading || isAuthenticated) {
    return <LoadingSpinner label="Cargando..." />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login({ email, password });
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        setError(submitError.message);
      } else if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError('No se pudo iniciar sesión.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.authCenter}>
      <section className={styles.authCard}>
        <div className={styles.authCardHeader}>
          <h1>Ingresar</h1>
          <p>Ingresá a Galilei con las credenciales asignadas a tu perfil.</p>
        </div>

        <form className={styles.authForm} onSubmit={handleSubmit}>
          {authNotice ? (
            <StatusMessage variant="error" title="Sesión" message={authNotice} />
          ) : null}
          {error ? (
            <StatusMessage
              variant="error"
              title="Acceso denegado"
              message={error}
            />
          ) : null}
          <Input
            label="Correo electrónico"
            type="email"
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            label="Contraseña"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Ingresando...' : 'Ingresar'}
          </Button>
          <Link className={styles.authLink} href="/consulta">
            Ir a consulta pública
          </Link>
        </form>
      </section>
    </main>
  );
}
