export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function formatDate(value?: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
  }).format(date);
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function formatBytes(value?: number | null) {
  if (!value && value !== 0) {
    return '-';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function toDateInput(value?: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
}

export function formatDateInput(value?: string | null) {
  const match = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function maskDateInput(value: string) {
  const digits = value.replace(/\D/gu, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseDateInput(value: string) {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/u);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: 'Crear',
  UPDATE: 'Actualizar',
  DELETE: 'Eliminar',
  PUBLICAR: 'Publicar',
  DESPUBLICAR: 'Retirar de publicación',
  ANONIMIZAR: 'Anonimizar',
  DESANONIMIZAR: 'Quitar anonimización',
  CONFIRMAR: 'Confirmar',
  UPLOAD: 'Subir archivo',
  DETECTAR: 'Detectar referencias',
  PERSONAL_DOCUMENT_DELETE: 'Eliminar documento personal',
  PERSONAL_UPLOAD: 'Subir documento personal',
  PERSONAL_FOLDER_UPLOAD: 'Subir carpeta a Mis documentos',
  WORKSPACE_DOCUMENT_UPLOAD: 'Subir documento al espacio',
  WORKSPACE_DOCUMENT_DELETE: 'Eliminar documento del espacio',
  WORKSPACE_DOCUMENT_MOVE: 'Mover documento entre espacios',
  DOCUMENT_LINK_APPROVE: 'Aprobar vínculo documental',
  DOCUMENT_LINK_REJECT: 'Rechazar vínculo documental',
};

export function formatAuditAction(value: string): string {
  const knownLabel = AUDIT_ACTION_LABELS[value];
  if (knownLabel) return knownLabel;

  const words = value.replace(/[_-]+/gu, ' ').toLocaleLowerCase('es-AR').trim();
  return words ? words[0].toLocaleUpperCase('es-AR') + words.slice(1) : 'Acción sin descripción';
}

const AUDIT_ENTITY_LABELS: Record<string, string> = {
  SENTENCIA: 'Fallo',
  SUMARIO: 'Sumario',
  RESEÑA: 'Reseña',
  CITA: 'Cita',
  REFERENCIA: 'Referencia',
  PDF: 'PDF',
  PersonalDocument: 'Documento personal',
  WorkspaceDocument: 'Documento compartido',
  OcrJob: 'Trabajo de OCR',
  Document: 'Documento',
  DocumentLink: 'Vínculo documental',
};

export function formatAuditEntity(value: string): string {
  const knownLabel = AUDIT_ENTITY_LABELS[value];
  if (knownLabel) return knownLabel;

  const words = value.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/[_-]+/gu, ' ').toLocaleLowerCase('es-AR').trim();
  return words ? words[0].toLocaleUpperCase('es-AR') + words.slice(1) : 'Entidad sin descripción';
}

export async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Continue with the browser's legacy clipboard path when permission is denied.
    }
  }

  if (typeof document === 'undefined' || !document.body) return false;

  let input: HTMLTextAreaElement | null = null;
  try {
    input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);
    input.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    input?.remove();
  }
}

export function buildQueryString(query: Record<string, unknown>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }

  return params.toString();
}
