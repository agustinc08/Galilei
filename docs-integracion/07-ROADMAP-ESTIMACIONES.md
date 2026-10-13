# 07 — Roadmap, esfuerzo, quick wins y bloqueantes

> **Actualización de Misión 3:** las estimaciones iniciales de 43–83 persona-semanas que aparecen en las fases siguientes son la línea base de Misión 2 y quedan supersedidas para la decisión vigente. El cierre revisado estima 19–31 persona-semanas para el MVP read-only después de recibir los insumos y 48–90 para la unificación completa, con gates y supuestos en [16-CIERRE-AUDITORIA-GO-NO-GO.md](16-CIERRE-AUDITORIA-GO-NO-GO.md).

Estimaciones en persona-semanas (PW), con equipo a tiempo completo y usuarios/ambientes disponibles. No incluyen demoras institucionales ni alcance que surja de entrevistas.

## MVP sensato

**Incluye:** staging seguro; UI y búsqueda read-only sobre subconjuntos de Jurisprudencia y export Digesto; resultados diferenciados por fuente; filtros del dominio, snippets, resaltado y PDF con permisos; ledger de importación; login administrativo seguro.

**No incluye:** retiro de sistemas existentes, escritura en Digesto, migración masiva final, índice Copernic, correo/directorios personales, IA como sustituto de texto literal, OCR sin prueba, motor externo de búsqueda o catálogo normativo que Digesto no demuestra.

**Éxito:** fuente y clave trazable en cada resultado; cero exposición de borrador/privado; cada fuente clasificada como importada, duplicada aprobada o excepción; consultas jurídicas de referencia revisadas por especialistas; tareas reales realizadas sin cambiar de sistema; latencia medida en corpus y carga definidos.

## Fases del proyecto

| Fase | Objetivo/entregable | Dependencia | Riesgo | Aceptación |
|---|---|---|---|---|
| 0 Auditoría | Mapa microisis, export Digesto y observación de Copernic | Custodios y usuarios | Alto si no hay fuente | Volumen, claves, reglas y consultas documentados |
| 1 Fundación | ADR, puertos, permisos, storage, staging | Fase 0 | Medio | Deploy repetible aislado |
| 2 Modelo/procedencia | Ledger, IDs fuente, hashes, fechas/encoding | Fase 1 | Alto por duplicados | Reglas aprobadas con ejemplos |
| 3 Jurisprudencia | Adoptar módulos y cerrar gaps | Fase 2 | Medio-alto | Publicación, anonimización, PDF y relaciones revisados |
| 4 Digesto | Adapter, Doc propio, jerarquía y catálogos | Export test + fase 2 | Alto | Conteos y relaciones conciliados |
| 5 Search/Copernic | Índice read model, parser, ranking, preview | Fases 3–4 | Alto por relevancia | Set de consulta y latencia aprobados |
| 6 UI/backoffice | Navegación única con permisos por dominio | Fases 3–5 | Medio | Usuarios completan tareas |
| 7 QA/migración | Importaciones repetibles, carga, seguridad, backup/rollback | Fases 3–6 | Alto | Cero pérdida silenciosa y rollback ensayado |
| 8 Piloto/producción | Piloto, capacitación, go/no-go y operación | Aprobación institucional | Muy alto si se saltea ensayo | Dueños firman criterios y soporte listo |

## Estimación

| Etapa | Esfuerzo | Dificultad / riesgo dominante |
|---|---:|---|
| Auditoría restante y usuarios | 2–4 PW | Acceso a datos y perfiles |
| Arquitectura, modelo y seguridad | 2–4 PW | Reglas de acceso/ownership |
| Infraestructura base | 2–4 PW | Staging, backup, almacenamiento |
| Identidad/permisos | 2–4 PW | Clasificación por fuente |
| Completar Jurisprudencia | 4–8 PW | Microisis y PDFs |
| Integrar Digesto | 4–8 PW | Export y workflow real |
| Search/funciones Copernic | 5–10 PW | Ranking, usuarios, latencia |
| Importadores/ledger | 5–9 PW | Nulos, duplicados, fechas, encoding |
| Frontend/backoffice | 6–11 PW | Experiencia común sin perder procesos |
| QA funcional/seguridad/carga | 5–9 PW | Usuarios y datos de prueba |
| Ensayo de migración/reconciliación | 3–6 PW | Snapshot y excepción manual |
| Piloto/capacitación/salida | 3–6 PW | Aprobaciones y rollback |
| **Total** | **43–83 PW** | No incluye demoras externas |

| Equipo | Calendario estimado | Productividad neta asumida |
|---|---|---|
| 1 desarrollador | 11–21 meses | Casi serial |
| 2 desarrolladores | 7–14 meses | 1,6× por paralelismo |
| 3 desarrolladores | 5–11 meses | 2,1× por coordinación/revisión |

MVP read-only: 14–22 PW; 3,5–5,5 meses con 1 persona, 2,5–4 con 2 y 2–3 con 3. No fijar fecha productiva hasta obtener snapshots y validar permisos.

## Desglose solicitado en 16 etapas

Esfuerzo incluido dentro del total anterior. La suma de extremos coincide con 43–83 PW.

| # | Etapa | Esfuerzo | Dificultad | Dependencia y riesgo |
|---:|---|---:|---|---|
| 1 | Auditoría y usuarios | 2–4 PW | Media | Snapshots/personas; sin acceso, alcance queda abierto |
| 2 | Arquitectura | 1–2 PW | Media | Dueños/permisos |
| 3 | Modelo de datos | 1–2 PW | Alta | Microisis y cruces Digesto |
| 4 | Infraestructura base | 2–4 PW | Media | Staging, backup y storage |
| 5 | Identidad/permisos | 2–4 PW | Alta | Reglas de acceso aprobadas |
| 6 | Jurisprudencia | 4–8 PW | Alta | Completar import y validar el núcleo |
| 7 | Digesto | 4–8 PW | Alta | Export de prueba y auth |
| 8 | Requisitos Copernic | 2–4 PW | Media | Observación y fuentes autorizadas |
| 9 | Buscador unificado | 3–6 PW | Alta | Corpus de oro y benchmark |
| 10 | Migradores/normalizadores | 5–9 PW | Alta | Datos, relaciones, hashes |
| 11 | Frontend común | 3–6 PW | Media-alta | API estable |
| 12 | Backoffice común | 3–5 PW | Media-alta | Roles y flujos por dominio |
| 13 | QA | 5–9 PW | Alta | Datos de prueba, perfiles y criterios |
| 14 | Migración controlada | 3–6 PW | Alta | Ensayos repetibles y rollback |
| 15 | Validación con usuarios | 2–4 PW | Media-alta | Usuarios judiciales disponibles |
| 16 | Puesta en producción | 1–2 PW | Alta | Go/no-go, operación y reversa aprobados |

## Escenarios

- **Optimista:** Digesto entrega snapshot de prueba; la función de microisis se aclara en días; usuarios aportan consultas Copernic y PDFs tienen asociaciones recuperables. El MVP avanza en 14–18 PW; la plataforma completa se acerca al extremo bajo.
- **Realista:** microisis requiere reconciliación manual, Digesto tiene filas por revisar y se ajusta el ranking tras entrevistas. Usar el rango total 43–83 PW; lanzar primero un buscador read-only y mantener convivencia.
- **Pesimista:** no se autorizan exportes, no se recupera el origen o aparecen políticas de privacidad incompatibles. No hay base para corte ni cifra de migración; conservar los sistemas fuente y limitar el resultado a un portal sobre fuentes autorizadas.
## Quick wins

### 1 día

- Identificar custodios/procedimiento para export Digesto y backup de SQLite/PDF.
- Bloquear omisión de microisis en el plan de migración; inventariar campos.
- Preguntar a usuarios si Copernic indexa solo corpus judicial o también red/correo.

### 1 semana

- Crear manifiestos SHA-256 y relación de archivos en copias.
- Obtener conteos/nulos/fechas/duplicados/huérfanos desde snapshots no productivos.
- Documentar consultas y pantallas Copernic autorizadas.
- Preparar repositorio con historia limpia y protección de secretos.

### 2–3 semanas

- Importación de muestra a PostgreSQL vacío con ledger.
- 30–50 queries de oro para medir relevancia de Jurisprudencia y prototipo.
- Definir roles y reconstruir un flujo Digesto seguro en desarrollo.
- Prototipo read-only con fuente, preview y snippet.

## Bloqueantes reales

| Bloqueante | Impacto | Probabilidad | Mitigación |
|---|---|---|---|
| tb_microisis tiene 52.375 filas y no la usa importador | Omisión de información/relaciones | Alta | Mapear, cruzar y aprobar destino |
| No hay export local de DB Digesto | No hay reconciliación de registros reales | Alta | Obtener dump de staging por procedimiento |
| Copernic sin índice/configuración/observación | No se demuestra paridad ni migración | Alta | Entrevistas, observación y export autorizado |
| PHP legacy e historia Git de Juris no disponibles | Paridad y cambios previos desconocidos | Alta | Recuperar referencia o documentar flujo con expertos |
| Sin matriz público/interno/pendiente | Exposición o desaparición de documentos | Media-alta | Aprobación de reglas por responsable |
| .env staged en Git Digesto sin commits | Riesgo de incorporar secreto al primer commit | Media-alta | Mantener valores fuera de Git y revisar índice con procedimiento seguro |

## Preguntas para usuarios

1. ¿Qué tres búsquedas hacen más seguido? ¿Qué escriben exactamente?
2. ¿Qué fuentes aparecen en Copernic: sistema, PDFs de red, carpetas, correo, adjuntos?
3. ¿Qué función de Copernic no perderían: prefijo, booleanos, NEAR, frase, wildcard, filtros, preview, resaltado, teclado?
4. ¿Qué debe aparecer primero para expediente, artículo, ley, carátula, nombres, tema y frase?
5. ¿Cómo distinguen fuente oficial, publicado, pendiente, interno y borrador? ¿Quién puede ver cada uno?
6. Muestre una búsqueda exitosa y una fallida; ¿qué hace cuando no encuentra?
7. ¿Qué imprimen, descargan, comparten o guardan fuera del sistema?
8. ¿Qué velocidad de respuesta y volumen de resultados consideran aceptables?
