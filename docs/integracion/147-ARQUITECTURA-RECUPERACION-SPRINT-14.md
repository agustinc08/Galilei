# 147 — Arquitectura de recuperación — Sprint 14

## Flujo de datos

```text
catálogo público permitido
→ manifiesto de fuente + cursor/checkpoint
→ clasificación con evidencia
→ comparación previa por identidad externa
→ adquisición permitida a staging
→ validación de respuesta y SHA-256
→ comparación posterior por bytes
→ dry-run Corpus
→ backup DEV + import incremental bajo guard
→ proyección y smoke
```

Los documentos fuente y sus representaciones digitales tienen identidades separadas. Un tomo recopilatorio no se considera una sentencia individual. Para los tomos CSJN hallados, los enlaces quedan `PENDING_DOWNLOAD`; el modelo actual no justifica fragmentar ni etiquetar el tomo completo como Civil.

## Estado y seguridad

- CIJ: consumir sólo sitemap expresamente declarado; nunca solicitar rutas disallow ni resolver `cij7.test` hacia producción.
- Datos Abiertos: no llamar `/api/`, `/revision/` ni `history`; usar su catálogo público con al menos 10 s entre peticiones.
- CSJN TFN: no consultar `/tribunales-federales-nacionales/inicio.html` ni rutas PDF disallow.
- Secretaría: la UI muestra catálogo y enlaces PDF; el `robots.txt` consultado no devolvió texto de reglas legibles. La descarga quedó bloqueada por el ejecutor antes de crear archivo.
- Cualquier futura DB write exige `with-dev-db-guard.cjs` y verificación de `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`; no hubo writes en este sprint.

## Código

`server/scripts/sources/sprint14/core.cjs` contiene parsers offline, reglas Civil, reconciliación conservadora, estado incremental y verificación PDF. Las siete pruebas usan fixtures sin Internet. No contiene un downloader ni ejecuta SQL; un manifest de enlaces no constituye permiso de adquisición.
