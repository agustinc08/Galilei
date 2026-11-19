# Galilei — Evolución y capacidad para 500 usuarios

**Fecha:** 18 de noviembre de 2026  
**Estado:** candidate local; sin deploy ni promoción  
**Criterio:** separar mediciones de inferencias; no convertir una respuesta HTTP o un test aislado en certificación de capacidad.

## Resumen ejecutivo

- El baseline Office y `origin/dev` observado fue `439186bdc92e7cafc58f3a8156d639d65cfddaf2`; `origin/main` fue `83947656420a9d6f6c3cfb12b353eb7f2c293a28`. No se modificaron ramas remotas ni Office durante este sprint.
- Se encontró una limitación reproducible en búsquedas guardadas: `JURISPRUDENCIA` tenía el CRUD ya implementado, pero los roles del controller y la ruta protegida la excluían; además no tenía enlace visible. El candidate amplía el acceso sólo a `ADMIN`, `OPERADOR` y `JURISPRUDENCIA`, y agrega el enlace de gestión para esos roles.
- La API del candidate pasó una prueba integrada con PostgreSQL QA aislado: JURISPRUDENCIA pudo crear/listar/leer una búsqueda; ADMIN no vio ni leyó ese registro; REVISOR recibió 403; el registro sintético fue eliminado por el endpoint oficial.
- Typecheck y builds de backend/frontend pasaron. ESLint completo del cliente pasó; el ESLint del backend detectó sólo formato en el test nuevo, que se corrigió y pasó ESLint dirigido. Las pruebas dirigidas existentes pasaron: 2 suites, 9 tests. El build de Vite conserva el aviso de chunks PDF grandes.
- La navegación autenticada pasó en Chromium aislado usando sesión sintética y API interceptada: JURISPRUDENCIA ve y abre el enlace; LECTOR no ve el enlace, no puede entrar por URL directa y no llama a la API. Esto es `PASS_QA_ONLY`, no validación Office.
- **No se ejecutó ninguna prueba de carga.** Office y QA comparten el mismo equipo físico; el margen de RAM medido durante esta sesión fue de aproximadamente 4 GB, y el host tiene 4 núcleos/hilos, disco de datos HDD y servicios de Office activos. Una carga de 25 a 500 usuarios no sería segura ni representativa aquí.
- No hay medición de latencia/RPS ni base para certificar 500 sesiones abiertas o 500 usuarios activos. La estimación de infraestructura es parcial; no se recomienda comprar hardware con estos datos.

## Baseline y método

| Elemento | Evidencia observada |
|---|---|
| Office desplegado / `origin/dev` | `439186bdc92e7cafc58f3a8156d639d65cfddaf2` |
| `origin/main` | `83947656420a9d6f6c3cfb12b353eb7f2c293a28`; sin cambios |
| Migraciones Office | 41; este candidate no agrega ni ejecuta migraciones |
| Worktree candidate | Rama `feature/galilei-mega-sprint-500-users-20261118`, con base en el SHA desplegado |
| QA | Perfil integrado; PostgreSQL, OpenSearch y storage separados lógicamente, pero en la misma máquina física que Office |
| Cambio funcional | Roles de búsquedas guardadas; no altera resultados, ranking, indexación ni corpus |
| Escrituras de QA | Una búsqueda sintética creada y luego eliminada por el API oficial; sin mutaciones de Office |

La evaluación de recursos combina los snapshots operativos previos del 18/11 y el muestreo de memoria de esta ejecución. Las lecturas de CPU fueron inconsistentes y no se consideran una línea base estable. No se repitió la consulta costosa de tamaño de PostgreSQL que ya había excedido su timeout de lectura.

## Corrección reproducible

**BETA-029 — P2 — acceso de investigación a búsquedas guardadas.** Antes del candidate, el servicio y las pruebas de propiedad ya existían, pero el controller y `ProtectedContent` sólo habilitaban ADMIN/OPERADOR, y el shell no mostraba un acceso a JURISPRUDENCIA. Se incorporó JURISPRUDENCIA en las tres puertas de autorización; los registros continúan filtrados por `usuarioId` en el servicio. No se cambió el modelo ni se agregó una migración.

**Validación QA:** login sintético JURISPRUDENCIA/ADMIN/REVISOR; alta, listado y lectura del registro por su propietario; invisibilidad para ADMIN distinto; 404 al intentar leerlo directamente como otro usuario; 403 para REVISOR; limpieza confirmada. Resultado `PASS_QA_ONLY`.

**UI:** Playwright Chromium aislado verificó el click desde `/galilei`, la pantalla destino y la denegación de LECTOR por URL directa; API interceptada con identidad sintética. `SAVED_SEARCH_UI=PASS_QA_ONLY`; `OFFICE=NOT_VERIFIED`.

## Registro acumulado BETA-011 a BETA-029

Los estados históricos no se sobrescriben ni se elevan por pruebas nuevas. Fuente detallada de 011–027: `BETA-VALIDACION-REAL-CONSOLIDADA.md`; fuente de 028: los informes de evolución y consolidación de noviembre. QA y Office son columnas distintas.

| ID | Estado QA conocido | Estado Office conocido | Nota de continuidad |
|---|---|---|---|
| BETA-011 | `PASS_QA_ONLY` | `NOT_VERIFIED` | Búsqueda avanzada por perfil |
| BETA-012 | `PASS_QA_ONLY` | `NOT_VERIFIED` | Autocomplete público |
| BETA-013 | `PASS_QA_ONLY` | Parcial; no PASS | Carga de carpetas |
| BETA-014 | `NOT_VERIFIED` | `NOT_VERIFIED` post-deploy | Mi perfil; falta click, datos y regreso en Office |
| BETA-015 | `PASS_QA_ONLY` | Parcial | Membresías y permisos de dependencia |
| BETA-016 | `PASS_QA_ONLY` | `NOT_VERIFIED` | Responsive de Workspace |
| BETA-017 | `NOT_VERIFIED` | `NOT_VERIFIED` post-deploy | Navegación interna Jurisprudencia |
| BETA-018 | — | `PASS_REAL` | Consistencia visual Mis documentos |
| BETA-019 | `PASS_QA_ONLY` | `NOT_VERIFIED` | Nombres UTF-8 y búsqueda documental |
| BETA-020 | `PASS_QA_ONLY` | `NOT_VERIFIED` | Privacidad y vista previa personales |
| BETA-021 | — | `PASS_REAL` | Refresh de deep link Colecciones |
| BETA-022 | — | `PASS_REAL` | Terminología Colecciones |
| BETA-023 | — | `PASS_REAL` | Confirmación de eliminación de colección |
| BETA-024 | `PASS_QA_ONLY` | Parcial | Estados de carga documental |
| BETA-025 | — | `PASS_REAL` | Consejos de búsqueda |
| BETA-026 | `PASS_QA_ONLY` | `OCR_OFFICE_E2E=NOT_VERIFIED` | OCR Workspace pendiente de validación humana; no se inició OCR real |
| BETA-027 | `PASS_QA_ONLY` | `NOT_VERIFIED` | Visor Workspace y ACL pendientes en Office |
| BETA-028 | Regresión local `PASS` | Validación visual real `NOT_VERIFIED` | Etiqueta `OCR_REQUIRED`; no se reabrió el bug ya corregido |
| BETA-029 | `PASS_QA_ONLY` para API/autorización | `NOT_VERIFIED` | Búsquedas guardadas habilitadas a JURISPRUDENCIA; UI Office pendiente |

## Inventario de funciones solicitadas

| Área | Estado demostrado | Pendiente |
|---|---|---|
| Búsquedas guardadas | CRUD, reejecución/novedades manuales y aislamiento por usuario ya existían; acceso JURISPRUDENCIA pasa API integrada QA | Validación Chromium y Office; no hay alertas automáticas |
| Alertas de nueva jurisprudencia | `PARTIAL_MANUAL`; el usuario puede consultar novedades manualmente | Opt-in, deduplicación durable, evaluación al publicar y notificación interna requieren diseño y migración aditiva probada en QA |
| Reportar un problema | `NOT_IMPLEMENTED`; no se encontró un modelo/flujo persistente en el inventario disponible | Formulario, privacidad, ciclo de estados y administración; requerirá almacenamiento durable y probablemente migración |
| Monitoreo operativo | `PARTIAL`; health readiness de componentes y telemetría de Search existen | No se demostraron tendencias/alertas de CPU, RAM, disco, 5xx, backups ni colas; no llamarlo panel operativo completo |

No se agregaron estas tres funciones en una versión incompleta. Toda migración futura requiere pruebas de integración en QA; aplicar una migración a Office necesitará autorización explícita para su identificador exacto.

## Hardware y consumo observados

| Componente | Medición o configuración actual | Riesgo y límite de la evidencia |
|---|---|---|
| Host | BANGHO CROSS B02; Ryzen 3 3200G, 4 núcleos/4 hilos; Windows 10 Pro x64; 14,95 GB RAM | Equipo compartido; no es un entorno de carga aislado |
| RAM libre | 3,5–4,0 GB en snapshots de esta investigación | Variación por otros procesos; no representa pico sostenido |
| CPU | Lecturas cortas de host 66–86%; otra muestra por proceso fue baja | Muestras discordantes; no inferir porcentaje de Galilei ni capacidad |
| Disco | C: SSD, 238,5 GB total / 13,9 GB libres; D: HDD, 149,1 GB / 48,5 GB libres; datos Galilei en D: | IOPS/throughput no medidos; el HDD es riesgo plausible para DB, blobs e índices |
| Backend | Node/NestJS; working set observado ~111 MB | Snapshot de un proceso, no pico de carga; no se midió event-loop delay |
| Frontend | Servidor estático ~27 MB en snapshot | No es carga de usuarios concurrentes |
| PostgreSQL | `max_connections=100`, `shared_buffers=128MB`, `max_wal_size=1GB`; 6 conexiones locales establecidas en el snapshot | Tamaño de DB y RAM real del proceso no medidos; un límite de conexiones no equivale a usuarios soportados |
| Pool Prisma | Valor por defecto del cliente: 10 conexiones por pool | El consumo potencial agregado depende de cantidad de instancias; no escalarlo sin medir conexiones/consultas |
| OpenSearch Office | Un nodo, GREEN, 4 shards activos; 72.460 documentos; índice ~11,57 GB; heap usado ~1.304/2.048 MB (63%) | No hay HA ni carga de prueba; una caída del nodo deja Search indisponible |
| OpenSearch QA | Nodo separado lógicamente, ~209/1.024 MB de heap, 609 documentos | Comparte CPU/RAM/disco físico con Office |
| Red | NIC con link Ethernet de 1 Gbps | No se midió ancho de banda efectivo, WAN, pérdida ni concurrencia de descargas |
| Backups | Último dump verificado conocido: 17/11, anterior a la migración 41 | No es una copia posterior al esquema actual; recuperación tendría que aplicar la 41. RTO/RPO no medidos |

OpenSearch recomienda dimensionar el heap aproximadamente a la mitad de la memoria disponible para el proceso y evitar swapping; ese consejo no justifica aumentar el heap del host compartido: PostgreSQL, Node, QA y Office compiten por la misma RAM ([documentación oficial](https://docs.opensearch.org/latest/install-and-configure/configuring-opensearch/configuration-system/)). PostgreSQL advierte que subir `max_connections` aumenta recursos compartidos asignados; 100 conexiones configuradas no certifican 100 usuarios activos ([documentación oficial](https://www.postgresql.org/docs/current/runtime-config-connection.html)).

## Benchmark y capacidad

No hubo benchmark reproducible en este sprint. No se midieron throughput, percentiles ni tasa de errores bajo carga. Las condiciones de parada del prompt no se pueden garantizar con QA co-localizada, por lo que no se ejecutó ni el escalón de 25 usuarios.

| Escenario | Usuarios virtuales | RPS | P95/P99 | Errores | CPU/RAM | Resultado |
|---|---:|---:|---:|---:|---|---|
| Uso ligero | 100 | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` |
| Uso normal | 250 | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` |
| Objetivo | 500 | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` |
| Pico | 500 | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` | `NOT_TESTED` |

**Respuestas con evidencia disponible:**

1. 500 sesiones abiertas: `NOT_TESTED`; no se certifica.
2. 500 usuarios activos: `NOT_TESTED`; no se certifica.
3. Máximo probado como carga en el SHA actual: ninguno (`NOT_TESTED`). El smoke histórico de cinco sesiones fue funcional y en un SHA anterior; no es benchmark.
4. Primer límite real: desconocido. CPU, RAM, I/O del HDD y OpenSearch son riesgos a medir, no cuellos de botella demostrados.
5. RAM por aplicación: un snapshot de backend ~111 MB; falta pico concurrente, workers OCR y número de instancias.
6. OpenSearch: 2 GB heap configurado, ~1,304 GB usados en el snapshot; no equivale a la RAM total de JVM.
7. PostgreSQL: pool Prisma 10 por proceso y `max_connections=100`; concurrencia sostenible no medida.
8. Descargas PDF: throughput de red, streaming efectivo bajo carga, tiempos y uso de disco no medidos.
9. OCR simultáneo: no probado en carga. Mantenerlo fuera del benchmark hasta aislar y medir CPU/colas.
10. Hardware para 500: no hay base para una compra certificada. Primero benchmark externo con corpus anonimizado/sintético representativo; luego separar app, PostgreSQL, OpenSearch y storage según RPS y crecimiento medidos.
11. Margen de crecimiento: `NOT_MEASURED`.
12. Arquitectura: no se demostró necesidad de Redis, microservicios ni cola nueva. Sí hace falta un entorno físico de ensayo y un plan de recuperación medido antes de certificar usuarios.
13. Caídas: OpenSearch es single-node; no hay tolerancia de nodo para Search. RTO de restablecimiento `NOT_MEASURED`.
14. Recuperación: no se ejecutó drill de restore este sprint; RTO/RPO `NOT_MEASURED`.
15. Monitoreo: conservar health checks y registros actuales; falta un recolector con series de CPU/memoria/disco, latencia/5xx, conexiones, jobs/outbox y edad del último backup, con retención y alertas internas.

Para el próximo benchmark, alojar el generador y el SUT en hardware separado de Office, usar datos sintéticos, definir SLO/umbrales antes de correr, escalar gradualmente y abortar ante saturación. Grafana k6 documenta thresholds para convertir p95 y tasa de fallos en criterios explícitos ([documentación oficial](https://grafana.com/docs/k6/latest/using-k6/thresholds/)). No usar extrapolación lineal como certificación.

## Estado de publicación

```text
GALILEI_FUNCTIONAL_REVIEW=PARTIAL_WITH_PRIOR_EVIDENCE
CRITICAL_BUGS_FOUND=0 newly confirmed P0/P1; no broad audit claimed
HIGH_PRIORITY_BUGS_FOUND=0 newly confirmed P1 in this sprint
HIGH_PRIORITY_BUGS_FIXED=0
NEW_BETA_ISSUES=1 (BETA-029, P2, fixed in candidate; QA only)
SAVED_SEARCHES=EXISTING_PLUS_JURISPRUDENCIA_ACCESS_FIX_QA_ONLY
JURISPRUDENCE_ALERTS=PARTIAL_MANUAL
BUG_REPORTING=NOT_IMPLEMENTED
OPERATIONS_MONITORING=PARTIAL
PUBLIC_PRIVATE_ISOLATION=PASS_QA_ONLY (prior evidence; not rerun here)
WORKSPACE_ACL=PASS_QA_ONLY (prior evidence; not rerun here)
PERSONAL_DOCUMENT_PRIVACY=PASS_QA_ONLY (prior evidence; not rerun here)
QA_E2E=PASS directed authenticated API + Chromium mocked navigation (2/2); Office NOT_VERIFIED
PERFORMANCE_BASELINE=PARTIAL_RESOURCE_SNAPSHOT_NO_LATENCY_OR_LOAD
MAX_TESTED_CONCURRENT_USERS=NOT_TESTED
500_CONCURRENT_SESSIONS=NOT_TESTED
500_ACTIVE_USERS=NOT_TESTED
LOAD_TEST_OFFICE_EXECUTED=NO
RESOURCE_ESTIMATE_500_USERS=PARTIAL
BOTTLENECKS_IDENTIFIED=RISKS_ONLY; NONE_PROVEN_BY_LOAD
BOTTLENECKS_FIXED=0
MONITORING_BASELINE=HEALTH_READINESS_PLUS_SEARCH_TELEMETRY; HOST_TRENDS_MISSING
BETA_026_HUMAN_VALIDATION=PENDING
MIGRATION_REQUIRED=NO for BETA-029; YES for future durable alerts/reporting (not applied)
OFFICE_DEPLOY=NOT_DONE
DEPLOYED_SHA=439186bdc92e7cafc58f3a8156d639d65cfddaf2
ORIGIN_DEV_SHA=439186bdc92e7cafc58f3a8156d639d65cfddaf2
ORIGIN_DEV_PROMOTED=NO
ORIGIN_MAIN_UNCHANGED=YES (83947656420a9d6f6c3cfb12b353eb7f2c293a28)
```

Este candidate no se presenta como validado en Office. La publicación visible requiere el updater oficial y comprobaciones post-deploy; la prueba de navegación de Office sigue pendiente. No hay autorización para migraciones de Office; BETA-029 no las necesita.

## Addendum de continuidad — 19 de noviembre de 2026

Este addendum conserva los estados históricos anteriores y registra el candidate separado `feature/galilei-alerts-reporting-20261119`, basado en `4de42b97b22430a45c5562fbd6659f5b9d6c296f`.

### Estado de despliegue y aislamiento

| Elemento | Estado observado en esta fase |
|---|---|
| Office desplegado | `4de42b97b22430a45c5562fbd6659f5b9d6c296f`; no se volvió a desplegar |
| `origin/dev` | `4de42b97b22430a45c5562fbd6659f5b9d6c296f`; no se modificó |
| `origin/main` | `83947656420a9d6f6c3cfb12b353eb7f2c293a28`; sin cambios |
| Migraciones Office | 41; sin cambios |
| QA integrado | PostgreSQL aislado `127.0.0.1:55434`, OpenSearch `127.0.0.1:19201`, API `127.0.0.1:43003`, UI `127.0.0.1:43004`; storage separado |
| Migraciones QA | 42/42; se aplicó sólo `20261119120000_saved_search_alerts_and_problem_reports` en la base QA |
| Publicación de feature | Implementación publicada por push normal a `origin/feature/galilei-alerts-reporting-20261119` (`570763da5216bdb8aea6031a6611187cf34cd190`); Office continúa sin deploy |

### EVOL-001 — alertas internas en búsquedas guardadas

Se agregó `alertasActivas` por búsqueda, activa por defecto. El usuario puede pausar y reactivar el seguimiento desde Búsquedas guardadas. Mientras está pausada, la carga de la lista omite la evaluación de novedades y pone el contador visible en cero; la consulta conserva sus filtros y el punto de inicio. La detección usa la fecha de publicación de fallos públicos, no cambios técnicos de índice. No se envían correos ni se agregan servicios externos.

**Alcance:** `PASS_QA_ONLY` para pausa/reactivación, persistencia tras recarga, privacidad por usuario y estado. Es una notificación interna consultada al abrir la lista; no hay worker de entrega en segundo plano. La aprobación no debe presentarse como validación Office ni como notificación push.

### EVOL-002 — reportes de problemas desde Galilei

Se incorporó un formulario autenticado y una vista exclusiva de ADMIN. El registro conserva tipo, descripción, ruta sin query string, acción opcional, módulo, versión e identificador de error opcional. No recibe capturas ni archivos, y la UI advierte que no se incluyan credenciales, información personal ni contenido jurídico privado. El administrador puede filtrar por estado/prioridad, cambiar estado/prioridad, guardar observaciones internas y relacionar duplicados con un reporte original. La auditoría registra creación y cambios sin copiar la descripción ni las notas.

**Validación integrada QA:** JURISPRUDENCIA creó dos reportes sintéticos; ADMIN los actualizó, filtró y vinculó como duplicados; REVISOR recibió 403 por API y la UI mostró “No autorizado”. Se verificaron cuatro eventos de auditoría. Los dos reportes sintéticos se eliminaron por sus identificadores únicos en la base aislada, preservando auditoría. No se dejaron búsquedas sintéticas.

### Regresiones y calidad

El recorrido real con Chromium/Edge detectó que el patrón HTML del identificador de error era inválido bajo la sintaxis moderna `v`. Se corrigió y el E2E ahora comprueba que un identificador con guiones sea válido. Validación final del recorrido integrado: `PASS`; 0 respuestas 5xx, 0 errores inesperados de consola y 0 errores JS. El 403 esperado del control de rol quedó clasificado como denegación ACL, no como fallo de servicio.

El server typecheck, ESLint dirigido, build y 3 suites server (15 pruebas) habían pasado antes del fix exclusivo de cliente. Después del fix, client typecheck, ESLint dirigido, build de producción y E2E integrado pasaron. Vite mantiene su aviso existente por el chunk PDF grande. No se ejecutó una auditoría de corpus, OCR real, carga ni pruebas en Office.

### Pendientes y límites

| Tema | Estado actual | Siguiente gate |
|---|---|---|
| Búsquedas guardadas y acceso JURISPRUDENCIA | `PASS_QA_ONLY` acumulado | Verificar en Office sólo después de un deploy autorizado |
| Alertas internas pausable/reanudables | `PASS_QA_ONLY`; consultadas al abrir la lista | Requiere migración exacta en Office y prueba humana; no hay envío en segundo plano |
| Reporte y administración de problemas | `PASS_QA_ONLY` integrado | Requiere migración exacta en Office y smoke autenticado por rol |
| BETA-026 | `OCR_OFFICE_E2E=NOT_VERIFIED` | Validación humana en Office; no se procesó OCR real aquí |
| Monitoreo operativo | `PARTIAL` | No hay series históricas/alertas de host demostradas |
| Capacidad para 500 usuarios | `NOT_TESTED` | Hace falta un entorno físico separado y un plan de carga gradual |

El candidate contiene la migración `20261119120000_saved_search_alerts_and_problem_reports`. No se aplicó a Office y no debe desplegarse allí sin autorización expresa que cite ese identificador exacto. QA y Office comparten host físico, por lo que tampoco se ejecutó benchmark en esa máquina. La capacidad para 500 sesiones o usuarios activos continúa sin certificación.

```text
SAVED_SEARCH_ALERT_CONTROLS=PASS_QA_ONLY
INTERNAL_PROBLEM_REPORTING=PASS_QA_ONLY
INTEGRATED_BROWSER_E2E=PASS
UNEXPECTED_5XX=0
UNEXPECTED_CONSOLE_ERRORS=0
PAGE_ERRORS=0
QA_SYNTHETIC_REPORTS_REMAINING=0
QA_AUDIT_ROWS_PRESERVED=YES
OFFICE_MIGRATION_20261119120000=NOT_APPLIED
OFFICE_DEPLOY=NOT_DONE
ORIGIN_DEV_PROMOTED=NO
ORIGIN_MAIN_UNCHANGED=YES
CAPACITY_500_USERS=NOT_TESTED
FEATURE_BRANCH_PUSH=PASS
FEATURE_IMPLEMENTATION_SHA=570763da5216bdb8aea6031a6611187cf34cd190
```
