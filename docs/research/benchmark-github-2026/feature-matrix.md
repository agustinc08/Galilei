# Matriz de capacidades

**Sí:** confirmado en documentación/superficie inspeccionada. **Parcial:** existe con límites. **No observado:** no se encontró evidencia suficiente. No es una auditoría de instancias.

| Sistema | Búsqueda | Guardado/alertas | Citas/relaciones | Documentos/OCR | Procedencia/calidad | ACL/privacidad |
|---|---|---|---|---|---|---|
| Galilei | Sí: búsqueda léxica, filtros, orden, páginas | Parcial: búsquedas guardadas internas; no desde Consulta pública | Parcial: referencias curatoriales | Sí: PDF/visor; alcance de búsqueda cambia por visor | Parcial: metadata y paneles de calidad | Sí: espacios privados con ACL |
| CourtListener | Sí, API con filtros | Sí, alertas documentadas | Sí, cites/cited-by | Opiniones y documentos | API y registros | Depende de fuente/cuenta |
| OpenCaseLaw | Sí | Parcial, herramientas reproducibles | Sí, grafo y citas pendientes | Parcial | Sí, método de conteo explícito | Fuentes/licencias declaradas |
| legal-rag (RN) | Híbrida declarada y metadatos | No confirmado | Citas verificadas en generación | Texto/chunks | Métricas autodeclaradas | Producto multiusuario no probado |
| RAG_CSJN_AI_ENG | RAG temático | No confirmado | Verificador textual acotado | Evidencia recuperada | Parcial | Demo |
| eyecite | Biblioteca, no UI | No | Sí, extracción/normalización | Anotación de texto | Conserva contexto | Local |
| mcp-legal-ar | Conectores, no motor único | No confirmado | Herramientas delegadas | Depende de fuente | Fuente por conector | Local declarado; licencia restrictiva |
| Paperless-ngx | Texto/campos/booleanos | Sí, vistas guardadas | No citador | OCR y gestión | Historial/metadatos | Gestión de permisos |
| Docspell | Texto y metadatos | Parcial | Relaciones entre archivos | OCR | Parcial | Self-hosted |
| Mayan EDMS | Texto y campos | Favoritos | Comentarios/enlaces | DMS/versiones | Auditoría y versiones | ACL granular |
| Zotero | Búsqueda avanzada | Sí, búsqueda dinámica y colecciones | Referencias bibliográficas | PDF/anotaciones | Biblioteca rastreable | Local-first y sync opcional |
| DSpace | Texto/facetas/scopes | Parcial | No citador legal | Repositorio | Metadata institucional | Niveles de acceso |
| InvenioRDM | OpenSearch y facetas | Parcial | Relaciones de registros | Archivos | Versiones y comunidad | Acceso/propiedad |
| Omeka S | Metadata de objetos | No observado | Relaciones de objetos | Medios | Parcial | Visibilidad |
| OpenSearch | Motor y agregaciones | No producto | No producto | Indexa texto | Infraestructura | Depende del despliegue |
| Haystack | Pipelines/retrievers | No producto | Nodos/fuentes | Conectores | Depende del pipeline | Depende de la app |
| Tika | No | No | No | Extracción MIME/texto | Metadata | N/A |
| OCRmyPDF/Tesseract | No | No | No | OCR | Calidad externa al motor | N/A |

## Galilei: verificación de producto local

- **Consulta:** formulario con campos y filtros (tribunal/Sala, fechas, expediente, tipo, partes, magistrados, frase exacta, exclusión y operador), orden, paginación, chips, URL y highlights. Tarjeta con metadata y estado PDF. Impresión por selección. En la pantalla pública inspeccionada, guardar y exportar están desactivados.
- **Guardados y favoritos:** existen pantallas para ambos, pero no se verificó que la búsqueda guardada restaure el estado íntegro de Consulta pública. La UI revisada para guardados usa JSON y ruta interna; favoritos es una lista, no una biblioteca anotada.
- **Fallos y referencias:** vista de fallo conserva la consulta y ofrece links y referencias editoriales. Relaciones curatoriales no equivalen a citación automática.
- **Visor:** PDF público pasa la consulta al fragmento de búsqueda nativo. No atribuir a ese visor la navegación encontrada en el visor del corpus.
- **Estadísticas:** existe panel de uso/calidad; no se afirma que registre texto libre de consultas.
- **Espacios:** personales, compartidos y restringidos; la evidencia previa del producto documenta controles fail-closed para búsqueda, conteos, metadata, vista y descarga. Nuevas colecciones, alertas, exportaciones y facets deben heredar el mismo límite.

## Ficheros revisados

client/src/components/consulta/ConsultaPublicaScreen.tsx; client/src/components/busqueda/BusquedaJurisprudenciaForm.tsx; client/src/components/consulta/ConsultaResultadoCard.tsx; client/src/components/consulta/SearchHelpModal.tsx; client/src/components/public/FalloPublicoViewer.tsx; client/src/components/documento/PdfViewer.tsx; client/src/components/documento/DocumentoCitasSection.tsx; client/src/components/documento/DocumentoReferenciasSection.tsx; client/src/app/(admin)/busquedas-guardadas/page.tsx; docs/uat/product-surface-inventory.json; docs/uat/guia-prueba-usuarios.md.