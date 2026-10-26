# Citas con página

## Cita canónica

El visor conserva una única función de formato: `formatCitation`. El botón «Copiar cita con página» obtiene la referencia normalizada del backend y agrega la página actual cuando el número de página del PDF está cargado y dentro de sus límites. El botón «Copiar enlace a esta página» copia la URL canónica actual con `?page=N`; los otros parámetros de la URL se conservan.

El formato `p. N` significa **página N del archivo PDF**, contada desde 1. No significa folio impreso, página editorial o número que figure dentro del fallo. Si esos números difieren, la interfaz no los equipara.

Antes de devolver una cita con página, el backend comprueba que la página esté en la extracción de Corpus `GENERAL` ligada al mismo archivo físico del visor. La URL pública de cita devuelve 400 cuando la página no puede mapearse al PDF. Una página válida en otro PDF o una página fuera de rango no basta.

La ruta pública de documento admite apertura directa en una página y usa el slug público. Las rutas privadas requieren sesión y autorización; el deep link no concede acceso.

## Pasaje

«Copiar fragmento + cita» está disponible para la coincidencia activa de la búsqueda local del PDF. `pdf-text-search` mantiene offsets UTF-16 sobre el texto realmente extraído por PDF.js y devuelve el recorte exacto de origen; las tildes se pliegan para buscar, `ñ` continúa distinta de `n`. La acción exige una coincidencia en la página actual y usa la cita de página canónica del backend; el pasaje se limita a 500 caracteres y se mantiene en el dispositivo. No se envían el texto ni la consulta al servidor, ni se persiste el clipboard.

El helper local sólo encierra el fragmento fuente entre comillas y agrega la cita de página que devolvió el formatter canónico; no genera metadatos de tribunal, Sala, fecha o expediente. Las selecciones visuales arbitrarias del layer PDF no se copian.

## Metadatos

El formatter omite metadatos vacíos, elimina puntuación final duplicada y no imprime `undefined`/`null`. Si no hay carátula, usa «Sentencia sin caratula». Las pruebas cubren metadatos completos y ausentes. Cuando no hay página fiable, el visor no muestra la acción de cita con página.
