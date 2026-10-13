# 04 — Análisis de Copernic: qué preservar

## Evidencia local

La carpeta tiene seis instaladores ejecutables con firmas válidas y metadatos de Copernic Desktop Search 2.0, 3.7, 7.0 y 7.2.0.14055. No contiene código fuente, aplicación instalada, índice, archivos de configuración, base de Copernic, lista de documentos indexados ni consultas guardadas. No se ejecutó software.

## Funciones descritas por el fabricante

La [guía oficial CDS7](https://copernic.com/wp-content/uploads/2021/05/CDS7_quick_start_guide.pdf) describe caja de consulta, categorías, resultados por contenido/nombre/fecha/tamaño, búsqueda por prefijo, AND implícito, OR, NOT, frase exacta, NEAR (puede requerir extensión) y comodines. Describe refinamientos, vista previa sin abrir el original, resaltado de coincidencias y apertura de archivo/carpeta. La página oficial de [características](https://copernic.com/en/desktop/features/) también describe operadores y refinamiento.

Esto documenta la familia de producto, no la instalación de Poder Judicial ni qué usan o aprecian sus usuarios. El producto puede buscar archivos y otras fuentes locales; hay que preguntar si el Copernic institucional indexa solo corpus jurídico o también carpetas de red, correo, adjuntos y fuentes personales.

## ¿Por qué los usuarios podrían valorarlo?

No se puede afirmar sin observarlos. Hipótesis comprobables: velocidad, una caja para varias categorías, operadores potentes, filtros inmediatos, resultados al escribir, preview con resaltado y acceso al original sin abrir archivos irrelevantes. No atribuir historial, consultas guardadas o ranking concreto sin evidencia.

## Reutilización

| Categoría | Conclusión |
|---|---|
| Código | No hay código fuente que se pueda integrar. Los instaladores son propietarios. |
| Datos | No hay índice, preferencias o exportación; no hay corpus Copernic a migrar en esta carpeta. |
| Lógica | Reproducir búsqueda incremental, consulta booleana, filtros, relevancia, preview y estado de indexación. |
| Comportamiento | Parcialmente documentado; falta configuración local y observación de usuarios. |
| UX a imitar | Caja inmediata, categorías visibles, facetas/refinamiento sin reiniciar, snippets/preview, resaltado, abrir el original y visibilidad de actualización. |
| Reemplazar | Aplicación de escritorio, instalador, motor e índice propietario, conectores no autorizados. |

## ¿Podemos construir un Copernic moderno?

**Sí, con condiciones.** Podemos recrear en el portal una búsqueda útil sobre las fuentes institucionales autorizadas; el parser, ranking, normalización y sugerencias de Jurisprudencia son una base parcial. No es conversión del ejecutable ni importación del índice.

Condiciones: observar usuarios; fijar requisitos de búsqueda y fuentes; implementar roles por documento; validar ranking y latencia con consultas reales; y decidir si hace falta OCR. No replicar correo o carpetas personales sin autorización/alcance y ACL equivalentes.

### “Copernic 2026” propuesto

Una aplicación web con una sola caja; resultados por Sentencias, Sumarios y Documentos; filtros que conservan la consulta; número/carátula/fecha visibles; snippet resaltado; preview/abertura segura del PDF; y fecha/estado del indexador. La indexación guarda fuente y clave de origen, ACL y errores.

Hacer 5–8 entrevistas/observaciones, registrar consultas y pasos con autorización institucional y medir cuánto tardan en recuperar el mismo documento antes/después.
