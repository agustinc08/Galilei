# 13 — Diseño objetivo: Buscador Jurídico Civil

## Objetivo de producto

Construir una experiencia de búsqueda jurídica civil que reúna jurisprudencia y documentos del Digesto con una consulta clara, filtros útiles, resultados trazables y permisos correctos. La pantalla puede ser común; las entidades, autoridades de publicación y reglas de acceso siguen siendo propias de cada dominio.

El buscador moderno de Jurisprudencia es una base funcional valiosa. Este análisis no propone reescribirlo ni convertir los datos en una tabla genérica. Propone incorporar la semántica que falta del legado, integrar fuentes mediante adaptadores y materializar una proyección de búsqueda auditable.

## Componentes

| Componente | Función |
|---|---|
| Interfaz común | Caja de búsqueda, sugerencias, filtros, selector/facetas de fuente, resultados con contexto y acceso a documento |
| API de búsqueda | Parser/versionado de consulta, autorización antes de recuperar/snippetar, filtros y paginación |
| Dominio Jurisprudencia | Sentencia, sumarios, publicación, anonimización, referencias y PDFs |
| Dominio Digesto | Documento, tipo, voz, dependencia, jerarquía y estado; reglas propias |
| Adaptadores de origen | Lectura de snapshots y sistemas autorizados; conservan IDs/campos fuente |
| Staging y ledger | Snapshot inmutable, conteos, hashes, errores, decisión de enlace y reconciliación |
| Proyección de búsqueda | Documento indexable común con fuente, tipo, ID original, campos, texto, filtros y ACL |
| Servicio de archivos | Asociación segura a PDF, ubicación persistente, checksum, versión y autorización |

La proyección de búsqueda es un read model; no reemplaza las tablas de dominio ni decide la fuente de verdad. Un documento del Digesto y un sumario de jurisprudencia pueden aparecer juntos en resultados, pero se mantienen distintos en detalle, publicación y permisos.

## Tratamiento de MicroISIS

Antes de cargar tb_microisis a modelos productivos:

1. Preservar la tabla cruda y el snapshot de origen con hash, fecha, nombre de base e IDs.
2. El XLS campos_explicados.xls ya fue leído y transcrito; validar la numeración y códigos de tipo_registro con documentación institucional y contrastar mappings por tipo.
3. No atribuir significado jurídico a dummy, local, resultado o los códigos S/C sin fuente institucional.
4. Mantener referencias_normativas, contradictorios, asociados y anulaciones en campos originales hasta acordar transformación.
5. Crear relaciones con sentencias/sumarios solo por claves aprobadas. Las coincidencias por texto de esta auditoría son candidatos, no enlaces definitivos.
6. Guardar estrategia, confianza, evidencia y resolución manual en el ledger de migración.
7. Publicar campos indexables solo después de aplicar la política de acceso y estado.

La tabla tiene 52.375 filas en el snapshot raíz y replica exactamente las filas de la SQLite moderna local. No participa en el importador Prisma visible. Por tanto, el primer trabajo de integración es resolver semántica y destino de importación, no diseñar una pantalla que presuponga que esos datos ya están cargados.

## Contrato de búsqueda que conviene acordar

Definir una gramática explícita y estable para todo el producto:

- palabras incluidas en conjunción por defecto;
- operadores visibles AND, OR y NOT con precedencia documentada;
- frases exactas con comillas;
- sintaxis de campos con lista controlada;
- decisión expresa sobre compatibilidad con +, *, - y % históricos;
- comportamiento de acentos, ñ, palabras cortas, números, artículos y referencias normativas;
- ranking transparente con priorización de número/expediente/artículo exacto y score textual separado de bonos semánticos;
- paginación por API y orden estable para no perder resultados;
- resaltado/snippet que cite el campo que produjo coincidencia;
- equivalencias de consulta mostradas si se transforma sintaxis legacy.

No conviene interpretar * como comodín: en el legado significa AND. El % legacy permite parcial al inicio/final y hoy no se demuestra en el parser moderno. La interfaz puede guiar la sintaxis, pero las consultas copiadas desde el legado necesitan compatibilidad o un mensaje de traducción visible. El parser debería quedar versionado y tener casos de oro aprobados por especialistas antes de reemplazar la consulta histórica.

## Seguridad y calidad del resultado

Aplicar filtros de publicación y estado en servidor, separados por contexto: público, consulta interna y administración. En búsqueda pública, excluir borradores/no publicados tanto en búsqueda, sugerencias, snippets, facetas, preview como en descarga. Los hallazgos estáticos del PHP hacen especialmente importante verificar que cada ruta pública exige publicación, no solo estado activo.

Usar parámetros SQL/ORM, escape contextual de salida, permisos por acción, validación de PDF y acceso controlado al servicio de archivos. Los snippets y campos indexados deben respetar anonimización/ACL. El índice no debe ser una vía lateral hacia contenido no visible por página de detalle.

## Secuencia recomendada

| Fase | Trabajo | Salida comprobable |
|---|---|---|
| 1. Contrato | Validar gramática, filtros, orden, publicación y vocabulario con usuarios | Especificación de búsqueda y consultas de oro |
| 2. Datos | Obtener XLS legible/export validado, decodificar códigos, staging y conciliación | Diccionario aprobado, ledger y mapa de relaciones |
| 3. Seguridad | Confirmar publicación y ACL en API, snippets y archivos | Matriz de rutas/roles y hallazgos corregidos |
| 4. Índice | Definir proyección y adaptadores por fuente | Resultados comunes con IDs trazables |
| 5. Evaluación | Medir recall, precisión, latencia y experiencia en corpus reconciliado | Decisión documentada de motor/índices |
| 6. Transición | Operar paralelo y reconciliar diferencias antes de retirar legado | Criterios de corte y reversión aprobados |

La recomendación es avanzar con un buscador común por etapas y mantener contextos separados. No activar una carga irreversible ni retirar bases legacy hasta confirmar cobertura de filas, relaciones y PDFs mediante ledger.

## Adenda de Misión 3 — contrato medido y estado de entradas

El libro XLS legible se transcribió en [15-TRANSCRIPCION-CAMPOS-EXPLICADOS.md](15-TRANSCRIPCION-CAMPOS-EXPLICADOS.md) y [diccionario-microisis.json](diccionario-microisis.json). Su lista 0–28 coincide con los 29 campos de texto, pero la columna numérica no tiene encabezado y aparecen posibles conflictos en los códigos 7 y 27 entre fragmentos. La transcripción cierra la lectura del archivo; la aprobación del significado y de las relaciones sigue pendiente.

El benchmark de 55 casos en [14-BENCHMARK-BUSQUEDA.md](14-BENCHMARK-BUSQUEDA.md) muestra que el legacy distingue `ñ` de `n`, aplica precedencia AND antes de OR y permite búsquedas por prefijo/sufijo con `%`. También expone una discrepancia estática: el parser moderno reconoce OR, pero el filtro candidato combina términos mediante un parámetro de operador aparte, que la UI inicia en AND. La especificación objetivo y su tabla de traducción están en [16-CIERRE-AUDITORIA-GO-NO-GO.md](16-CIERRE-AUDITORIA-GO-NO-GO.md); requieren casos de oro aprobados antes de adoptar una caja común.

Estado de la decisión: **NO-GO para MVP integrado con datos reales ahora; GO para un spike no productivo de solo lectura**. No se consultó PostgreSQL porque el servicio local no estaba escuchando y la configuración remota de Digesto no se pudo certificar como no productiva. La relación `ArchivoPdf` está descrita estáticamente; sus filas reales y su correspondencia con archivos no están verificadas.
