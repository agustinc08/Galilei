'use client';

import { Link } from "@/lib/router-compat";
import { Button } from '@/components/ui/Button';
import styles from './documento.module.css';
import type { PdfViewerControls } from './PdfViewer';

type Props = {
  pdfControls: PdfViewerControls;
  fichaHref: string;
};

export function DocumentoDownloadSection({ pdfControls, fichaHref }: Props) {
  return (
    <div className={styles.actions}>
      <Button
        variant="secondary"
        onClick={pdfControls.openInNewTab}
        disabled={!pdfControls.hasPdf}
      >
        Abrir PDF
      </Button>
      <Button
        variant="secondary"
        onClick={pdfControls.download}
        disabled={!pdfControls.hasPdf}
      >
        Descargar PDF
      </Button>
      <Button
        variant="secondary"
        onClick={pdfControls.print}
        disabled={!pdfControls.hasPdf}
      >
        Imprimir PDF
      </Button>
      <Link href={fichaHref} target="_blank" rel="noreferrer">
        <Button variant="secondary">Ver ficha</Button>
      </Link>
      <Button
        variant="secondary"
        onClick={() => window.open(fichaHref, '_blank', 'noopener')}
      >
        Imprimir ficha
      </Button>
    </div>
  );
}
