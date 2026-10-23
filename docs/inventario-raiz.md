# Inventario y decisiones de raíz

La línea base se tomó en AgustinNotebook el 2026-10-23 antes de modificar el checkout, desde C:/proyecto triple. El informe local está en _recovery-work/galilei-project-structure-normalize1/root-before.json. En esa lectura había 93.180.219.325 bytes lógicos, 91.559.060.608 bytes en disco y 518.713 archivos; es una medida del checkout original con runtimes y datos locales, no sólo del repositorio Git.

| Entrada antes | Evidencia / clasificación | Decisión |
|---|---|---|
| .git | Repositorio activo e historial | Preservado; no se compactó. |
| JurisprudenciaN/front | Frontend activo Next.js | Git move a client/; se actualizaron paths de tests y scripts. |
| JurisprudenciaN/back | Backend activo NestJS/Prisma | Git move a server/; se corrigieron roots relativos. |
| JurisprudenciaN raíz | README/checklists/demo/Compose y .gitignore | README nuevo a raíz; checklists y demo a docs/; Compose a raíz; ignores consolidados; contenedor vacío retirado. |
| digesto | App CRA/Nest antigua, sin repositorio Git propio, no runtime actual | Código rastreado a legacy/digesto/ y documentado. Los PDFs locales ignorados no se mueven ni eliminan. |
| docs-integracion | Documentación maestra BJC rastreada | Git move a docs/integracion/; se reparan referencias y rutas de salida. |
| Copernic | Seis instaladores .exe de Copernic Desktop Search; no índices/export/config; no proceso Copernic activo; no están rastreados | Instaladores legacy redundantes, no el módulo Copernic de Galilei. La carpeta local se elimina tras registrar hashes; código/UI Copernic no se toca. |
| _dev-corpus-storage | Datos locales read-only de Corpus, 3,415 GiB, 17.101 archivos según inventario previo | Preservado como REAL_CORPUS e ignorado por Git. |
| _dev-corpus-storage-test | Ausente en inventario | Sin acción. |
| _recovery-work | Evidencia y runtimes locales, 64,112 GiB en inventario previo; contiene Search activo y trabajo vigente | Preservado completo; ignorado por Git. No se trata como directorio desechable. |
| _recovery-backups | 2,153 GiB de respaldos locales | Preservado fuera de Git; no se invalida ni sustituye ningún backup. |
| _local-setup | 7,003 GiB de instalación/configuración/transferencia | Preservado fuera de Git; sin revisión destructiva. |
| _legacy-audit-work | 0,985 GiB de evidencia histórica | Preservado fuera de Git. |
| AGENTS.md, .gitignore, .gitattributes | Instrucciones y configuración comunes | Permanecen en raíz; se actualizan rutas e ignores concretos. |
| docker-compose*.yml | Recetas locales optativas versionadas | Se conservan en raíz y se documenta que no son servicios activos. El Compose DEV comparte el puerto nativo 55432; no iniciarlo sobre el entorno principal. |

## Fuentes locales conservadas

El checkout original mantiene los datos ignorados bajo JurisprudenciaN/back/data, JurisprudenciaN/back/uploads y digesto/server/pdfs. La aplicación reubicada sigue leyendo las raíces documentales únicamente cuando la configuración explícita server/scripts/dev/institutional-pdf-roots.json las declara. Son origen de documentos, no archivos de código; no se trasladan ni sobrescriben.

El detalle de los seis instaladores y SHA-256 está en copernic-installers.json dentro del informe local de esta misión. El plan/resultado de movimientos, cambios y validaciones también permanece fuera de Git, bajo _recovery-work/galilei-project-structure-normalize1/.
