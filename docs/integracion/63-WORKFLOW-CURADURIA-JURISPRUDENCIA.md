# Flujo de curaduría de Jurisprudencia

**Sprint 9 — implementado y probado en DEV.**

## Asociación de documentos

Las asociaciones candidatas y de alta confianza continúan pendientes hasta que una persona revise la evidencia. Aprobar exige seleccionar una Sentencia existente y comprobable; la operación crea el vínculo activo del documento Corpus con esa Sentencia y registra responsable, hora, resultado y evidencia. Rechazar conserva la decisión y motivo. No se generan Sentencias desde PDFs ni se autoaprueban coincidencias.

## Selección editorial

El documento pasa por NO_REVIEWED, REVIEW_PENDING y la decisión SELECTED o NOT_SELECTED. La selección exige asociación aprobada con Sentencia existente y motivo permitido; OTRO exige nota explicativa. La decisión y sus metadatos se guardan en el documento y AccionLog. La decisión editorial no modifica por sí sola ACL, anonimización ni publicación.

## Permisos y evidencia

Las rutas usan autenticación y roles existentes ADMIN/OPERADOR. Un OPERADOR no puede alterar documentos RESTRICTED; ADMIN puede hacerlo. Colecciones y taxonomías se administran sólo por ADMIN. No se añadió el rol revisor al esquema existente.

Pruebas: servicio unitario y prueba PostgreSQL de integración (1/1) con registros sintéticos creados y eliminados en DEV. No se ejecutó aceptación HTTP en navegador: no hay usuario activo institucional de prueba. En la base persistente siguen 27 asociaciones HIGH_CONFIDENCE y 2 CANDIDATE en REVIEW_PENDING; 10.703 permanecen UNRESOLVED, y no se creó ningún vínculo cruzado real.
