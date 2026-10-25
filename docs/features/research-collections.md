# Colecciones privadas de investigación

Las colecciones personales guardan referencias a fallos ya publicados; nunca duplican PDFs ni copian el corpus. Cada colección pertenece a una cuenta, admite el mismo fallo en varias colecciones y evita duplicados dentro de una colección. Eliminar una colección elimina únicamente sus referencias y notas.

La ficha de una colección permite renombrar, buscar por metadatos publicados o por nota, paginar, quitar fallos y editar notas de texto plano de hasta 5.000 caracteres. La búsqueda dentro de notas ocurre sólo al consultar la colección propia; las notas no se envían a Search ni a OpenSearch.

La API exige autenticación, filtra por `usuarioId` en cada lectura y mutación, responde como no encontrado ante identificadores ajenos y sólo permite agregar sentencias publicadas y activas. La unicidad compuesta por propietario/nombre normalizado y por colección/sentencia protege las carreras concurrentes. Las referencias usan `ON DELETE CASCADE` limitado a la colección o al fallo original; no se elimina el fallo al borrar una colección.

El modelo reutiliza favoritos y búsquedas guardadas como superficies separadas: favoritos son un marcador global por cuenta; búsquedas guardadas conservan estado de consulta; colecciones contienen referencias y notas contextuales. No hay etiquetas ni colaboración en esta primera versión.

Validación de esta candidata post-UAT: pruebas unitarias de ownership, nombres repetidos, deduplicación, filtro de nota y nota vacía; E2E mock-only cubre creación, agregar desde resultados, guardar nota, borrar referencia y salida segura de HTML. Las 33 migraciones pasan tanto una instalación fresca de PostgreSQL descartable como una actualización aditiva desde el conjunto de migraciones previo. La aplicación en DEV/UAT queda pendiente de revisión y promoción separadas.
