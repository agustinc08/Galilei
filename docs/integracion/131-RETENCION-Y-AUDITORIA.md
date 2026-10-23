# 131 — Retención y auditoría

**Estado:** decisión institucional **PENDING**. Este documento no establece plazos legales ni valores por defecto.

## Inventario para decisión

| Clase | Qué debe definirse | Estado |
|---|---|---|
| PDF original y procedencia | Custodia, retención, baja autorizada, bloqueos legales | PENDING |
| Extracción/OCR y proyecciones | Versiones, regeneración, retiro coordinado y trazabilidad | PENDING |
| Paquetes fuente/receipts | Plazo, ubicación, acceso, verificación hash y destrucción | PENDING |
| Auditoría de acciones | Eventos mínimos, acceso, integridad, export y revisión | PENDING |
| Logs operativos | Campos permitidos, plazo, acceso, rotación y borrado | PENDING |
| Backups DB y storage | Frecuencia, generaciones, ubicación, cifrado, retención y restore | PENDING |
| Cuentas y sesiones | Inactividad, baja, revocación, investigación | PENDING |

## Criterios técnicos a acordar

La política debe asignar owner, base normativa, plazo/evento de inicio, mecanismo de retención/borrado, excepción legal, evidencia de ejecución y responsable de revisión. Loguear request ID, ruta y resultado operacional; no guardar texto de búsqueda, cuerpos, excerpts ni secretos. Debe existir vínculo trazable entre original, hash, extracciones y eventos. No aplicar borrado automático hasta la aprobación y una prueba de alcance.
