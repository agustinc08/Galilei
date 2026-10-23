# 01 — Inventario técnico de Jurisprudencia, Digesto y Copernic

**Fecha de inspección:** 7 de octubre de 2026.  
**Alcance:** inspección estática de archivos, lectura local inocua y lectura de SQLite en modo solo lectura. No se conectó a producción ni a servicios remotos; no se iniciaron instaladores, Docker, importadores, seeds o migraciones; no se modificó código de los proyectos. Se crearon únicamente estos informes.

Etiquetas: **VERIFICADO EN CÓDIGO**, **VERIFICADO EJECUTANDO**, **DOCUMENTADO PERO NO VERIFICADO**, **INFERIDO**, **NO VERIFICADO**.

## Repositorios, rutas y tamaño visible

| Sistema | Ruta | Git y estado | Archivos relevantes |
|---|---|---|---|
| Jurisprudencia moderno | JurisprudenciaN/ | No hay directorio Git; rama, commit y cambios no determinables. | 143 archivos bajo backend/src y 137 de frontend/src; 27 rutas de página Next.js. |
| Digesto backend | legacy/digesto/server/ | Git, rama master, ningún commit. Archivos staged, modificados y nuevos; una entrada .env aparece en el índice Git. | 59 archivos relevantes de fuente/configuración/migración/pruebas, excluidos PDFs y .git. |
| Digesto frontend | legacy/digesto/client/ | No tiene .git propio; está fuera de la raíz Git del backend. | 42 archivos relevantes. |
| Copernic | Copernic/ | No hay .git ni fuentes. | Seis instaladores ejecutables; no se encontraron índices, preferencias ni datos exportados. |

La carpeta común no es un repositorio coordinador. En Jurisprudencia no se puede verificar qué cambios son nuevos ni su autoría. Digesto backend no tiene historia y el frontend no está versionado junto a él.

## Jurisprudencia

**Stack verificado en código:** NestJS 11, TypeScript, Prisma 7 con adaptador pg, PostgreSQL, Next.js 16, React 19. El Compose disponible solo inicia PostgreSQL con etiqueta 16; no hay Compose de aplicaciones. Los scripts del frontend y backend usan puerto 4001, lo que puede causar colisión. El cliente también advierte si el API apunta a 4001.

No se encontró código PHP/jQuery de la aplicación antigua; sí una base SQLite y PDFs históricos.

**Backend:** módulos de autenticación, roles/usuarios, sentencias/sumarios, archivos, búsqueda, importación, catálogos, citas, referencias normativas/jurisprudenciales/doctrinarias, normas/equivalencias, institutos/sinónimos, favoritos, búsquedas guardadas, estadísticas/eventos, logs y health.

**Frontend:** consulta pública; fichas, documentos e impresión; login; dashboard; búsqueda avanzada; sentencias, carga rápida y completa; sumarios; archivos; normas; referencias; institutos; favoritos; búsquedas guardadas; estadísticas y logs.

**Funciones verificadas en código:** publicación y anonimización; búsqueda pública e interna; filtros y sugerencias; resaltado y score ponderado; exportación CSV/TXT/JSON; PDFs; citas y relaciones; estadísticas; bitácora de acciones/eventos; lectura/importación SQLite y asociación de PDFs. Ollama genera reseñas y embeddings en código, con vectores JSON, pero no se probó el servicio. No aparece pgvector.

La búsqueda tiene normalización de acentos, trigramas GIN para campos seleccionados y ranking propio; no se encontró tsvector/ts_rank. El parser reconoce comillas, AND/OR, exclusión con prefijo -, y campos. No prueba compatibilidad completa con comodines, paréntesis, NEAR o NOT.

### Datos locales verificados

La SQLite local tiene 136.859.648 bytes. En apertura read-only se observaron:

| Tabla | Filas |
|---|---:|
| tb_sentencias | 27.387 |
| tb_sumarios | 32.695 |
| tb_microisis | 52.375 |
| tb_operadores | 0 |

tb_microisis tiene campos de materia, sumario, referencias normativas, contradicciones/asociaciones, causa/expediente, publicación, número SAIJ, operador, sentencias anuladas y observaciones.

Hay 10.639 PDFs en back/data (aprox. 2,14 GB) y 11.747 PDFs en back/uploads (aprox. 2,29 GB). No se determinó si se superponen o están ligados al mismo corpus. No se conectó a PostgreSQL: filas y estado del destino moderno **NO VERIFICADOS**.

### Seguridad, pruebas y despliegue

- **VERIFICADO EN CÓDIGO:** guard global JWT, guard de roles, bcrypt, roles ADMIN/OPERADOR y publicadores explícitos; CORS con orígenes configurados.
- **RIESGO ALTO:** AuthModule tiene un secreto JWT conocido como fallback si no se configura el secreto. Producción debe fallar al arrancar si falta.
- **RIESGO ALTO:** Compose publica PostgreSQL por el puerto configurado y contiene una contraseña fija de desarrollo. No se verificó si se usa fuera de local.
- Eventos de consulta pueden guardar texto consultado; falta comprobar política de acceso/retención. El vínculo AccionLog→Usuario usa borrado en cascada, por lo que borrar un usuario podría eliminar sus acciones históricas.
- **VERIFICADO EJECUTANDO:** TypeScript del backend pasa tsc --noEmit -p tsconfig.build.json.
- **VERIFICADO EJECUTANDO:** pasa el único test visible, health.controller.spec.ts.
- Solo se encontró una prueba unitaria de Jurisprudencia; build completo, PostgreSQL, importación, login, permisos, PDF y relevancia siguen **NO VERIFICADOS**. No hay dependencias frontend instaladas.
- Hay configuración .env/.env.local; no se leyeron valores.

### Rutas API principales observadas

El backend añade el prefijo global /api. Se observaron grupos para auth, roles, usuarios, sentencias, sumarios, archivos, búsqueda, catálogos, estadísticas, logs, normas, institutos y referencias. Los controllers públicos incluyen búsqueda y ficha/PDF de sentencias publicadas; las rutas administrativas llevan guards JWT/roles en el código.
## Digesto

**Stack verificado en código:** NestJS 10, TypeScript, Prisma 5, PostgreSQL declarado por DATABASE_URL; frontend React 18, Create React App, JavaScript, React Router y Tailwind. Hay nueve migraciones Prisma, pero no dump de base. En las migraciones inspeccionadas no se encontraron vistas, triggers ni procedimientos almacenados. No se encontró node_modules, por lo que no se ejecutó build/tests.

Prisma modela cinco entidades: User, Doc, DocDependencias, Dependencia y Tipo. Doc guarda número, ruta, tipo entero, voz, texto extraído del PDF, fecha, pendiente e ID de documento asociado. DocDependencias relaciona documentos y dependencias. La UI arma jerarquías padre/hijo. **INFERIDO por nombres de archivos, sin leer su contenido:** el conjunto parece incluir documentación administrativa institucional como oficios, resoluciones, dictámenes e informes, no solo normativa.

**Funciones verificadas en código:** consulta por número/fecha/voz/tipo/texto PDF; carga, edición, asociación y borrado; tipos, dependencias y PDFs. El cliente obtiene resultados amplios y filtra/ordena parte de ellos en memoria. El servicio devuelve texto PDF; no se observa paginación de servidor ni OCR. Hay 278 PDFs (188,4 MB) en server/pdfs y digesto/pdfs está vacía. Un archivo 7z bajo src/usuario no se extrajo. El runtime usa /home/node/pdfs, sin volumen persistente documentado en Compose.

**Flujo frontend → API → servicio/datos observado:** el cliente consulta la ruta de listado amplia de carga de datos; el controller delega a CargaDeDatosService, que consulta Doc/Tipo/Dependencia por Prisma y arma la jerarquía en el cliente. La carga pasa multipart al mismo servicio, que extrae texto con pdf-parse, escribe en filesystem y persiste en Prisma. Hay endpoints bajo users, carga-de-datos, tipo, dependencia y pdf, además de Swagger. La URL base está fijada en el frontend a un host remoto institucional; no se consultó.
**No hay en el schema** entidades de leyes, decretos, acordadas, artículos, vigencia, derogaciones o jurisdicciones. Por evidencia de código, es un archivo documental con clasificaciones y dependencias; su contenido funcional exacto requiere inspección autorizada de datos y validación con usuarios.

**Riesgos de seguridad y calidad:**

- **CRÍTICO:** no se ven guards de autenticación/autorización en los controllers. El registro recibe el rol desde el request. La interfaz verifica un rol en localStorage, pero el login no emite token y el servidor no aplica permisos.
- CRUD/carga/borrado, tipos y PDFs son rutas API sin control visible de roles; CORS está abierto.
- El endpoint PDF combina un nombre recibido con la ruta de almacenamiento sin validación visible de confinamiento. La consulta GET de documentos no tiene guard visible y el servicio selecciona/retorna pdfContent de los registros coincidentes; puede exponer texto fuera de las reglas aprobadas si el API es alcanzable. No se probó explotación ni se consultó el host remoto.
- El upload no muestra límite de tamaño ni filtro MIME; usa nombre original. El almacenamiento no tiene volumen persistente documentado.
- El schema Prisma no declara la relación padre/hijo; una migración sí añade una FK real Doc.idDocAsociado → Doc.id con ON DELETE SET NULL. En cambio, DocDependencias tiene clave compuesta pero no FKs visibles. Hay una diferencia entre schema y migraciones que debe resolverse. El servicio imprime el objeto de carga completo en consola y coordina escritura de archivo y base sin una transacción distribuida; puede dejar archivos huérfanos si falla la persistencia.
- Consulta por texto aplica contains a tipo aunque el campo es entero: combinación potencialmente inválida. Texto PDF usa contains, sin FTS/trigram visible.
- .env está staged y no excluido por .gitignore. No se inspeccionó ni se reproducen sus valores.
- Dockerfiles no sustituyen una configuración de despliegue verificable; el backend fija puerto 5000 y no hay Compose común.

## Copernic

Seis ejecutables firmados válidamente tienen metadatos de CDS 2.0, 3.7, 7.0 y 7.2.0.14055. No hay fuente, instalación, DLL independientes, índice, configuración, base ni exportación de consultas. Los instaladores no se ejecutaron.

**DOCUMENTADO PERO NO VERIFICADO aquí:** la [guía CDS7 oficial](https://copernic.com/wp-content/uploads/2021/05/CDS7_quick_start_guide.pdf) y [página de funciones](https://copernic.com/en/desktop/features/) describen búsqueda de archivos por contenido/nombre/fecha/tamaño, prefijo, booleanos, frases, NEAR/comodines, categorías, refinamiento, vista previa, resaltado y actualización incremental/programada. Esto no demuestra qué versión está en uso ni qué configuración o funciones aprecian los usuarios judiciales.

## Tipos de archivos observados

- Jurisprudencia: 22.386 PDFs (10.639 en data y 11.747 en uploads), una SQLite, un CSV y código/configuración. No se encontraron fuentes PHP, bases Access/DBF ni dumps SQL.
- Digesto: 278 PDFs, un archivo 7z no inspeccionado, imágenes/assets y fuentes/configuración; no hay dump de base en el árbol local.
- Copernic: seis EXE y ningún índice/documento asociado.
- No se encontraron archivos DOC/DOCX/XML en el inventario del workspace. Los tipos de archivo dentro del 7z no están verificados.
## Archivos y límites

- No se inspeccionaron documentos PDF, archivos 7z ni logs.
- Se observan archivos de entorno, pero no se leyeron valores.
- El cliente Digesto contiene llamadas a un host remoto institucional. **No se consultó** ese endpoint.
- No se ejecutaron servicios, migraciones, importadores, seeds ni pruebas contra base alguna.
