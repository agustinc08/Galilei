# 10 — tb_microisis: datos, relaciones y brecha de importación

## Respuesta ejecutiva

tb_microisis contiene 52.375 registros en la base SQLite raíz del paquete, con un identificador propio y 29 campos de texto que combinan clasificación, metadatos de causa/sentencia, texto de sumario y referencias jurídicas. El mismo conjunto de 52.375 filas, con idénticos valores en sus 30 columnas, también está en la SQLite moderna local.

La mejor lectura es un snapshot/export relacional histórico y aplanado de registros MicroISIS; no hay evidencia de que sea índice de búsqueda, staging operativo o tabla activa del PHP. La certeza sigue en nivel medio. En Misión 3 se leyó campos_explicados.xls: documenta una lista campo/número 0–28 y fragmentos de tablas, pero no define códigos almacenados ni procedencia ETL. No se encontró .mst/.xrf ni importador de origen; no se demuestra si la SQLite es el origen o una copia intermedia.

## Inventario SQLite y comparación

Todas las bases se inspeccionaron con conexión SQLite mode=ro&immutable=1, usando consultas SELECT y PRAGMA.

| Snapshot | Bytes | tb_microisis | tb_sentencias | tb_sumarios | tb_operadores |
|---|---:|---:|---:|---:|---:|
| Paquete, jurisprudencia/jurisprudencia_db.sqlite | 120.231.936 | 52.375 | 24.644 | 29.349 | 0 |
| Paquete, jurisprudencia/jurisp_6/db/jurisprudencia_db.sqlite | 96.728.064 | 47.079 | 21.109 | 25.139 | 16 |
| Paquete, jurisprudencia/jurisp_6/db/jurisprudencia_db11.sqlite | 97.175.552 | 47.809 | 21.034 | 25.065 | 0 |
| Workspace, JurisprudenciaN/back/data/jurisprudencia_db.sqlite | 136.859.648 | 52.375 | 27.387 | 32.695 | 0 |

La comparación directa del snapshot raíz con la SQLite moderna dio 52.375 IDs comunes y 52.375 registros idénticos en las 30 columnas. Esto prueba que la copia de SQLite moderna aún conserva esos datos; no prueba que estén cargados en PostgreSQL.

### Esquema observado

Clave primaria: id_microisis INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT. Los otros 29 campos son TEXT, no admiten NULL observado y no tienen índices declarados ni claves foráneas. Vacíos están representados como cadenas vacías. La aplicación no declara una relación de base entre esta tabla y sentencias o sumarios.

| # | Campo | Distintos, incluyendo vacío | Vacíos | Máximo de caracteres |
|---:|---|---:|---:|---:|
| PK | id_microisis | 52,375 | 0 | 5 |
| 0 | tipo_registro | 22 | 37 | 7 |
| 1 | dummy | 4 | 50,169 | 44 |
| 2 | materia | 36 | 22,898 | 29 |
| 3 | numero_sumario | 28,571 | 23,670 | 62 |
| 4 | tema | 24,841 | 23,940 | 578 |
| 5 | texto_sumario | 28,383 | 23,954 | 9,749 |
| 6 | referencias_normativas | 35 | 52,341 | 2,209 |
| 7 | sumarios_contradictorios | 6,095 | 45,355 | 191 |
| 8 | tipo_fallo | 9 | 542 | 7 |
| 9 | sala | 32 | 3,141 | 15 |
| 10 | local | 15 | 255 | 25 |
| 11 | causa | 22,417 | 261 | 44 |
| 12 | pre_causa | 10 | 251 | 78 |
| 13 | expte | 1 | 52,375 | 0 |
| 14 | fecha | 7,029 | 0 | 32 |
| 15 | resultado | 23 | 37,848 | 20 |
| 16 | juez | 258 | 31,155 | 24 |
| 17 | objeto | 2,447 | 29,409 | 515 |
| 18 | actor | 20,876 | 29,083 | 173 |
| 19 | demandado | 17,907 | 31,053 | 118 |
| 20 | magistrados | 2,734 | 29,112 | 1,794 |
| 21 | publicacion | 165 | 52,178 | 208 |
| 22 | numero_saij | 14 | 34,627 | 8 |
| 23 | sumarios_asociados | 2,322 | 30,106 | 522 |
| 24 | fecha_carga | 1,341 | 5,235 | 63 |
| 25 | operador | 81 | 5,194 | 8 |
| 26 | tribunal_origen | 113 | 41,184 | 17 |
| 27 | sentencias_anuladas | 2,819 | 49,057 | 30 |
| 28 | observaciones | 23 | 52,353 | 33 |

No se observaron valores NULL; vacíos se almacenan como cadenas vacías. Distintos incluye la cadena vacía cuando existe. Los códigos de campo 0–28 fueron transcritos del XLS; los números no tienen encabezado en la hoja, por lo que su interpretación como tags/posiciones se marca como inferencia.

Los valores exactos de tipo_registro son S=26.694, C=22.800, s=1.104, X=727, x=650, c=307, cadena vacía=37 y solo espacio=8. Los 48 registros restantes usan valores minoritarios (incluyen números y variantes de letras), sin significado documentado. El XLS nombra el campo como código 0, pero no define S/C ni variantes. En fecha, 51.512 valores se interpretan con datetime.fromisoformat; 863 no; 52.067 empiezan con patrón YYYY-MM-DD, que por sí solo no garantiza fecha válida. expte está vacío en 52.375 filas. referencias_normativas, publicacion, observaciones y relaciones asociadas/contradictorias/anuladas tienen poca cobertura; resultado, en cambio, contiene 14.527 valores no vacíos y no debe describirse como casi vacío.
## Relación con las tablas modernas/legacy

La revisión del PHP y del TypeScript encontró uso explícito de tb_sentencias y tb_sumarios, pero no una rutina de aplicación que cree, importe, lea o actualice tb_microisis. Tampoco se halló mención de sus campos en el esquema Prisma o en los mapeadores actuales.

El importador local JurisprudenciaN/back despacha sentencias, sumarios y PDFs; el servicio SQLite resuelve tb_sentencias/sentencias y tb_sumarios/sumarios. No expone una opción de importación MicroISIS. Por ello, el hallazgo defendible es: la tabla sobrevive en el SQLite local y no forma parte del pipeline visible hacia PostgreSQL. No se inspeccionó una base PostgreSQL destino.

Análisis de candidatos por contenido, usando normalización amplia de minúsculas, acentos y signos:

| Cruce potencial | Filas con coincidencia |
|---|---:|
| tema MicroISIS ↔ tema de sumario | 27.800 |
| texto_sumario ↔ texto/resumen de sumario | 26.931 |
| Coincidencia tema o texto sumario | 27.803 |
| MicroISIS ↔ sentencia por combinación de fecha/sala/tipo/actores/objeto | 19.324 |
| Coinciden con ambos grupos de candidatos | 10 |
| Sin candidato exacto por esas reglas | 5.258 |

Solo dos filas emparejaron por el número de sumario en el cruce directo. No hay clave estable ni FK que confirme esos enlaces. Las coincidencias de texto son candidatas: una normalización permisiva y valores repetidos pueden producir falsos positivos. Los 5.258 sin candidato con estas reglas no son prueba de datos huérfanos; pueden relacionarse por campos ausentes o semántica/códigos aún desconocidos.

## Resultado de Misión 3: transcripción del XLS

El archivo tiene 34.304 bytes, SHA-256 3CED5C03A8E077CD4E9E6C6D3FE243B076DA7E68FCFDBD0036402AD78FE1A88, firma OLE Compound File y flujo BIFF8; contiene una hoja, Hoja1. El runtime no tiene xlrd, por lo que pandas.read_excel no lo abre. Se transcribió con un lector temporal OLE/BIFF8 de Python estándar en modo de lectura. No se instalaron paquetes ni se ejecutaron macros. La lista E/F contiene los nombres y números 0–28 que alinean con las 29 columnas TEXT; el libro no define tipos/longitudes permitidas ni valores codificados.

Los fragmentos de tb_sentencias y tb_sumarios aportan un cruce parcial de campos. Hay colisiones por contexto en el mismo XLS: el código 7 aparece asociado a fallo_completo y en la lista E/F a sumarios_contradictorios; el 27 a numero_expediente y a sentencias_anuladas. Puede ser un tag reutilizado según tipo de registro o un cruce impreciso. No resolverlo sin muestras/documentación de cada tipo. Los campos de autor y último guardado por existen en propiedades del archivo y se omitieron por privacidad; aplicación reportada: Microsoft Excel, con guardado en 2018. No se encontró storage VBA.

La transcripción completa está en 15-TRANSCRIPCION-CAMPOS-EXPLICADOS.md y diccionario-microisis.json. El SQL jurisprudencia_db2.sql sigue mostrando DDL malformado en fecha] y dni]; no se usa para reconstruir el esquema.

## Consecuencia para una migración

No se recomienda descartar ni cargar ciegamente esta tabla en Sentencia o Sumario. Conservar primero una copia de origen, todos los campos crudos, su ID original y procedencia. Decodificar códigos con documentación institucional; luego aprobar reglas explícitas para las relaciones. Un ledger debe guardar por cada fila el snapshot/archivo de origen, ID de MicroISIS, estrategia y confianza del enlace, conflictos y decisión manual. Campos como referencias normativas, contradictorios, asociados y anulaciones requieren valoración jurídica antes de mapearlos.
