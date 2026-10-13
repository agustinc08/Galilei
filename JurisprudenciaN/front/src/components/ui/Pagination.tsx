'use client';

import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import styles from './ui.module.css';

type PaginationProps = {
  page: number;
  pageCount: number;
  total: number;
  totalExact?: boolean;
  hasMore?: boolean;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
};

export function Pagination({
  page,
  pageCount,
  total,
  totalExact = true,
  hasMore = false,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  if (total === 0 && !hasMore) {
    return null;
  }

  const safePageCount = totalExact
    ? Math.max(1, pageCount)
    : Math.max(page, page + (hasMore ? 1 : 0));
  const safePage = Math.min(Math.max(1, page), safePageCount);

  const goToPage = (value: number) => {
    const nextPage = Math.min(Math.max(1, value), safePageCount);
    onPageChange(nextPage);
  };

  return (
    <div className={styles.pagination}>
      <span>
        {totalExact
          ? `${total} resultados, página ${safePage} de ${safePageCount}, ${pageSize} por página`
          : `Página ${safePage} · ${hasMore ? 'hay más resultados' : 'fin de resultados'} · ${pageSize} por página`}
      </span>
      <div className={styles.paginationControls}>
        {onPageSizeChange ? (
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
        ) : null}
        {totalExact ? (
          <Button variant="secondary" onClick={() => goToPage(1)} disabled={safePage <= 1}>
            Primera
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => goToPage(safePage - 1)}
          disabled={safePage <= 1}
        >
          Anterior
        </Button>
        {totalExact ? <Input
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
        /> : null}
        <Button
          variant="secondary"
          onClick={() => goToPage(safePage + 1)}
          disabled={totalExact ? safePage >= safePageCount : !hasMore}
        >
          Siguiente
        </Button>
        {totalExact ? <Button
          variant="secondary"
          onClick={() => goToPage(safePageCount)}
          disabled={safePage >= safePageCount}
        >
          Última
        </Button> : null}
      </div>
    </div>
  );
}
