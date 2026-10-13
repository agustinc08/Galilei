# 143 — Checklist de bootstrap preprod

**Criterio:** cada casilla requiere evidencia identificable. Un `BLOCKED` impide avanzar al siguiente gate. No sustituir el entorno con DEV.

## Infraestructura y aislamiento

- [ ] Host/VM privada, owner, sistema operativo y autorización de uso recibidos (140).
- [ ] CPU/RAM/SSD aprobados según corpus A/B/C y concurrencia previstas; cuota/alertas documentadas.
- [ ] PostgreSQL 16 operativo; DB preprod separada (`buscador_juridico_civil_preprod` o nombre aprobado) y rol mínimo.
- [ ] DB efectiva no es DEV ni loopback; `with-preprod-db-guard.cjs check` pasa sin conectar.
- [ ] Storage documental persistente, absoluto, existente y separado de DEV/producción.
- [ ] DNS interno de frontend/API, reverse proxy y TLS privado revisados.
- [ ] Firewall permite sólo flujos aprobados; HTTPS de usuarios termina en proxy.
- [ ] Cuenta técnica/vault y rotación listos; ningún secreto en repositorio o reporte.

## Datos, continuidad y configuración

- [ ] Modalidad de corpus A completo autorizado / B subset aprobado / C fixtures elegida por owner.
- [ ] Manifest de corpus: documentos, archivos, bytes, SHA-256, source y timestamp.
- [ ] ACL, anonimización y retención aprobadas (142); export/crosswalk Digesto decidido.
- [ ] Backup previo de DB y storage verificado con SHA-256; RPO/RTO aprobados.
- [ ] Restore drill completado en DB/storage aislados de origen; revisar evidencia Sprint 12.1 (103–104), no repetir DEV restore.
- [ ] Configuración preprod validada fail-closed; CORS HTTPS, JWT, rate limits, timeout y réplica aprobados.
- [ ] Artefactos/release manifest identificados: versión, fecha, build IDs, commit, migraciones y Search projection.

## Despliegue y verificación técnica

- [ ] Migraciones inspeccionadas; `migrate status` limpio/entendido y plan de rollback aprobado.
- [ ] `migrate deploy` sólo en DB preprod verificada; jamás auto-migración en startup.
- [ ] Servicios iniciados por service manager institucional y detrás del proxy/TLS.
- [ ] Health/readiness API y DB/storage PASS.
- [ ] Corpus autorizado cargado o fixtures instalados según modalidad elegida; origen/hash conservados.
- [ ] Search projection `projection-rebuild` sólo si hace falta; `projection-verify` PASS y estado listo.
- [ ] Smoke del doc 144: login, TERM, PHRASE, PREFIX, SUFFIX, SHORT, AND, OR, NOT, abrir documento, PDF Range y logout.
- [ ] Carga 1/5/10 sólo después de aprobación de ventana; registrar p50/p95, errores y host.
- [ ] Backup success/failure, disco, 5xx, DB, storage y slow Search visibles para el owner operativo.

## Aceptación

- [ ] Usuarios reales de LECTOR, REVISOR, JURISPRUDENCIA, DIGESTO y ADMIN aprobados/creados por owner de identidad.
- [ ] UAT ejecutada por personas conforme doc 141; no usar cuentas sintéticas como evidencia.
- [ ] Incidencias P0/P1 cerradas o con decisión aprobada; ACL denegada comprobada.
- [ ] Owner funcional acepta el piloto; acta, evidencia y release manifest almacenados según retención acordada.

**Estado general:** BLOCKED hasta tener host y políticas aprobadas. Este checklist no autoriza producción ni red compartida.
