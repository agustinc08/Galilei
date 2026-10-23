# Inventario de raíz y decisiones

Este inventario separa dos cosas que no deben confundirse:

1. **Checkout físico original** en `C:\proyecto triple`. Se conserva en su estado histórico porque tiene cinco cambios locales únicos. No es el árbol limpio que se debe usar para Sytec10.
2. **Árbol Git canónico** en `refactor/project-client-server-layout1`: `client/`, `server/` y `docs/`. El estado base ya publicado es `dfa81250af387326ab338b1c58fcc3198c42817a`; este follow-up retira el duplicado obsoleto `legacy/digesto/`.

## Medición del checkout físico

La línea base de la limpieza se capturó el 2026-10-23 a las 18:18 UTC:

- Logical/on-disk: **92.496.963.350 bytes**
- Archivos: **521.538**
- Directorios: **68.599**
- Espacio libre en C:: **156.923.879.424 bytes**

Rescan completo después de retirar las copias redundantes y el worktree terminado, 2026-10-23 18:36 UTC:

- Logical/on-disk: **87.090.697.888 bytes**
- Archivos: **442.094**
- Directorios: **58.936**
- Errores de escaneo: **0**
- Espacio libre en C:: **161.339.736.064 bytes (68,39% usado)**

Reducción lógica: **5.406.265.462 bytes (5,84%)**. Los archivos físicamente liberados en C: fueron menos por enlaces/reparse points y almacenamiento compartido. El objetivo de menos de 100 GiB se cumple; el resto se conserva por ser fuente, corpus, Search, backup o evidencia QA aún necesaria. No se borran datos legítimos sólo para alcanzar 60–80 GiB.

Informe de medición: `_recovery-work/galilei-project-structure-normalize1/root-after.json`. La línea base adicional de la normalización estructural está en `root-before.json`.

## Entradas que existían en la raíz física

| Path original | Tamaño inicial → actual | Propósito y uso | Git / ignorado | Decisión / destino |
|---|---:|---|---|---|
| `.git/` | 1.945.356.839 → 1.945.209.954 B | Repositorio compartido por los worktrees; contiene historial y refs. | Metadatos Git, no un path versionado. | Preservado. No hacer prune agresivo ni compactación durante esta misión. |
| `JurisprudenciaN/` | 7.025.145.697 → igual | Checkout original con `front/`, `back/`, dependencias/builds y datos locales históricos. Es el checkout protegido de cinco archivos. | Código rastreado en el checkout original; datos y dependencias locales ignorados. | Preservado sin mover, resetear ni limpiar. En el árbol publicado, el código vive en `client/` y `server/`; los cinco cambios locales no se incorporaron. |
| `digesto/` | 200.066.849 → igual | App CRA/Nest histórica y PDFs locales. El dominio Digesto vigente está integrado en el producto actual; no hay dependencia activa de la app CRA/Nest. | El código es rastreado por el checkout original; PDFs locales ignorados. | Checkout histórico preservado. El código antiguo se quitó de la rama normalizada; la historia Git lo conserva. Los PDFs no se movieron ni borraron. |
| `Copernic/` | 612.496.208 B → **ausente** | Seis instaladores de Copernic Desktop Search; sin índice, export, configuración de producto ni proceso activo. No corresponde a la funcionalidad Copernic de Galilei. | No rastreado; local. | Eliminado tras inventariar SHA-256: eran descargas reproducibles, sin datos únicos. |
| `docs-integracion/` | 1.533.879 → igual | Documentación maestra BJC versionada en el checkout original. | Rastreada en el checkout original. | La rama normalizada la reubica mediante Git rename a `docs/integracion/`; la copia física original permanece intacta. |
| `_dev-corpus-storage/` | 3.667.203.658 → igual | Storage local real para Viewer/descarga; 17.078 documentos y 17.098 archivos registrados en PostgreSQL DEV, con blobs verificados por tamaño y SHA-256. | Local, ignorado por Git; el backend lo resuelve por configuración/default. | `REAL_CORPUS_REQUIRED`: preservado. No mover ni versionar. |
| `_dev-corpus-storage-test/` | Ausente → ausente | Storage sintético de tests ya retirado. | No existe. | `OBSOLETE_DELETE`: ausente / previamente limpiado. |
| `_local-setup/` | 7.519.319.046 → 3.282.074.789 B | Scripts y paquete único de transferencia a oficina. El RAR contiene dump DEV y blobs; checksums y manifests laterales. | Local e ignorado. | Se retuvieron el RAR verificado, checksums, manifests y scripts. Se eliminaron la copia expandida (3.667.203.473 B lógicos) y el dump expandido duplicado (570.040.784 B), ambos verificados dentro del RAR. |
| `_recovery-work/` | 68.768.444.005 → 67.599.569.685 B | Evidencia de misiones, runtimes, Search principal y QA del release con gates P1 pendientes. | Local, ignorado por Git. | Conservado selectivamente. Se eliminó el worktree limpio terminado `galilei-project-structure-normalize1/worktree` (1.027.932.978 B lógicos); permanecen informes. Se preservan Search principal y runtimes QA del release. |
| `_recovery-backups/` | 2.312.140.330 → igual | Snapshot local único/justificado; contiene datos de recuperación. | Local, ignorado. | `UNIQUE_BACKUP`: preservado. |
| `_legacy-audit-work/` | 1.057.736.720 → igual | Extracción y evidencia histórica de auditoría jurisprudencial. | Local, ignorado. | `LEGACY_REFERENCE_REQUIRED`: preservado fuera de Git; no es runtime de producto. |
| `.gitattributes` | 62 → igual | Reglas compartidas de texto/atributos Git. | Rastreado. | Permanece en la raíz canónica. |
| `.gitignore` | 859 → igual en el checkout original | Ignora datos/runtime locales y artefactos generados sin ocultar código fuente. | Rastreado. | Permanece en la raíz canónica; se quitaron reglas de la antigua app Digesto. |
| `AGENTS.md` | 15.406 → igual en el checkout original | Instrucciones y límites operativos del repositorio. | Rastreado. | Permanece en raíz; la rama normalizada actualiza rutas y estado de Search. |
| Archivos raíz `README.md`, `docker-compose*.yml` | No estaban en el checkout físico inicial | Guía de producto y recetas locales optativas. | Rastreado en el árbol normalizado. | Permanecen en la raíz canónica; Compose no se ejecuta sobre servicios principales. |

## Search, PostgreSQL y QA que se retienen

- **Search principal — `PRINCIPAL_SEARCH_REQUIRED`:** OpenSearch 2.19.6, GREEN; escucha en 9200/9300. Data en `_recovery-work/search-engine-integration1/runtime/data`; el alias `galilei-search-active` apunta a V4, V3/V4 tienen 69.313 documentos y el writer es V4. No se mueve.
- **PostgreSQL principal — `LOCAL_RUNTIME_REQUIRED`:** PostgreSQL 16 en `127.0.0.1:55432`, DB `buscador_juridico_civil_dev`, rol `bjc_dev`. No se mueve ni modifica su schema/datos.
- **QA de release — `CURRENT_RELEASE_QA_REQUIRED`:** QA en 55434 y OpenSearch en 29220/29320 se mantienen porque la revisión de `galilei-pre-office-rc-closeout2` tiene gates P1 pendientes de lifecycle, concurrencia, Viewer, descarga y ACL. No es Search principal y no se presenta como producto aceptado.
- **Sytec10:** no se accedió ni se cambió durante esta tarea.

## Digesto

**DIGESTO SIRVE PARA:** una funcionalidad vigente del producto Galilei en `client/` y `server/`, más PDFs locales históricos preservados bajo el checkout original. La app CRA/Nest antigua no tiene referencias activas de runtime/build y se retiró del árbol Git en este follow-up; su historia queda en Git y los PDFs locales permanecen intactos.

## Árbol Git canónico

La raíz versionada de la rama normalizada queda así:

```text
client/                   frontend Next.js y pruebas de interfaz
server/                   API NestJS, Search, ACL, Prisma y scripts
docs/                     guías y documentación BJC
README.md                 inicio del proyecto
AGENTS.md                 salvaguardas e instrucciones
.gitattributes            reglas compartidas Git
.gitignore                exclusiones concretas
docker-compose.yml        receta local optativa
docker-compose.dev.yml    receta local optativa
```

No contiene `JurisprudenciaN/`, `digesto/`, `legacy/`, corpus, backups, PostgreSQL PGDATA, Search data, secretos ni `node_modules`. El checkout físico antiguo sigue preservado separadamente y no debe copiarse a Sytec10 como fuente del producto.

## Artefactos locales

Los conteos y clasificaciones completos están fuera de Git, bajo `_recovery-work/galilei-project-structure-normalize1/` y `_recovery-work/galilei-pre-office-root-cleanup1/`. Incluyen hashes, resultados de verificación del paquete, inventario de worktrees, movimientos, borrados y mediciones antes/después.

