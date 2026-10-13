'use client';

import styles from './consulta.module.css';

type Props = {
  html: string;
};

export function HighlightText({ html }: Props) {
  return (
    <span
      className={styles.highlightText}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
