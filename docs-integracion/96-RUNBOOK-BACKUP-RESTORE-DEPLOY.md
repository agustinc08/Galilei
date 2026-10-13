# Runbook: backup, restore y deploy

## Backup

1. Confirmar ambiente, DB y ventana de mantenimiento.
2. Tomar `pg_dump` de versión compatible y guardar timestamp, tamaño y SHA-256 en storage restringido.
3. Respaldar en forma coherente el storage content-addressed y su manifiesto; la DB no incluye los PDFs externos.
4. Validar integridad del archivo y conservar copia fuera del host.

## Restore

1. Restaurar primero a DB aislada con credenciales de mínimo privilegio; nunca sobrescribir como primer paso.
2. Validar migraciones, tablas, conteos de documentos/archivos/páginas/clasificaciones/colecciones/auditoría, muestra de `CorpusDocumentFile.sha256` y smoke de búsqueda.
3. Restaurar storage y comparar checksums antes de habilitar tráfico.
4. Registrar aprobación del operador y conservar el origen hasta cerrar validación.

## Deploy y migración

Tomar backup DB+storage, desplegar versión inmutable, ejecutar `prisma migrate deploy`, verificar estado/schema y health, y luego smoke funcional. Prisma no ofrece rollback mágico: ante fallo, detener tráfico, conservar logs y decidir restaurar DB+storage coherentes o desplegar corrección hacia adelante con responsables. No restaurar sólo DB si faltan archivos.

## Health y límites actuales

Validar readiness, permisos de storage, acceso DB, login/roles y PDF Range. Este runbook no fue probado de extremo a extremo en Sprint 12: `pg_restore` está bloqueado por Device Guard y el rol DEV no crea DB temporal. Resolver esa capacidad autorizadamente antes de la puesta en marcha.
