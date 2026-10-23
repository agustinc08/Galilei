'use client';

import styles from './wizard.module.css';
import baseStyles from './sentencias.module.css';
import { Checkbox } from '@/components/ui/Checkbox';
import type { WizardPublicacionOptions } from './wizard-types';

type Props = {
  actor?: string;
  demandado?: string;
  opciones: WizardPublicacionOptions;
  actorPublicoPreview: string;
  demandadoPublicoPreview: string;
  onChange: <K extends keyof WizardPublicacionOptions>(
    key: K,
    value: WizardPublicacionOptions[K],
  ) => void;
};

export function PublicacionStep({
  actor,
  demandado,
  opciones,
  actorPublicoPreview,
  demandadoPublicoPreview,
  onChange,
}: Props) {
  return (
    <div className={baseStyles.section}>
      <div className={baseStyles.checkboxGrid}>
        <Checkbox label="Publicar sentencia" checked={opciones.publicarSentencia} onChange={(event) => onChange('publicarSentencia', event.target.checked)} />
        <Checkbox label="Publicar sumarios" checked={opciones.publicarSumarios} onChange={(event) => onChange('publicarSumarios', event.target.checked)} />
        <Checkbox label="Publicar reseña" checked={opciones.publicarResena} onChange={(event) => onChange('publicarResena', event.target.checked)} />
        <Checkbox label="Anonimizar actor y demandado" checked={opciones.anonimizar} onChange={(event) => onChange('anonimizar', event.target.checked)} />
        <Checkbox label="Generar enlace público" checked={opciones.generarSlugPublico} onChange={(event) => onChange('generarSlugPublico', event.target.checked)} />
        <Checkbox label="Marcar destacada" checked={opciones.destacada} onChange={(event) => onChange('destacada', event.target.checked)} />
      </div>

      <div className={styles.previewGrid}>
        <article className={styles.previewItem}>
          <span>Actor interno</span>
          <strong>{actor || '-'}</strong>
        </article>
        <article className={styles.previewItem}>
          <span>Actor público</span>
          <strong>{opciones.anonimizar ? actorPublicoPreview || '-' : actor || '-'}</strong>
        </article>
        <article className={styles.previewItem}>
          <span>Demandado interno</span>
          <strong>{demandado || '-'}</strong>
        </article>
        <article className={styles.previewItem}>
          <span>Demandado público</span>
          <strong>{opciones.anonimizar ? demandadoPublicoPreview || '-' : demandado || '-'}</strong>
        </article>
      </div>
    </div>
  );
}
