# 138 — Gaps de preparación para producción

**Dictamen:** **NOT READY FOR PRODUCTION PLANNING**. No existe preprod técnica desplegada ni UAT suficiente para reunir el criterio del Sprint 13.

| Gap | Estado/evidencia | Owner que debe resolver | Gate de cierre |
|---|---|---|---|
| Host/topología preprod | No identificado; sólo equipo local DEV | IT institucional | Host privado autorizado y ficha doc 126 completa |
| Configuración preprod | Validador fail-closed agregado y probado con fixtures sintéticos; no probado en host objetivo. `LOG_LEVEL` no está aplicado; validator limita deployment a una réplica por rate limit en memoria | Desarrollo + IT/Seguridad | Startup positivo/negativo en host autorizado, decidir logging; si se requiere escalar, implementar limitador compartido y validar |
| Base/storage separados | No hay DB/storage preprod confirmados | DBA/IT | DB nueva, permisos mínimos, almacenamiento y restore drill |
| UAT real | PENDING; sin participantes | Responsables de cada área | Sesión documentada por perfil, retests y aceptación |
| ACL | PENDING; propuesta doc 129 | Dueños de Jurisprudencia, Digesto, Consulta, IT | Matriz aprobada y pruebas de permisos antes de conteos/archivos |
| Anonimización/visibilidad | PENDING; sin regla institucional | Jurídico/privacidad/owner | Política aprobada y flujo/versionado probado |
| Retención/auditoría | PENDING | Archivo/seguridad/IT | Plazos, owners, controles y evidencia definidos |
| Digesto metadata/crosswalk | Export autorizado no recibido; doc 80 | Owner Digesto | Paquete autorizado, dry-run y crosswalk revisado; o decisión NOT REQUIRED FOR PILOT |
| Rendimiento real | Sólo medición local DEV doc 132 | IT/DBA/producto | Benchmark en topología preprod y SLO aceptado |
| Proxy/TLS/CORS/sesión | No configurados en host compartido; CORS HTTPS explícito se valida por código, pero origins institucionales faltan | Seguridad/IT | Política de red, TLS, proxy, origins, expiración y baja probadas |
| Rate limit multiinstancia | Memoria por proceso | IT/seguridad | Topología 1 instancia aprobada o limitador compartido probado |
| Backup/monitoring | Sólo evidencia DEV histórica | IT/DBA | DB y storage protegidos, alertas, restore y RPO/RTO aprobados |
| Corpus autorizado | Evidencia local DEV; no lote preprod aprobado | Owners de fuentes | Manifest, procedencia, ACL y autorización de copia aprobados |

P0/P1 observados en UAT: ninguno **registrado porque UAT no ocurrió**; no equivale a inspección satisfactoria. Producción no es objetivo automático de Sprint 13.
