'use client';

import styles from './documento.module.css';

type Props = {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
};

export function DocumentoAccordion({
  title,
  children,
  defaultOpen = false,
}: Props) {
  return (
    <details className={styles.accordion} open={defaultOpen}>
      <summary className={styles.accordionSummary}>{title}</summary>
      <div className={styles.accordionBody}>{children}</div>
    </details>
  );
}
