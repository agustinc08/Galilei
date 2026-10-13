# 46 — Resultado Misión 7 — CIJ / CSJN Civil

**Fecha de verificación:** 2026-10-07. **Dictamen:** FUENTE CIVIL OFICIAL — NO GO para ingesta automatizada con las rutas observadas.

## Respuestas

| Pregunta | Resultado |
|---|---|
| ¿Existe buscador oficial actual? | Sí: CSJN, Tribunales Federales y Nacionales. La URL CIJ histórica de sentencias redirige allí. |
| ¿Puede identificarse Civil? | Parcialmente sí. La UI ofrece la Cámara Nacional de Apelaciones en lo Civil separada de Civil y Comercial Federal; hay evidencia de juzgados civiles de primera instancia. Falta export/catálogo completo de oficinas y códigos. |
| ¿Hay CAPTCHA o auth en la UI observada? | No se observó en la página y formulario públicos. |
| ¿Hay ID candidato? | Sí, UUID `SGU` en el nombre de archivo; estabilidad semántica no verificada. |
| ¿Se puede descargar automáticamente el PDF por la ruta observada? | La ruta responde como PDF en la superficie oficial, pero está prohibida por robots CSJN; la ingesta automatizada no se ejecutó. |
| ¿Hay API/export/dataset oficial alternativo localizado? | No se encontró API documentada/estable. CKAN devolvió cero coincidencias para `fallos`, `sentencia` y `jurisprudencia`. |
| ¿Se puede reanudar/idempotencia/extraer/indexar/buscar? | M6 ya soporta flujo genérico, pero ninguna de esas etapas se probó con material oficial M7. |
| ¿Hay primera y segunda instancia? | La fuente declara incorporación de primera instancia en 2025; la UI muestra Cámara Civil y juzgado civil. Sin ingesta, ambas no fueron validadas extremo a extremo. |
| ¿Qué cubre el histórico? | El buscador actual indica disponibilidad desde 21/08/2013 y enlaza “fallos anteriores”. El destino legado muestra un total global (226.770) no filtrado por Civil y resultados fuera de pre-2013; no permite inferir período ni inventario Civil. |
| ¿Qué bloquea recuperación a escala? | `robots.txt` disallow sobre descargas CSJN `/tribunales-federales-nacionales/d/` y CIJ `/archivo-cij/adj/pdfs/`, falta de export alternativo probado, autorización masiva y catálogo íntegro de oficinas. |

## Trabajo realizado

- Verificación de las superficies CSJN/CIJ y la redirección vigente.
- Revisión pública de `robots.txt` para ambos hosts.
- Revisión puntual del buscador, controles/catálogos visibles, patrón de descarga/UUID y ayuda sobre fechas.
- Consultas de bajo volumen a `package_search` de Datos Abiertos CSJN.
- Documentación de alcance Civil y diseño condicionado del adapter futuro.

## Trabajo no realizado

- Sin descarga piloto ni nueva fuente Corpus. Un PDF fue previsualizado por el visor durante la verificación inicial del enlace; no se conservó ni se incorporó. Sin adapter remoto ejecutable.
- Sin cambios en DB, migraciones, fixture, archivos locales legacy, Search endpoint, fan-out o ACL.
- Sin benchmark ni prueba real de idempotencia/search sobre un PDF CSJN.
- Sin afirmar permiso legal/institucional de reutilización masiva.

## Gate de salida

No marcar Fase 7 DONE ni empezar recuperación histórica a escala. Reabrir sólo al recibir un mecanismo oficial autorizado que permita adquisición de PDFs y el catálogo necesario. Entonces implementar primero discovery-only/dry-run acotado y un piloto <=100 antes de cualquier batch. El fan-out a Search, ACL institucional y endpoint autenticado de archivo siguen siendo gates previos a exposición a usuarios.
