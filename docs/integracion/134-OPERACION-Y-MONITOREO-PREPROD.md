# 134 — Operación y monitoreo preprod

**Estado:** diseño operativo; no hay servicio BJC preprod desplegado.

## Señales mínimas

| Señal | Verificación esperada | Umbral/owner |
|---|---|---|
| API liveness/readiness | `/api/health/live` y `/api/health/ready`; DB/storage en ready | Acordar IT |
| Disponibilidad y 5xx | Por servicio/ruta, sin payload sensible | Acordar IT |
| Search lento/errores de fuente | Duración/código/request ID sin query | Acordar con SLO |
| PostgreSQL/pools | Conectividad, saturación, espera, almacenamiento | DBA/IT pendiente |
| Storage y disco | Acceso, capacidad y crecimiento | Owner pendiente |
| Backup | Éxito, edad, tamaño y SHA; DB y storage por separado | Owner/RPO/RTO pendientes |
| Auditoría | Acciones privilegiadas, acceso y fallos relevantes | Seguridad pendiente |

## Límite actual y controles

El rate limit está en memoria por proceso; no es global entre réplicas. JWT en frontend usa el mecanismo de sesión actualmente implementado; duración, revocación y respuesta a baja/cambio de rol requieren validación institucional. No habilitar varias réplicas sin limitador compartido y sesión definida. TLS, CORS exacto, trust proxy/IP, rotación de secretos, retención y alertas dependen de la topología real. Mantener loopback hasta configurar esos controles.

## Operaciones

Antes de cambios: release/build ID, backup verificado de DB y storage, revisión de migraciones, ventana, responsables y rollback. Después: readiness, login, Search, archivo/rango, curaduría, Digesto, auditoría, logout y estado backup. Restore se ensaya en destino temporal aislado; nunca sobre DB viva. Runbook de deploy: doc 136; backup/restore DEV histórico: docs 90 y 123, que no certifican preprod.

## Corte PREPROD-UAT-PREP-1 (2026-10-18)

**Estado operativo: PREPROD_INFRA_NOT_PROVISIONED.** No hay host, URL, DB, OpenSearch, proxy ni storage institucional identificados o autorizados desde este equipo. No se ejecutó deploy, conexión institucional, restore preprod ni UAT. El runbook queda condicionado a que infraestructura complete el doc 140 y entregue accesos por vault.

### Señales y comprobaciones

| Señal | Comprobación | Límite actual |
|---|---|---|
| Proceso API | `GET /api/health/live` | Sólo confirma proceso; no confirma dependencias. |
| Readiness API | `GET /api/health/ready` | Comprueba DB (`SELECT 1`), acceso R/W al storage y OpenSearch green/yellow + alias; no certifica schema/proyección completa ni backlog. |
| Search | Smoke de TERM/PHRASE/PREFIX/SUFFIX/SHORT/AND/OR/NOT + consulta de fuente | Requiere identidad de prueba aprobada; no correr carga antes de ventana. |
| PostgreSQL | estado de servicio, pool, conexiones, disco y guard de identidad | `check` es sin conexión; `target-verify` es conectante y sólo se permite después del host/DB aprobados. |
| OpenSearch | cluster health, alias activo, fallos y proyección | Mantener clúster/usuario/prefijo aislados; DEV local v3 no es evidencia de preprod. |
| Outbox | edad/cantidad de eventos pendientes y eventos fallidos | El worker integrado despierta cada segundo; alertar por backlog sostenido y revisar logs sin guardar queries. |
| Procesamiento documental | cola/leases, trabajos fallidos y storage | OCR debe quedar apagado al inicio; shutdown no drena un OCR in-flight de forma demostrada. |
| Capacidad | disco DB, OpenSearch, storage y backup | No hay sizing institucional; C: local tenía ~40.8 GiB libres y no debe extrapolarse. |

Logs de aplicación van a stdout. Errores HTTP registran request ID, ruta, método, estado, duración y categoría; slow Search registra duración/request ID sin query. El logger de importación tiene ruta separada `back/logs/importacion`; retención y recolección se deben definir en el host. Nunca habilitar `BUSQUEDA_DEBUG`, `BJC_SEARCH_PROFILE`, `BJC_SEARCH_EXPLAIN_CAPTURE` u `OPENSEARCH_CANDIDATE_ONLY` en preprod.

### Arranque, apagado y recuperación

Orden: PostgreSQL 16 y OpenSearch seguros/green → storage montado y permisos verificados → migraciones explícitas bajo guard → backend API en loopback detrás del proxy → frontend con API HTTPS aprobada → readiness y smoke. El backend conecta Prisma, inicia el worker de outbox Search si encuentra alias, recupera escaneos fuente `QUEUED/RUNNING` marcándolos fallidos y recupera leases OCR aun con OCR deshabilitado. No corre migraciones ni rebuild completo al iniciar. Nest recibe señales de shutdown; OpenSearch espera la operación in-flight y Prisma desconecta. OCR activo no tiene drain validado; mantener `OCR_ENABLED=false` hasta ensayo de restart aislado.

Un restart puede escribir registros de recuperación/outbox; relevar esos efectos antes de reiniciar durante UAT. No escalar a varias réplicas: el rate limit es local por proceso y el preflight exige una réplica. Para restaurar, crear recursos de reemplazo aislados, validar hashes del dump y archivos, restaurar allí, comprobar conteos/migraciones/proyección y hacer cambio controlado; no restaurar sobre DB activa ni borrar el origen.
