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
