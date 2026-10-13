# 42 — Alcance Justicia Nacional en lo Civil

**Verificado:** 2026-10-07. **Estado:** alcance identificable en la UI oficial; catálogo completo de primera instancia pendiente de canal consultable autorizado.

## Definición v1

El universo objetivo es **Justicia Nacional en lo Civil — CABA**, bajo la Cámara Nacional de Apelaciones en lo Civil. No es un filtro textual genérico por “civil”. La superficie oficial permite restringir por jurisdicción y tribunal, y presenta una opción exacta para la Cámara Nacional de Apelaciones en lo Civil.

| Nivel | Valor/catálogo oficial observado | Incluido | Motivo / límite |
|---|---|---:|---|
| Jurisdicción | Capital Federal | Sí | Delimita el distrito CABA en el buscador detallado. |
| Cámara | Cámara Nacional de Apelaciones en lo Civil | Sí | Coincidencia exacta con el órgano de segunda instancia objetivo. |
| Salas | Salas pertenecientes a la Cámara Nacional en lo Civil | Sí | Debe mapearse del tribunal publicado; el catálogo de salas completo no se enumeró por requests automáticos. |
| Primera instancia | Juzgados Nacionales de Primera Instancia en lo Civil | Sí | La página actual declara cobertura de primera instancia desde la incorporación de 2025 y muestra registros de juzgados civiles; faltó obtener un catálogo completo verificable. |
| Instancia | Primera / segunda según el tipo de oficina y tribunal publicado | Sí | No inferirla desde carátula; conservar el valor original y mapear sólo categorías inequívocas. |
| Civil y Comercial Federal | Cámara Nacional de Apelaciones en lo Civil y Comercial Federal | No | Fuero federal distinto; aparece como opción separada. |
| Comercial | Cámara Nacional de Apelaciones en lo Comercial | No | Fuero distinto. |
| Trabajo / Contencioso / Penal / Seguridad Social | Cámaras nacionales/federales correspondientes | No | Fuero distinto aunque jurisdicción sea Capital Federal. |
| Justicia provincial y otros distritos federales | Tribunales distintos a Capital Federal y a la órbita de la Cámara Civil Nacional | No | Fuera del alcance institucional v1. |

## Clasificación segura

Usar la identidad del tribunal/cámara y jurisdicción estructuradas que publique el buscador. Una entrada se incluye sólo si el órgano es la Cámara Nacional en lo Civil (o una de sus Salas) o un Juzgado Nacional en lo Civil, y el distrito corresponde a Capital Federal cuando la fuente lo presenta. Un tribunal de otra cámara no se convierte en Civil por contener esa palabra en la carátula o materia.

El identificador de tribunal/cámara debe persistirse junto al texto original. Los nombres oficiales pueden cambiar; la normalización es una capa versionada, no sustitución del dato fuente. La separación de primera y segunda instancia debe basarse en tipo de oficina/tribunal o catalogación oficial.

## Límite de evidencia

La UI muestra Cámara Nacional en lo Civil como opción distinta de Civil y Comercial Federal y muestra registros de primera instancia civil. La lista completa de juzgados, salas/secretarías y sus códigos no se considera cerrada sin export/catálogo oficial reutilizable. Por eso no se publica una lista de IDs hardcodeada ni se crea una regla `LIKE '%CIVIL%'`.
