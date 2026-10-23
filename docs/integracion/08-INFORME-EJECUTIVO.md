# 08 — Informe ejecutivo

## ¿Qué tenemos y qué hace cada sistema?

**Jurisprudencia** ya es una aplicación moderna sustancial para sentencias, sumarios, publicación, búsqueda, PDF, referencias, backoffice y auditoría. Usa NestJS/TypeScript, Next/React, Prisma y PostgreSQL.

**Digesto** administra y busca documentos asociados a PDF con número, fecha, voz, tipo, dependencia, estado pendiente y relaciones. El código no demuestra que mantenga leyes, artículos o vigencia normativa.

**Copernic** está representado por instaladores de Desktop Search 2, 3.7, 7.0 y 7.2. No hay fuente, índice ni configuración del Poder Judicial. La guía del fabricante describe búsqueda de texto, operadores, refinamiento, preview y resaltado, pero aún no se conoce qué valoran los usuarios locales.

## ¿Se pueden unir? ¿Conviene?

**Sí, con condiciones.** Conviene que una sola interfaz permita buscar en distintas fuentes y conservar resultados diferenciados. Se deben mantener dominios y reglas de acceso separados; no convertir todos los registros en una tabla genérica.

Recomendamos un frontend Next común y backend Nest modular; Jurisprudencia, Digesto, documentos, identidad, Search y auditoría con límites explícitos. Crear proyección de lectura con fuente e ID original. PostgreSQL es suficiente para el primer buscador; medir antes de sumar otro motor. Usar portal read-only como etapa puente.

## ¿Qué conservar y qué reemplazar?

Conservar el modelo y los módulos modernos de Jurisprudencia, completar importación y endurecer seguridad. Preservar en Digesto el flujo de voz, dependencia, tipo, pendiente y jerarquía; reconstruir autorización, integridad y almacenamiento. Recrear comportamientos Copernic útiles. No hay código o datos Copernic que integrar desde estos archivos.

## Riesgos, éxito y esfuerzo

Riesgo actual **ALTO**. El importador de Jurisprudencia no menciona tb_microisis, que tiene 52.375 filas. La API Digesto no muestra autorización de servidor. No hay export de su base en el workspace. No se conocen el índice ni el workflow real de Copernic. No se inspeccionaron datos reales PostgreSQL.

Estimaciones de planificación revisadas en Misión 3; no son probabilidades estadísticas ni garantías:

- Entregar un MVP integrado read-only una vez cumplidos los gates: **80 %** (rango 70–85 %).
- Reconciliar binarios y asociaciones PDF contra el destino real: **70 %** (60–80 %).
- Mapear MicroISIS completo a entidades jurídicas confiables: **58 %** (45–65 %).
- Recrear funciones útiles de Copernic: **72 %** (60–80 %).
- Aceptación de la experiencia por usuarios: **62 %** (55–70 %).
- Esfuerzo: **19–31 persona-semanas** para el MVP definido; **48–90** para unificación/migración/reemplazo gradual. El detalle y las condiciones están en [16-CIERRE-AUDITORIA-GO-NO-GO.md](16-CIERRE-AUDITORIA-GO-NO-GO.md).

## Primer paso y decisión

No desplegar ni migrar sistemas todavía. Se puede comenzar un spike no productivo de solo lectura sobre la gramática y el snapshot SQLite medido. Para el MVP integrado, primero cerrar los gates de datos Digesto/PostgreSQL, PDFs, acceso y consultas de oro.

> **DECISIÓN VIGENTE: NO-GO para el MVP integrado hoy; GO para el spike acotado.**

La modernización integrada sigue siendo viable si se cumplen los gates del cierre, se validan las reglas público/interno/pendiente y se mide con usuarios lo que significa “Copernic bueno”.

## Resumen técnico solicitado

### JURISPRUDENCIA
- **Estado:** núcleo moderno sustancial; despliegue/migración integral no verificados.
- **Stack:** NestJS 11, TypeScript, Prisma 7, PostgreSQL; Next.js 16, React 19.
- **Calidad:** 6/10 orientativa; código 6, seguridad 4, testing 2.
- **Reutilización:** alta para módulos, modelos, búsqueda y UI; con cambios.
- **Problemas:** microisis sin importador; PHP legacy/Git ausentes; destino Postgres no inspeccionado.

### DIGESTO
- **Estado:** aplicación de archivos PDF y búsqueda; base real no inspeccionada.
- **Stack:** NestJS 10, Prisma 5, PostgreSQL; React 18/CRA.
- **Calidad:** 2–3/10; seguridad 1.
- **Reutilización:** modelo/flujo como contexto propio; reimplementar auth, ACL, carga y búsqueda.
- **Problemas:** rutas API sin guard visible; rol desde request; PDFs y asociaciones sin integridad declarada.

### COPERNIC
- **Estado:** seis instaladores; sin fuente, configuración o índice local.
- **Stack:** producto propietario; metadatos incluyen versión 7.2.
- **Calidad:** no evaluable.
- **Valor funcional:** operadores, preview, resaltado/refinamiento y búsqueda rápida, documentados por fabricante; valor local inferido.
- **Problemas:** no se puede importar ni observar la instalación en este workspace.

### COMPATIBILIDAD
- **Jurisprudencia ↔ Digesto:** PDF, texto, búsqueda y fechas solapan; entidades y permisos difieren.
- **Jurisprudencia ↔ Copernic:** comportamientos de búsqueda; no hay corpus Copernic.
- **Digesto ↔ Copernic:** ambos recuperan documentos; Copernic podría buscar fuentes locales adicionales, alcance a validar.

### RESPUESTAS Y ESTIMACIONES
- **¿Un solo sistema?** Sí con condiciones: UI/API comunes, bounded contexts separados y proyección de búsqueda trazable.
- **MVP integrado tras gates:** 80 % (rango 70–85 %), estimación de planificación.
- **Riesgo:** ALTO.
- **Tiempo:** 1 dev 11–21 meses; 2 dev 7–14; 3 dev 5–11.
- **MVP:** búsqueda global read-only en muestras reconciliadas, resultados diferenciados, permisos, snippet/preview y ledger.

### Trabajo completado en Misión 2

- Se verificó el hash del paquete, su inventario y estructura; se preservó el archivo original.
- Se documentaron las dos aplicaciones PHP, sus rutas de consulta y administración, y la gramática legacy.
- Se compararon los tres snapshots SQLite con el archivo local moderno, incluyendo MicroISIS y tablas principales.
- Se calcularon hashes PDF y se cotejaron nombres/IDs con las SQLite disponibles.
- Se añadieron cinco informes detallados, del 09 al 13.

### Próximos pasos pendientes

1. Obtener la definición institucional de los valores de tipo_registro y confirmar si los códigos de campo cambian según tipo de registro.
2. Aprobar relaciones MicroISIS con claves institucionales; las coincidencias textuales actuales son candidatas.
3. Revisar la base PostgreSQL real y las relaciones ArchivoPdf contra ambos árboles de archivos.
4. Obtener un export de Digesto de staging; no hay base Digesto en este workspace.
5. Acordar roles y reglas público/interno/pendiente y resolver el manejo de las credenciales incluidas en la configuración de Digesto; el host indicado no se consultó.
6. Validar con usuarios la sintaxis legacy, las consultas de oro, los campos y el comportamiento esperado de Copernic.
7. Confirmar guardias de publicación y permisos para búsqueda, sugerencias, snippets, facetas y descarga.
8. Medir precisión, recall y latencia sobre un corpus conciliado antes de decidir el motor final.

El paquete sí aportó el código PHP legacy que antes faltaba; lo que sigue sin estar disponible es la historia Git del sistema moderno y la configuración/índice local de Copernic.

## Cierre de Misión 3 — decisión vigente

Esta actualización sustituye la recomendación provisional anterior para el inicio del MVP: **NO-GO para comenzar ahora el MVP integrado con datos reales de Jurisprudencia y Digesto; GO para un spike limitado, no productivo y de solo lectura sobre el contrato de búsqueda y la SQLite disponible.** La Misión 3 logró leer y transcribir `campos_explicados.xls` y medir 55 casos de búsqueda (40 conteos sobre la SQLite que abre el endpoint público). Esto cierra la incógnita de lectura del XLS, pero no la definición institucional de sus códigos, el origen/ETL ni las claves MicroISIS.

No se inspeccionó PostgreSQL: el servicio local no tenía listener y no se intentó una conexión; la configuración remota de Digesto no se consultó por no poder probar que fuera no productiva. Tampoco se verificaron las filas ni los vínculos reales de `ArchivoPdf`. En consecuencia, el resultado no habilita una migración, despliegue o carga de datos. El MVP integrado pasa a GO solo después de cumplir los gates del [cierre de auditoría](16-CIERRE-AUDITORIA-GO-NO-GO.md). El benchmark y la transcripción están en [14-BENCHMARK-BUSQUEDA.md](14-BENCHMARK-BUSQUEDA.md), [benchmark-busqueda.json](benchmark-busqueda.json), [15-TRANSCRIPCION-CAMPOS-EXPLICADOS.md](15-TRANSCRIPCION-CAMPOS-EXPLICADOS.md) y [diccionario-microisis.json](diccionario-microisis.json).

No se modificó código de producto ni base de datos. La petición pegada para la Misión 3 termina en medio de la sección 14; el cierre cubre las instrucciones y objetivos visibles en el archivo recibido.

### BLOQUEANTES

Siguen pendientes la validación institucional de los códigos y claves MicroISIS, un snapshot PostgreSQL de procedencia no productiva y las asociaciones/rutas reales de PDF, un export de Digesto de staging, la definición de acceso/publicación y la validación de Copernic con usuarios. También debe acordarse la custodia de las credenciales incluidas en la configuración Digesto; no se intentó conexión al host indicado.
**Fuentes Copernic:** [guía oficial CDS7](https://copernic.com/wp-content/uploads/2021/05/CDS7_quick_start_guide.pdf), [página oficial de funciones](https://copernic.com/en/desktop/features/). Describen el producto general, no la configuración local.

## Adenda de Misión 2 — Buscador Jurídico Civil

La auditoría estática del paquete legado confirma dos aplicaciones PHP (consulta pública y administración) y tres snapshots SQLite. La base raíz tiene 52.375 filas en tb_microisis. La tabla también está copiada exactamente, en sus 30 columnas, en la SQLite moderna local; sin embargo, no aparece en el importador TypeScript ni en el esquema Prisma inspeccionado. Su lectura más probable es un snapshot relacional aplanado derivado de MicroISIS, con confianza media. La Misión 3 pudo transcribir el libro y su numeración 0–28; los valores S/C y otros códigos siguen sin leyenda, y no se encontró ETL de origen.

La sintaxis de búsqueda difiere: legacy usa *, +, - separado y %; el parser moderno usa AND/OR, exclusión con prefijo, frases y campos. La capa moderna agrega ranking, filtros, sugerencias y acceso a referencias, pero no conserva % ni la gramática simbólica histórica. Hace falta un contrato versionado y una colección de consultas de oro antes de unificar la caja.

Se detectó un punto de control prioritario: la consulta PHP pública abre el snapshot administrativo, exige filas activas pero no tb_sumarios.publicado=1. En esa base 112 filas activas no publicadas pasan el WHERE; son 36 en la SQLite raíz y 69 en la SQLite moderna local. Es riesgo estático, no comprobación de exposición en producción.

Auditoría de PDFs por SHA-256: 1.404 contenidos únicos en las dos carpetas judiciales legacy; todos aparecen en los directorios modernos locales data/uploads. Hay duplicados físicos en ambas épocas. Los estados de huérfano del destino siguen sin poder determinarse porque no se proporcionó la base PostgreSQL ni las asociaciones ArchivoPdf.

Las Misiones 2 y 3 añadieron informes 09–16, un benchmark JSON de 55 casos y un diccionario JSON transcrito. No se modificó código de producto. El XLS se pudo leer con un parser BIFF8 temporal; queda pendiente una leyenda institucional para los códigos, no acceso al archivo.
