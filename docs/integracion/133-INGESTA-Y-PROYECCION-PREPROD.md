# 133 — Ingesta y proyección en preproducción

**Estado:** flujo DEV documentado; preprod no disponible. No importar, escanear roots reales ni reconstruir proyecciones hasta aprobación del destino, corpus y ACL.

## Identidad e invariantes

Preservar source ID estable, origen/legacy ID, SHA-256, nombre recibido seguro, fecha y manifest/receipt. Diferenciar duplicado binario de identidad jurídica. Originales son read-only; extracción/OCR y tokens son derivados versionados. El read model Search no es fuente de verdad. `sourceMissing` se conserva y revisa; no borrar automáticamente. Excluir `tb_microisis` de importaciones automáticas.

## Procedimiento de prueba seguro

1. Aprobar corpus sintético o paquete institucional autorizado y definir storage aislado.
2. Verificar host/DB/rol de preprod y backup; jamás reutilizar DB DEV ni un destino no identificado.
3. Validar manifest/hash y ejecutar dry-run; revisar errores, ACL, visibilidad, tamaño y rutas contenidas.
4. Importar sólo después de autorización del owner; medir extracción, páginas, indexabilidad y tiempo hasta Search.
5. Ejecutar verify de proyección, anotar documentos/stale/muestra y repetir import para idempotencia.
6. Registrar nuevos/modificados/faltantes sin mutar origen; detenerse si roots no coinciden exactamente con los aprobados.

El paquete Digesto de metadata/crosswalk no se recibió. No inventar taxonomía ni IDs; usar `80-ESPECIFICACION-EXPORT-DIGESTO.md` y hacer dry-run antes de cualquier import futuro. Las rutas PDF CIJ/CSJN automatizadas siguen NO GO.
