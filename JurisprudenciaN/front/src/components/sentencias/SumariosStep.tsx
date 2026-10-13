'use client';

import { useMemo, useState } from 'react';
import styles from './wizard.module.css';
import baseStyles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { generateLocalId } from '@/lib/local-id';
import type { WizardSumarioItem } from './wizard-types';

type Props = {
  items: WizardSumarioItem[];
  onChange: (items: WizardSumarioItem[]) => void;
};

const emptyItem = (): WizardSumarioItem => ({
  localId: generateLocalId(),
  numeroSumario: '',
  tema: '',
  texto: '',
  publicado: false,
  activo: true,
});

export function SumariosStep({ items, onChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WizardSumarioItem>(emptyItem);

  const isEditing = useMemo(
    () => editingId !== null && editingId === draft.localId,
    [draft.localId, editingId],
  );

  const resetDraft = () => {
    setEditingId(null);
    setDraft(emptyItem());
  };

  const save = () => {
    if (!draft.texto.trim()) {
      return;
    }

    if (isEditing) {
      onChange(items.map((item) => (item.localId === draft.localId ? draft : item)));
    } else {
      onChange([...items, draft]);
    }

    resetDraft();
  };

  return (
    <div className={baseStyles.section}>
      <div className={baseStyles.formGrid}>
        <Input label="N° de sumario" value={draft.numeroSumario} onChange={(event) => setDraft((current) => ({ ...current, numeroSumario: event.target.value }))} />
        <Input label="Tema" value={draft.tema} onChange={(event) => setDraft((current) => ({ ...current, tema: event.target.value }))} />
      </div>
      <Textarea label="Texto" value={draft.texto} onChange={(event) => setDraft((current) => ({ ...current, texto: event.target.value }))} />
      <div className={baseStyles.checkboxGrid}>
        <Checkbox label="Publicado" checked={draft.publicado} onChange={(event) => setDraft((current) => ({ ...current, publicado: event.target.checked }))} />
        <Checkbox label="Activo" checked={draft.activo} onChange={(event) => setDraft((current) => ({ ...current, activo: event.target.checked }))} />
      </div>
      <div className={baseStyles.inlineActions}>
        <Button onClick={save}>{isEditing ? 'Actualizar sumario' : 'Agregar sumario'}</Button>
        {isEditing ? (
          <Button variant="secondary" onClick={resetDraft}>
            Cancelar edicion
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Sin sumarios preparados"
          description="Agrega uno o varios sumarios antes de finalizar."
        />
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <article key={item.localId} className={styles.listItem}>
              <strong>{item.numeroSumario || 'Sin número'} · {item.tema || 'Sin tema'}</strong>
              <p>{item.texto}</p>
              <div className={baseStyles.badgeRow}>
                <span className={baseStyles.badge}>{item.publicado ? 'Publicado' : 'Interno'}</span>
                <span className={baseStyles.badge}>{item.activo ? 'Activo' : 'Inactivo'}</span>
              </div>
              <div className={baseStyles.inlineActions}>
                <Button variant="secondary" onClick={() => {
                  setEditingId(item.localId);
                  setDraft(item);
                }}>
                  Editar
                </Button>
                <Button variant="secondary" onClick={() => {
                  const duplicate = { ...item, localId: generateLocalId() };
                  onChange([...items, duplicate]);
                }}>
                  Duplicar
                </Button>
                <Button variant="danger" onClick={() => onChange(items.filter((current) => current.localId !== item.localId))}>
                  Eliminar
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
