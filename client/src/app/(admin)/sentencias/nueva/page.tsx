'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import styles from '@/components/sentencias/sentencias.module.css';
import { api, ApiError } from '@/lib/api';

type UploadResult = { data: { sentenciaId: number; status: string; pageCount: number | null; textAvailable: boolean } };

export default function NuevaSentenciaPage() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploaded, setUploaded] = useState<UploadResult['data'] | null>(null);
  const [existingSentenceId, setExistingSentenceId] = useState<string | number | null>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setExistingSentenceId(null);
    try {
      const payload = new FormData();
      payload.append('file', file);
      const response = await api.post<UploadResult>('/archivos/upload/jurisprudencia', payload);
      setUploaded(response.data);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && cause.details && typeof cause.details === 'object' && 'existingSentenceId' in cause.details) {
        const candidate = cause.details.existingSentenceId;
        if (typeof candidate === 'string' || typeof candidate === 'number') setExistingSentenceId(candidate);
      }
      setError(cause instanceof ApiError && cause.status === 409
        ? 'Este archivo ya fue incorporado. Revisa el fallo existente antes de volver a cargarlo.'
        : 'No pudimos procesar este archivo. Comprueba que sea un PDF válido y vuelve a intentarlo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Nuevo fallo"
        description="Primero incorporá el PDF. Después completá los datos y guardalo como borrador."
        actions={<Link href="/sentencias"><Button variant="secondary">Volver a gestión</Button></Link>}
      />
      <Card>
        <h2 style={{ marginTop: 0, color: '#173b5e', fontSize: 18 }}>Archivo del fallo</h2>
        <div
          className={styles.fileDrop}
          role="button"
          tabIndex={0}
          aria-label="Elegir o arrastrar un archivo PDF"
          onClick={() => input.current?.click()}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') input.current?.click(); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); setFile(event.dataTransfer.files[0] ?? null); }}
          style={{ borderColor: dragging ? '#4677c8' : undefined, background: dragging ? '#eef6ff' : undefined }}
        >
          <strong>{file ? file.name : 'Arrastrá el PDF acá o elegí un archivo'}</strong>
          <p>PDF de hasta 100 MB. El fallo quedará como borrador para completar y revisar antes de publicarlo.</p>
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          {uploaded ? (
            <Button onClick={() => router.push(`/sentencias/${uploaded.sentenciaId}`)}>Completar datos del fallo</Button>
          ) : (
            <Button onClick={() => void submit()} disabled={!file || busy}>{busy ? 'Procesando documento…' : 'Subir PDF y continuar'}</Button>
          )}
          <Button variant="secondary" onClick={() => router.push('/consulta')}>Cancelar</Button>
        </div>
        {uploaded ? (
          <StatusMessage variant="success" title="PDF incorporado como borrador" message={uploaded.textAvailable ? `Documento válido${uploaded.pageCount ? ` de ${uploaded.pageCount} páginas` : ''}. Completa los datos y revísalo antes de publicar.` : 'El PDF es válido, pero todavía no tiene texto reconocible. Completa los datos y revísalo antes de publicar.'} />
        ) : null}
        {error ? <StatusMessage variant="error" title="No se pudo cargar el fallo" message={error} /> : null}
        {existingSentenceId ? <p><Link href={`/sentencias/${existingSentenceId}`}>Ver el fallo ya incorporado</Link></p> : null}
      </Card>
    </div>
  );
}
