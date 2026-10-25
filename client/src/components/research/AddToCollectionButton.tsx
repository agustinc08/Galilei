'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { ApiResponse } from '@/types/common';
import styles from './research-collections.module.css';

type CollectionSummary = {
  id: number;
  nombre: string;
  itemCount: number;
};

type Props = {
  sentenciaId: number;
  disabled?: boolean;
};

export function AddToCollectionButton({ sentenciaId, disabled = false }: Props) {
  const { user } = useAuth();
  const canUseCollections = [
    'ADMIN',
    'OPERADOR',
    'LECTOR',
    'REVISOR',
    'JURISPRUDENCIA',
    'DIGESTO',
  ].includes(user?.rol.nombre ?? '');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const openPicker = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await api.get<ApiResponse<CollectionSummary[]>>('/research/collections');
      setCollections(response.data);
      setSelectedId(response.data[0]?.id ?? null);
    } catch {
      setError('No pudimos cargar tus colecciones. Volvé a intentarlo.');
    } finally {
      setLoading(false);
    }
  };

  const addToCollection = async (collectionId: number) => {
    setSaving(true);
    setError(null);
    try {
      const response = await api.post<{ added: boolean }>(
        `/research/collections/${collectionId}/items/${sentenciaId}`,
      );
      setMessage(response.added ? 'Fallo agregado a la colección.' : 'El fallo ya estaba en esa colección.');
      setOpen(false);
    } catch {
      setError('No se pudo agregar el fallo. Verificá que la colección y el fallo sigan disponibles.');
    } finally {
      setSaving(false);
    }
  };

  const createAndAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nombre = newName.trim();
    if (!nombre) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<ApiResponse<CollectionSummary>>('/research/collections', { nombre });
      await api.post(`/research/collections/${created.data.id}/items/${sentenciaId}`);
      setMessage('Colección creada y fallo agregado.');
      setOpen(false);
    } catch {
      setError('No se pudo crear la colección o agregar el fallo. Revisá si ya existe una colección con ese nombre.');
    } finally {
      setSaving(false);
    }
  };

  if (!canUseCollections) return null;

  return (
    <>
      <Button variant="ghost" disabled={disabled} onClick={() => void openPicker()}>
        Agregar a colección
      </Button>
      {message ? <span className={styles.inlineStatus} role="status">{message}</span> : null}
      <dialog
        ref={dialogRef}
        className={styles.collectionDialog}
        aria-labelledby="add-to-collection-title"
        onClose={() => setOpen(false)}
      >
        <div className={styles.dialogHeader}>
          <div>
            <h2 id="add-to-collection-title">Agregar a una colección</h2>
            <p>La colección y sus notas son privadas de tu cuenta.</p>
          </div>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} aria-label="Cerrar">
            Cerrar
          </Button>
        </div>
        {loading ? <p role="status">Cargando tus colecciones…</p> : null}
        {!loading && collections.length ? (
          <div className={styles.dialogBody}>
            <label>
              Colección
              <select
                value={selectedId ?? ''}
                onChange={(event) => setSelectedId(Number(event.target.value) || null)}
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>{collection.nombre}</option>
                ))}
              </select>
            </label>
            <Button type="button" disabled={saving || selectedId === null} onClick={() => selectedId && void addToCollection(selectedId)}>
              {saving ? 'Agregando…' : 'Agregar fallo'}
            </Button>
          </div>
        ) : null}
        {!loading ? (
          <details className={styles.createCollectionInline}>
            <summary>{collections.length ? 'Crear otra colección' : 'Crear tu primera colección'}</summary>
            <form onSubmit={(event) => void createAndAdd(event)}>
              <label htmlFor={`new-collection-${sentenciaId}`}>Nombre</label>
              <input
                id={`new-collection-${sentenciaId}`}
                value={newName}
                maxLength={100}
                onChange={(event) => setNewName(event.target.value)}
                required
              />
              <Button type="submit" disabled={saving || !newName.trim()}>
                {saving ? 'Creando…' : 'Crear y agregar fallo'}
              </Button>
            </form>
          </details>
        ) : null}
        {error ? <p className={styles.errorStatus} role="alert">{error}</p> : null}
      </dialog>
    </>
  );
}
