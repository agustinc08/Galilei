# 09 — Auditoría del legado de Jurisprudencia: estructura y flujos

## Alcance y método

Se inspeccionó estáticamente el paquete C:\Users\magco\Downloads\jurisprudencia.7z y el código local de JurisprudenciaN. El paquete tiene SHA-256 37A5E728271BF5400EBB66F4A8DE63D690AF6ADD34BEEB3AD16010BC6934E278 y tamaño de 643.528.914 bytes. Se listaron sus entradas antes de extraerlas: 2.265 entradas, una raíz jurisprudencia/, sin rutas absolutas ni ..; se excluyeron 12 entradas de $Recycle.Bin. El archivo original quedó intacto.

La revisión comprende rutas, formularios, JavaScript, PHP, SQL/SQLite y nombres/recuentos de archivos. No se ejecutó PHP ni ningún binario del paquete, no se hicieron conexiones externas y las bases SQLite se consultaron en modo de solo lectura. Los hallazgos describen el código y los snapshots, no una instalación actualmente desplegada.

## Inventario de alto nivel

| Contenido | Recuento |
|---|---:|
| Entradas totales del 7z | 2.265 |
| Archivos PDF con extensión .pdf en el paquete | 1.443 |
| Archivos PHP | 153 |
| JavaScript | 67 |
| CSS | 54 |
| Bases SQLite | 3 |
| Archivos SQL | 1 |
| Libro de campos .xls | 1 |
| Aplicaciones PHP | consulta/ y jurisp_6/ |

Hay dos ramas PHP que comparten concepto y datos, pero no una sola aplicación homogénea. Los archivos con prefijo new_ son alternativas paralelas; los wrappers principales siguen incluyendo los archivos sin ese prefijo. Algunas alternativas apuntan a otra base SQLite, por lo que no deben darse por activas solo por existir.

## Flujo de consulta pública

| Paso | Componente | Responsabilidad observada |
|---|---|---|
| Entrada | consulta/index.php | Marco/iframe de la aplicación |
| Pantalla | consulta/0_0_index.php, consulta/0_1_busquedas.php | Formulario de texto, sala y fechas; ayuda, limpiar e imprimir selección |
| Interacción | consulta/js/jurisprudencia.js | Envía la búsqueda por AJAX y controla resultados, selección e impresión |
| Búsqueda | consulta/1_1_buscar_resultados.php | Construye la consulta SQLite, trae hasta 300 filas y genera fragmentos |
| Documento | consulta/PDF/{prefijo}/{id}.pdf | Ruta que construye el cliente para abrir el PDF asociado |

El endpoint consulta/1_1_buscar_resultados.php abre ../jurisp_6/db/jurisprudencia_db.sqlite. Consulta tb_sumarios.resumen y une tb_sumarios.id_sentencia con tb_sentencias.id_sentencia. Exige registros activos en ambas tablas, filtra por sala/fecha si se indicaron y ordena por fecha descendente. No busca en tb_microisis; la interfaz pagina de a uno con tope servidor 300 y sin ranking por relevancia.

Hallazgo de publicación: el WHERE público exige tb_sumarios.activo=1 y tb_sentencias.activo=1, pero omite tb_sumarios.publicado=1. tb_sentencias no tiene columna publicado en el snapshot. La base que abre ese endpoint contiene 112 sumarios activos/no publicados que satisfacen el WHERE. Aplicando la misma condición a otros snapshots: 36 en la SQLite raíz del paquete y 69 en la SQLite moderna local. Es riesgo estático, no comprobación de exposición productiva; no se hizo prueba dinámica.

## Flujo de administración

La entrada jurisp_6/index.php carga jurisp_6/0_0_index.php; la pantalla incluye carga/edición de sentencias, carga/edición de sumarios y búsquedas. El JavaScript principal está en jurisp_6/js/jurisprudencia.js. Las búsquedas usan el mismo estilo de endpoint PHP; la administración también llama a endpoints de consulta, alta, modificación, baja lógica, vista previa e impresión.

| Área | Endpoints observados | Efecto |
|---|---|---|
| Sesión | 0_1_login.php | Resuelve operador de sesión |
| Consulta de registros | 2_1_buscar_sentencia.php, 2_2_buscar_sumario.php, 2_3_buscar_sumario.php, 2_4_existe_sentencia.php | Busca por identificadores o existencia |
| Alta | 3_1_insertar_sentencia.php, 3_2_insertar_sumario.php | Inserta sentencia/sumario |
| Edición | 3_3_modificar_sentencia.php, 3_3_modificar_sumario.php | Modifica campos y resumen de búsqueda |
| Baja lógica | 4_1_eliminar_sentencia.php, 4_2_eliminar_sumario.php | Marca registros eliminados/inactivos |
| Búsqueda e impresión | 1_1_buscar_resultados.php, 5_1_*.php, 5_4_*.php | Resultados, impresión o vista previa |
| PDF | Scripts de carga/reemplazo/baja bajo jurisp_6/ | Escribe el PDF en consulta/PDF/{prefijo}/ |

Los formularios administran atributos de sentencia (tipo, sala, fecha, juez, tribunal de origen, actores, objeto, magistrados, expediente y PDF) y sumarios (número, tema, texto, publicación, operador y estado). La herramienta contiene jQuery, Bootstrap, datepicker, paginación, TinyMCE, alertas y mPDF.

Hay una tabla tb_operadores sin filas en la base raíz y en otro snapshot administrativo tiene 16. La lógica de login incluye un identificador de operador predeterminado si falta $_SESSION['dni']; una pantalla niega el acceso cuando el identificador vale cero. En varios endpoints de escritura no se encontró una guardia de sesión/permiso explícita. Son señales de revisión, no prueba de exposición remota ni de una vulnerabilidad explotable en el entorno actual.

## Gramática de la búsqueda legacy

La ayuda del formulario describe esta sintaxis, confirmada en el parser PHP:

| Entrada | Significado implementado |
|---|---|
| daño * moral | Ambos términos (AND) |
| daño + moral | Cualquiera de los términos (OR) |
| daño - moral | daño y exclusión de moral |
| "daño moral" | Secuencia contigua de palabras |
| accident% | Comienza con accident, con continuación permitida |
| %accident | Termina con accident, con texto anterior permitido |

El signo * es el operador AND; no es comodín. % es el comodín. No se observó sintaxis de paréntesis ni un operador NEAR. La gramática es pequeña, admite una cantidad limitada de términos alternados con operadores y devuelve mensaje de error ante formulaciones inválidas. Los fragmentos se resaltan sustituyendo texto, no mediante un motor de snippets indexado.

El campo materializado resumen se arma al guardar con atributos de sentencia y sumario. El guardado normaliza texto y signos; no se halló un trigger SQLite. Las referencias, sumarios asociados/contradictorios y sentencias anuladas de MicroISIS no se incorporan a este resumen.

## Observaciones de implementación

- Las consultas PHP concatenan partes de SQL dinámicamente en vez de usar parámetros enlazados en los sitios inspeccionados.
- La carga de PDFs construye ruta a partir de identificadores; conviene validar de forma estricta autorización, nombre final, MIME/tamaño y ruta.
- Hay inserción de valores de base en HTML que requiere confirmar escape contextual en los caminos de salida.
- El árbol jurisp_6/PDF/ contiene otra colección; las rutas normales de consulta/administración apuntan a consulta/PDF/. La presencia del árbol por sí sola no prueba que esté activo.
- seleccion.php tiene parser similar, pero no se halló una referencia desde el wrapper principal; no se trata como flujo principal.
- No se encontraron referencias a Copernic ni un indexador/buscador de escritorio dentro del código legacy.

Cada señal anterior es análisis estático. No se hizo explotación, ejecución de PHP ni validación de configuración del servidor.
