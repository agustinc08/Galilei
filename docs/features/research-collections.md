# Colecciones privadas de investigación

> **Actualización 2026-10-26:** la rama candidata `feature/research-reproducibility-suite-2` agrega exportación ZIP `galilei-research-bundle/1`, hash de contenido y revalidación de sentencias publicadas/activas. Esta extensión todavía no está promovida a DEV; ver [contrato del dossier](../research-bundles.md) y el estado BJC vigente.

Las colecciones personales guardan referencias a fallos ya publicados; nunca duplican PDFs ni copian el corpus. Cada colección pertenece a una cuenta, admite el mismo fallo en varias colecciones y evita duplicados dentro de una colección. Eliminar una colección elimina únicamente sus referencias y notas.

La ficha de una colección permite renombrar, buscar por metadatos publicados o por nota, paginar, quitar fallos y editar notas de texto plano de hasta 5.000 caracteres. La búsqueda dentro de notas ocurre sólo al consultar la colección propia; las notas no se envían a Search ni a OpenSearch.

La API exige autenticación, filtra por `usuarioId` en cada lectura y mutación, responde como no encontrado ante identificadores ajenos y sólo permite agregar sentencias publicadas y activas. La unicidad compuesta por propietario/nombre normalizado y por colección/sentencia protege las carreras concurrentes. Las referencias usan `ON DELETE CASCADE` limitado a la colección o al fallo original; no se elimina el fallo al borrar una colección.

El modelo reutiliza favoritos y búsquedas guardadas como superficies separadas: favoritos son un marcador global por cuenta; búsquedas guardadas conservan estado de consulta; colecciones contienen referencias y notas contextuales. No hay etiquetas ni colaboración en esta primera versión.

Validación de la base post-UAT (2026-10-25): pruebas unitarias de ownership, nombres repetidos, deduplicación, filtro de nota y nota vacía; Playwright mock-only cubre colección y notas. En Suite 2 (2026-10-26) se agregó el ZIP reproducible; el test de servicio revalida colección propia, fallos públicos/activos y auditoría sin texto de nota. El ZIP de 100 items se reabrió y validó con 305 entradas, CRC y SHA-256. PostgreSQL descartable pasó 34/34 fresca y 33→34 incremental. Suite 2 sigue como rama candidata; el E2E contra API real y su promoción requieren revisión separada.
