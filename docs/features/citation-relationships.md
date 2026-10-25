# Citas y relaciones entre fallos

## Fuentes y estados

`ReferenciaJurisprudencial` existente se conserva como capa curatorial manual. Una relación extraída se almacena aparte como `SentenciaRelationshipCandidate`, con origen, destino propuesto cuando puede resolverse a un fallo publicado único, cita textual, identificador normalizado, tipo (`CITES`), método/versión, página opcional, estado, fecha y revisor. El extractor de primera versión reconoce sólo identificadores explícitos con año precedidos por `Expte./Expediente` o `Sentencia/Fallo`; fechas, números de leyes, referencias incompletas y menciones ambiguas no se convierten en candidatos.

La extracción crea `DETECTED_CANDIDATE` solamente. Ninguna cita pasa a `VERIFIED` automáticamente. Personal autorizado puede verificar (con destino publicado y activo), rechazar o dejar sin resolver. La precisión declarada no es una probabilidad de confianza; `confidence` permanece nulo hasta calibrar un modelo con etiquetas reales. No hay inferencias de vigencia, obligatoriedad, autoridad ni superación del precedente.

La extracción se solicita para un fallo individual y sólo lee referencias ya cargadas en su ficha. No hay ejecución masiva ni backfill en PostgreSQL/OpenSearch principales. No se añade ranking por citas.

## Presentación y ACL

La cola de revisión está protegida por roles editoriales. La vista pública consulta exclusivamente candidatas verificadas y exige que origen y destino permanezcan publicados y activos; las relaciones a registros retirados, privados o inexistentes desaparecen del resultado público. Los vínculos curatoriales antiguos se conservan, pero sus destinos sólo se exponen cuando también son públicos y activos.

## Evaluación

`src/research-relationships/citation-evaluation-set.ts` ofrece 8 ejemplos sintéticos inspeccionables: 5 identificadores positivos, 2 negativos, 1 referencia ambigua y 1 incompleta (2 casos sin resolver). La prueba registra precision=1.00 y recall=1.00 sobre esos 8 ejemplos sintéticos. Estas métricas no representan el corpus real; la evaluación con una muestra judicial etiquetada sigue pendiente antes de considerar una extracción más amplia. La candidata combinada pasó pruebas unitarias de persistencia sólo como candidata, validación de destino público y filtrado del endpoint público, además del E2E mock-only de verificación editorial. No se ejecutó backfill en principal.
