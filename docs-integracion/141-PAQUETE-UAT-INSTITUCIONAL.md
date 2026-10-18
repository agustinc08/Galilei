# 141 — Paquete de UAT institucional

**Estado:** PENDING. Este guion se ejecuta cuando haya preproducción autorizada, usuarios reales aprobados, corpus y ACL definidos. Cuentas sintéticas DEV y Playwright no cuentan como aceptación institucional.

## Participantes por perfil

| Perfil funcional | Participante / área | Cuenta preprod | Aprobación |
|---|---|---|---|
| LECTOR | Pendiente | Pendiente por alta institucional | PENDING |
| REVISOR | Pendiente | Pendiente por alta institucional | PENDING |
| JURISPRUDENCIA | Pendiente | Pendiente por alta institucional | PENDING |
| DIGESTO | Pendiente | Pendiente por alta institucional | PENDING |
| ADMIN | Pendiente | Pendiente por alta institucional | PENDING |

No crear usuarios hasta que el owner de identidad provea nombres, correos, roles, vigencia y aprobación por canal seguro. No escribir contraseñas en la planilla UAT.

## Sesión por participante

Registrar ID del caso, fecha/hora, perfil, build/release, resultado PASS/FAIL/BLOCKED, evidencia sin datos personales/documentos restringidos, severidad, responsable y decisión del usuario. El facilitador no debe cambiar ACL durante la sesión.

| ID | Tarea del usuario | Resultado esperado |
|---|---|---|
| UAT-01 | Ingresar y confirmar que la navegación corresponde al perfil asignado | Acceso correcto; enlaces no autorizados ausentes |
| UAT-02 | Buscar `responsabilidad` y abrir un resultado autorizado | Lista coherente con permisos; abrir metadata y procedencia |
| UAT-03 | Ejecutar frase `"responsabilidad civil"` | Resultados comprensibles; confirmar si respeta la frase exacta |
| UAT-04 | Ejecutar prefijo `responsabilid%` y sufijo `%civil` | Resultados revisables, sin error de interfaz |
| UAT-05 | Ejecutar término corto `de` | La UI explica el resultado conforme a Search vigente |
| UAT-06 | Ejecutar `responsabilidad AND contrato`, `responsabilidad OR contrato` y `responsabilidad NOT mediacion` | Sintaxis y resultados entendibles; reportar diferencias inesperadas |
| UAT-07 | Abrir un documento permitido y navegar páginas/visor | Documento correcto y lectura fluida |
| UAT-08 | Descargar o abrir un documento | Sólo si el perfil y ACL aprobados lo permiten; comprobar auditoría requerida |
| UAT-09 | Realizar acción propia del perfil (revisión, selección o Digesto) | Sólo acciones autorizadas; historial/confirmación comprensible |
| UAT-10 | Cerrar sesión y volver atrás en el navegador | Sesión cerrada; datos restringidos no quedan accesibles |
| UAT-11 | Reportar errores, demora o resultados parciales | Incidencia con ID, hora, familia Search y latencia; no copiar consulta sensible |

## Cierre de la sesión

El usuario registra aceptación/rechazo por tarea y observaciones. Área responsable clasifica cada incidencia P0–P3; un P0 de ACL, visibilidad o identidad detiene UAT. El owner funcional decide si el flujo cumple el trabajo real. El resultado sólo puede marcarse PASS después de la sesión humana ejecutada con build/corpus/ACL identificados.

**Acta:** release ______ · corpus manifest ______ · participante/perfil ______ · fecha ______ · resultado ______ · responsable ______ · observaciones/incidencias ______.

## Revisión del paquete — PREPROD-UAT-PREP-1 (2026-10-18)

**UAT institucional: NOT STARTED.** El plan está preparado; no hay ambiente real, personas invitadas, usuarios ni credenciales. Ninguna cuenta sintética local cuenta como UAT.

### Propósito, alcance y participantes

Validar con personal institucional que los flujos y resultados permiten realizar las tareas acordadas sobre una versión, corpus y matriz ACL identificados. Participan lectores, revisores, operadores de Jurisprudencia, operadores de Digesto y administrador institucional, con owners funcionales y facilitador. Las altas sólo las realiza el owner de identidad con aprobación y vigencia; no guardar contraseñas en actas.

### Precondiciones

- PREPROD provisionado y aislado de DEV/producción; URL HTTPS privada aprobada.
- Release SHA/build IDs, migraciones, corpus manifest y Search projection registrados.
- Backup DB/storage y restore drill preprod aprobados; readiness, Search, Viewer y storage pasan.
- Cuentas por perfil creadas por identidad; ACL de dependencias/documentos preparada y revisada con datos autorizados o anonimizados.
- Plan de reset/retención aprobado; canal de incidencias y responsables definidos. Prohibido copiar documentos restringidos a la planilla o capturar consultas sensibles.

### Perfiles y flujos

| Perfil | Flujos a validar |
|---|---|
| LECTOR | Inicio de sesión, Search público/autorizado, detalle/Viewer, descargas permitidas, Mi Sala/Mis documentos sólo cuando tenga membresía. |
| REVISOR | Cola propia, abrir/revisar documento autorizado, estado/historial, límites de acceso. |
| JURISPRUDENCIA | Buscar, abrir, acciones editoriales permitidas, estado/auditoría y rechazo de acciones fuera de rol. |
| DIGESTO | Consulta y acciones acordadas sobre contenido importado; procedencia y estado legibles. |
| ADMIN | Gestión permitida de miembros/espacios/configuración, sin acceso implícito a documento restringido por ser admin global. |

Usar los UAT-01–UAT-11 ya definidos arriba como guion base. Añadir recorrido UX: `/galilei` → Jurisprudencia → resultado/detalle/Viewer; `/spaces` con cero/una/múltiples dependencias; `/personal`; `/spaces/manage` sólo para el perfil habilitado. Probar permiso permitido y denegado para Search, conteos, metadata, Viewer y descarga.

### Fixtures, severidad y aceptación

Fixtures deben ser sintéticos o institucionales expresamente aprobados, pequeños, deterministas y con manifest (ID, origen autorizado, hash, ACL, idioma/formato); no importar el corpus DEV sin autorización. No reutilizar cuentas ni contraseñas DEV. Reset significa recrear DB/storage/proyección UAT según runbook y aprobación del owner, preservar evidencia necesaria y verificar conteos; nunca borrar globalmente ni tocar fuente.

- **P0:** fuga ACL, acceso cruzado, identidad/rol incorrecto, pérdida/corrupción; detener UAT y bloquear aceptación.
- **P1:** flujo crítico inutilizable o documento/procedencia incorrectos; bloquear cierre hasta resolver/aceptación formal.
- **P2:** función degradada con workaround; owner decide priorización antes de aceptar.
- **P3:** cosmético/usabilidad menor; registrar y acordar destino.

Cada observación registra ID, fecha/hora, perfil, release, escenario, resultado esperado/real, severidad, pasos reproducibles, request ID y evidencia redactada. No incluir tokens, passwords, URL con query, texto sensible, documentos o datos personales.

UAT se acepta sólo con todos los perfiles/escenarios críticos ejecutados, PASS del owner funcional, cero P0 abiertos, P1 cerrados o aceptados formalmente, permiso denegado verificado, backup/restore y reset aprobados y acta vinculada a release/corpus/ACL. No es benchmark de Search, prueba de carga, pentest, auditoría de código ni repetición de replay de migraciones; esos gates son independientes.

**Estado actual:** plan READY como documento; environment AFTER_INFRA; UAT real NOT STARTED; no invitar usuarios.
