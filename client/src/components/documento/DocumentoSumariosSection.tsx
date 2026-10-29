'use client';

import { CopyButton } from '@/components/ui/CopyButton';
import { Button } from '@/components/ui/Button';
import styles from './documento.module.css';
import { DocumentoHighlight } from './DocumentoHighlight';
import type { Sumario } from '@/types/sumario';
import { htmlToPlainText } from '@/lib/html-to-plain-text';

type Props = {
  sumarios: Sumario[];
  highlightQuery?: string;
  onGoToPage?: (page: number) => void;
};

export function DocumentoSumariosSection({
  sumarios,
  highlightQuery,
  onGoToPage,
}: Props) {
  if (sumarios.length === 0) {
    return <div className={styles.empty}>Sin sumarios publicados para este fallo.</div>;
  }

  return (
    <div className={styles.list}>
      {sumarios.map((sumario) => {
        const plainText = htmlToPlainText(sumario.texto);
        return <article key={sumario.id} className={styles.item}>
          <div className={styles.badgeRow}>
            <span className={styles.badge}>
              {sumario.numeroSumario ?? `Sumario ${sumario.id}`}
            </span>
            {sumario.tema ? (
              <span className={styles.badge}>
                <DocumentoHighlight text={sumario.tema} query={highlightQuery} />
              </span>
            ) : null}
          </div>
          <DocumentoHighlight
            text={plainText}
            query={highlightQuery}
            className={styles.context}
          />
          <div className={styles.actions}>
            <CopyButton value={plainText} label="Copiar" />
            <Button variant="secondary" disabled={!onGoToPage}>
              Ver contexto
            </Button>
          </div>
        </article>;
      })}
    </div>
  );
}
