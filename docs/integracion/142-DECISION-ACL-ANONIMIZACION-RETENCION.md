# 142 — Decisión de ACL, anonimización y retención

**Estado de cada decisión:** PENDING. Completa el owner institucional responsable y fecha/acta. La implementación actual no define por sí sola una política institucional.

| Pregunta a resolver | Decisión institucional | Owner / aprobación |
|---|---|---|
| ¿Quién puede buscar cada colección o clase documental? | PENDING | PENDING |
| ¿Quién puede abrir/descargar documentos y adjuntos? | PENDING | PENDING |
| ¿Quién puede seleccionar jurisprudencia y con qué motivo? | PENDING | PENDING |
| ¿Quién puede editar sumarios y aprobar cambios? | PENDING | PENDING |
| ¿Quién administra Digesto, colecciones, temas, etiquetas y memberships? | PENDING | PENDING |
| ¿Quién puede consultar documentos restringidos y cómo se autoriza? | PENDING | PENDING |
| ¿Qué documentos/campos deben anonimizarse y en qué etapa? | PENDING | PENDING |
| ¿Quién aprueba anonimización, excepciones y control de calidad? | PENDING | PENDING |
| ¿Qué eventos deben auditarse y quién puede consultar auditoría? | PENDING | PENDING |
| ¿Cuánto conservar logs técnicos, auditoría, backups y exportaciones? | PENDING | PENDING |
| ¿Cómo se elimina/vencen datos y respaldos, y quién certifica la operación? | PENDING | PENDING |

Registrar referencias de políticas vigentes, marco normativo aplicable, dueño de datos, fecha efectiva y revisión periódica. Las reglas deben traducirse a matriz rol×acción×tipo documental y probarse con casos permitidos y denegados antes de UAT. No inferir que selección editorial, origen público o pertenencia a Digesto concede visibilidad.

**Digesto:** export y crosswalk legacy siguen PENDING; no asignar IDs, ownership, temas, etiquetas o ACL por nombre de archivo. Solicitar paquete por canal institucional autorizado conforme al contrato documentado en Sprint 10 (doc 80); no consultar endpoints remotos en Sprint 13.1.

**CIJ/CSJN:** descarga pública masiva automatizada continúa **NO GO**. Cualquier autorización/canal institucional para ese trabajo debe gestionarse como línea separada, sin crawler ni rutas alternativas en esta misión.
