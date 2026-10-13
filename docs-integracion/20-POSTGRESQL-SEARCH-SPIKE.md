# 20 — PostgreSQL Search Spike

## Estado y alcance

Esta misión deja el entorno auditado y la configuración dev aislada preparada, pero el spike PostgreSQL no pudo ejecutarse. No se importaron datos, no se generó Prisma Client, no se aplicaron migraciones, no se intentó conectar a una base y no se modificó el código fuente de búsqueda.

El estado real de la copia de trabajo es distinto del supuesto inicial de la misión: la prueba de Jest sobre los módulos preservados pasa, pero el backend no compila en el estado actual de dependencias. No se debe declarar listo el adaptador PostgreSQL hasta resolver ese bloqueo.

## Auditoría Node y package manager

- Node disponible: v24.19.0.
- pnpm disponible: 11.19.0. npm no está disponible como comando en esta sesión.
- Backend: package.json y package-lock.json, lockfileVersion 3; no hay pnpm-lock.yaml, pnpm-workspace.yaml ni configuración raíz de workspace.
- Frontend: package.json y su package-lock.json, también lockfileVersion 3.
- Los manifiestos no fijan packageManager ni engines. Las dependencias raíz de los lockfiles coinciden con las especificaciones de package.json.
- La estructura existente es inconsistente: node_modules/.ignored conserva parte del árbol previo, y node_modules/.pnpm contiene versiones posteriores para algunas dependencias. Hay lanzadores de node_modules/.bin con rutas absolutas a la ubicación antigua bajo OneDrive, que ya no existe.
- No se borraron node_modules ni los package-lock.json. No se generó pnpm-lock.yaml y no se ejecutó una reinstalación: no se demostró que la transición conserve el único entorno recuperable.
- El backend usa Prisma y una dependencia nativa SQLite. El árbol preservado y el árbol reestructurado no tienen versiones idénticas para todos los paquetes; esto desaconseja una migración improvisada.

## Verificación disponible

Se ejecutó Jest con NODE_PATH apuntando a back/node_modules/.ignored y con la ruta local del fixture SQLite: 5 suites y 35 pruebas pasaron. Esto verifica el código cubierto por esas pruebas en ese árbol preservado; no verifica PostgreSQL.

Se intentó compilar con el Nest CLI preservado. El build falló con 553 errores de resolución de módulos y tipos (incluidos módulos Nest, Prisma y tipos Node) porque el árbol .ignored no se resuelve como una instalación normal desde los paquetes fuente. El resultado no demuestra un defecto funcional del adaptador; tampoco permite afirmar que el backend compile. La compilación fallida emitió 475 archivos en back/dist antes de terminar con error. Sin Git ni snapshot previo no se determinó si sustituyeron artefactos anteriores; este directorio debe tratarse como salida parcial, no como build válido.

## Docker y aislamiento local

El Compose existente de JurisprudenciaN tiene nombre de contenedor genérico, publica el puerto estándar 5432, usa credenciales por defecto y un volumen persistente. No se reutilizó.

Se añadió docker-compose.dev.yml con una única imagen PostgreSQL 16, nombre y volumen exclusivos de desarrollo, bind a 127.0.0.1:55432, contraseña requerida desde SEARCH_DEV_DB_PASSWORD, healthcheck y sin política de reinicio. El archivo no fue validado por Docker Compose y el servicio no se inició; por tanto, el aislamiento está diseñado pero aún no probado.

Docker no está instalado. La consulta directa del sistema confirma Windows 11 Home, build 26300; WSL2 no está instalado y el proceso actual no es administrador. Winget encuentra Docker Desktop, pero no ofrece un instalador aplicable al alcance de usuario. El intento de descargar/verificar y ejecutar el instalador oficial en modo per-user fue bloqueado por la política del ejecutor antes de iniciarse; no se descargó ni ejecutó el EXE. La primera habilitación de WSL2 requiere elevación y puede requerir reiniciar Windows. No se habilitaron características del sistema ni se reinició el equipo. Ver [instalación Docker Desktop en Windows](https://docs.docker.com/desktop/setup/install/windows-install/) y [requisitos de permisos](https://docs.docker.com/desktop/setup/install/windows-permission-requirements/).

## Diseño previsto para el adaptador

El adaptador debe recibir el AST ya analizado por SearchParser e implementar SearchSourceAdapter. No debe volver a interpretar la consulta. Las operaciones deben traducir nodos conocidos a fragmentos SQL de lista blanca y parámetros enlazados. No se debe interpolar texto, identificadores, filtros o patrones suministrados por el usuario.

Para términos y frases se compararán PostgreSQL full-text search y pg_trgm sobre campos seleccionados. B-tree queda reservado para identificadores, filtros y ordenamientos apropiados; GIN puede servir a tsvector y trigram según la consulta medida. No se incorporarán motores externos en este spike. El SQL especializado puede usarse a través de Prisma sólo con parámetros; campos y direcciones de orden deben venir de enumeraciones internas.

Para wildcard, PREFIX debe convertirse en prefijo con escape de %, _ y barra inversa; SUFFIX en sufijo equivalente. El comodín del usuario no se concatenará a una consulta SQL libre. Debe acordarse y probarse el significado de comodines interiores o múltiples antes de soportarlos.

La normalización debe conservar original y una clave de búsqueda. Para ignorar tildes se puede quitar marcas combinantes de vocales, preservando expresamente ñ como letra distinta de n. No se debe aplicar una configuración lingüística que pliegue ñ a n sin prueba. Peña/Pena y prescripción/prescripcion son pares de aceptación.

Los identificadores de expediente, sentencia y sumario requieren campos tipados o claves normalizadas propias y comparación exacta antes del puntaje textual. La igualdad exacta debe dominar el ranking; frases/caratulas y temas se consideran después, texto completo después de ellos y similitud fuzzy en último lugar. La IA queda fuera.

La visibilidad y ACL deben filtrar candidatos antes de score, snippets, facetas, conteos y previews. Paginación y orden deben usar listas permitidas y desempate estable.

## Próximo procedimiento técnico

1. Recuperar una instalación reproducible de Node sin eliminar los lockfiles existentes; comparar versiones instaladas con ambos locks y fijar versiones soportadas.
2. Obtener habilitación administrativa para WSL2, completar reinicio si Windows lo pide e instalar Docker Desktop para el usuario.
3. Validar Compose y levantar sólo el servicio PostgreSQL dev con una contraseña efímera/local.
4. Crear una exportación determinista y acotada desde SQLite en modo read-only, preservando IDs legacy; excluir MicroISIS y datos personales no aprobados.
5. Crear una fixture con entidades mínimas y verificar trazabilidad de conteos/IDs antes de cargar PostgreSQL.
6. Implementar el adaptador contra AST, migración dev mínima y pruebas de integración explícitas.
7. Ejecutar benchmark, ranking, seguridad, paginación, ñ/tildes/wildcards y medir parser, DB y total; informar p50/p95 sólo si la muestra es suficiente.
8. Cerrar con test y build desde dependencias resueltas, sin producción, remoto ni despliegue.

## Fuera de alcance cumplido

No se conectó CIJ, CSJN, Lex100 ni Digesto remoto. No se usaron credenciales institucionales, no se hizo scraping, no se importó MicroISIS, no se alteró el schema de Digesto y no se instaló ningún buscador externo.
