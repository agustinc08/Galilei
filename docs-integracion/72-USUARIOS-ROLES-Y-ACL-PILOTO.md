# Sprint 10 — Usuarios, roles y ACL del piloto

Se prepararon cuentas automatizadas sólo para PostgreSQL DEV (`@example.invalid`): ADMIN, OPERADOR, LECTOR, REVISOR, JURISPRUDENCIA y DIGESTO. El seed es idempotente. Las claves aleatorias están únicamente en `C:\proyecto triple\_recovery-work\sprint10\acceptance\credentials.json`, con ACL local restringida; no incluirlas en logs ni control de versiones.

| Capacidad | LECTOR | REVISOR | JURISPRUDENCIA | DIGESTO | OPERADOR | ADMIN |
|---|---:|---:|---:|---:|---:|---:|
| Login, búsqueda y lectura interna permitida | Sí | Sí | Sí | Sí | Sí | Sí |
| Descargar PDF Corpus interno autorizado | Sí | Sí | Sí | Sí | Sí | Sí |
| Revisar clasificación | No | Sí | Sí | No | Sí | Sí |
| Curar/seleccionar Jurisprudencia | No | No | Sí | No | Sí | Sí |
| Crear taxonomía/colecciones Digesto | No | No | No | Sí | No | Sí |
| Resumen/administración | No | No | No | No | Operación | Sí |

La matriz refleja rutas y guardas actuales, no validación institucional. Backend usa guardas de rol; UI oculta navegación/acciones restringidas. La integración PostgreSQL verificó login y `/auth/me` para los seis roles y 403 en acciones prohibidas.

JWT expira en 8 horas y frontend mantiene el token en `localStorage`. Las cuentas son fixtures técnicos, no identidades institucionales. Acordar alta, recuperación, baja y política de sesión antes de uso compartido.
