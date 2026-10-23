'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import styles from './documento.module.css';

type Props = {
  title: string;
  subtitle?: string;
  backHref: string;
  backLabel?: string;
  viewportOffset?: number;
  sidePanel: React.ReactNode;
  viewer: React.ReactNode;
};

export function DocumentoViewerLayout({
  title,
  subtitle,
  backHref,
  backLabel = 'Volver',
  viewportOffset = 0,
  sidePanel,
  viewer,
}: Props) {
  const [panelOpen, setPanelOpen] = useState(true);

  return (
    <div
      className={styles.shell}
      style={{ '--document-viewer-offset': `${viewportOffset}px` } as React.CSSProperties}
    >
      <header className={styles.topbar}>
        <div className={styles.topbarTitle}>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className={styles.topbarActions}>
          <Link href={backHref}>
            <Button variant="secondary">{backLabel}</Button>
          </Link>
          <Button
            variant="secondary"
            onClick={() => setPanelOpen((current) => !current)}
          >
            {panelOpen ? 'Ocultar panel' : 'Mostrar panel'}
          </Button>
        </div>
      </header>

      <div className={panelOpen ? styles.body : `${styles.body} ${styles.bodyPanelClosed}`}>
        <aside className={panelOpen ? styles.sidePanel : styles.sidePanelHidden}>
          {sidePanel}
        </aside>
        <section className={styles.viewerArea}>{viewer}</section>
      </div>
    </div>
  );
}
