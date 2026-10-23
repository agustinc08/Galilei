'use client';

import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';

type Props = {
  selectedCount: number;
  onPrint: () => void;
  onClear: () => void;
};

export function SelectedResultsBar({ selectedCount, onPrint, onClear }: Props) {
  if (selectedCount === 0) return null;

  return (
    <div className={styles.selectedBar}>
      <strong>{selectedCount} {selectedCount === 1 ? 'fallo seleccionado' : 'fallos seleccionados'} para imprimir</strong>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={onPrint}>
          Imprimir
        </Button>
        <Button variant="ghost" onClick={onClear} disabled={selectedCount === 0}>
          Quitar selección
        </Button>
      </div>
    </div>
  );
}
