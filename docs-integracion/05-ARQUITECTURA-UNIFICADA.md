# 05 — Arquitectura unificada recomendada

## Decisión

Adoptar una opción D: experiencia/API comunes, monolito modular con dominios separados y read model de búsqueda. Es la opción B como destino, con la C como puente read-only mientras Digesto y las fuentes históricas siguen siendo fuentes de registro. No hacer una tabla universal ni iniciar tres microservicios.

Jurisprudencia es el núcleo más reutilizable, con correcciones de seguridad, puertos, migración y pruebas. Digesto conserva su dominio propio. Copernic aporta comportamientos a recrear, no código ni datos disponibles.

## Diagrama objetivo

~~~text
 USUARIOS: público | consulta interna | editores | administradores
                            |
               FRONTEND ÚNICO Next/React
             caja global | resultados | backoffice
                            |
                   API NestJS / TypeScript
          Identity + RBAC + auditoría + Search API
                   /                     \
     CONTEXTO JURIS                 CONTEXTO DIGESTO
 Sentencia, Sumario, PDF,          Doc, Tipo, Dependencia,
 referencias, norma, cita          padre/hijo, pendiente
                   \                     /
                    adaptadores de fuentes
                            |
             PROYECCIÓN DE BÚSQUEDA (lectura)
     fuente + tipo + clave fuente + campos + texto
                            |
       PostgreSQL: identity / juris / digesto / search
                            |
        almacenamiento documental con versión y hash

 SQLite + PDFs ----> staging inmutable ---> ledger/reconciliación
 Digesto export ---> staging autorizado --> adapter/importador
 Copernic --------> especificación de comportamiento; sin índice local
~~~

Durante la transición puede mantenerse el PostgreSQL fuente Digesto por separado. Unificar servidores/base requiere confirmar backup, disponibilidad, volumen, ownership y control institucional; los modelos de dominio siguen separados incluso si se comparte clúster.

## Comparación de arquitecturas

| Opción | Complejidad | Riesgo | Tiempo | Mantenibilidad | Migración progresiva | Dictamen |
|---|---|---|---|---|---|---|
| A. Monolito con una base/modelo común | Bajo al principio; alto al crecer | Alto por semántica mezclada | Rápido para demo | Media-baja | Media | No en versión literal |
| B. UX común, dominios separados | Media | Medio | Medio | Alta si módulos tienen ownership | Alta | Buen destino |
| C. Portal común sobre fuentes separadas | Media-alta por adaptadores | Bajo en escrituras, medio en frescura | Rápido read-only | Media si es transitorio | Muy alta | Puente recomendado |
| D. Bounded contexts + read model común | Media | Medio-bajo con reconciliación | Medio | Alta | Muy alta | **Recomendación** |

## Dominios y contratos

- **Identity:** usuarios, roles, permisos y sesión; una identidad común, no reutilizar contraseñas legacy.
- **Jurisprudencia:** Sentencia, Sumario, publicación, anonimización, citas y referencias.
- **Digesto:** Doc, voz, Tipo, Dependencia, estado y jerarquía propia.
- **Documentos:** binarios, checksum, MIME, versiones y extracción; cada dominio conserva propiedad y reglas.
- **Search:** proyección y búsqueda; no es fuente maestra de documentos.
- **Catálogos:** vocabularios propios y equivalencias explícitas.
- **Auditoría/Importación:** acciones, jobs y runs con estado y procedencia.

Una proyección de búsqueda común almacena fuente, tipo, ID de origen, título, metadatos, fecha, texto normalizado, ACL y ruta segura. Una referencia de fallo a norma es una relación jurídica, no un vínculo genérico a archivo. La proyección indexable no reemplaza modelos de Sentencia, Sumario o Doc.

## Buscador

### PostgreSQL primero

El volumen local observado es de decenas de miles de filas legacy y cientos de PDFs Digesto, aunque falta comprobar el volumen actual. PostgreSQL basta para MVP y ya se usa en ambos sistemas.

Combinar:

1. Índices B-tree para número, expediente, sala y artículo exactos.
2. tsvector ponderado (título/carátula, metadatos, cuerpo) con configuración española.
3. pg_trgm/GIN para typos y coincidencia parcial; Jurisprudencia ya los usa en campos seleccionados.
4. Normalización de acentos/mayúsculas manteniendo valor fuente y búsqueda especializada de números.
5. Ranking por ID exacto, frase, campo, relevancia textual y calidad.
6. Filtros/facetas aplicados bajo permisos antes de mostrar snippet o resultado.
7. Parser probado para frase, AND/OR/NOT, campo, paréntesis y NEAR solo si usuarios lo requieren.

La búsqueda actual puntúa candidatos en código y limita cuántos evalúa; la migración crea índices trigram, pero no FTS tsvector/ts_rank. Hace falta medir recall/latencia del índice común antes de producción.

No agregar Elasticsearch/OpenSearch, Meilisearch o Typesense antes de benchmark. Cambiar solo si PostgreSQL no cumple objetivos acordados de latencia, carga, facets, indexación o independencia. Cada motor adicional duplica datos y requiere monitoreo, permisos, backup y sincronización. Mantener embeddings/Ollama como experimento comparativo, no como sustituto de expediente/número/artículo/frase.

## Piezas que hay que crear

1. Search API y proyección con sourceSystem, sourceType, sourceId, permisos, título, campos exactos, texto y estado de indexación.
2. Pipeline de migración observable: snapshot, staging, normalizador, reconciliador y tablero de errores.
3. Identity/RBAC y autorización real del API Digesto.
4. Metadata/servicio de archivos con ubicación persistente, checksum y autorización por documento.
5. Navegación común, snippets/preview y facetas por fuente, luego de observar a usuarios.

Lo demás se conserva o refactoriza en el contexto dueño. Evitar hacer un documento jurídico universal, un microservicio por módulo o un OCR/IA común si el corpus y los usuarios no lo requieren.
## Seguridad objetivo

- Roles: público, consulta interna, operador/editor, administrador; permisos de servidor por acción y dominio.
- La UI no es barrera de seguridad. Filtrar acceso en API, Search, facetas, snippets, preview y descarga.
- PDFs detrás de autorización; almacenamiento fuera del webroot; validar ruta, MIME/tamaño y análisis de malware.
- JWT sin fallback, configuración obligatoria, CORS limitado y endpoints/docs expuestos deliberadamente.
- Diferenciar audit log de consultas; retención/acceso aprobados y redactar términos sensibles.
- Segregar borradores, pendientes e información privada del índice público.

## Aterrizaje de Misión 2: Buscador Jurídico Civil

El destino de búsqueda común debe recuperar lo útil de los hábitos legacy sin reinterpretar sus símbolos silenciosamente. En PHP, * significa AND, + significa OR, - separado excluye el siguiente término y % es el comodín parcial; en el parser moderno esa gramática no es equivalente. Se debe aprobar y versionar el contrato (incluyendo tildes, ñ, términos cortos y números) antes de migrar usuarios.

Agregar MicroISIS como fuente de datos pendiente de semántica, no como índice ya integrado: 52.375 filas están en la SQLite moderna local, pero el importador visible procesa sentencias, sumarios y PDFs y no tiene mapper MicroISIS. Las relaciones por parecido textual son candidatas hasta obtener diccionario y claves institucionales.

La lectura estática encontró que la búsqueda pública legacy filtra activo, pero no publicación. El proyecto debe verificar que publicación y ACL se aplican en búsqueda, snippets, facetas, sugerencias, preview y descarga. No se debe retirar el legado hasta reconciliar filas, relaciones y PDFs con hashes y un ledger.
