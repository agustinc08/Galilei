# Búsqueda y visor unificados

El shell integra /busqueda, /jurisprudencia, /digesto, /corpus, /revision y /consulta, preservando rutas anteriores. La búsqueda existente federada devuelve resultados jurisprudenciales y Corpus conforme a ACL; los resultados Corpus incluyen metadatos Digesto cuando existen. No se creó todavía un adapter de texto contra el Digesto institucional independiente.

El visor Corpus muestra fuente, hash/procedencia, extracción/OCR, página, fragmento de búsqueda, documento PDF original, anterior/siguiente y relaciones curadas. Una referencia abre el visor sin duplicar archivo. Los matches se muestran en panel de contexto con salto a página. No hay resaltado dibujado sobre la capa PDF nativa ni prueba E2E de navegador con identidad real. Esas capacidades quedan pendientes de aceptación de usuarios.
