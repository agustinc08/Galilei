# Resultado Sprint 9 — decisión de salida

**Resultado: NO GO integral de aceptación.** Hay avance implementado y validado en DEV, pero no se cumplen todos los gates end-to-end. No es autorización productiva.

## Entregado

- Interfaz de navegación unificada, taxonomía Digesto sobre Corpus, visor y cola de revisión.
- Curaduría manual de asociaciones y clasificaciones, decisión editorial con motivo e historial, acciones batch limitadas a 20.
- Migración aditiva 20261008100000_sprint9_digesto_taxonomy, aplicada a la base DEV con backup previo.
- Scan incremental funcional; corrida real detectó 23.829 UNCHANGED y ninguna diferencia.
- OCR local español limitado e idempotente: 20/20 documentos, 94 páginas, texto de búsqueda, originales verificados intactos.
- Pruebas unitarias, PostgreSQL de integración sintético y builds frontend/backend.

## Evidencia de datos y ambiente

- Base: bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev; estado de migración al día, 14 migraciones.
- Corpus: 10.732 documentos, 10.752 archivos (20 derivados OCR), 23.829 ubicaciones, 95.486 páginas.
- Clasificación: 21.547 sugerencias; cero aprobadas.
- Asociación: 27 HIGH_CONFIDENCE y 2 CANDIDATE pendientes; 10.703 UNRESOLVED; cero cross-domain links reales.
- OCR residual: 379 OCR_REQUIRED y un PDF inválido; sin evaluación de exactitud contra ground truth.
- Scan incremental real: 0 NEW/MODIFIED/MISSING.
- Backup pre-Sprint9: _recovery-work/sprint9/backups/buscador_juridico_civil_dev-pre-sprint9-2026-10-08T03-19-16-620Z.dump, 220.766.179 bytes, SHA256 d4f0cce5e6a1b59b0c5a1360a7b55b6ecb6e8d7e3d88a9ce8d2a7df7bcd735ec.
- Suite general: 12 suites pass, 4 skipped; 61 pass, 13 skipped. Nest build y TypeScript pasan. Next production build y TypeScript pasan. Suites PostgreSQL opt-in previas al cierre: search 7/7, Corpus 3/3, paquete 2/2, curaduría 1/1.
- Fuentes originales read-only; sin acceso a producción, Digesto remoto ni scraping institucional.

## Gates pendientes para aceptación integral

1. Probar recorrido autenticado HTTP/browser con usuario autorizado de aceptación y matriz ACL real.
2. Acordar/exportar catálogo e identidad/ACL del Digesto institucional, validarlo e implementar búsqueda de contenido legacy; hoy no hay cross-domain links.
3. Validar decisiones de curaduría con responsables y dataset real; no se aprobaron las 29 asociaciones pendientes ni sugerencias de clasificación.
4. Medir exactitud OCR con transcripción de referencia y validar flujo con especialistas; ampliar más allá del lote inicial sólo después.
5. Aceptar UX de búsqueda/visor, incluyendo realce de coincidencias sobre el PDF, y probar navegación de punta a punta.
6. Acordar publicación, anonimización, retención y SLO/carga antes de producción.

Las suites sintéticas prueban lógica y persistencia DEV; no sustituyen aceptación de usuarios. Mantener GO sólo para desarrollo local acotado y NO GO para producción/aceptación funcional completa.
