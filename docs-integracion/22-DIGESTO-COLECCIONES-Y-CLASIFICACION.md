# 22 — Digesto, colecciones y clasificación

## Modelo funcional

Digesto es un dominio de documentos administrativos y conocimiento compartido, no una carpeta universal ni una colección de fallos. Debe permitir encontrar documentos por texto y metadata, organizarlos por temas y colecciones, y mostrar su procedencia y dependencia cuando corresponda.

Propuesta inicial: mantener Documento, Colección, Tema y Etiqueta como conceptos diferenciados. Una colección reúne documentos; un documento puede pertenecer a más de una colección si el flujo lo requiere. Los temas representan clasificación temática controlada y las etiquetas permiten descriptores flexibles. Guardar autoría y fecha de cambios.

Añadir Carpeta sólo si entrevistas y prototipos confirman una jerarquía dentro de colecciones que resuelve un uso real que no cubren colecciones, temas, etiquetas y filtros. No reproducir un explorador de archivos ni usar la ubicación de un archivo como única taxonomía.

## Asistente de clasificación

Una futura función de IA puede sugerir tema, etiquetas, resumen o colección. Cada sugerencia debe persistir como propuesta con versión del modelo, fecha, entradas consideradas y explicación o nivel de confianza cuando sea útil. Una persona autorizada revisa, acepta, corrige o rechaza. La sugerencia no publica, cambia ACL ni transforma una clasificación pendiente en aprobada.

## Pipeline futuro inspirado en la detección rápida de Copernic

1. Detectar documento incorporado por un mecanismo autorizado.
2. Calcular checksum y verificar duplicados.
3. Registrar procedencia y metadatos originales.
4. Extraer texto y registrar herramienta/versión y posibles errores.
5. Proponer clasificación.
6. Solicitar revisión humana según las reglas del dominio.
7. Indexar versión aprobada y registrar versión del índice.
8. Hacer el documento recuperable sólo para usuarios autorizados.
9. Reindexar de forma idempotente al cambiar contenido, extractor, ACL o taxonomía.

No implementar ahora un watcher de filesystem. La futura ingesta debe usar eventos o una cola controlada, tener reintentos e idempotencia, y evitar indexar rutas compartidas antes de verificar permisos.

## Resultado global de búsqueda

Conservar un núcleo común de resultado: dominio, sistema fuente, tipo, ID de origen, título, subtítulo, texto indexable, fecha y metadata común/específica. El resultado de Digesto puede añadir colección, temas y dependencia; Jurisprudencia puede añadir órgano, instancia y sala opcional. No forzar campos de Jurisprudencia en documentos de Digesto.

SearchDocument es una proyección de lectura/versionada que admite reconstrucción a partir de las fuentes de verdad. ACL debe aplicarse antes de obtener puntuación, snippets, facets, conteos o vistas previas.

## Límites de esta misión

No se conectó Digesto remoto, no se modificó su base ni su schema, no se importaron documentos y no se integró IA, OCR global, watcher o indexador. La taxonomía y permisos concretos necesitan validación con usuarios del módulo.
