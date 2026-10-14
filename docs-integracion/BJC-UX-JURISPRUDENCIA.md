# UX de Jurisprudencia — J9.1

**Alcance:** interfaz web de Jurisprudencia para lectores y operadores. Este contrato no modifica el motor de búsqueda, el visor PDF, el Corpus, el esquema ni los permisos de espacios. Evidencia local no versionada: `_recovery-work/jurisprudencia-j91/`.

## Personas y recorridos

- **Lector:** entra directamente a la consulta, busca por tema o texto, aplica Sala/fechas/tipo/expediente, reconoce los filtros activos, abre el detalle, consulta el sumario si fue publicado, abre el fallo y vuelve a resultados.
- **Operador:** desde gestión distingue todos, borradores/no publicados, publicados y archivados; carga un PDF, completa datos, guarda/publica, retoma, edita y archiva. La consulta pública no muestra sus controles.

## Búsqueda y familiaridad legacy

El formulario conserva Tema como búsqueda principal y Sala, desde/hasta, Tipo de fallo y Expediente como campos visibles. “Más filtros” contiene los campos secundarios del contrato legado: Nº de Sumario, sentencia, magistrados, carátula y tribunal de origen. Cuando el catálogo está vacío, Sala/Tipo/Tribunal admiten texto libre. `Sala H` se normaliza a `H` al enviar; el filtro activo sigue siendo legible.

Enter envía la consulta. Los filtros activos se muestran como chips removibles; “Limpiar filtros” los quita sin iconografía ambigua. La paginación conserva criterios y presenta anterior/siguiente y tamaño de página. La lista de últimos fallos queda plegada y limitada a cuatro entradas visibles al desplegar.

## Resultados, detalle y visor

La tarjeta prioriza carátula, Sala/fecha/tipo/expediente, extracto y disponibilidad del fallo; las acciones son seleccionar para imprimir, ver sumario y ver fallo. El detalle muestra metadata disponible, vuelve a resultados y abre el fallo. Los campos ausentes se omiten o muestran como no informados; los tipos internos comunes se traducen a etiquetas de usuario.

El wrapper del visor ofrece “Volver a resultados” y etiquetas legibles, sin modificar su núcleo. En el registro auditado el visor se abrió en E2E; una captura mostró el panel PDF vacío, por lo que la legibilidad/renderizado del archivo queda pendiente de revisión manual con un documento visualmente confirmado. No se afirma una prueba de impresión end-to-end.

## Alta y ciclo editorial

Gestión presenta pestañas de Todos, Borradores y no publicados, Publicados y Archivados, con acción principal “+ Nuevo fallo”. El alta explica cómo elegir/arrastrar el PDF; los datos se agrupan y ordenan por expediente, carátula, fecha, Sala, tipo y el resto de metadata. Los botones conservan el workflow existente; no se agregó un flujo editorial. La prueba J9.0.1 recorre borrador, publicación, lector/visor, edición, archivo y rechazo de duplicado por SHA.

## Lenguaje, responsive y accesibilidad básica

La interfaz común habla de Jurisprudencia, fallos, expediente, Sala, sumario y publicación; evita presentar Corpus, ACL, proyección, OCR_REQUIRED u otros estados internos en la ruta estándar. Se verificó ausencia de overflow horizontal en 1366×768, 1440×900, 1536×864, 1600×900, 1920×1080, 1920×1200 y 2560×1440; un smoke adicional pasó en 375/768/1366. E2E comprueba etiquetas accesibles, teclado Enter y flujo de botones. El contraste fue inspección visual cualitativa, no medición WCAG automatizada.

## Gaps conocidos

1. La auditoría DEV informa cero sumarios visibles para lectores: el usuario puede llegar al apartado, pero no leer un sumario en este snapshot.
2. La pestaña “Borradores y no publicados” consulta un universo histórico amplio (21.119 filas activas no publicadas en el corte), no sólo las 56 filas de revisión J9. Es una limitación del alcance de datos/listado que requiere acotar en un trabajo futuro sin cambiar publicación.
3. La lista de últimos publicados y la evidencia legacy dependen de metadata disponible; los catálogos vacíos requieren fallback a texto libre.
4. La captura visual de Viewer no demuestra contenido PDF renderizado; revisar con un fallo de archivo comprobado antes de certificar la lectura visual.
5. El lint global mantiene cuatro errores preexistentes en Corpus, Digesto y Revisión. El lint dirigido J9.1 sí pasa.

## Paquete de UAT humana (pendiente; no ejecutado)

**Lector:** “Busque daño. Muestre sólo Sala H. Abra un fallo. Lea el sumario. Vuelva a resultados. Busque un expediente.” La falta de sumarios visibles es un gap del snapshot, no un error del usuario.

**Operador:** “Cargue un nuevo fallo. Guárdelo como borrador. Encuéntrelo. Publíquelo. Archívelo.” Usar un PDF de prueba autorizado y acordar previamente su limpieza.

Registrar si cada tarea se completó sin ayuda, desvíos, preguntas, tiempo y errores. UAT institucional sigue pendiente.
