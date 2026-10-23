# 06 — Estrategia de migración

## Pipeline no destructivo

~~~text
ORIGEN SOLO LECTURA
  → snapshot/export consistente, hash y conteos
STAGING INMUTABLE
  → parseo con versión de importador
NORMALIZACIÓN Y VALIDACIÓN
  → aceptado / revisión / rechazado / duplicado aprobado
DESTINO DE PRUEBA
  → comparación registros y adjuntos
VALIDACIÓN DE USUARIO Y SEGURIDAD
  → runbook, backup y rollback ensayado
~~~

No usar el importador contra una base existente como prueba: algunas opciones escriben en PostgreSQL, copian/reasocian PDFs y pueden cambiar publicación. No ejecutar seeds/migraciones sobre bases reales.

## Fuentes y dificultad

| Fuente | Evidencia | Riesgo/esfuerzo | Requisito |
|---|---|---|---|
| Jurisprudencia SQLite | 27.387 sentencias, 32.695 sumarios, 52.375 microisis | Alto por solapamiento y microisis no mapeada | Resolver fuente canónica, IDs, relaciones y campos únicos |
| PDFs Juris | 10.639 en data y 11.747 en uploads | Alto por asociaciones/posibles duplicados | SHA-256, tamaño, path, relación por ID |
| PostgreSQL Juris destino | No inspeccionado | Desconocido | Snapshot/test database y conteos autorizados |
| PostgreSQL Digesto | No hay dump local | Alto hasta obtener datos | Export consistente de test y schema |
| PDFs Digesto | 278 en server/pdfs | Medio-alto por rutas/volumen | Manifiesto y match exacto contra Doc.path |
| Copernic | Solo instaladores | Imposible estimar migración de datos | Definir fuentes y exportar configuración aprobada |

No se consultó el host remoto que usa el cliente Digesto.

## Omisión en importación Jurisprudencia

El script principal llama importadores de sentencias, sumarios y PDFs. El lector busca tb_sentencias y tb_sumarios. No hay referencia a tb_microisis en fuente de importación. Eso prueba que el importador presente no toma esas filas. No prueba que el destino no tenga datos equivalentes: PostgreSQL no se consultó.

La tabla microisis incluye referencias normativas, sumarios contradictorios/asociados, publicación, SAIJ, operador, anulaciones y observaciones. Hay que decidir destino o preservación textual para cada campo antes de declarar migración completa.

## Ledger de procedencia

Por fila: sistema/tabla/clave fuente, hash, run ID, versión del importador, fecha de captura, destino/clave, estado, transformaciones, warning/error, snapshot recuperable bajo permiso.

Por archivo: path de origen, tamaño/hash, MIME detectado, ID jurídico asociado, texto extraído y checksum, estado y motivo de rechazo. Mantener valor original y versión normalizada.

## Reconciliación demostrable

El reporte de cada tabla/lote debe contar filas fuente, leídas, válidas, creadas, existentes, duplicadas exactas/probables, revisión manual, rechazadas por motivo, relaciones huérfanas y faltantes. Para PDFs debe contar esperados, válidos, faltantes, repetidos por hash, asociados y extracción vacía.

Cada registro/archivo de origen termina con exactamente una correspondencia, una deduplicación aprobada o excepción revisada. Así se elimina la pérdida silenciosa. El script visible de validación cuenta filas destino con ID legacy y PDFs; no cubre por sí solo microisis ni prueba correspondencia de todas las filas.

## Secuencia por dominio

### Jurisprudencia

1. Crear copia inmutable de SQLite y PDFs y manifestarla.
2. Cruzar claves/campos de las tres tablas; decidir cuál fila representa entidad, sumario, índice u otra función.
3. Mapear operador, publicación, SAIJ, texto normativo, anulaciones, resultados y relaciones.
4. Probar importador en PostgreSQL desechable con datos reducidos; validar dry-run y sus conexiones antes de ejecutar.
5. Importar IDs originales; asociar archivos por referencias explícitas y hash, no nombre parecido.
6. Comparar conteos, filtros, fichas, relaciones y estado de PDF con usuarios.
7. Ensayar repetición y rollback en staging.

### Digesto

1. Obtener export de test mediante procedimiento de solo lectura.
2. Preservar Doc ID, fecha fuente, pendiente, tipo y dependencia.
3. Validar padre/hijo y dependencias; señalar huérfanos antes de integridad SQL.
4. Comparar cada PDF y texto. Registrar PDFs que no extraen texto. Evaluar OCR con muestras si corresponde.
5. No migrar password hashes/roles antiguos a la identidad nueva sin evaluación.
6. Comparar conteos fuente/destino, rutas y asociaciones antes de indexar.

### Copernic

No importar un índice propietario que no existe en el workspace. Si se identifican fuentes útiles, usar export/API/carpetas autorizadas con ACL, clave origen, responsable, actualización y revocación. No indexar correos ni directorios personales por defecto.

## Riesgos de datos

Guardar fechas originales y parseadas; TZ por acordar; fechas faltantes no se inventan. Números jurídicos son cadenas. Duplicado probable requiere aprobación, no borrado automático. Conservar acentos/nombres/rutas originales y registrar transformación reversible. La tabla con filas candidatas solapadas no se cuenta como conjuntos aditivos hasta comprobarlo.
