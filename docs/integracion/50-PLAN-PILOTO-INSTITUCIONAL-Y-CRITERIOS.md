# 50 — Plan de piloto institucional y criterios de salida

## Precondiciones

- Autorización expresa para entrega e indexación; dueño de datos y contacto de incidentes.
- Export con IDs estables, diccionario de columnas, período/cobertura, checksum del proveedor y reglas de actualización/revocación.
- Decisión institucional sobre ACL, datos personales, anonimización y qué material puede llegar a rutas públicas.
- Responsable funcional valida clasificación Civil, órgano judicial y metadata; personal técnico no infiere procedencia.

## Piloto propuesto

1. Iniciar en staging aislado con un paquete sintético y luego una muestra institucional autorizada pequeña (objetivo inicial <=100 documentos), tras aprobación formal.
2. Validar manifiesto y comparar cada hash/id/fecha/órgano con el inventario de origen; mantener receipt inmutable por run.
3. Comprobar PDF textual vs `OCR_REQUIRED`, duplicados, nueva versión, reintento, revocación y visibilidad con cuentas de cada rol.
4. Evaluar consulta únicamente sobre el subconjunto autorizado, paginación, links de documento, rango, latencia, errores y logs sin secretos.
5. Revisar discrepancias y aprobar o detener; escalar volumen por etapas con rollback/retención definido.

## Gates

No GO institucional hasta que pasen: autorización documentada; 100% de hashes válidos; ningún path fuera de paquete; 0 escrituras fuera de DEV durante ensayo; conteo reconciliado; ACL revisada por responsable; descarga denegada para restringidos; idempotencia demostrada; registros de procedencia y auditoría preservados; aceptación funcional y acuerdo de SLO/carga. El piloto real no se ejecutó en M7.1.
