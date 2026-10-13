# 156 — Ingesta al Corpus — Sprint 14

No se hizo backup, dry-run ni escritura de DB: no hubo archivos completos con PDF magic/EOF, checksum y procedencia suficientes para formar un paquete de sentencias. No se ejecutaron migraciones, Prisma ni importador. No se conectó PostgreSQL y el estado del Corpus no cambió.

La ingesta queda condicionada a: (1) recurso permitido y archivo validado; (2) identificar si es sentencia individual o tomo agregado; (3) comparar ID externo y SHA con Corpus; (4) dry-run de paquete con fuente/versiones/ACL; (5) backup DEV; (6) import incremental sólo por `with-dev-db-guard.cjs` tras verificar DB, host, puerto y rol; (7) conteos y Search smoke. No importar un tomo recopilatorio como fallo único ni marcar PUBLIC sin evaluación ACL.

Último snapshot maestro: 10.732 documentos, 10.752 objetos/archivos (incluye 20 derivados OCR), 23.829 ubicaciones y 95.486 páginas. El delta Sprint 14 es “sin cambios ejecutados”; no se consultó DB ni se reauditaron los roots.
