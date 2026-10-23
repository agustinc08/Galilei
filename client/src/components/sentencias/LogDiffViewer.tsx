'use client';

type Props = {
  before?: unknown;
  after?: unknown;
};

export function LogDiffViewer({ before, after }: Props) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <strong>Datos antes</strong>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(before ?? null, null, 2)}
        </pre>
      </div>
      <div>
        <strong>Datos despues</strong>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(after ?? null, null, 2)}
        </pre>
      </div>
    </div>
  );
}
