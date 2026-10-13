# 03 — Mapa de datos y compatibilidad

## Entidades comprobadas

| Concepto | Jurisprudencia | Digesto | Copernic | Compatibilidad |
|---|---|---|---|---|
| Registro principal | Sentencia con expediente, carátula, partes, magistrados, sala, fecha, tipo y publicación | Doc con número, voz, tipo, fecha, PDF, texto y pendiente | No hay registro exportado local | Mantener modelos separados |
| Unidad de análisis | Sumario con texto/tema y FK obligatoria a Sentencia | No hay entidad Sumario | Índice genérico | No son equivalentes por tener texto |
| Archivo | ArchivoPdf enlazado a Sentencia, ruta/metadata/IDs legacy | Path del PDF principal de Doc | Índice hace referencia a elementos, no hay índice local disponible | Servicio técnico de archivos común, propietario por dominio |
| Catálogos | Sala, TipoFallo, TribunalOrigen, institutos/sinónimos, temas | Tipo y Dependencia | Tipos/categorías de archivos | Equivalencias solo aprobadas, no mezclar IDs |
| Relaciones | CitaFallo, ReferenciaNormativa/Jurisprudencial/Doctrinaria, equivalencia normativa | Doc padre/hijo y DocDependencias | Adjuntos y categorías del buscador | Relaciones con tipo/origen explícito |
| Normativa | NormaArticulo y EquivalenciaNormativa más referencias desde fallos | No hay leyes/artículos/vigencia en schema | No hay corpus normativo | Juris tiene catálogo/referencias parciales |
| Identidad/uso | Rol, Usuario, Favorito, BusquedaGuardada, EventoConsulta, AccionLog | User | No hay cuenta/index local | Identity común; no copiar contraseñas legacy |
| Búsqueda | Texto normalizado, score, sinónimos, embeddings JSON | Texto PDF | Índice privado ausente | Read model con fuente y clave original |

## SQLite de Jurisprudencia: esquema y riesgo

La base local, abierta en solo lectura, contiene:

- tb_sentencias: 27.387 filas. ID, código/número, tipo, sala, fecha, juez, objeto, partes, magistrados, tribunal de origen, flag fallo completo, expediente, activo y link.
- tb_sumarios: 32.695 filas. ID, ID de sentencia, número, tema, texto, resumen, publicado, operador y activo.
- tb_microisis: 52.375 filas. 29 campos, incluyendo materia, número/texto de sumario, referencias normativas, contradictorios/asociados, causa, expediente, fecha, resultado, publicación, número SAIJ, operador, tribunal de origen, sentencias anuladas y observaciones.
- tb_operadores: 0 filas.

El código de importación descubre tb_sentencias y tb_sumarios y procesa PDFs. No se encontró referencia a tb_microisis. Puede ser fuente complementaria o tener solapamiento; **no asumir que las tres cantidades son aditivas** ni que microisis está duplicada. Hay que resolver sus claves/campos antes de cualquier migración final.

El schema moderno tiene 21 modelos: Rol, Usuario, Sentencia, Sumario, ArchivoPdf, CitaFallo, ReferenciaNormativa, ReferenciaJurisprudencial, ReferenciaDoctrinaria, Favorito, EmbeddingDocumento, BusquedaGuardada, EventoConsulta, AccionLog, InstitutoJuridico, SinonimoJuridico, NormaArticulo, EquivalenciaNormativa, Sala, TipoFallo y TribunalOrigen. El estado real del PostgreSQL no se verificó.

## Digesto

Prisma tiene User, Doc, DocDependencias, Dependencia y Tipo. Doc incluye número, path, tipo entero, voz, contenido PDF, fecha, pendiente y documento asociado. Los nombres de algunos PDFs sugieren documentación administrativa institucional, pero no se leyó su contenido. No aparecen normativas, artículos, vigencia, derogaciones ni jurisdicciones. No hay dump local para conteos reales de registros. Nueve migraciones describen cambios de schema; 278 PDFs están en server/pdfs.

El schema Prisma no declara la relación padre/hijo, pero una migración crea la FK Doc.idDocAsociado → Doc.id con ON DELETE SET NULL. Esto es una diferencia schema/migración que se debe alinear. DocDependencias tiene clave primaria compuesta, sin FKs visibles a Doc ni Dependencia. Validar filas huérfanas en un snapshot antes de migrar y definir las restricciones en el nuevo modelo.

## Compartibles como infraestructura, no como dominio

Se pueden compartir identidad, audit-log, catálogo de formatos, almacenamiento de PDF, extracción/indexación y un read model para buscar. Una proyección de búsqueda puede tener fuente, tipo, clave original, URL segura, título/metadatos, fecha, etiquetas, texto normalizado, checksum y versión del indexador. La proyección no reemplaza Sentencia, Sumario o Doc ni decide su semántica.

## Duplicados, incompatibilidades y transformaciones

- Claves autoincrementales independientes: namespace por sistema/tabla y source ID original.
- Posible solapamiento entre tb_sentencias, tb_sumarios y tb_microisis; no medido.
- 10.639 PDFs en back/data frente a 11.747 en back/uploads; no se compararon hashes.
- 278 PDFs Digesto; no se compararon contra Doc.path ni el volumen real de runtime.
- Digesto guarda pdfContent en minúsculas; normalización y extracción pueden haber perdido formato/acento, no medido.
- Doc.fecha tiene default actual; fecha ausente no puede convertirse en fecha de creación histórica silenciosamente.
- Números jurídicos como texto para preservar cero inicial, barra, guión y formato.
- En inventario aparecieron nombres con representación de caracteres posiblemente incorrecta; verificar origen/codificación antes de corregir.
- Tipo Digesto es entero en BD, nombre de catálogo en pantalla; Jurisprudencia conserva también etiquetas libres.
- IDs de personas, operadores y documentos no son equivalentes entre sistemas.

## Preservación de trazabilidad

Cada importación debe almacenar sistema, tabla, clave fuente, hash de origen, lote/versión de importador, fecha de captura, destino, transformaciones, errores, observaciones y snapshot recuperable. Clasificar cada fila como importada, duplicada aprobada, revisión manual o rechazada. Guardar texto original más su versión normalizada. Para PDF, agregar SHA-256, tamaño, MIME real, extracción, ruta lógica anterior y asociación verificada.

**Migrabilidad preliminar:** Jurisprudencia, media-alta para tablas que el importador ya toma, incompleta para microisis y PDFs. Digesto, indeterminada sin export de base. Copernic, no migrable desde los archivos actuales porque no hay índice ni fuente documental.
