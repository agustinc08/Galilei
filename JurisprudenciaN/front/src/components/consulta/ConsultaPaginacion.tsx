'use client';

import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

type Props = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function ConsultaPaginacion({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: Props) {
  if (total === 0) {
    return null;
  }

  const safePageCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(1, page), safePageCount);
  const goToPage = (value: number) => {
    onPageChange(Math.min(Math.max(1, value), safePageCount));
  };

  return (
    <div className={styles.paginator}>
      <span>
        {total} resultados | página {safePage} de {safePageCount} | {pageSize} por página
      </span>
      <div className={styles.pageButtons}>
        <Select
          label="Mostrar"
          value={String(pageSize)}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          options={[
            { label: '10', value: '10' },
            { label: '25', value: '25' },
            { label: '50', value: '50' },
            { label: '100', value: '100' },
          ]}
        />
        <Button variant="secondary" onClick={() => goToPage(1)} disabled={safePage <= 1}>
          Primera
        </Button>
        <Button variant="secondary" onClick={() => goToPage(safePage - 1)} disabled={safePage <= 1}>
          Anterior
        </Button>
        <Input
          label="Página"
          type="number"
          min={1}
          max={safePageCount}
          value={String(safePage)}
          onChange={(event) => {
            const nextPage = Number(event.target.value);
            if (Number.isInteger(nextPage)) {
              goToPage(nextPage);
            }
          }}
        />
        <Button
          variant="secondary"
          onClick={() => goToPage(safePage + 1)}
          disabled={safePage >= safePageCount}
        >
          Siguiente
        </Button>
        <Button
          variant="secondary"
          onClick={() => goToPage(safePageCount)}
          disabled={safePage >= safePageCount}
        >
          Última
        </Button>
      </div>
    </div>
  );
}
