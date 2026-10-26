# Patrones de estructura observados en fallos civiles

## Método

Se tomó una muestra determinística estratificada por año y Sala de 200 fallos civiles publicados y activos, asociados a su última extracción `GENERAL` de Corpus. La consulta corrió contra PostgreSQL 16.15 en `127.0.0.1:55432`, base `buscador_juridico_civil_dev`, dentro de una transacción `REPEATABLE READ READ ONLY` que terminó con `ROLLBACK`. Los 200 documentos eran PDF con texto extraído; la muestra reúne 3.350 páginas. El extractor de Corpus reportó `TEXT_EXTRACTED` en los 200.

La muestra cubrió 2008, 2013, 2015–2023 y 2025; hubo 40 registros sin Sala normalizada y variantes como `C`, `Sala C` y letras sueltas. Es una muestra de investigación del proyecto, no una estimación estadística de cobertura para cada año o Sala.

## Formas observadas

- `AUTOS Y VISTOS:` y `VISTOS Y CONSIDERANDO:` aparecen como encabezados en la primera página. El encabezado combinado conserva la etiqueta visible «Vistos y Considerando».
- Hay encabezados numerados romanos con punto o guion, por ejemplo `II.- SOBRE LA RESPONSABILIDAD`, `III. RUBROS INDEMNIZATORIOS` y `IV.1.- INCAPACIDAD SOBREVINIENTE`.
- También aparecen apartados arábigos y jerárquicos, como `2. DAÑO MORAL` y `III. 1.INCAPACIDAD SOBREVINIENTE`.
- Los títulos suelen estar en mayúsculas; a veces incluyen dos puntos, punto, guion, barras, tildes o un título largo.
- `RESUELVE:` se observó una vez en el subconjunto con estructura detectada. No se encontró un encabezado aislado `CONSIDERANDO:` en esta muestra.
- Hay fallos de una y varias decenas de páginas, junto con resoluciones breves. El texto extraído puede incluir encabezados repetidos, firmas, sellos y errores de OCR; esos fragmentos no se toman automáticamente como estructura.

## Resultado del detector

En los 200 fallos se emitieron 78 secciones en 35 documentos: 22 `VISTOS`, 55 apartados `NUMBERED_SECTION` y 1 `RESUELVE`. Se revisaron las 78 etiquetas contra el texto de su página fuente: las 78 correspondían a encabezados reales; no se observaron falsos títulos mayores en este conjunto.

En 165 documentos no se emitió esquema. Eso significa «sin encabezado que el detector acepte», no que el fallo carezca de estructura. La cobertura observada fue 35/200 (17,5%); prima precisión navegacional sobre cobertura.

## Reglas y semántica de página

El parser `argentine-civil-structure-v1` acepta encabezados en mayúsculas completos y títulos numerados que pasan reglas conservadoras. Los números de página son índices PDF de 1 en adelante. Los offsets son UTF-16 locales a la página extraída. `pageEnd` sólo se informa cuando las páginas intermedias están presentes y su rango se puede demostrar; en extracciones incompletas o con huecos queda `null`.

El visor y la búsqueda de Corpus usan la última extracción GENERAL asociada al mismo archivo PDF físico del visor. Para sentencias, la asociación se acepta sólo si la ruta de storage de esa extracción coincide con el PDF original de `ArchivoPdf`; cero, varias o una fuente distinta hacen que la estructura no se exponga. No se persiste el resultado del parser: se calcula al consultar.

## Límites

La muestra no certifica OCR, PDF sin texto, fallos de primera instancia ni todos los formatos históricos. Los títulos partidos en varias líneas, con minúsculas o con numeración no observada quedan sin reconocer. Una sección omitida es preferible a mostrar una navegación equivocada. La cobertura no debe presentarse como representativa de toda la colección.
