# 23 — Roadmap del Buscador Jurídico Civil

## Estado actual

La Misión 5.1 recuperó el backend con pnpm 11.19.0: instalación congelada, Prisma Client generado, 5 suites/35 tests aprobados y pnpm build con exit code 0. El detalle y la ruta del backup están en 24-RECUPERACION-ENTORNO-MISION-5.1.md.

Docker/WSL2 sigue sin estar operativo y PostgreSQL no se inició. No hay fixture PostgreSQL ni adaptador PostgreSQL implementado. El benchmark de 55 casos tiene 0 mediciones PostgreSQL; ver 19-BENCHMARK-POSTGRESQL.md. El avance puede continuar en la capa de búsqueda, pero el spike y la validación PostgreSQL siguen bloqueados.

## Tramos y puertas de salida

### 0. Recuperar entorno reproducible

- Determinar versiones soportadas por el proyecto, Node y pnpm.
- Resolver package-lock de backend y frontend antes de elegir transición.
- Mantener los lockfiles npm y el árbol actual hasta que instalación, Prisma generate, pruebas y build pasen en una copia verificable.
- Corregir module/type resolution mediante una instalación coherente, sin usar NODE_PATH como arreglo permanente.
- Salida: instrucciones de instalación reproducibles y test/build del backend verdes.

### 1. Habilitar desarrollo local aislado

- Habilitar WSL2 y virtualización en Windows 11 Home con asistencia administrativa; reiniciar si Windows lo requiere.
- Instalar Docker Desktop para el usuario y validar versión de Docker/Compose.
- Validar Compose, listener sólo en loopback, credencial local fuera del repositorio, volumen exclusivo y healthcheck.
- Salida: PostgreSQL 16 dev accesible sólo en el host local y descartable.

### 2. Crear fixture SQLite → PostgreSQL

- Seleccionar un subconjunto determinista de sentencias y sumarios con IDs legacy preservados.
- Leer SQLite en modo read-only; no incluir tablas de MicroISIS.
- Documentar consulta de exportación, checksum del origen y conteos antes/después.
- No cargar datos personales no aprobados.
- Salida: import repetible, conteos reconciliados y trazabilidad por ID.

### 3. Implementar SearchSourceAdapter PostgreSQL

- Traducir el AST existente sin volver a parsear.
- Usar parámetros SQL y listas permitidas de campos/orden/filtros.
- Añadir exact match de expediente/sentencia/sumario por delante de ranking textual.
- Mantener ñ distinta de n e ignorar tildes según el comportamiento aprobado.
- Añadir AND/OR/NOT, frases, wildcard de prefijo/sufijo, paginación y ACL.
- Salida: suite de integración sobre fixture y mismas pruebas contractuales que SQLite.

### 4. Medir y decidir

- Ejecutar el benchmark de 55 casos aplicables; separar errores del parser, diferencias semánticas, conteos e IDs.
- Comparar orden/ranking moderno por separado del orden legacy por fecha.
- Medir parser, DB y total; registrar candidatos y resultados.
- Informar promedio, p50/p95 sólo con una muestra suficiente y el entorno reproducible.
- Elegir B-tree, GIN, pg_trgm y configuración de tsvector a partir de mediciones.
- Salida: informe con equivalencias, diferencias explicadas, seguridad y límites.

### 5. Incorporar procedencia y curaduría

- Validar con Secretaría fuentes, organización judicial, instancia opcional, proceso de selección, catálogo de motivos, estado editorial, ACL y anonimización.
- Mantener las decisiones humanas y su historial.
- Salida: modelo Prisma revisado y migración dev sólo tras validación funcional.

### 6. Preparar Digesto y fuentes futuras

- Validar colecciones, temas, etiquetas y necesidad real de carpetas.
- Diseñar ingestion/adapters para CIJ y CSJN sólo con información pública/autorizada.
- Lex100 requiere autorización y mecanismo institucional oficial.
- Diseñar indexación idempotente e IA como asistencia con aprobación humana.
- Salida: contrato y roadmap aprobados; sin conectores ni ingesta hasta contar con autorización y requisitos.

### 7. Frontend

- Cambiar interfaz sólo después de estabilizar contrato, seguridad, filtros y paginación del backend.
- Mostrar procedencia y metadata específica por dominio sin imponer campos comunes inexistentes.
- Salida: flujo de búsqueda validado con usuarios y permisos.

## Go/no-go de esta misión

SÍ CON BLOQUEANTES para continuar el diseño y la recuperación del entorno. NO para declarar completo el spike PostgreSQL ni para abrir todavía un MVP respaldado por PostgreSQL: faltan Docker/WSL2, build estable, fixture, adaptador, integración, benchmark y mediciones. Ningún dato productivo o remoto fue usado.
