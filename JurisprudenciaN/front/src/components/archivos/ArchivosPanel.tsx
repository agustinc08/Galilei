'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Table } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { downloadBlob, formatBytes, formatDateTime } from '@/lib/utils';
import type { ArchivoPdf } from '@/types/archivo';

type Props = {
  sentenciaId: number;
  allowDelete?: boolean;
};

export function ArchivosPanel({ sentenciaId, allowDelete = true }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<ArchivoPdf[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadInitialFiles = async () => {
      if (active) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const response = await api.get<{ data: ArchivoPdf[] }>(`/archivos/sentencia/${sentenciaId}`);
        if (active) {
          setFiles(response.data);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los archivos.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadInitialFiles();

    return () => {
      active = false;
    };
  }, [sentenciaId]);

  const loadFiles = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<{ data: ArchivoPdf[] }>(`/archivos/sentencia/${sentenciaId}`);
      setFiles(response.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los archivos.');
    } finally {
      setIsLoading(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (file.type !== 'application/pdf') {
      setError('Solo se permiten archivos PDF.');
      return;
    }

    setError(null);
    setMessage(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post(`/archivos/upload/sentencia/${sentenciaId}`, formData);
      setMessage('PDF cargado correctamente.');
      await loadFiles();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'No se pudo subir el PDF.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/archivos/${id}`);
      setMessage('PDF eliminado correctamente.');
      await loadFiles();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No se pudo eliminar el PDF.');
    }
  };

  const handleDownload = async (archivo: ArchivoPdf) => {
    try {
      const blob = await api.download(`/archivos/${archivo.id}/download`);
      downloadBlob(blob, archivo.nombreOriginal ?? archivo.nombreArchivo);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'No se pudo descargar el PDF.');
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.inlineActions}>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void uploadFile(file);
            }
            event.target.value = '';
          }}
        />
        <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          {isUploading ? 'Subiendo PDF...' : 'Subir PDF'}
        </Button>
        <Button variant="secondary" onClick={() => void loadFiles()}>
          Recargar
        </Button>
      </div>

      {message ? <StatusMessage variant="success" title="Operacion exitosa" message={message} /> : null}
      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}

      {isLoading ? (
        <LoadingSpinner label="Cargando archivos..." />
      ) : files.length === 0 ? (
        <EmptyState title="No hay PDFs asociados" description="Sube un archivo PDF para esta sentencia." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Archivo</th>
              <th>Tamaño</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {files.map((archivo) => (
              <tr key={archivo.id}>
                <td>{archivo.id}</td>
                <td>{archivo.nombreOriginal ?? archivo.nombreArchivo}</td>
                <td>{formatBytes(archivo.tamanioBytes)}</td>
                <td>{formatDateTime(archivo.createdAt)}</td>
                <td>
                  <div className={styles.inlineActions}>
                    <Button variant="secondary" onClick={() => void handleDownload(archivo)}>
                      Descargar
                    </Button>
                    {allowDelete ? (
                      <Button variant="danger" onClick={() => void handleDelete(archivo.id)}>
                        Eliminar
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
