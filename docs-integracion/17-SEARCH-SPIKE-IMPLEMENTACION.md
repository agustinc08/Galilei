# 17 — SEARCH SPIKE: implementación

## Alcance y stack observado

Se evolucionó el módulo Search existente de Jurisprudencia en un spike local, sin crear un segundo buscador. El frontend sigue siendo Next.js, React y TypeScript; el backend NestJS y TypeScript; Prisma sigue siendo el ORM; PostgreSQL es la base de destino. El único archivo de datos usado para medir compatibilidad fue la copia local SQLite de referencia en `_legacy-audit-work/extracted/jurisprudencia/jurisp_6/db/jurisprudencia_db.sqlite`. No se usaron endpoints PHP ni la base remota de Digesto.

El cambio se concentra en `JurisprudenciaN/back/src/busqueda`. La UI no se modificó. No se hizo migración, despliegue ni escritura sobre datos institucionales.

## Arquitectura incorporada

- `utils/search-ast.ts`: AST versionado `bjc-v1`, con nodos `term`, `phrase`, `not`, `and` y `or`. Un literal puede incluir un campo controlado y un modo `contains | prefix | suffix`.
- `utils/search-parser.ts`: parser recursivo único. Produce AST y conserva proyecciones temporales requeridas por el servicio actual. Los errores de sintaxis se traducen a HTTP 400; no se suprimen operadores inválidos.
- `utils/search-normalizer.ts`: normalización de consulta y texto; `utils/search-highlights.ts` emplea la misma regla española al resaltar.
- `adapters/search-source.adapter.ts`: contrato `SearchSourceAdapter`, `SearchContext` y resultado común con identidad de fuente, visibilidad, fecha, snippet, campos coincidentes, score, metadatos y documento.
- `adapters/legacy-sqlite-search.adapter.ts`: adaptador solo del fixture de referencia. El AST se convierte en predicados de una lista cerrada de columnas; valores y patrones se enlazan como parámetros.
- `busqueda.service.ts`: el flujo Prisma existente traduce el mismo AST a filtros estructurados `AND/OR/NOT`; se conserva el scorer moderno, la paginación y los filtros. El contrato no obliga a Prisma a representar consultas FTS futuras.

El contrato permite incorporar adaptadores PostgreSQL y Digesto después; ninguno de esos adaptadores se implementó en esta misión.

## Gramática, precedencia y campos

Se aceptan operadores modernos `AND`, `OR`, `NOT`, comillas para frase exacta, paréntesis y `campo:valor`. La precedencia es `NOT > AND > OR`; la yuxtaposición es AND por defecto. El selector actual de interfaz todavía puede definir OR implícito cuando no hay operador lógico escrito; los operadores explícitos en la consulta siempre prevalecen. Conviene quitar/deprecar ese selector en el ajuste futuro del frontend.

Los alias admitidos son explícitos: `tema`, `sala`, `tipo`/`tipoFallo`, `tribunal`/`tribunalOrigen`, `expediente`, `caratula` (también `carátula`), `actor`, `demandado`, `objeto`, `magistrados`, `numeroSentencia` y `numeroSumario`. Los nombres arbitrarios se rechazan.

Compatibilidad legacy que llega al mismo AST: `*` es AND; `+` es OR; `-` es NOT, con o sin espacio; el `%` al final representa prefijo y al inicio sufijo; el `%` interno o un patrón vacío produce error. La frase entre comillas sigue siendo un solo literal. Los términos cortos y números no se descartan.

## Normalización, números y seguridad

Se conserva `originalQuery` exactamente, incluidos los espacios externos, y se guarda `normalizedQuery` con minúsculas, espacios normalizados y vocales sin tilde. La normalización NFD protege la secuencia de `ñ` antes de retirar otros diacríticos; por tanto `Peña` y `Pena` siguen siendo distintos, mientras que `prescripción` y `prescripcion` pueden coincidir. La normalización es insensible a mayúsculas.

Los identificadores numéricos no se eliminan; expediente, número de sentencia y número de sumario tienen alias propios y conservan los pesos del scorer moderno. La prioridad de igualdad exacta para identificadores numéricos todavía requiere una regla y casos de ranking específicos: este spike no afirma que el corpus demuestre esa prioridad.

El parser valida la gramática antes de que la consulta alcance el servicio. En Prisma se construyen filtros tipados; en SQLite, los nombres SQL proceden de la lista fija y todos los valores usan bindings. No se concatena entrada de usuario como fragmento SQL.

## Compatibilidad histórica y benchmark

El modo `legacy-reference` aplica los patrones, conectores y valores de comparación del benchmark; el modo `modern` permite semántica de campo moderna. El corpus medido son las tablas de sentencias y sumarios del snapshot local. La referencia histórica marca 25.103 filas activas en la consulta unida del endpoint auditado.

Los 40 casos `measured_legacy_sqlite` del benchmark pasaron en conteo. La prueba verificó también los cinco IDs de control cuando estaban definidos, comprobando pertenencia y sus grupos de fecha; no inventa orden entre resultados empatados por fecha. `total` se calcula separado de `page/pageSize/results`. El tamaño de página máximo de 300 es exclusivo del adaptador de referencia para reproducir el límite visible antiguo; no es una decisión para PostgreSQL.

BJC-031/032 aplican filtros sala/fecha estructurados del fixture. BJC-033 compara explícitamente con la consulta control histórica `daños` (9.798 resultados); eso verifica el control del benchmark, no una ejecución PostgreSQL del filtro moderno `tema:daños`. Los BJC-030/039 mantienen el comportamiento literal en modo de referencia aunque el parser normal reconozca `sala:A` como campo moderno. Las razones y resultados caso por caso están en el informe 18; el JSON histórico no se editó.

## Fuente, publicación y seguridad

`SearchContext` distingue `PUBLIC | INTERNAL | ADMIN`, dialecto y política de publicación activa/publicada. El servicio Prisma actual aplica sus filtros público/interno antes de puntuar candidatos. El adaptador SQLite solo aplica el estado activo y la política que recibe; es una regla histórica de fixture, no una política institucional ni un mecanismo de autorización productivo. Su resultado incluye la visibilidad solicitada como dato de contrato, pero el caller del fixture debe decidir la política antes de ejecutarlo. No registrar este adaptador en el módulo Nest ni usarlo como fuente de producción.

La ruta interna `GET /busqueda/interpretar?q=...&operador=...` muestra versión, consulta original/normalizada y AST para el rol permitido; responde 404 en `NODE_ENV=production`. La ruta pública existente no expone el AST.

## Frontend inspeccionado y evolución necesaria

`front/src/components/busqueda/BusquedaJurisprudenciaForm.tsx` y la pantalla pública envían la consulta, el operador actual, filtros y paginación hacia `/public/busqueda` o `/busqueda/avanzada`. El siguiente cambio de interfaz debe conservar `query`, `filters`, `page` y `pageSize`, dejar el parser exclusivamente en backend y decidir con el equipo cuándo retirar el selector `operador`. No se implementó una UI de inspección del AST.

## PostgreSQL y trabajo pendiente

PostgreSQL/Prisma siguen como destino. No se creó migración ni índice, no se conectó a PostgreSQL y no se probó rendimiento del corpus importado. La primera integración productiva debe medir consultas parametrizadas, igualdad de identificadores, pg_trgm/FTS y ranking; revisar índices B-tree/GIN/tsvector; asegurar filtros de publicación/autorización antes de puntuación, sugerencias, facetas, preview o descarga; y añadir pruebas con datos PostgreSQL. No se implementó Digesto ni se accedió a su host; no se procesó MicroISIS; no se integró Copernic.

## Verificación ejecutada

- Backend: 5 suites, 35 tests aprobados; incluye parser/AST, normalización/acentos/ñ, resaltado y benchmark SQLite opt-in.
- El test del adaptador leyó el benchmark sin cambiarlo y pasó los 40 conteos medidos, incluyendo filtros de sala/fecha y grupos de fecha de IDs de control.
- Build NestJS: ejecutado con el CLI local existente, porque este backend tiene `package-lock.json` pero no está preparado como workspace pnpm. No se ejecutó build frontend porque no hubo cambios allí.
- El comando `pnpm build` intentó instalar/reconciliar dependencias al no existir lock pnpm y las políticas locales bloquearon scripts nativos. Pnpm reubicó módulos previos bajo `node_modules/.ignored` y relinkó dependencias; se eliminaron los dos archivos de lock/workspace generados y se restauró el módulo SQLite local anterior. `node_modules` quedó reorganizado por ese intento; no se cambiaron manifiestos de dependencias ni se añadieron dependencias al proyecto.
- La carpeta no contiene repositorio Git; por ello no hay `git diff` disponible. Los documentos 01–16 y el benchmark JSON histórico quedaron sin cambios.
