# Preproduction Gate — Sprint 12

## TECHNICAL: NOT READY

| Gate | Estado | Evidencia |
|---|---|---|
| Search | FAIL | Familias frecuentes/NOT/phrase entre ~5 y 20 s; handler p95 hasta ~20,7 s. |
| Concurrencia | FAIL | 10 usuarios: Search p95 74 s, 3/120 errores; 20: p95 82 s, 5/240 errores. |
| Backup | PASS de archivo solamente | Dump y SHA verificados; contenido del archive no pudo listarse. |
| Restore aislado | BLOCKED | App Control impide `pg_restore`; `bjc_dev` sin CREATEDB. |
| Migraciones desde cero | BLOCKED | No fue posible crear DB efímera. DB actual: 14/14 al día. |
| Backend/frontend/tests/E2E | PASS | Backend 18 suites/76 PASS; typecheck/build PASS; frontend typecheck/build y Playwright 4/4 PASS. |
| Viewer/security local | PASS con límites | Range 206, sesión/roles/health en evidencia Sprint 11; buffering y hardening de destino pendientes. |
| OCR | PENDING | Dos páginas evaluadas, sin muestra aprobada ni revisión humana. |

## HUMAN ACCEPTANCE: PENDING

La UAT por perfiles sigue pendiente; E2E usa identidades sintéticas DEV. No hay feedback o firmas humanas.

## GATES INSTITUCIONALES

- ACL institucional: PENDING.
- Export/crosswalk Digesto: PENDING; no acceder a endpoint remoto ni inferir metadata.
- Adquisición automatizada CIJ/CSJN: NO GO hasta canal autorizado que resuelva restricciones.

No habilitar red compartida. Restore y migración son bloqueantes técnicos externos; Search y carga son bloqueantes de producto/arquitectura que requieren corrección medible.
