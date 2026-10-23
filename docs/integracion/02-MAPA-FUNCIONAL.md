# 02 — Mapa funcional comparado

Copernic aquí significa documentación del producto y metadatos de los instaladores disponibles; no una instalación comprobada.

| Funcionalidad | Jurisprudencia | Digesto | Copernic | Solapamiento / destino |
|---|---|---|---|---|
| Búsqueda libre | Pública e interna, sentencias, sumarios y referencias | Voz/tipo y texto extraído de PDF; cliente filtra parte | Archivos/contenido por guía | Alto; una API de búsqueda por fuentes |
| Operadores | Comillas, AND/OR, exclusión con -, búsqueda por campo | Sin gramática; contains | Guía: AND/OR/NOT, NEAR, frase, prefijo, comodín | Parcial; acordar gramática y casos de prueba |
| Identificadores | Expediente, número fallo/sumario, sala, fechas | Número interno, fecha, tipo, dependencia | No tiene semántica jurídica por diseño | Compartir caja; mantener campos tipados |
| Filtros/facetas | Fechas, sala, tema, tipo, tribunal, PDF, publicación | Fecha, número, voz/tipo, dependencia | Refinamiento de categoría/tipo documentado | Alto patrón UX, filtros por dominio |
| Sugerencias | Tema, magistrado, sala, tipo, expediente, carátula | Catálogos de filtro; no autocompletado comprobado | Resultados al escribir/prefijo documentado | Medio; conservar sugerencias jurídicas |
| Sentencias y sumarios | Gestión completa, publicación, reseña y anonimización | No existen con esa semántica | No es gestor jurídico | Exclusivo Juris |
| Documentos PDF | Upload, asociación, lectura/descarga pública | Upload/editar/asociar y texto PDF | Indexa archivos y previsualiza | Alto infraestructura; contexto propietario por sistema |
| Extracción de texto | Importación/lectura PDF en scripts | pdf-parse en carga | Extractores/indexadores del producto | Alto; pipeline versionado, OCR solo si requerido |
| Clasificaciones | Salas, tipos, tribunales, temas, institutos/sinónimos | Tipos y dependencias | Categorías de archivos | Parcial; vocabularios separados con equivalencias aprobadas |
| Relaciones | Citas, doctrina, normas, fallos relacionados, sumarios | Padre/hijo y dependencias | Archivos y adjuntos según producto | Parcial; API de relaciones tipadas |
| Normativa | NormaArticulo, EquivalenciaNormativa y referencias | No hay entidades legislativas | No hay corpus jurídico local | Juris tiene soporte parcial; no asumir Digesto normativo |
| Usuarios/permisos | JWT, guards, ADMIN/OPERADOR | Login solo de UI; auth API no visible | Perfil local del producto no disponible | Usar identidad segura de Juris y repararla |
| Auditoría/estadísticas | Acciones, consultas, calidad, uso, descargas | No se encontró bitácora | Estado de indexado documentado | Reutilizar base de auditoría Juris con retención |
| Favoritos/búsquedas | Ambos en Juris | No se encontraron | No comprobados | Evaluar con usuarios; no asumir |
| Exportación/impresión | CSV/TXT/JSON, ficha imprimible | PDF, no exportación de resultados hallada | Abrir documento/carpeta, no export masivo comprobado | Exportadores propios del dominio |
| IA/semántica | Ollama, reseña y embeddings en código | No hallado | Ranking de la instalación desconocido | Dejar experimental; texto literal primero |
| Administración | Usuarios, roles, catálogos, logs, estadísticas | CRUD documental/tipos expuesto | Configurar carpetas/indexación local | Backoffice común con permisos y pantallas separadas |
| Búsqueda cruzada | Dominio jurisprudencial y referencias | Dominio Doc | Categorías múltiples según guía | Alto objetivo de plataforma; hoy no existe |

## Solapamientos y fronteras

Solapan la búsqueda textual, el uso de PDFs, fechas, filtros, preview y navegación desde resultado a documento. La experiencia común es viable.

Deben permanecer separados: reglas de sentencia/sumario, publicación y anonimización; voz/pendiente/tipo/dependencia y jerarquía Digesto; referencias jurídicas tipadas; y la política de privacidad del usuario de escritorio. Una relación entre dos documentos debe explicar si es cita, norma, adjunto, jerarquía o equivalencia.

## Estado de Jurisprudencia modernizado

**Dictamen: SÍ, CON CAMBIOS.** El código tiene módulos, API, UI pública y administrativa, modelo relacional, búsqueda, roles/auditoría, PDFs y scripts de importación. Separar Sumario de Sentencia, referencias tipadas e IDs legacy son decisiones valiosas.

No se puede afirmar que esté finalizado: destino Postgres no inspeccionado, no hay Git visible, una sola prueba unitaria, no build integral verificado y la importación omite tb_microisis. La gramática tampoco es paridad total con operadores Copernic. Corregir el secreto JWT fallback, confirmar permisos, puertos y cobertura de datos; integrar Digesto como dominio independiente.

## Qué conservar, refactorizar, migrar, reimplementar o retirar

| Sistema/componente | Clasificación | Motivo/destino |
|---|---|---|
| Jurisprudencia: modelo Sentencia/Sumario y relaciones jurídicas | CONSERVAR | Ya refleja distinciones de dominio útiles; añadir cobertura microisis y revisión de publicación. |
| Jurisprudencia: identidad, roles, auditoría, catálogos y backoffice | REFACTORIZAR | Reutilizar el diseño; endurecer secreto JWT, retención de logs, permisos y tests. |
| Jurisprudencia: SQLite/PDF y claves legacy | MIGRAR | Importador existe, pero necesita microisis, ledger, hashes y reconciliación. |
| Jurisprudencia: módulos públicos, fichas e interacción de búsqueda | CONSERVAR/REFACTORIZAR | Evita tirar trabajo bueno; adaptar shell, búsqueda y rutas a contexto multi-fuente. |
| Legacy PHP de Jurisprudencia | REIMPLEMENTAR solo funciones validadas | El código no está en el workspace; recuperar proceso/código o especificar con usuarios antes de reemplazar. |
| Digesto: conceptos Doc, voz, Tipo, Dependencia y jerarquía | CONSERVAR funcionalmente | Son el conocimiento operativo que se debe trasladar a un modelo separado. |
| Digesto: controllers, login, carga, filesystem y búsqueda actual | REIMPLEMENTAR | No confiar en login de UI como control; agregar validación, ACL, storage y búsqueda server-side. |
| Digesto: datos y PDFs | MIGRAR | Requiere export y manifiesto verificado; hoy no hay dump local. |
| Digesto: UI de búsqueda/carga | REFACTORIZAR | Observar usuarios y conservar pasos útiles; unificar navegación y restringir cada operación. |
| Copernic: instaladores/motor | DESCARTAR como componente de plataforma | No se integra el binario propietario; el usuario obtiene búsqueda web nueva. |
| Copernic: operadores/preview/refinamiento | REIMPLEMENTAR tras validar | Comportamientos documentados e hipótesis de UX, sin evidencia de configuración local. |
| Copernic: índice/datos | MIGRAR solo si aparece export aprobado | No existe en los archivos disponibles; no afirmar que se puede importar. |

“Descartar” aplica a componentes técnicos que no aportan reutilización verificable, no a datos, prácticas o funciones de usuarios sin validación.

## Piezas nuevas justificadas

- API/read model de búsqueda multi-fuente con fuente e ID de origen; no existe en los dos backends.
- Ledger de importación con hashes, conteos, excepciones y reanudación; se requieren pruebas de no pérdida y soporte al corte.
- Identity/RBAC común con enforcement de servidor para Digesto; hoy no está resuelto.
- Ciclo de vida de PDFs con storage persistente, checksum, permisos y extracción observable; los directorios actuales no tienen almacenamiento unificado demostrado.
- Capa visual común y preview/snippet según validación de usuarios Copernic.

No crear un módulo de normativa integral, un bus de eventos o motor de búsqueda adicional hasta que un requisito/dataset medido lo justifique.
## Puntuación técnica (0–10)

Evaluación del material inspeccionado, no certificación. N/E = evidencia insuficiente para puntuar.

| Dimensión | Jurisprudencia | Digesto | Copernic |
|---|---:|---:|---:|
| Arquitectura | 7 | 3 | N/E |
| Calidad del código | 6 | 3 | N/E |
| Mantenibilidad | 6 | 2 | N/E |
| Documentación | 5 | 2 | N/E |
| Seguridad | 4 | 1 | N/E |
| Modelo de datos | 7 | 3 | N/E |
| Búsqueda | 7 | 2 | N/E |
| Frontend | 7 | 3 | N/E |
| Backend | 7 | 3 | N/E |
| Testing | 2 | 3 | N/E |
| Despliegue | 4 | 3 | N/E |
| Observabilidad | 3 | 1 | N/E |
| Facilidad de migración | 5 | 2 | N/E |

Jurisprudencia es la base más reutilizable, pero necesita seguridad/migración/QA. Digesto tiene los flujos de negocio que conviene preservar, con barreras de API e integridad de datos insuficientes. Copernic queda sin nota porque no hay código o instalación evaluable.

## Deuda técnica priorizada

| Problema | Sistema | Severidad | Consecuencia | Solución |
|---|---|---|---|---|
| API CRUD sin autorización visible; registro permite rol del request | Digesto | CRÍTICO | Exposición/modificación no autorizada si el API es alcanzable | Cerrar acceso, auth y RBAC en servidor antes de exponer |
| tb_microisis poblada no aparece en importador | Jurisprudencia | ALTO | Migración incompleta o pérdida de campos/relaciones | Mapear y reconciliar antes de importar |
| .env staged y no ignorado, repo sin commits | Digesto | ALTO | Credenciales podrían incluirse en primer commit | Retirar secretos del índice con procedimiento seguro; agregar controles |
| Path de PDF/upload sin validación visible, sin límite | Digesto | ALTO | Riesgo de lectura/arbitrario consumo o persistencia | Confinar rutas, MIME/tamaño, escaneo y ACL |
| Secreto JWT default y Compose con credencial local fija | Jurisprudencia | ALTO | Riesgo si configuración de desarrollo se reutiliza | Validar config productiva y separar secretos |
| Datos PDF duplicados o sin mapeo probado | Jurisprudencia/Digesto | ALTO | Archivos faltantes, duplicación, asociación incorrecta | Manifiestos hash y reconciliación |
| Digesto consulta sin paginar y devuelve pdfContent | Digesto | MEDIO | Respuesta grande y latencia/memoria | Búsqueda server-side, paginación, snippets |
| Campo entero tipo filtrado con contains | Digesto | MEDIO | Error en query por texto | Corregir filtro y probar combinación |
| Schema/migraciones Digesto divergentes; DocDependencias no declara FKs | Digesto | MEDIO | Drift de Prisma y asociaciones huérfanas | Alinear schema con la FK padre existente y auditar/añadir integridad a DocDependencias |
| Puertos API/UI ambiguos | Jurisprudencia | MEDIO | Arranque local o URL equivocada | Fijar contratos de puerto y entorno |
| Pruebas escasas | Ambos | MEDIO | Regresión sin detectar | Pruebas por reglas de permisos, importación y búsqueda |

No se califican como defectos las decisiones que dependen de datos o uso aún no observados.
