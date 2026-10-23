# Sprint 15.5 — Search + Viewer final certification

> **Contexto INT-1 (2026-10-14):** Este contrato forma parte de Galilei integrado en la rama de integración. La interfaz presenta Jurisprudencia, Mi Sala / Juzgado y Mis documentos; Copernic queda como nombre interno. El estado global es PARTIAL y no habilita actualizar origin/dev: el snapshot local de publicación no coincide con el certificado y faltan los manifiestos J7/J8. Ver BJC-ESTADO-ACTUAL.md; los cortes y resultados históricos debajo conservan la fecha/sprint que los generó.


Fecha: 2026-10-14. Certificación original de componente ejecutada en feature/copernic, base 34ad48d965fc9576eacc5d0760b42e60531f830a. Revalidación INT-1 en integration/galilei-beta: Search golden PASS; verify stale=0, mismatch=0/100, rebuild=0; Viewer smoke 6/6; E2E visual de Search/PDF PASS contra el storage local real.

## Dictamen

**CERTIFIED_WITH_KNOWN_LIMITATIONS para beta técnica controlada en DEV.** Search y Viewer cumplen los gates principales de corrección, paginación, ACL, navegación y formatos medidos. Esto no reemplaza UAT institucional ni habilita preproducción o producción. No se declara 100% ni cobertura universal.

La superficie incluye una suite PostgreSQL reproducible de 300 consultas sintéticas generadas determinísticamente más 19 casos de contrato, muestra local de corpus real, controles privados A/B, rutas UI de Search/Viewer, formatos PDF/RTF/DOC/OCR, paginación, F3/Shift+F3 y capturas responsive. La suite golden queda versionada en `server/src/corpus/sprint155-search-golden.integration.spec.ts`; requiere el wrapper DEV `node scripts/with-dev-db-guard.cjs sprint155-golden` o `pnpm search:golden`.

## Baseline DEV y esquema

PostgreSQL se verificó únicamente en `127.0.0.1:55432`, base `buscador_juridico_civil_dev`, rol `bjc_dev`. No se usaron los puertos 5432/5433. Tras cleanup: 17.078 documentos, 17.098 archivos, 198.129 páginas, 17.685 ingestas, 18.799.500 tokens; 0 workspaces/documentos privados y 0 membresías activas. Search projection: ready, 0 stale, 0 discrepancias de la muestra 100/100 y `rebuiltDocuments=0`.

Schema verify pasó con 53 tablas, 25 migraciones y `pg_trgm=1.6`. Prisma validate/generate pasaron y migrate status informó 25 migraciones al día. Esta sprint no cambió `schema.prisma`, no agregó migraciones ni dependencias. El baseline completo está en `_recovery-work/sprint155/baseline.json`.

## Golden Search y gramática

| Gate | Resultado observado |
|---|---|
| Casos | 319: 300 tokens sintéticos determinísticos + 19 contratos |
| Resultado | 319 PASS, 0 FAIL; 100% de los casos ejecutados |
| Acentos / mayúsculas | PASS; la plegadura de vocales conserva la distinción de `ñ` |
| Booleanos / precedencia / paréntesis | PASS para los casos explícitos TERM, AND, OR, NOT y precedencia |
| PHRASE / whitespace / punctuation | PASS para adyacencia, salto de línea, normalización de whitespace y puntuación insertada |
| PREFIX / SUFFIX / duplicados | PASS; resultados sin IDs duplicados |
| Tiempo por consulta golden | p50 56,01 ms; p95 61,24 ms; máximo observado 2.952,96 ms |

Los casos de 1 carácter como consulta independiente, entrada malformada extrema, todos los caracteres especiales y longitudes máximas no forman parte de esos 319 PASS y siguen fuera de esta certificación explícita. El máximo golden no es un SLO.

La muestra real local usó 300 documentos indexados generales, 300 IDs únicos, 4 fuentes, 10 buckets de año, 299 PDF + 1 TXT y 3.521 páginas de extracción referenciadas. Los 300 cumplen scope general, status indexado, texto no vacío y al menos un archivo. IDs y metadatos están sólo en `_recovery-work/sprint155/real-corpus-sample.json`; no se copiaron PDFs.

## Paginación, matches y ACL

La regresión sintética de paginación recorrió 325/325 resultados en páginas 100/100/100/25: orden estable, 0 duplicados, 0 faltantes. Páginas parciales reportan un límite inferior con `hasMore`; la última página informa total exacto 325. La página 5 fuera de rango devuelve cero filas y total exacto 325. Se corrigió el conteo de páginas fuera de rango, que antes podía informar `400` para un corpus de 325.

El integration PostgreSQL de Workspace/ACL pasó 1/1 y ejercitó aislamiento A/B, Search general sin IDs privados, filtros de workspace/source/folder/type/date, descarga y Viewer cruzado denegados. La E2E privada pasó 2/2: el Viewer cruzado respondió 404; el usuario sin permiso no obtuvo preview ni descarga. Los detalles están en `_recovery-work/sprint1511/` y el manifest de cleanup en `_recovery-work/sprint154a1/`.

La suite unitaria dirigida pasó 39/39. El span PREFIX/SUFFIX cubre el token original completo, con límites UTF-16 válidos incluso con un carácter astral precedente; TERM/PHRASE y límites de cantidad quedan en `corpus-document-matches.spec.ts`. El cambio de paginación y los spans están en `corpus-search.adapter.ts` y `corpus-document-matches.ts`.

## Viewer, OCR y formatos

La E2E piloto pasó 5/5: Search general, PDF nativo, headers de seguridad, dashboard y navegación de roles. El PDF real mostró canvas no blanco y marca activa naranja; si el mapper no logra anclaje seguro, no inventa highlight. La muestra Sprint 15.3.3 conserva 221 spans auditados, 0 falsos mappings y 10 comprobaciones visuales reales; sigue siendo una muestra, no garantía para PDF arbitrario.

La E2E de workspace pasó 2/2 tras corregir el submit de Search que podía perder la query durante la inicialización concurrente del workspace. Cubrió búsqueda PDF, OCR pendiente y posterior indexación, F3/Shift+F3 y ausencia de highlight visual OCR; además RTF/DOC preview, descarga protegida, filtro de fecha/tipo, tres paneles y error ACL. PDF escaneado/híbrido, TXT, RTF, DOC, DOCX y ODT tienen la evidencia sintética de las sprints 15.4A/15.4A.1. OCR visual bbox queda explícitamente **NO CERTIFICADO**: se muestra contexto y página, nunca coordenadas inventadas.

Capturas ignoradas por Git: `_recovery-work/sprint155/screenshots/` (Search 1366×768/1920×1080, Copernic tres paneles, PDF nativo, contexto OCR, preview textual y denegación ACL). Responsive comprobado en 1366×768 y 1920×1080; resize del Viewer y tres paneles en el flujo E2E. Las demás resoluciones de la lista del mission prompt y una auditoría formal WCAG no se ejecutaron en esta ronda.

## Errores, rendimiento y límites

Search privado reportó 146 ms para la solicitud en el E2E que corrigió la navegación; Search OCR estuvo listo en 111 ms, primera preview PDF en 651 ms y navegación F3 en 34 ms en esa corrida. Son muestras locales, no SLO. La suite de integración previo midió Search general TERM p50/p95 470/553 ms y PHRASE 1.093/1.117 ms. Extracción DOC sigue siendo lenta: el p95 observado en 15.4A.1 fue 57,57 s y es una limitación de carga por lotes. El preparation p95 del mapper PDF.js fue 8,144 ms en una pasada; revisar con benchmark emparejado antes de ampliar afirmaciones de performance.

El flujo de error ACL responde sin revelar documento y con 404; OCR pendiente comunica estado de usuario. Se comprobaron headers `nosniff`, `SAMEORIGIN`, `Referrer-Policy` y `Permissions-Policy`. Esta sprint no ejecutó una matriz exhaustiva de SQLi/XSS para query, metadata y preview, ni una auditoría WCAG completa: esas superficies quedan como validación de seguridad/accesibilidad ampliada pendiente.

Lint frontend global no pasó por errores preexistentes en `src/app/(admin)/corpus/page.tsx`, `digesto/page.tsx` y `revision/page.tsx` (setState en efecto); no pertenecen a los archivos de Search/Viewer modificados. Frontend build y TypeScript sí pasaron. No se hicieron cambios para silenciar ese lint ajeno al alcance.

UAT institucional, preproducción, compatibilidad universal de PDF/OCR, highlight visual OCR, ligaduras/columnas no muestreadas, búsqueda semántica/NEAR/RAG y SLO de producción siguen fuera del cierre. Próxima opción: UX-1 Zero-Training UX, sólo después de coordinar integración de ramas; no se inicia automáticamente.

## Limpieza y evidencia

La suite E2E creó 2 workspaces y 5 documentos sintéticos; cleanup DEV guarded eliminó ambos workspaces, los 5 documentos, dependencias y storage aislado: 0 residuos lógicos. Los tres directorios `galilei-*` preexistentes siguen siendo el residuo histórico permitido; esta sprint no creó ni borró otros. La proyección se verificó después del cleanup, sin rebuild global.

El collision audit está en `_recovery-work/sprint155/collision-report.json`. Se compararon `origin/feature/copernic`, `origin/feature/jurisprudencia` y worktree sin checkout ni merge. El commit y push finales se registran en el cierre de la sprint.

## Extensión de ACL — Sprint 15.6.1 (2026-10-14)

La certificación Search/Viewer suma los scopes personal `GLOBAL_PER_USER` y carpeta `RESTRICTED` de workspace. La E2E autenticada probó autorización y denegación en búsqueda, conteo, metadata, coincidencias, Viewer y descarga, revocación inmediata de una membresía/grant y transiciones explícitas entre personal/compartido. Search general, ranking y proyección no se reconstruyeron ni cambiaron de scope. Golden Search 319/319; verificación final 17.078 documentos / 18.799.500 tokens, stale=0, discrepancias 0/100, rebuild=0. Es una extensión automatizada de ACL en DEV, no certificación UAT, UNC, preproducción, producción ni de highlight OCR.
