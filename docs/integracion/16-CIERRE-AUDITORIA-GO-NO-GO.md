# 16 — Cierre de auditoría y decisión GO/NO-GO

## Decisión ejecutiva

**NO-GO para comenzar hoy el MVP integrado con datos reales de Jurisprudencia y Digesto. GO para un spike acotado, no productivo y de solo lectura sobre el contrato de búsqueda y el snapshot SQLite disponible.**

El núcleo de Jurisprudencia y su código son reutilizables; la auditoría recuperó la aplicación PHP, transcribió el mapa XLS y midió 55 consultas legacy. Aún no hay un snapshot/export real de Digesto, el PostgreSQL de Jurisprudencia no tiene listener local, no se pudieron verificar asociaciones ArchivoPdf reales y faltan reglas institucionales de acceso. Iniciar el MVP integrado antes de esas entradas obligaría a diseñar contra supuestos.

El spike puede validar gramática, AST, normalización y diseño de resultados con consultas legacy medidas. No debe conectarse a la URL remota de Digesto ni a un entorno de producción. El MVP integrado pasa a GO al cumplir los gates enumerados al final.

## Cierre de incógnitas

| Tema | Evidencia cerrada | Estado restante |
|---|---|---|
| XLS de MicroISIS | 34.304 bytes, OLE/BIFF8, SHA-256 documentado, una hoja Hoja1; lista de 29 nombres con números 0–28; transcripción Markdown/JSON | La columna numérica no tiene encabezado; no hay glosa de valores de tipo_registro ni significado de S/C/minúsculas/X; mappings 7 y 27 chocan según tabla/tipo |
| MicroISIS | 52.375 filas; 30 columnas; 29 campos de texto; copia exacta de la SQLite moderna local; no aparece en Prisma/importador ni como tabla operativa PHP | No se conoce ETL/origen exacto ni se validan enlaces a entidades modernas; destino PostgreSQL no consultado |
| Benchmark | 55 consultas; 40 con conteo sobre SQLite que usa el endpoint público; 5 comparaciones de intersección/unión; límite de 300 y top IDs no sensibles incluidos en JSON | Sin conteos modernos ni latencia/recall por PostgreSQL no disponible; valores personales se dejaron redactados |
| Gramática | Diferencias legacy medidas; wildcard, AND/OR/NOT, ñ y palabras cortas documentadas | Requiere implementar/validar el contrato AST antes de adoptar una caja común |
| PostgreSQL Jurisprudencia | .env local apunta a localhost; compose declara PostgreSQL 16; no hay listener ni proceso PostgreSQL local | No se intentó conectar; no hay dump de destino inspeccionado |
| PostgreSQL Digesto | La configuración encontrada señala un host no loopback | No se intentó conectar: no se puede demostrar que no sea producción |
| PDF modernos | 1.404 hashes únicos legacy aparecen en data/uploads modernos. Prisma define ArchivoPdf → Sentencia, con FK obligatoria, cascade e índices de legacyId/legacyPath | Sin instancia/dump no se conocen filas ArchivoPdf, orfandad, ruta existente ni publicación. El modelo no declara hash/unique en legacyId o legacyPath |
| Seguridad/publicación | PHP público no filtra tb_sumarios.publicado; 112 filas activas no publicadas pasan el WHERE en la SQLite que abre el endpoint | Exposición de producción no probada. Digesto requiere revisión de autorización de servidor y matriz de acceso |

## Qué es y qué hacer con tb_microisis

### Conclusión

La lectura más probable es un **snapshot/export relacional aplanado de registros derivados de MicroISIS**, con confianza **media**. La tabla no muestra señales de ser un índice: tiene clave primaria, campos de contenido y clasificación, ningún índice secundario/FK y no tiene una ruta de lectura/escritura en el PHP inspeccionado ni en el importador moderno.

El XLS ayuda: su lista con números 0–28 coincide con los 29 campos de texto. También contiene listas para tb_sentencias, tb_sumarios y tb_operadores. No incluye `.mst/.xrf`, ETL, autoría de la exportación ni glosa de valores. La numeración 0–28 parece corresponder a tags/posiciones MicroISIS, pero la hoja no titula esa columna. El aparente reuso de 7 y 27 entre listas hace posible que la etiqueta dependa de tipo_registro; también puede ser un crosswalk inconsistente. Es hipótesis, no significado documentado.

### Cobertura frente al modelo moderno

Conceptos que sí tienen representación moderna explícita o equivalente: número/tema/texto de sumario; tipo de fallo, sala, fecha, juez, objeto, actor, demandado, magistrados, tribunal de origen y expediente/caratula. La hoja sugiere vínculos parciales entre campos MicroISIS y tablas legacy, pero no hay una clave de fila confirmada.

Campos que el pipeline moderno no importa desde tb_microisis y que pueden guardar información no representada por ese pipeline: referencias_normativas, sumarios_contradictorios, sumarios_asociados, sentencias_anuladas, numero_saij, publicacion, resultado, operador, fecha_carga, materia, local, pre_causa, causa, observaciones, dummy y tipo_registro. Algunos tienen modelos conceptuales modernos (por ejemplo, referencias normativas), pero no se probó que estos registros estén importados o enlazados. No se puede llamar “perdido” a un campo sin cotejo del PostgreSQL destino.

Relaciones a recrear solo tras claves aprobadas: registro MicroISIS ↔ sentencia/sumario por tipo; relaciones de sumarios asociados/contradictorios; referencias normativas/jurisprudenciales; sentencias anuladas; y PDF ↔ sentencia. El análisis textual previo aporta candidatos, no relaciones definitivas.

### Disposición recomendada

**No importar automáticamente las 52.375 filas como entidades modernas.** Conservar la base/snapshot íntegro como evidencia de procedencia o staging histórico inmutable si la política institucional permite su retención. Para el producto, proyectar selectivamente campos que tengan significado, clasificación de acceso y enlace verificado. No crear un modelo de producción LegacyMicroisisRecord solo por la existencia de la tabla. Para el MVP, MicroISIS queda fuera del índice hasta cerrar significados y claves; su snapshot se conserva para reconciliación.

## Contrato de búsqueda recomendado

Toda consulta debe parsearse primero a un AST tipado; ni PHP ni ORM deben reinterpretar directamente los símbolos del usuario como SQL.

### Sintaxis aceptada

- Palabras contiguas: conjunción implícita, equivalente a AND.
- AND, OR y NOT como operadores explícitos, sin distinción de mayúsculas.
- Frases entre comillas: coincidencia contigua.
- campo:valor para una lista controlada: tema, sala, tipo/tipoFallo, tribunal/tribunalOrigen, expediente, caratula, actor, demandado, objeto, magistrados, numeroSentencia y numeroSumario.
- Paréntesis para agrupación real.
- El NOT prefijado `-termino` y el operador palabra NOT son equivalentes.

### Compatibilidad legacy

Mantener una capa de traducción visible:

| Legacy | Traducción a AST | Regla |
|---|---|---|
| `*` | AND | Solo como operador entre operandos; nunca comodín |
| `+` | OR | Solo como operador entre operandos |
| `a - b` | AND(a, NOT(b)) | El guion aislado entre operandos excluye el término siguiente |
| `-termino` | NOT(termino) | Aceptar la forma moderna adjunta y documentarla |
| `%termino` | TERM con modo SUFFIX | El token termina con termino |
| `termino%` | TERM con modo PREFIX | El token empieza con termino |
| `"frase"` | PHRASE | Mismo sentido, con normalización acordada |

No asignar un wildcard a `*`: en legacy significa AND. Admitir `%` solo al inicio/final de un término sin comillas; rechazar `%` interno, doble wildcard o wildcard vacío con error claro. Parametrizar patrones e interpretar comodines con escape seguro.

### AST y precedencia

Representación conceptual:

- `TERM(value, field?, matchMode?)`
- `PHRASE(value, field?)`
- `NOT(node)`
- `AND(nodes[])`
- `OR(nodes[])`

Precedencia recomendada, de mayor a menor: **NOT → AND (incluye AND implícito) → OR**. Paréntesis cambian precedencia. Operadores asociativos del mismo nivel se agrupan de izquierda a derecha; el normalizador puede aplanar nodos AND/OR equivalentes. Ejemplos:

- `daño * moral` → `AND(TERM(daño), TERM(moral))`
- `daño - moral` → `AND(TERM(daño), NOT(TERM(moral)))`
- `daño OR moral AND civil` → `OR(TERM(daño), AND(TERM(moral), TERM(civil)))`
- `NOT actor:valor` → `NOT(TERM(valor, field=actor))`

La UI debe mostrar cómo se interpretó una consulta legacy. AND/OR dentro del texto debe conducir al mismo AST que el selector de operador o reemplazarlo; no mantener dos fuentes de verdad. La implementación moderna actual separa el token OR de `query.operador`, que la UI inicia en AND, y no representa paréntesis como grupos. Esto debe resolverse antes del MVP.

### Normalización

Conservar texto original. Normalizar mayúsculas y tildes vocálicas de manera uniforme, pero **preservar ñ como letra distinta de n**. No descartar silenciosamente palabras cortas: usar reglas por campo/contexto y permitir búsquedas explícitas de abreviaturas, artículos, letras/números de sala e identificadores. Números, artículos, expedientes y números de sentencia/sumario deben tener ruta exacta prioritaria. El score semántico debe ser una señal separada y no cambiar exclusiones ni coincidencias exactas.

## Arquitectura final recomendada

Mantener Jurisprudencia como núcleo y desarrollar un portal/API de lectura con contextos separados:

1. Adaptador Jurisprudencia usa la fuente moderna verificada; filtros publicados/activos y anonimización se aplican en servidor.
2. Adaptador Digesto se construye después de recibir export de staging con conteos, relaciones y clasificación de acceso. No consultar su host remoto actual.
3. Parser común convierte ambas sintaxis a AST; adaptadores traducen AST a búsqueda propia por fuente y devuelven contrato de resultado común con tipo/fuente/ID, campos de coincidencia, score y permisos.
4. Resultados mantienen entidades propias: Sentencia/Sumario y Documento Digesto. El índice es proyección de lectura, nunca fuente maestra.
5. PDFs se resuelven por ArchivoPdf.sentenciaId y ruta comprobada; deduplicación con SHA-256 en pipeline/ledger externo al modelo actual. No usar nombre del archivo como único enlace.
6. MicroISIS se queda fuera del índice MVP hasta decodificar tipo y aprobar relaciones; staging conserva el original y el crosswalk versionado.
7. API filtra contenido antes de score/snippet/facetas/sugerencias/preview/descarga. Roles y estado se definen por matriz aprobada; los servicios de archivos validan autorización y existencia.

## Probabilidades revisadas y estimaciones

Son juicio de planificación, no probabilidades estadísticas. El éxito se condiciona a obtener los datos de Digesto y verificar seguridad antes de integrar.

| Resultado | Estimación central | Rango | Cambio/razón |
|---|---:|---:|---|
| Entregar MVP integrado de solo lectura una vez cumplidos los gates | 80% | 70–85% | Núcleo Jurisprudencia reutilizable y legacy medido; baja por falta actual de export Digesto, DB destino y cierre de OR/ACL |
| Reconciliar binarios y asociaciones PDF modernas con destino real | 70% | 60–80% | Todos los hashes legacy existen en el árbol local y hay FK en Prisma; población/rutas del destino desconocidas |
| Mapear íntegramente MicroISIS a entidades jurídicas confiables | 58% | 45–65% | XLS recuperado, pero valores y mappings por tipo siguen ambiguos |
| Reimplementar funciones de Copernic útiles localmente | 72% | 60–80% | Capacidades generales conocidas; falta validar consultas y preview con usuarios locales |
| Aceptación de la experiencia como mejora para usuarios | 62% | 55–70% | No se observaron búsquedas de usuarios ni se midió relevancia moderna |

Estimación del MVP definido aquí (dos fuentes en lectura, resultados trazables, gramática AST/compatibilidad, filtros básicos, preview autorizado; sin migración completa de MicroISIS, OCR, IA ni reemplazo de backoffice): **19–31 persona-semanas** después de recibir los insumos y accesos seguros. Para un equipo de 1 persona: alrededor de 5–8 meses; 2 personas: 3–5 meses; 3 personas: 2–4 meses por dependencias de datos/seguridad y validación. No incluye demora institucional de obtener exports, decisiones de privacidad ni hardening/despliegue.

Proyecto completo de unificación, migración y reemplazo gradual: **48–90 persona-semanas**, rango revisado desde 43–83 porque MicroISIS muestra crosswalk por tipo ambiguo, el benchmark detectó divergencia de OR y los datos reales de PostgreSQL/Digesto/PDF siguen sin cotejarse. Estos rangos deben recalcularse tras el primer export Digesto y el snapshot relacional moderno.

## Gates para pasar a GO integrado

1. Export Digesto de staging con autorización, conteos por entidad, IDs, estados, asociaciones y manifiesto de archivos; confirmar guardias de autorización del servidor.
2. Dump/snapshot PostgreSQL Jurisprudencia cuya procedencia no productiva esté documentada, o instancia local levantada explícitamente como desarrollo. No inferir seguridad solo del valor localhost.
3. Snapshot de ArchivoPdf y árbol persistente para cotejar sentenciaId, legacyId/path, ruta existente y hashes. Mantener duplicados y resolver conflictos con ledger.
4. Política aprobada: público/interno/administración, borrador/pendiente/publicado, anonimización, campos/snippets visibles y acceso PDF.
5. Decisión firmada de gramática/normalización basada en los 55 casos; corregir o resolver la discrepancia OR del servicio actual.
6. Definir si MicroISIS entra en la primera versión; recomendación actual: no. Si se incluye después, glosario de tipo_registro y claves/relaciones por tipo documentadas.

No ejecutar migración o retirada legacy dentro de este GO. Después de gates, comenzar MVP read-only con consultas de oro, ledger de reconciliación y criterios de corte medibles.

## Archivos de cierre

- Benchmark de 55 casos y mediciones legacy: 14-BENCHMARK-BUSQUEDA.md y benchmark-busqueda.json.
- Transcripción XLS/campos: 15-TRANSCRIPCION-CAMPOS-EXPLICADOS.md y diccionario-microisis.json.
- Flujos legacy: 09-LEGACY-ESTRUCTURA-Y-FLUJOS.md.
- PDFs: 12-AUDITORIA-PDF-Y-REFERENCIAS.md.
- Diseño base: 13-ARQUITECTURA-BUSCADOR-JURIDICO-CIVIL.md.
