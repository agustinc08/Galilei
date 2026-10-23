# 15 — Transcripción segura de campos_explicados.xls

## Archivo y lectura

- Miembro del paquete: jurisprudencia/jurisp_6/db/campos_explicados.xls.
- Tamaño: 34.304 bytes. SHA-256: 3ced5c03a8e077cd4e9e6c6d3fe243b076da7e68fcfdbd0036402ad78fe1a88c.
- Formato comprobado por firma y registros: contenedor OLE Compound File con flujo BIFF8 (Excel 97–2003); una hoja visible, Hoja1.
- La hoja tiene 76 referencias de cadenas compartidas y 42 cadenas únicas. Los metadatos embebidos indican Microsoft Excel, página de códigos 1252 y fechas de creación/último guardado en 2018. Los campos de autor/último guardado por existen, pero se omiten por privacidad. No se ejecutaron macros ni se abrieron enlaces.
- pandas/openpyxl no leen este formato sin xlrd; no está instalado. Para esta transcripción se usó un lector temporal de OLE/BIFF8 en Python estándar, en modo lectura, sin instalar paquetes. No se modificó el archivo del paquete.

## Lo que documenta y lo que no

La hoja muestra una lista de 29 nombres de campo, con números contiguos 0–28 en una columna sin encabezado. La correspondencia al esquema de tb_microisis es fuerte porque los 29 nombres coinciden; llamar a esos números “tags MicroISIS” es una inferencia razonable, no una etiqueta explícita del libro. La hoja no define significado narrativo, tipo, longitud permitida ni valores posibles.

### Lista transcrita de campo/código

| Código mostrado | Campo | Tipo SQLite | Distintos (incluye vacío) | Cadenas vacías | Máximo observado |
|---:|---|---|---:|---:|---:|
| PK | id_microisis | INTEGER PRIMARY KEY | 52,375 | 0 | 5 |
| 0 | tipo_registro | TEXT | 22 | 37 | 7 |
| 1 | dummy | TEXT | 4 | 50,169 | 44 |
| 2 | materia | TEXT | 36 | 22,898 | 29 |
| 3 | numero_sumario | TEXT | 28,571 | 23,670 | 62 |
| 4 | tema | TEXT | 24,841 | 23,940 | 578 |
| 5 | texto_sumario | TEXT | 28,383 | 23,954 | 9,749 |
| 6 | referencias_normativas | TEXT | 35 | 52,341 | 2,209 |
| 7 | sumarios_contradictorios | TEXT | 6,095 | 45,355 | 191 |
| 8 | tipo_fallo | TEXT | 9 | 542 | 7 |
| 9 | sala | TEXT | 32 | 3,141 | 15 |
| 10 | local | TEXT | 15 | 255 | 25 |
| 11 | causa | TEXT | 22,417 | 261 | 44 |
| 12 | pre_causa | TEXT | 10 | 251 | 78 |
| 13 | expte | TEXT | 1 | 52,375 | 0 |
| 14 | fecha | TEXT | 7,029 | 0 | 32 |
| 15 | resultado | TEXT | 23 | 37,848 | 20 |
| 16 | juez | TEXT | 258 | 31,155 | 24 |
| 17 | objeto | TEXT | 2,447 | 29,409 | 515 |
| 18 | actor | TEXT | 20,876 | 29,083 | 173 |
| 19 | demandado | TEXT | 17,907 | 31,053 | 118 |
| 20 | magistrados | TEXT | 2,734 | 29,112 | 1,794 |
| 21 | publicacion | TEXT | 165 | 52,178 | 208 |
| 22 | numero_saij | TEXT | 14 | 34,627 | 8 |
| 23 | sumarios_asociados | TEXT | 2,322 | 30,106 | 522 |
| 24 | fecha_carga | TEXT | 1,341 | 5,235 | 63 |
| 25 | operador | TEXT | 81 | 5,194 | 8 |
| 26 | tribunal_origen | TEXT | 113 | 41,184 | 17 |
| 27 | sentencias_anuladas | TEXT | 2,819 | 49,057 | 30 |
| 28 | observaciones | TEXT | 23 | 52,353 | 33 |

La columna de código es inferida por su posición; el XLS no le pone encabezado. Las longitudes son máximos medidos en SQLite, no límites declarados. Todas las columnas tienen cero NULL; los faltantes usan cadena vacía.

## Fragmentos de tablas que aparecen en la hoja

En las columnas A/B aparece un listado de campos de tb_sentencias. Los campos que tienen número adyacente son codigo_sentencia=11, tipo_fallo=8, sala=9, fecha=14, juez=16, objeto=17, actor=18, demandado=19, magistrados=20, tribunal_origen=26, fallo_completo=7 y numero_expediente=27. id_sentencia y activo aparecen sin número.
En el mismo bloque tb_sumarios, la hoja numera numero_sumario=3, tema=4 y texto_sumario=5; id_sumario, id_sentencia, publicado, resumen, id_operador y activo aparecen sin número. También lista id_operador, dni y activo bajo tb_operadores.
Una tercera lista en la columna I carece de encabezado. Enumera id_sumario, tipo_registro, numero_sumario, tema, texto_sumario, fallo_completo, tipo_fallo, sala, codigo_sentencia, fecha, juez, objeto, actor, demandado, magistrados, tribunal_origen y numero_expediente. No se infiere su dirección ni tabla destino.

## tipo_registro: valores vistos, significado no documentado

El campo está asociado al código mostrado 0. SQLite contiene estos valores; no se les atribuye significado sin una leyenda institucional:

| Valor | Filas |
|---|---:|
| S | 26,694 |
| C | 22,800 |
| s | 1,104 |
| X | 727 |
| x | 650 |
| c | 307 |
| cadena vacía | 37 |
| 1 | 15 |
| XX | 11 |
| m | 9 |
| solo espacio | 8 |
| M | 2 |
| SS | 2 |
| 0025061 | 1 |
| CS | 1 |
| CSC | 1 |
| D | 1 |
| SSSS | 1 |
| a | 1 |
| d | 1 |
| o | 1 |
| ss | 1 |

El libro no define S, C, s, c, X, x ni los valores atípicos. El código mostrado 0 designa al campo tipo_registro, no a los valores almacenados. El aparente conflicto de códigos 7/27 en fragmentos de tablas sugiere semántica por tipo de registro o un cruce incompleto; se debe verificar contra documentación MicroISIS antes de importar.

## Disposición

Conservar los 52.375 registros como evidencia de procedencia en snapshot/staging inmutable, si la política institucional autoriza su retención; no cargarlos automáticamente como 52.375 entidades modernas. Importar selectivamente solo después de aclarar la semántica por tipo y las claves de enlace con Sentencia/Sumario. Los campos de referencia, asociados, contradictorios, publicación y anulaciones merecen mapeo jurídico; operador, dummy y campos ambiguos pueden quedar archivados si no hay uso aprobado.

La tabla completa de campos/códigos/estadísticas está en diccionario-microisis.json.
