# 12 — Auditoría de PDFs, checksums y referencias

## Método y límites

Se calcularon SHA-256 en streaming para los PDFs sueltos del paquete y los directorios PDF locales modernos. En el ZIP anidado consulta.zip se listaron sus miembros y se calcularon hashes de los miembros PDF con zipfile, sin extraer el ZIP ni ejecutar contenido. No se abrió visualmente ni se extrajo texto de los PDFs. Los duplicados se definen por contenido SHA-256, no por nombre.

El paquete original y los árboles de aplicación no se modificaron. La base SQLite de referencia se leyó en modo inmutable. La base PostgreSQL destino y su modelo ArchivoPdf no están disponibles en el workspace, así que no se puede certificar orfandad contra el destino final.

## Recuento y duplicados por ubicación

| Ubicación | Archivos PDF | Bytes | Hashes únicos | Copias redundantes |
|---|---:|---:|---:|---:|
| Legacy consulta/PDF | 1.171 | 304.660.152 | 1.167 | 4 |
| Legacy jurisp_6/PDF | 270 | 57.207.373 | 237 | 33 |
| PDF sueltos fuera de esas dos carpetas | 2 | 635.970 | sin clasificación jurídica por ubicación | — |
| Total PDFs con extensión en el 7z | 1.443 | — | — | — |
| consulta.zip, miembros PDF | 1.172 | 304.978.137 descomprimidos | 1.168 | 4 |
| Moderno back/data | 10.639 | 2.102.111.083 | 10.556 | 83 |
| Moderno back/uploads | 11.747 | 2.402.132.093 | 10.389 | 1.358 |
| Moderno data + uploads | 22.386 | 4.504.243.176 | 10.731 | 11.655 |

En los 1.441 archivos de las dos carpetas judiciales legacy hay 1.404 contenidos únicos y 37 copias extra. Los 1.404 hashes únicos están presentes también en los directorios modernos data/uploads. consulta.zip vuelve a contener los 1.167 contenidos únicos de consulta/PDF; es una copia redundante empaquetada, no 1.172 contenidos únicos. Las dos carpetas legacy no comparten hash entre sí.

En los dos directorios modernos hay 10.214 hashes únicos compartidos entre data y uploads; el total combinado de 10.731 hashes únicos no debe sumarse como si fueran archivos distintos por sistema. Los resultados describen el árbol local, no qué binarios están asociados/publicados en producción.

## Referencias legacy verificables

| Revisión | Resultado |
|---|---|
| PDFs numéricos en consulta/PDF | 1.170 |
| IDs de esos PDFs hallados en tb_sentencias del snapshot raíz | 1.170 |
| IDs con fallo_completo=1 | 1.170 |
| Prefijo/carpeta del nombre acorde a ruta construida por el cliente | 1.170 |
| Filas marcadas fallo_completo=1 sin archivo local bajo consulta/PDF | 6.951, de las cuales 6.938 están activas |

Los 6.951 son ausencia local en ese snapshot/carpeta, no huérfanos definitivos: los binarios legacy únicos aparecen en el árbol moderno y pueden existir otros almacenes o referencias. La carpeta jurisp_6/PDF tiene 270 archivos; 268 IDs numéricos coinciden con sentencia marcada con PDF en el snapshot raíz y 2 no. La aplicación principal apunta a consulta/PDF, y no se probó que jurisp_6/PDF esté cableada en producción. Por eso se clasifica como colección histórica/candidata pendiente de cotejo, no como 270 archivos huérfanos.

## Referencias modernas con SQLite local

back/data tiene 10.638 nombres de ID numérico únicos y un nombre no numérico. Los 10.638 IDs se encuentran en tb_sentencias de la SQLite moderna; 10.624 tienen fallo_completo=1 y 14 no. La SQLite marca 10.860 filas con fallo_completo=1; 236 no tienen un PDF de nombre numérico en ese directorio (230 sentencias activas).

Estos casos necesitan cotejo con las relaciones modernas de archivos PDF, almacenamiento uploads, y base PostgreSQL real antes de decidir si hay PDF faltante o bandera obsoleta. La ruta uploads utiliza nombres no numéricos y no permite inferir ID de sentencia a partir del nombre.

## Conclusiones de conciliación

- Hay duplicación por bytes tanto en el paquete como en los directorios modernos; la deduplicación debe usar checksum y mantener todas las referencias de origen.
- Hash igual prueba igualdad binaria, no identidad jurídica ni que un vínculo de base sea correcto.
- El cotejo de destino debe unir ID de sentencia, asociación en ArchivoPdf, ruta válida y checksum; además debe considerar archivos almacenados con nombre aleatorio.
- Para una migración, registrar hash, tamaño, origen, ID fuente, ubicación, relación, estado de publicación y resultado de reconciliación por cada archivo.
- No se puede afirmar un total de PDFs huérfanos/rotos en producción sin snapshot de las relaciones ArchivoPdf y del almacenamiento persistente.

## Adenda de Misión 3 — modelo Prisma y límite de verificación

La inspección estática del esquema Prisma moderno define `ArchivoPdf.sentenciaId` como entero obligatorio y una relación a `Sentencia` con `onDelete: Cascade`. También define `legacyId`, `nombreArchivo`, `nombreOriginal`, `rutaArchivo`, `legacyPath`, `mimeType` y `tamanioBytes`, con índices en `sentenciaId`, `legacyId` y `legacyPath`. El esquema inspeccionado no declara unicidad para esos identificadores/rutas ni un campo de checksum.

Esto documenta el diseño del modelo, no el estado de la base desplegada. No se consultó PostgreSQL: no hay instancia/dump cuya procedencia no productiva esté demostrada. Por tanto, siguen sin verificarse población, asociaciones, rutas existentes, duplicados en el destino y relaciones huérfanas. Los 1.404 hashes legacy encontrados en el árbol local moderno prueban presencia binaria local, no asociación correcta ni disponibilidad en producción. Para cerrar el cotejo hace falta un snapshot autorizado de `ArchivoPdf` y `Sentencia`, más un manifiesto del almacenamiento persistente; unir por nombre solamente no es suficiente.
