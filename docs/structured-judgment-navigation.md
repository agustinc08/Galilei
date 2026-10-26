# Navegación estructural de fallos

## Comportamiento

Los visores presentan «Contenido del fallo» cuando el parser determinístico reconoce encabezados suficientes. Un botón de sección lleva al índice PDF de su página inicial. Los títulos se tratan como datos de navegación, no como una calificación jurídica. Si el texto está incompleto, el API devuelve estado parcial; si no hay título confiable, no se inventa uno.

`argentine-civil-structure-v1` reconoce Vistos, Resulta/Resultando, Considerando, Resolución/Fallo/Parte dispositiva y encabezados numerados romanos, arábigos y ordinales sólo cuando pasan reglas de mayúsculas y formato. `VISTOS Y CONSIDERANDO` conserva esa etiqueta combinada.

## Fuente y páginas

La página es el índice PDF 1-based correspondiente al texto extraído por la última extracción GENERAL. Para el visor de sentencia, la fuente se acepta sólo cuando es el mismo PDF físico que `ArchivoPdf`; una extracción ausente, ambigua o distinta falla cerrada. Las secciones se calculan al consultar y no se guardan como metadatos persistentes.

El `pageEnd` es inclusivo y sólo se asigna si el rango es continuo y está presente. Si no puede demostrarse un límite, se devuelve `null`. Las páginas no equivalen necesariamente a la numeración impresa dentro del fallo.

El parser acepta hasta 10.000 páginas, página 1–100.000, 1.000.000 caracteres por página y 10.000.000 caracteres en total; fuera de esos límites devuelve estructura vacía. El cálculo de rangos no itera sobre huecos arbitrariamente grandes.

## Superficies

- Visor público de sentencia: `GET /api/public/sentencias/:slug/estructura`.
- Visor interno de sentencia: `GET /api/sentencias/:id/estructura`.
- Corpus: `GET /api/corpus/documents/:id/structure`.
- Espacios: `GET /api/workspaces/:workspaceId/documents/:id/structure`.
- Documentos personales: `GET /api/personal/documents/:id/structure`.
- Los visores de espacios y documentos personales reutilizan la misma verificación de visibilidad/ACL del archivo y sus páginas. La estructura no hace público un documento privado.

Las rutas públicas usan el slug; las internas requieren la autorización habitual del backend. No se añade un endpoint público basado en un ID de documento privado.

## Auditoría observada

La muestra de 200 fallos produjo 78 encabezados en 35 documentos; los 78 se comprobaron contra la página fuente. Otros 165 documentos no recibieron esquema. No se presenta ese último grupo como «fallos sin secciones» ni se afirma cobertura total. Ver [investigación de patrones](research/judgment-structure-patterns.md).
