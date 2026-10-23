'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArchivosPanel } from '@/components/archivos/ArchivosPanel';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Table } from '@/components/ui/Table';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { PaginatedResponse } from '@/types/common';
import type { Sentencia } from '@/types/sentencia';

export default function ArchivosPage() {
  const { user } = useAuth();
  const [sentenciaId, setSentenciaId] = useState('');
  const [recent, setRecent] = useState<Sentencia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadRecent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.get<PaginatedResponse<Sentencia>>('/sentencias', {
          query: { page: 1, pageSize: 10, activo: true },
        });
        setRecent(response.data);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'No se pudieron cargar las sentencias recientes.',
        );
      } finally {
        setIsLoading(false);
      }
    };

    void loadRecent();
  }, []);

  const selectedSentenciaId = Number(sentenciaId);
  const isAdmin = user?.rol.nombre === 'ADMIN';

  return (
    <div className={styles.section}>
      <PageHeader
        title="Archivos PDF"
        description="Carga, descarga y administracion de archivos asociados a sentencias."
      />

      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}

      <Card>
        <div className={styles.section}>
          <strong>Seleccionar sentencia</strong>
          <div className={styles.inlineActions}>
            <Input
              label="ID de sentencia"
              type="number"
              min={1}
              value={sentenciaId}
              onChange={(event) => setSentenciaId(event.target.value)}
            />
          </div>
          <p>Ingresa un ID manualmente o elige una sentencia reciente para administrar sus PDFs.</p>
        </div>
      </Card>

      {isLoading ? (
        <LoadingSpinner label="Cargando sentencias recientes..." />
      ) : recent.length === 0 ? (
        <EmptyState
          title="No hay sentencias recientes"
          description="Cuando existan sentencias cargadas podras administrar sus archivos desde aqui."
        />
      ) : (
        <Card>
          <div className={styles.section}>
            <strong>Sentencias recientes</strong>
            <Table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Número</th>
                  <th>Sala</th>
                  <th>Fecha</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((sentencia) => (
                  <tr key={sentencia.id}>
                    <td>{sentencia.id}</td>
                    <td>{sentencia.numeroSentencia ?? '-'}</td>
                    <td>{sentencia.sala ?? '-'}</td>
                    <td>{formatDate(sentencia.fecha)}</td>
                    <td>
                      <div className={styles.inlineActions}>
                        <Button variant="secondary" onClick={() => setSentenciaId(String(sentencia.id))}>
                          Administrar PDFs
                        </Button>
                        <Link href={`/sentencias/${sentencia.id}`}>
                          <Button variant="secondary">Ver sentencia</Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}

      {Number.isFinite(selectedSentenciaId) && selectedSentenciaId > 0 ? (
        <Card>
          <div className={styles.section}>
            <strong>PDFs de la sentencia #{selectedSentenciaId}</strong>
            <ArchivosPanel sentenciaId={selectedSentenciaId} allowDelete={isAdmin} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
