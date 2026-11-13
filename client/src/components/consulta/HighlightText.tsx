'use client';

import styles from './consulta.module.css';
import { SafeSearchHighlight } from './SafeSearchHighlight';

type Props = {
  html: string;
};

export function HighlightText({ html }: Props) {
  return (
    <span className={styles.highlightText}>
      <SafeSearchHighlight markup={html} />
    </span>
  );
}
