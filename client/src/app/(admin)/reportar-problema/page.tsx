"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { api } from "@/lib/api";
import { usePathname } from "@/lib/router-compat";
import styles from "./reportar-problema.module.css";

const tipoOptions = [
  { label: "Error o pantalla que no funciona", value: "ERROR" },
  { label: "Problema al completar una tarea", value: "FUNCIONAMIENTO" },
  { label: "Acceso o permisos", value: "ACCESO" },
  { label: "Contenido o información", value: "CONTENIDO" },
  { label: "Otro", value: "OTRO" },
];

export default function ReportarProblemaPage() {
  const pathname = usePathname();
  const [tipo, setTipo] = useState("ERROR");
  const [descripcion, setDescripcion] = useState("");
  const [accion, setAccion] = useState("");
  const [errorId, setErrorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ data: { id: number } }>(
        "/reportes-problemas",
        {
          tipo,
          descripcion,
          ruta: pathname || "/",
          ...(accion.trim() && { accion: accion.trim() }),
          ...(errorId.trim() && { errorId: errorId.trim() }),
        },
      );
      setSubmitted(response.data.id);
      setDescripcion("");
      setAccion("");
      setErrorId("");
    } catch {
      setError(
        "No se pudo guardar el reporte. Revisá los datos e intentá nuevamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Reportar un problema"
        description="Contanos qué pasó para que el equipo pueda revisarlo y darle seguimiento."
      />
      {submitted ? (
        <StatusMessage
          variant="success"
          title="Reporte recibido"
          message={`Se registró con el número ${submitted}. Podés volver a tu tarea.`}
        />
      ) : (
        <Card>
          <form
            className={styles.form}
            onSubmit={(event) => void submit(event)}
          >
            <div className={styles.context}>
              <span className={styles.contextLabel}>Pantalla</span>
              <code>{pathname || "/"}</code>
              <p>
                Galilei registra la fecha, el módulo y la versión disponible
                automáticamente.
              </p>
            </div>
            <Select
              id="problem-type"
              label="Tipo de problema"
              options={tipoOptions}
              value={tipo}
              onChange={(event) => setTipo(event.target.value)}
            />
            <label className={styles.field} htmlFor="problem-description">
              <span>Descripción</span>
              <textarea
                id="problem-description"
                value={descripcion}
                onChange={(event) => setDescripcion(event.target.value)}
                minLength={10}
                maxLength={4000}
                required
                rows={6}
                placeholder="Qué ocurrió y qué esperabas que ocurriera"
              />
              <small>{descripcion.length}/4000</small>
            </label>
            <label className={styles.field} htmlFor="problem-action">
              <span>
                ¿Qué estabas intentando hacer? <em>Opcional</em>
              </span>
              <textarea
                id="problem-action"
                value={accion}
                onChange={(event) => setAccion(event.target.value)}
                maxLength={1000}
                rows={3}
              />
            </label>
            <label className={styles.field} htmlFor="problem-error-id">
              <span>
                Identificador de error <em>Opcional</em>
              </span>
              <input
                id="problem-error-id"
                value={errorId}
                onChange={(event) => setErrorId(event.target.value)}
                maxLength={80}
                pattern={"[A-Za-z0-9._:\\-]+"}
                autoComplete="off"
              />
            </label>
            <p className={styles.privacy}>
              No incluyas contraseñas, códigos de acceso, datos personales ni el
              contenido de documentos judiciales. No se adjuntan ni capturan
              pantallas.
            </p>
            {error ? (
              <StatusMessage
                variant="error"
                title="No se guardó el reporte"
                message={error}
              />
            ) : null}
            <Button
              type="submit"
              disabled={busy || descripcion.trim().length < 10}
            >
              {busy ? "Enviando…" : "Enviar reporte"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
