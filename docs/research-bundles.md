# Dossiers de investigación

Galilei permite descargar una colección propia como un ZIP autocontenido de metadatos y notas. La operación autenticada es `POST /api/research/collections/:id/export`; el cuerpo no acepta rutas ni opciones de inclusión de archivos. El ZIP usa `galilei-research-bundle/1` y limita cada exportación a 1.000 referencias.

## Contenido y reproducibilidad

El paquete incluye `INDEX.html`, `README.md`, `collection.json`, `manifest.json` y, por cada fallo disponible, `metadata.json`, `referencia.txt`, `fuente.json` y una `notas.md` opcional. El orden es estable por posición de agregado (`createdAt`, luego ID); los paths se forman con IDs numéricos, nunca con nombres o textos proporcionados por usuarios. Los archivos JSON tienen serialización estable y el manifiesto contiene SHA-256 UTF-8 de todos los demás archivos del paquete. El propio manifiesto se excluye de su mapa de hashes.

`generatedAt` y `bundleId` cambian en cada descarga. El SHA de Git sólo aparece si el proceso recibe `GIT_SHA` con 40 caracteres hexadecimales. No se inventa una versión. No existe una relación persistida colección→búsqueda, por eso no se exporta un origen de búsqueda.

## Acceso y datos

El servicio resuelve la colección junto con `usuarioId`; a otra cuenta responde como no encontrada. En el momento de exportar vuelve a seleccionar únicamente sentencias publicadas y activas. Los elementos que ya no están disponibles se omiten y se informa un conteo agregado, sin revelar sus IDs ni metadatos. Una nota pertenece a la referencia privada de esa colección y sólo sale en el dossier que exporta su propietario. El HTML escapa todos los textos, no ejecuta scripts ni carga recursos externos; Markdown presenta la nota como bloque literal. No se copian PDFs ni se leen archivos del filesystem.

El `AuditLog` guarda propietario, colección, ID de bundle, fecha y conteos. No guarda notas, ZIP, archivos ni credenciales. La descarga es privada y `no-store`.

## Pruebas

El backend valida autorización por propietario, sentencias no disponibles, nota privada, orden, paths, nombres maliciosos, escapes HTML, hashes SHA-256 y CRC del ZIP. El E2E Playwright de investigación valida la descarga y sus estados de interfaz sin servidor API; la inspección programática del ZIP se ejecuta en el unit test del generador.

Comandos: `pnpm --filter back run test` y `pnpm --filter front run test:e2e:research`.
