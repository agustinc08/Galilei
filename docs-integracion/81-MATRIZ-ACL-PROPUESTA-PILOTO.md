# ACL propuesta para el piloto — Sprint 11

**Estado: propuesta pendiente de validación por dueños institucionales.** Los roles reflejan permisos de API observados en DEV y no constituyen delegación institucional aprobada.

| Capacidad | ADMIN | OPERADOR | LECTOR | REVISOR | JURISPRUDENCIA | DIGESTO |
|---|---:|---:|---:|---:|---:|---:|
| Buscar y leer contenido INTERNAL | Sí | Sí | Sí | Sí | Sí | Sí |
| Leer contenido PUBLIC publicado | Sí | Sí | Sí | Sí | Sí | Sí |
| Descargar archivo sujeto a ACL del documento | Sí | Sí | Sí | Sí | Sí | Sí |
| Ver tablero administrativo y salud | Sí | Según API | No | No | No | No |
| Clasificar / aprobar sugerencias | Sí | Sí | No | Sí | No | No |
| Curar asociaciones y sumarios de Jurisprudencia | Sí | Según permiso configurado | No | Según permiso configurado | Sí | No |
| Curar colecciones, temas, etiquetas de Digesto | Sí | Según permiso configurado | No | No | No | Sí |
| Cambiar visibilidad/publicación | No habilitar en piloto sin aprobación específica | No habilitar | No | No | No | No |
| Administrar cuentas y roles | ADMIN únicamente, con auditoría | No | No | No | No | No |
| Consultar bitácora | ADMIN; alcance mínimo necesario | No por defecto | No | No | No | No |

Las celdas “según permiso configurado” requieren prueba por endpoint y revisión de negocio antes de aceptar. Aplicar mínimo privilegio, denegar por defecto, verificar ACL antes de conteo/resultados/descarga y emitir 403 sin exponer detalles internos. Cada cambio editorial debe asociar usuario, entidad, acción, fecha y motivo; no borrar el evento original para simular reversión.

Antes de UAT, validar por área: acceso a INTERNAL, manejo de PUBLIC, descarga, exportación, cambios reversibles, administración de roles, alcance de bitácora, retención de sesiones y segregación entre Digesto y Jurisprudencia. Mantener JWT en localStorage como riesgo conocido del piloto; no habilitar acceso de red compartida.
