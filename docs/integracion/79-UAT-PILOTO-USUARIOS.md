# UAT del piloto — Sprint 11

**Estado: checklist preparada; aceptación humana pendiente.** Esta UAT se ejecuta únicamente en DEV local con fixtures/datos ya importados. La ejecución técnica automatizada no equivale a aprobación institucional.

## Registro de sesión

| Campo | Completar durante UAT |
|---|---|
| Fecha y hora |  |
| Responsable y área |  |
| Versión / commit |  |
| Ambiente | PostgreSQL DEV local |
| Resultado global | Pendiente |

Por cada caso marcar **PASS / FAIL / OBSERVACIÓN / SUGERENCIA** y registrar comentario, perfil y evidencia sin incluir credenciales ni datos personales innecesarios.

| ID | Perfil | Caso verificable | Resultado | Observación |
|---|---|---|---|---|
| UAT-01 | Secretaría / Jurisprudencia | Buscar con términos, frase, filtros y acentos; abrir resultado y explicar su procedencia. | Pendiente | |
| UAT-02 | Secretaría / Jurisprudencia | Revisar asociación y cambiar estado con motivo; confirmar historial y reversión controlada. | Pendiente | |
| UAT-03 | Secretaría / Jurisprudencia | Consultar y editar sumarios/temas conforme a ACL aprobada para el piloto. | Pendiente | |
| UAT-04 | Digesto | Crear/consultar colección, tema y etiqueta; agregar/quitar documento de una colección y verificar que el archivo permanece. | Pendiente | |
| UAT-05 | Digesto | Filtrar una colección y revisar título, fuente, fecha, checksum y estado OCR. | Pendiente | |
| UAT-06 | Consulta | Buscar, paginar, filtrar y abrir PDF; probar fragmento, descarga, archivo grande y error de archivo ausente. | Pendiente | |
| UAT-07 | Consulta | Verificar que contenido INTERNAL requiere sesión y que PUBLIC respeta política de publicación. | Pendiente | |
| UAT-08 | Administración | Revisar readiness, tablero, pendientes y drill-down; contrastar conteos con el inventario de DEV. | Pendiente | |
| UAT-09 | Administración | Revisar usuarios/roles, bitácora filtrada y respuesta 403 para acciones no autorizadas. | Pendiente | |
| UAT-10 | Todos | Cerrar sesión y confirmar retorno a login; repetir acceso con sesión vencida o usuario inactivo. | Pendiente | |

## Incidencias y aceptación

| ID | Severidad | Perfil | Pasos / resultado esperado | Resultado observado | Evidencia | Responsable |
|---|---|---|---|---|---|---|
| — | — | — | — | Sin incidencias humanas registradas todavía | — | — |

Severidad: **P0** impide piloto; **P1** afecta workflow principal; **P2** molesta pero permite trabajar; **P3** mejora. Al cerrar cada hallazgo registrar acción correctiva, responsable y estado.

La persona responsable de cada área debe completar la tabla, y Administración debe registrar el dictamen global. No marcar esta UAT como aceptada hasta que exista firma/nombre y fecha de quienes participaron.
