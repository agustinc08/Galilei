'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';

type Workspace = { id: string; code: string; name: string; type: string; role: 'ADMIN' | 'EDITOR' | 'VIEWER' };
type Folder = { id: string; parentId: string | null; name: string; _count: { documents: number; children: number } };
type WorkspaceDocument = { documentId: string; folder: { id: string; name: string } | null; uploadedBy: { nombre: string; apellido: string | null }; document: { title: string; status: string; file: { filename: string; sizeBytes: number } | null; extraction: { status: string; pageCount: number } | null } };
type WorkspaceMember = { userId: number; role: 'ADMIN' | 'EDITOR' | 'VIEWER'; active: boolean; user: { nombre: string; apellido: string | null; email: string } };
type SearchPage = { total: number; totalExact: boolean; partial: boolean; results: Array<{ id: string; sourceId: string; title: string | null; snippet: string | null; metadata: Record<string, string | number | boolean | null> }> };

export default function PrivateSpacesPage() {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [folderId, setFolderId] = useState('');
  const [moveToFolderId, setMoveToFolderId] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchPage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [depCode, setDepCode] = useState('');
  const [depName, setDepName] = useState('');
  const [depType, setDepType] = useState('JUZGADO');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState<'ADMIN' | 'EDITOR' | 'VIEWER'>('VIEWER');
  const [uploadSummary, setUploadSummary] = useState('');
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const canEdit = workspaces.find((workspace) => workspace.id === workspaceId)?.role !== 'VIEWER';
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  const visibleFolders = useMemo(() => folders.filter((folder) => !folder.parentId || folders.some((parent) => parent.id === folder.parentId)), [folders]);

  async function refresh(nextId = workspaceId) {
    if (!nextId) return;
    const [nextFolders, nextDocuments] = await Promise.all([
      api.get<Folder[]>(`/workspaces/${nextId}/folders`),
      api.get<WorkspaceDocument[]>(`/workspaces/${nextId}/documents`, { query: { folderId: folderId || undefined } }),
    ]);
    setFolders(nextFolders); setDocuments(nextDocuments);
    const current = workspaces.find((workspace) => workspace.id === nextId);
    if (current?.role === 'ADMIN') setMembers(await api.get<WorkspaceMember[]>(`/workspaces/${nextId}/members`));
    else setMembers([]);
  }

  useEffect(() => {
    void api.get<Workspace[]>('/workspaces/mine').then((items) => { setWorkspaces(items); setWorkspaceId(items[0]?.id ?? ''); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los espacios.'));
  }, []);
  useEffect(() => { if (workspaceId) void refresh(workspaceId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudo cargar el espacio.')); }, [workspaceId, folderId]);

  async function createWorkspace() {
    setBusy(true); setError('');
    try { const created = await api.post<Workspace>('/workspaces', { code: depCode, name: depName, type: depType }); setWorkspaces((items) => [...items, created]); setWorkspaceId(created.id); setDepCode(''); setDepName(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el espacio.'); }
    finally { setBusy(false); }
  }
  async function upload(files?: FileList | null) {
    if (!files?.length || !workspaceId) return;
    const form = new FormData(); Array.from(files).forEach((file) => form.append('files', file));
    setBusy(true); setError('');
    try { const response = await api.post<{ results: Array<{ status: string; duplicate: boolean }> }>(`/workspaces/${workspaceId}/documents/upload${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`, form); setUploadSummary(`${response.results.length} PDF procesado(s): ${response.results.filter((item) => item.status === 'INDEXED').length} indexado(s), ${response.results.filter((item) => item.status === 'OCR_REQUIRED').length} con OCR pendiente, ${response.results.filter((item) => item.duplicate).length} duplicado(s) idempotente(s).`); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los PDFs.'); }
    finally { setBusy(false); }
  }
  async function addFolder() {
    if (!newFolder.trim() || !workspaceId) return;
    setBusy(true); setError('');
    try { await api.post(`/workspaces/${workspaceId}/folders`, { name: newFolder, parentId: folderId || null }); setNewFolder(''); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la carpeta.'); }
    finally { setBusy(false); }
  }
  async function search() {
    if (!query.trim() || !workspaceId) return;
    setBusy(true); setError('');
    try { setResults(await api.get<SearchPage>(`/workspaces/${workspaceId}/search`, { query: { q: query, page: 1, pageSize: 50 } })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la búsqueda.'); }
    finally { setBusy(false); }
  }
  async function saveMember(userId: number, role: 'ADMIN' | 'EDITOR' | 'VIEWER', active = true) {
    if (!workspaceId) return;
    setBusy(true); setError('');
    try { await api.post(`/workspaces/${workspaceId}/members`, { userId, role, active }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la membresía.'); }
    finally { setBusy(false); }
  }
  async function moveDocument(documentId: string) {
    setBusy(true); setError('');
    try { await api.patch(`/workspaces/${workspaceId}/documents/${documentId}/folder`, { folderId: moveToFolderId || null }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo mover el documento.'); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeader title="Mi espacio" description="Documentos privados de tus dependencias. Cada espacio requiere una membresía explícita." />
    {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}{uploadSummary && <p role="status">{uploadSummary}</p>}
    {workspaces.length > 0 ? <Card>
      <label>Espacio documental <select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setFolderId(''); setResults(null); }}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.type}</option>)}</select></label>
      {user?.rol.nombre === 'ADMIN' && <button onClick={() => setShowCreateWorkspace((value) => !value)}>{showCreateWorkspace ? 'Cancelar creación' : 'Crear otro espacio'}</button>}
      {showCreateWorkspace && user?.rol.nombre === 'ADMIN' && <div><input aria-label="Código de dependencia nueva" value={depCode} onChange={(event) => setDepCode(event.target.value)} placeholder="JUZGADO-CIVIL-23" /><input aria-label="Nombre de dependencia nueva" value={depName} onChange={(event) => setDepName(event.target.value)} placeholder="Juzgado Civil 23" /><label>Tipo <select value={depType} onChange={(event) => setDepType(event.target.value)}><option value="JUZGADO">Juzgado</option><option value="SALA">Sala</option><option value="SECRETARIA">Secretaría</option><option value="DEPENDENCIA">Dependencia</option></select></label><button disabled={busy} onClick={() => { void createWorkspace().then(() => setShowCreateWorkspace(false)); }}>Crear espacio</button></div>}
      <p>Rol: {selectedWorkspace?.role}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Carpeta <select value={folderId} onChange={(event) => setFolderId(event.target.value)}><option value="">Raíz</option>{visibleFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
        {canEdit && <label>Mover documentos a <select value={moveToFolderId} onChange={(event) => setMoveToFolderId(event.target.value)}><option value="">Raíz</option>{visibleFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
        {canEdit && <><input aria-label="Nombre de carpeta" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="Nueva carpeta" /><button disabled={busy} onClick={() => void addFolder()}>Crear subcarpeta</button><label>Subir PDFs<input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => { void upload(event.target.files); event.currentTarget.value = ''; }} /></label></>}
      </div>
    </Card> : user?.rol.nombre === 'ADMIN' ? <Card><h2>Crear espacio por dependencia</h2><p>El administrador que lo crea queda como ADMIN del workspace. La administración global no concede acceso a espacios ajenos.</p><input aria-label="Código de dependencia" value={depCode} onChange={(event) => setDepCode(event.target.value)} placeholder="JUZGADO-CIVIL-64" /><input aria-label="Nombre de dependencia" value={depName} onChange={(event) => setDepName(event.target.value)} placeholder="Juzgado Civil 64" /><label>Tipo <select value={depType} onChange={(event) => setDepType(event.target.value)}><option value="JUZGADO">Juzgado</option><option value="SALA">Sala</option><option value="SECRETARIA">Secretaría</option><option value="DEPENDENCIA">Dependencia</option></select></label><button disabled={busy} onClick={() => void createWorkspace()}>Crear espacio</button></Card> : <Card><p>No tenés espacios documentales asignados. Pedí al administrador que te incorpore a una dependencia.</p></Card>}
    {workspaceId && <Card><h2>Buscar en este espacio</h2><form onSubmit={(event) => { event.preventDefault(); void search(); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Términos o frase" aria-label="Buscar documentos privados" /><button disabled={busy}>Buscar</button></form>
      {results && <section><p>{results.total}{results.totalExact ? ' resultados autorizados' : ' resultados autorizados en la ventana analizada (total parcial)'}{results.partial ? ' · una fuente no respondió' : ''}</p>{results.results.map((result) => <article key={result.id} style={{ padding: 12, borderTop: '1px solid #ddd' }}><h3><Link href={`/spaces/${workspaceId}/documents/${result.sourceId}?q=${encodeURIComponent(query)}&page=${Number(result.metadata.pageNumber || 1)}`}>{result.title || 'Documento'}</Link></h3><p>{result.snippet}</p></article>)}</section>}
    </Card>}
    {workspaceId && <Card><h2>{folderId ? 'Documentos de la carpeta' : 'Documentos recientes'}</h2>{documents.length ? documents.map((item) => <article key={item.documentId} style={{ padding: 12, borderTop: '1px solid #ddd' }}><h3><Link href={`/spaces/${workspaceId}/documents/${item.documentId}`}>{item.document.title}</Link></h3><p>{item.document.status === 'OCR_REQUIRED' ? 'Disponible para ver; OCR pendiente y excluido de búsqueda.' : `Indexado · ${item.document.extraction?.pageCount ?? 0} páginas`}</p><small>{item.document.file?.filename} · {Math.ceil((item.document.file?.sizeBytes ?? 0) / 1024)} KB · Subido por {item.uploadedBy.nombre} {item.uploadedBy.apellido ?? ''}</small>{canEdit && <button disabled={busy} onClick={() => void moveDocument(item.documentId)}>Mover a destino seleccionado</button>}</article>) : <p>Este espacio todavía no tiene documentos.</p>}</Card>}
    {selectedWorkspace?.role === 'ADMIN' && <Card><h2>Miembros del espacio</h2><form onSubmit={(event) => { event.preventDefault(); const userId = Number(memberUserId); if (Number.isInteger(userId) && userId > 0) { void saveMember(userId, memberRole); setMemberUserId(''); } }}><input aria-label="ID de usuario" inputMode="numeric" value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} placeholder="ID de usuario activo" /><select aria-label="Rol del miembro" value={memberRole} onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}><option value="ADMIN">ADMIN</option><option value="EDITOR">EDITOR</option><option value="VIEWER">VIEWER</option></select><button disabled={busy}>Agregar o actualizar</button></form>{members.map((member) => <p key={member.userId}>{member.user.nombre} {member.user.apellido ?? ''} · {member.user.email} · {member.role} · {member.active ? 'Activo' : 'Inactivo'} <button disabled={busy || member.userId === user?.id} onClick={() => void saveMember(member.userId, member.role, false)}>Desactivar</button></p>)}</Card>}
  </>;
}
