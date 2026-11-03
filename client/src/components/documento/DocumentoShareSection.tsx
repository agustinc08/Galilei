'use client';

import { CopyButton } from '@/components/ui/CopyButton';
import { ShareLinkButton } from '@/components/ui/ShareLinkButton';
import styles from './documento.module.css';
import type { CitaSentencia } from '@/types/sentencia';

type Props = {
  sentenciaId: number;
  currentUrl: string;
  publicUrl?: string | null;
  cita?: CitaSentencia | null;
  publicOnly?: boolean;
};

export function DocumentoShareSection({
  sentenciaId,
  currentUrl,
  publicUrl,
  cita,
  publicOnly = false,
}: Props) {
  return (
    <div className={styles.actions}>
      <ShareLinkButton
        url={currentUrl}
        sentenciaId={sentenciaId}
        label="Copiar enlace actual"
        publicOnly={publicOnly}
      />
      {publicUrl ? (
        <ShareLinkButton
          url={publicUrl}
          sentenciaId={sentenciaId}
          label="Copiar enlace público"
          publicOnly={publicOnly}
        />
      ) : null}
      {cita?.citaCopiable ? (
        <CopyButton value={cita.citaCopiable} label="Copiar cita" />
      ) : null}
    </div>
  );
}
