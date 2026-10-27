# Guía UAT institucional — Revisión OCR

**Entorno:** QA aislado autorizado. Usar un PDF de prueba institucional con acceso permitido; no cargar documentos sensibles en un entorno no aprobado.

## Recorrido

1. Iniciar sesión con una cuenta del rol que participará en la revisión y abrir `/admin/jurisprudencia/ocr`.
2. Confirmar que la cola muestra solo documentos internos que requieren OCR y que los filtros, contadores y paginación responden.
3. Abrir un documento, tomar la revisión y comparar el PDF original con el OCR página por página.
4. Corregir una página de prueba, guardar y recargarla. Confirmar que el texto corregido persiste separado del texto OCR.
5. Aprobar una página con texto. Confirmar que la página siguiente no queda aprobada automáticamente.
6. Marcar explícitamente una página vacía como **Sin texto**. Rechazar una página de prueba con un motivo permitido y volver a revisarla.
7. Intentar aprobar el documento con una página pendiente o rechazada y confirmar que la operación se bloquea con un mensaje útil.
8. Completar la revisión individual de todas las páginas y aprobar el texto del documento. Confirmar quién aprobó, hora, procedencia y checksum en el panel correspondiente.
9. Buscar un fragmento de la corrección en el Search interno después de la sincronización. Si Search se pausa, confirmar que la aprobación queda guardada y que la cola indica sincronización pendiente hasta la recuperación.
10. Confirmar que el PDF original descarga con los mismos bytes/SHA-256, que el documento sigue sin publicar y que `publishedAt`, metadatos jurídicos y verificación de citas no cambiaron.
11. Reabrir una página aprobada. Verificar que la versión Search aprobada anterior continúa vigente hasta una nueva aprobación completa.
12. Repetir los intentos de abrir/editar/aprobar con una cuenta LECTOR y con un usuario sin acceso al recurso; ambos deben ser denegados sin filtrar metadatos.

## Registro de UAT

Para cada caso registrar ambiente, SHA de la aplicación, rol, resultado esperado/observado, fecha y defectos. No incluir contraseñas, texto de fallos reales ni PDFs en el reporte. Sprint 8 no tiene aún resultado de UAT humana institucional: este documento es el guion para esa ejecución posterior.
