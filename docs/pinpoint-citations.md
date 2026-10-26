# Citas con página

## Cita canónica

El visor conserva una única función de formato: `formatCitation`. El botón «Copiar cita con página» obtiene la referencia normalizada del backend y agrega la página actual cuando el número de página del PDF está cargado y dentro de sus límites. El botón «Copiar enlace a esta página» copia la URL canónica actual con `?page=N`; los otros parámetros de la URL se conservan.

El formato `p. N` significa **página N del archivo PDF**, contada desde 1. No significa folio impreso, página editorial o número que figure dentro del fallo. Si esos números difieren, la interfaz no los equipara.

Antes de devolver una cita con página, el backend comprueba que la página esté en la extracción de Corpus `GENERAL` ligada al mismo archivo físico del visor. La URL pública de cita devuelve 400 cuando la página no puede mapearse al PDF. Una página válida en otro PDF o una página fuera de rango no basta.

La ruta pública de documento admite apertura directa en una página y usa el slug público. Las rutas privadas requieren sesión y autorización; el deep link no concede acceso.

## Pasaje

El formatter de dominio puede formar `citaConFragmento` para un pasaje fuente de hasta 500 caracteres. `pdf-text-search` mantiene offsets UTF-16 sobre el texto realmente extraído por PDF.js y devuelve el recorte de origen exacto, incluyendo espacios originales. Las tildes se pliegan para buscar, `ñ` continúa distinta de `n`.

En esta iteración el visor ofrece copia de cita con página y enlace de página; no expone una acción «Copiar fragmento + cita». Así no presenta una selección visual del layer PDF como texto fuente confirmado. El clipboard no se persiste en servidor.

## Metadatos

El formatter omite metadatos vacíos, elimina puntuación final duplicada y no imprime `undefined`/`null`. Si no hay carátula, usa «Sentencia sin caratula». Las pruebas cubren metadatos completos y ausentes. Cuando no hay página fiable, el visor no muestra la acción de cita con página.
