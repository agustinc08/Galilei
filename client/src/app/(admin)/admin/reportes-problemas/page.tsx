"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import type {
  ReporteProblema,
  ReporteProblemaPriority,
  ReporteProblemaStatus,
} from "@/types/reportes-problemas";
import styles from "./reportes-problemas.module.css";

const statuses: { label: string; value: ReporteProblemaStatus | "" }[] = [
  { label: "Todos los estados", value: "" },
  { label: "Nuevo", value: "NUEVO" },
  { label: "En análisis", value: "EN_ANALISIS" },
  { label: "Reproducido", value: "REPRODUCIDO" },
  { label: "En corrección", value: "EN_CORRECCION" },
  { label: "Resuelto", value: "RESUELTO" },
  { label: "Pendiente de validación", value: "PENDIENTE_VALIDACION" },
  { label: "Cerrado", value: "CERRADO" },
];
const priorities: { label: string; value: ReporteProblemaPriority | "" }[] = [
  { label: "Todas las prioridades", value: "" },
  { label: "P0", value: "P0" },
  { label: "P1", value: "P1" },
  { label: "P2", value: "P2" },
  { label: "P3", value: "P3" },
];
const statusLabels: Record<ReporteProblemaStatus, string> = {
  NUEVO: "Nuevo",
  EN_ANALISIS: "En análisis",
  REPRODUCIDO: "Reproducido",
  EN_CORRECCION: "En corrección",
  RESUELTO: "Resuelto",
  PENDIENTE_VALIDACION: "Pendiente de validación",
  CERRADO: "Cerrado",
};

type EditState = {
  estado: ReporteProblemaStatus;
  prioridad: ReporteProblemaPriority;
  notasAdmin: string;
  duplicadoDeId: string;
};

type ReportListResponse = {
  data: ReporteProblema[];
  meta: { total: number; page: number; pageSize: number; pageCount: number };
};

export default function ReportesProblemasPage() {
  const [estado, setEstado] = useState<ReporteProblemaStatus | "">("");
  const [prioridad, setPrioridad] = useState<ReporteProblemaPriority | "">("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [reports, setReports] = useState<ReporteProblema[]>([]);
  const [edits, setEdits] = useState<Record<number, EditState>>({});
  const [meta, setMeta] = useState<ReportListResponse["meta"]>({
    total: 0,
    page: 1,
    pageSize: 20,
    pageCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (estado) query.set("estado", estado);
    if (prioridad) query.set("prioridad", prioridad);
    void api
      .get<ReportListResponse>(`/admin/reportes-problemas?${query.toString()}`)
      .then((response) => {
        if (!active) return;
        setError(null);
        setReports(response.data);
        setMeta(response.meta);
        setEdits(
          Object.fromEntries(
            response.data.map((report) => [
              report.id,
              {
                estado: report.estado,
                prioridad: report.prioridad,
                notasAdmin: report.notasAdmin ?? "",
                duplicadoDeId: report.duplicadoDeId
                  ? String(report.duplicadoDeId)
                  : "",
              },
            ]),
          ),
        );
      })
      .catch(() => {
        if (active) setError("No se pudieron cargar los reportes.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [estado, page, prioridad, reloadKey]);

  function updateEdit(id: number, patch: Partial<EditState>) {
    setEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function save(report: ReporteProblema) {
    const edit = edits[report.id];
    if (!edit || savingId !== null) return;
    setSavingId(report.id);
    setNotice(null);
    setError(null);
    try {
      const duplicate = edit.duplicadoDeId.trim();
      await api.patch(`/admin/reportes-problemas/${report.id}`, {
        estado: edit.estado,
        prioridad: edit.prioridad,
        notasAdmin: edit.notasAdmin,
        duplicadoDeId: duplicate ? Number(duplicate) : null,
      });
      setNotice(`Se actualizó el reporte ${report.id}.`);
      setLoading(true);
      setReloadKey((value) => value + 1);
    } catch {
      setError(
        `No se pudo actualizar el reporte ${report.id}. Verificá el vínculo con el reporte original.`,
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Problemas reportados"
        description="Revisá los informes de los usuarios y registrá su seguimiento."
      />
      <div className={styles.filters}>
        <Select
          id="report-status-filter"
          label="Estado"
          options={statuses}
          value={estado}
          onChange={(event) => {
            setLoading(true);
            setEstado(event.target.value as ReporteProblemaStatus | "");
            setPage(1);
          }}
        />
        <Select
          id="report-priority-filter"
          label="Prioridad"
          options={priorities}
          value={prioridad}
          onChange={(event) => {
            setLoading(true);
            setPrioridad(event.target.value as ReporteProblemaPriority | "");
            setPage(1);
          }}
        />
        <span className={styles.total}>{meta.total} reporte(s)</span>
      </div>
      {error ? (
        <StatusMessage
          variant="error"
          title="No se completó la operación"
          message={error}
        />
      ) : null}
      {notice ? (
        <StatusMessage
          variant="success"
          title="Seguimiento guardado"
          message={notice}
        />
      ) : null}
      {loading ? (
        <p role="status">Cargando reportes…</p>
      ) : reports.length === 0 ? (
        <EmptyState
          title="No hay reportes"
          description="Los problemas informados aparecerán aquí."
        />
      ) : (
        <div className={styles.list}>
          {reports.map((report) => {
            const edit = edits[report.id];
            if (!edit) return null;
            const lastObservedAt = report.duplicados.reduce(
              (latest, duplicate) =>
                new Date(duplicate.createdAt) > new Date(latest)
                  ? duplicate.createdAt
                  : latest,
              report.createdAt,
            );
            return (
              <Card key={report.id}>
                <article className={styles.report}>
                  <header className={styles.header}>
                    <div>
                      <h2>
                        Reporte {report.id}: {report.tipo}
                      </h2>
                      <p>
                        {report.modulo} · {report.ruta} ·{" "}
                        {formatDateTime(report.createdAt)}
                      </p>
                    </div>
                    <strong className={styles.priority}>
                      {report.prioridad}
                    </strong>
                  </header>
                  <p className={styles.description}>{report.descripcion}</p>
                  {report.accion ? (
                    <p>
                      <strong>Acción:</strong> {report.accion}
                    </p>
                  ) : null}
                  <div className={styles.meta}>
                    <span>
                      Ocurrencias relacionadas: {report.duplicados.length + 1}
                    </span>
                    <span>
                      Última observación: {formatDateTime(lastObservedAt)}
                    </span>
                    <span>
                      Usuario:{" "}
                      {report.usuario
                        ? `${report.usuario.nombre} ${report.usuario.apellido ?? ""} (${report.usuario.email})`
                        : "Cuenta eliminada"}
                    </span>
                    <span>Versión: {report.version}</span>
                    {report.errorId ? (
                      <span>Id. de error: {report.errorId}</span>
                    ) : null}
                    {report.duplicadoDe ? (
                      <span>Relacionado con #{report.duplicadoDe.id}</span>
                    ) : null}
                  </div>
                  <div className={styles.controls}>
                    <Select
                      id={`report-${report.id}-status`}
                      label="Estado"
                      options={
                        statuses.filter((option) => option.value !== "") as {
                          label: string;
                          value: string;
                        }[]
                      }
                      value={edit.estado}
                      onChange={(event) =>
                        updateEdit(report.id, {
                          estado: event.target.value as ReporteProblemaStatus,
                        })
                      }
                    />
                    <Select
                      id={`report-${report.id}-priority`}
                      label="Prioridad"
                      options={
                        priorities.filter((option) => option.value !== "") as {
                          label: string;
                          value: string;
                        }[]
                      }
                      value={edit.prioridad}
                      onChange={(event) =>
                        updateEdit(report.id, {
                          prioridad: event.target
                            .value as ReporteProblemaPriority,
                        })
                      }
                    />
                    <label
                      className={styles.field}
                      htmlFor={`report-${report.id}-notes`}
                    >
                      <span>Observaciones internas</span>
                      <textarea
                        id={`report-${report.id}-notes`}
                        value={edit.notasAdmin}
                        maxLength={4000}
                        rows={3}
                        onChange={(event) =>
                          updateEdit(report.id, {
                            notasAdmin: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label
                      className={styles.field}
                      htmlFor={`report-${report.id}-duplicate`}
                    >
                      <span>
                        Reporte original relacionado <em>Opcional</em>
                      </span>
                      <input
                        id={`report-${report.id}-duplicate`}
                        type="number"
                        min={1}
                        max={report.id - 1}
                        value={edit.duplicadoDeId}
                        onChange={(event) =>
                          updateEdit(report.id, {
                            duplicadoDeId: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <footer className={styles.footer}>
                    <span>Estado actual: {statusLabels[report.estado]}</span>
                    <Button
                      onClick={() => void save(report)}
                      disabled={savingId !== null}
                    >
                      {savingId === report.id
                        ? "Guardando…"
                        : "Guardar seguimiento"}
                    </Button>
                  </footer>
                </article>
              </Card>
            );
          })}
        </div>
      )}
      <nav className={styles.pagination} aria-label="Paginación de reportes">
        <Button
          variant="secondary"
          disabled={page <= 1 || loading}
          onClick={() => {
            setLoading(true);
            setPage((value) => value - 1);
          }}
        >
          Anterior
        </Button>
        <span>
          Página {page} de {Math.max(1, meta.pageCount)}
        </span>
        <Button
          variant="secondary"
          disabled={loading || page >= meta.pageCount}
          onClick={() => {
            setLoading(true);
            setPage((value) => value + 1);
          }}
        >
          Siguiente
        </Button>
      </nav>
    </div>
  );
}
