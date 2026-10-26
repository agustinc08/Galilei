# Gobierno del repositorio

Revisión read-only de GitHub al 2026-10-26 para `agustinc08/Galilei`:

- Visibilidad detectada: **public**. Este sprint no la modificó.
- `LICENSE`: ausente. No se eligió ni agregó una licencia.
- `main`: sin protección de branch y sin ruleset efectivo detectado; force-push y borrado no están restringidos por protección de rama.
- `dev`: sin protección de branch y sin ruleset efectivo detectado; force-push y borrado no están restringidos por protección de rama.
- Checks requeridos: ninguno antes de este sprint. El workflow agregado aquí define los jobs `Client validation`, `Server validation` y `Production dependency audit`; sus nombres pueden seleccionarse como checks requeridos tras confirmar el primer resultado real en GitHub.

## Recomendaciones

1. Decidir institucionalmente si el repositorio debe ser privado antes de alojar nuevos datos o documentación sensibles. No hacer el cambio como parte de una modificación de código.
2. Obtener una decisión jurídica/institucional sobre la licencia antes de agregar `LICENSE`.
3. Proteger `main` y `dev`: exigir pull request, impedir force-push y borrado, y requerir los tres checks de CI después de que GitHub los haya publicado y se confirme el contexto exacto.
4. Mantener `contents: read` como permiso mínimo del workflow; no añadir secretos productivos a CI.

La auditoría usó metadatos de repositorio y endpoints de protección/rulesets. No se mostró ni guardó el token de lectura. Las políticas de GitHub no se cambiaron.
