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
