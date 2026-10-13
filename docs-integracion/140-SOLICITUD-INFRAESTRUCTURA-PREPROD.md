# 140 — Solicitud de infraestructura para BJC preproducción

**Destinatario:** SYTEC / Infraestructura. **Estado:** solicitud pendiente; no hay target autorizado al corte Sprint 13.1.

## Entrega solicitada

Completar y devolver este inventario, junto con owner técnico, ventana y autorización escrita de uso. No incluir secretos en correo, ticket ni este documento.

| Recurso | Dato que debe informar/aprobar infraestructura |
|---|---|
| Host o VM | FQDN privado, owner, ambiente, método de acceso y responsable de operación |
| Sistema operativo | Distribución/versión soportada y política de parches |
| CPU / RAM / SSD | Capacidad asignada y límites; indicar crecimiento/alertas de disco |
| PostgreSQL | PostgreSQL 16, host/puerto, DB nueva (nombre conceptual `buscador_juridico_civil_preprod`), rol de servicio, TLS/autenticación y responsable de backup |
| Node.js | Versión compatible con el lockfile/runtime verificado (desarrollo validado con Node 24.19.0); versión institucional aprobada |
| Storage documental | Volumen persistente separado de DEV/producción, ruta absoluta en el host, cuota, owner/permisos y capacidad de backup |
| DNS / proxy / TLS | FQDN interno de frontend y API, proxy inverso, certificado/cadena, terminación TLS, headers y configuración de IP de cliente confiable |
| Backup | Destino separado, herramienta aprobada, cifrado, responsable, retención/RPO/RTO y procedimiento de restauración aislada |
| Red / firewall | Matriz origen→destino, protocolo/puerto, dirección y owner de cada regla; acceso de usuarios sólo por HTTPS al proxy |
| Cuenta técnica | Mecanismo institucional/vault, owner, rotación y permisos mínimos. Entregar referencia del secreto por vault; nunca el secreto |
| Capacidad operativa | Usuarios previstos, crecimiento del corpus, horario, monitoreo y ventana de despliegue |

## Topología solicitada

```text
Usuario institucional
        │ HTTPS privado
        ▼
Reverse proxy (DNS + TLS)
        │ frontend/API según rutas aprobadas
        ▼
Frontend ───────► Backend API
                       ├────► PostgreSQL 16 preprod
                       └────► Corpus Storage preprod
```

DB y storage de preproducción deben ser recursos independientes. Queda prohibido `PREPROD → DEV DB`, `PREPROD → DEV STORAGE` y `PROD → DEV DB`. No usar el equipo de desarrollo como host institucional.

## Base de capacidad observada

Sprint 12.3 midió en DEV local el endpoint Search: PHRASE p50/p95 1.400/1.459 ms, SHORT 1.718/1.899 ms y término común 119/234 ms. Concurrencia local 1/5/10 dio Search p95 259/1.331/2.619 ms; 20 usuarios, 4.284 ms, sin errores en esa corrida. La proyección DEV tuvo 11.008 documentos y 9.475.712 tokens. El índice GIN medido fue 210.452.480 bytes. Son referencias del hardware/corpus DEV y no SLO ni sizing de preprod.

Por eso no se fija CPU/RAM/SSD arbitrariamente. Infraestructura debe confirmar el corpus autorizado (modalidad A/B/C del doc 133), usuarios concurrentes previstos y espacio para DB/índices, archivos derivados, backup y restore temporal; luego asignar capacidad y umbrales con esa base. El volumen físico institucional histórico de Sprint 8 fue 4.866.746.671 bytes, pero no autoriza copiar ese corpus a preprod.

## A completar por infraestructura

```text
Owner / ticket de autorización:
Host / OS:
CPU / RAM / SSD y cuota:
PostgreSQL 16 / endpoint / DB / rol:
Node.js:
Storage / ruta / cuota:
DNS frontend / API:
Proxy / TLS:
Backup / restore / RPO / RTO / retención:
Firewall (origen, destino, puerto, protocolo):
Vault / service account owner:
Usuarios concurrentes / corpus autorizado:
Ventana / rollback owner:
```
