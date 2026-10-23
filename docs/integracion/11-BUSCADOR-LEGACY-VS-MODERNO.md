# 11 — Comparación del buscador legacy con el moderno

## Qué se comparó

Se inspeccionaron el parser PHP y SQL del buscador legacy, los formularios/JavaScript y el parser/servicio NestJS moderno. Los resultados de abajo son comportamiento leído del código; no son una batería de ejecución ni una afirmación sobre despliegues activos.

## Comparación funcional

| Capacidad | Legacy PHP | Moderno Jurisprudencia |
|---|---|---|
| Corpus consultado | tb_sumarios.resumen con unión a sentencia | Sumarios y campos de sentencia; referencias normativas, jurisprudenciales y doctrinarias participan en coincidencias |
| Búsqueda libre | Un resumen concatenado y normalizado al guardar | Búsqueda por campos, sumario, tema, resúmenes/reseñas publicados y referencias según modo |
| AND | * entre términos | Palabra AND aceptada; además la inclusión normal es conjuntiva |
| OR | + entre términos | Parser registra orGroups; el servicio también aplica operador AND/OR separado y la UI arranca en AND; OR escrito en q puede no dar unión sin ese parámetro |
| NOT | - separado entre término anterior y siguiente | Prefijo unido al término/frase, por ejemplo -moral |
| Frases | Comillas; secuencia textual contigua | Frases exactas entre comillas |
| Comodines | % al principio/final para coincidencia parcial | No se encontró compatibilidad para % |
| Búsqueda por campo | Filtros separados de sala/fecha; no parser general de campos | Alias como sala:, tema:, expediente:, actor:, objeto:, numeroSentencia: |
| Números/IDs | Parte del texto normalizado salvo filtros existentes | Se preservan tokens numéricos cortos y existen filtros por número/expediente |
| Relevancia | Sin score; fecha descendente | Score ponderado, prioridad por relevancia o fecha y posible bono semántico |
| Resultados/página | Máximo fijo de 300; cliente recorre de a uno | API paginada; búsqueda pública por defecto de 25 y límite de 300, interna por defecto de 10 |
| Filtros | Sala y rango de fechas, más texto | Sala, fechas/año, tema, expediente, carátula, actores, tipo, tribunal, PDF y otros campos según endpoint |
| Resaltado | Sustitución de términos en HTML | Highlights/snippets estructurados por campos |
| PDF | El cliente compone ruta histórica directa | API resuelve PDF asociado y expone URL de servicio público según slug |

Los conteos de página y límites son valores por defecto del código analizado; los DTO pueden permitir otros parámetros dentro de sus restricciones.

## Diferencias de sintaxis que afectan continuidad

La sintaxis no es intercambiable. Un usuario que escriba daño + moral conserva OR en legacy; el parser moderno no trata + como OR y puede quedarse con términos de inclusión. El signo * legacy significa AND, no comodín; en moderno no se identificó como operador explícito. El - legacy separado (a - b) no se traduce al formato moderno de prefijo (a -b). El comodín % no se conserva en el parser moderno. Por tanto, una caja común necesita una gramática definida y una capa de compatibilidad deliberada.

La revisión estática del servicio moderno muestra una discrepancia adicional: q con OR crea orGroups, pero el filtro de candidatos también combina parsed.terms y usa un operador AND/OR independiente; la UI establece AND por defecto. La gramática debe conectar OR del texto con ese AST/operador o la unión puede fallar. El parser moderno también elimina palabras funcionales y términos no numéricos menores de tres caracteres; legacy busca de y a como términos. La matriz cuantitativa y sus límites están en el informe 14.

## Acentos y normalización

El legacy conserva la distinción ñ/n en los resultados medidos. El código de consulta tiene una sustitución defectuosa para í; en la pareja prescripción/prescripcion medida ambos casos devolvieron las mismas 1.107 filas, sin divergencia en ese snapshot. El normalizador moderno elimina todos los diacríticos: daño/dano y Peña/Pena pueden colisionar, en contra de los 1/2.708 y 108/61 conteos legacy (Peña/Pena no comparten filas).

El parser moderno aplica normalización Unicode NFD y quita todos los diacríticos; eso hace que ñ y n queden indistinguibles en el término parseado. Es una diferencia con efecto posible en búsquedas jurídicas y nombres propios. La normalización de búsqueda debe validarse con términos de oro; conviene conservar el texto fuente intacto y definir reglas de equivalencia explícitas.

## Ranking y límites

El moderno tiene puntuaciones de código para, entre otros, expediente exacto, tema, resumen/reseña, sumario, actor/demandado, filtros y publicación; los empates pueden ordenarse por fecha. El servicio puede agregar un bono semántico desde el componente RAG y tiene un timeout/fallback. Esto no reemplaza exactitud de número, artículo o expediente y no está probado con datos representativos aquí.

El legacy ordena por fecha descendente y corta en 300, sin score ni paginado de servidor por offset. El moderno aporta sugerencias, filtros y exportación en rutas internas; son funciones nuevas respecto de la interfaz legacy inspeccionada.

## Interpretación del resultado y controles

- La versión moderna es funcionalmente más amplia, pero su gramática rompe varios hábitos legacy.
- No se observó un motor FTS persistente que garantice cobertura exacta sobre todos los documentos. El score se calcula a nivel de aplicación sobre candidatos limitados.
- En búsqueda pública moderna el servicio pide registros publicados/activos; eso contrasta con la consulta pública PHP auditada, cuyo SQL no filtra publicado.
- La vista legacy imprime selección y abre PDFs por ruta; la moderna obtiene el PDF a través de endpoint asociado. La paridad visual completa de preview/impresión requiere revisión con usuarios y ejecución en entorno autorizado.
- No se realizaron benchmarks ni pruebas de recall; no se estima rendimiento productivo a partir de lectura estática.


## Misión 3 — medición y contrato pendiente

El nuevo benchmark midió 55 casos sobre el SQLite que abre el endpoint público legacy, mediante SQL de solo lectura con parámetros, y marcó por separado la ausencia de resultados PostgreSQL modernos. En legacy AND/OR/NOT y comodines tienen diferencias observables; el parser moderno tiene una posible discrepancia entre OR dentro de q y el operador separado del DTO. El informe 16 fija una gramática objetivo basada en AST y precedencia NOT > AND > OR, con compatibilidad simbólica legacy explícita.
