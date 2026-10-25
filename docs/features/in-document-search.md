# Búsqueda dentro de un fallo

## Alcance

La vista documental de una sentencia permite buscar una palabra o frase en el PDF abierto. La búsqueda se activa desde «Buscar dentro del fallo»; si se llega desde una búsqueda pública, el texto se propone en el campo, pero no se ejecuta sin una acción de la persona usuaria.

## Arquitectura y privacidad

- El cliente reutiliza el PDF que ya descargó mediante el endpoint autorizado de la vista documental.
- PDF.js se carga bajo demanda al abrir el panel. Lee las páginas localmente y conserva solo el texto extraído en memoria durante la vista.
- La consulta y el texto del PDF no se envían al servidor, no se persisten ni producen telemetría.
- No requiere el índice de Search, no altera su ranking ni su contrato y funciona igual con documentos públicos o con una respuesta autorizada para la persona autenticada.

## Coincidencias y navegación

La comparación ignora mayúsculas y tildes, conserva la distinción entre `ñ` y `n`, admite frases contiguas y cuenta coincidencias no superpuestas. PDF.js puede fragmentar palabras en varios elementos; el cliente usa posición y ancho para unir fragmentos, conserva separaciones entre palabras y corrige guiones de corte de línea cuando el patrón es claro. «Anterior» y «Siguiente» recorren las coincidencias con vuelta determinista; el visor navega a la página real de cada coincidencia.

No se dibuja un resaltado HTML sobre el iframe nativo: el cliente no puede mapear de forma segura los offsets extraídos a los glifos del visor embebido. Así se evita mostrar un resaltado visual falso. La búsqueda detecta PDFs sin capa de texto y presenta «No hay texto disponible para buscar dentro de este PDF.»; no hay OCR.

## Límites conocidos

- La extracción cubre texto que PDF.js puede leer. PDFs escaneados sin texto seleccionable, cifrados o dañados no se convierten mediante OCR.
- Los saltos de columna, ligaduras no estándar y guiones ambiguos pueden separar una coincidencia; las heurísticas no reescriben el documento original.
- El visor sigue usando su ruta de descarga existente y su control de acceso. Esta función no cambia ni certifica por sí sola Range, descarga ni autorización del endpoint.

## Verificación

Incluye pruebas de normalización, `ñ`, frases entre fragmentos, espacios por geometría, guionado, conteo, PDF sin texto y navegación en PDF sintético de 2 y 50 páginas. E2E corre con una API totalmente simulada y no modifica PostgreSQL ni OpenSearch.
