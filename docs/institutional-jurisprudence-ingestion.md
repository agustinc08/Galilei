# Ingreso institucional de jurisprudencia

## Propósito y alcance

Esta pantalla permite que personal autorizado reciba un PDF judicial nuevo, revise su identidad y decida si lo vincula a una sentencia existente o si crea una sentencia en borrador. Recibir un archivo no lo publica. La publicación sigue separada y conserva las autorizaciones existentes.

La implementación de Sprint 7 está en la rama candidata `feature/institutional-ingestion-suite-7`. Se validó en servicios QA locales aislados. No es una aprobación de despliegue en oficina ni de producción.

## Uso para el equipo institucional

1. Abrí **Ingreso de jurisprudencia** desde el área administrativa.
2. Elegí un solo archivo PDF de hasta 100 MB y presioná **Recibir PDF**. Galilei valida el tipo y la estructura antes de aceptar el archivo.
3. Revisá el SHA-256, las páginas y el resultado de extracción. Si el PDF es un escaneo sin texto, queda marcado **Requiere OCR**; el sistema no inventa texto.
4. Confirmá expediente, Sala, fecha y carátula. Los datos adicionales son opcionales. La fecha se conserva como fecha civil, sin desplazar el día por zona horaria.
5. Revisá las coincidencias deterministas. Si hay una sentencia exacta, seleccioná explícitamente el registro correcto y confirmá el vínculo. Si hay coincidencias múltiples o parciales, resolvelas como revisión humana; Galilei no elige por similitud.
6. Si no hay coincidencia, elegí **Crear sentencia en borrador** sólo después de revisar los datos. El borrador y su documento permanecen internos y sin publicar.
7. Consultá la cola paginada, sus estados y el historial para continuar o revisar el trabajo. Reintentá una extracción sólo cuando la cola lo habilite. Se puede cancelar el ingreso antes de crear el vínculo legal.

Los duplicados exactos muestran que el archivo ya existe y reutilizan la identidad de bytes. Cambiar el nombre no crea otro archivo. Un nombre repetido con contenido distinto no sobrescribe el archivo anterior.

## Roles

| Rol | Ver cola y detalle | Cargar, confirmar, vincular, crear borrador, reintentar o cancelar |
| --- | --- | --- |
| `ADMIN` | Sí | Sí |
| `OPERADOR` | Sí | Sí |
| `JURISPRUDENCIA` | Sí | Sí |
| `REVISOR` | Sí | No |
| `LECTOR` | No | No |

El servidor verifica los roles en cada endpoint. Un `LECTOR` no recibe cola, metadatos ni acceso al archivo por esta función.

## Estados del flujo

- `VALIDATING`: se validan el PDF y su extracción.
- `METADATA_PENDING`: el archivo quedó incorporado al Corpus y espera revisión de datos.
- `OCR_REQUIRED`: PDF legible estructuralmente, pero sin texto nativo suficiente; no se publica texto supuesto.
- `DUPLICATE_EXACT`: se detectó identidad SHA-256 existente y se reutiliza el archivo canónico. Si esa identidad no puede resolverse de manera segura, el caso pasa a revisión.
- `MATCH_CANDIDATE`: existe una coincidencia exacta única que requiere confirmación explícita de la persona usuaria.
- `READY_TO_CREATE_DRAFT`: no se encontró coincidencia determinista y se puede solicitar la creación explícita de un borrador.
- `REVIEW_REQUIRED`: el archivo está cifrado, tiene resultados ambiguos o necesita una decisión institucional.
- `LINKED`: vínculo confirmado con una sentencia existente.
- `DRAFT_CREATED`: sentencia creada en `BORRADOR`, con `publicado=false` y `publishedAt=null`.
- `FAILED`: el ingreso no pudo completarse; se guarda un mensaje seguro y una causa controlada.
- `CANCELLED`: ingreso cancelado antes de terminar un vínculo o borrador.

Los estados posibles los decide el servidor; no existe una operación cliente para asignar un estado arbitrario. El detalle muestra la historia de eventos y las acciones habilitadas para el estado actual.

## Duplicados, identidad y matching

- Se calcula SHA-256 en el servidor. Los bytes se escriben en el almacenamiento content-addressed ya utilizado por Corpus.
- Un duplicado exacto no crea un segundo `CorpusDocumentFile` ni una segunda copia física. La asociación y el contexto institucional se conservan en la fila/eventos de ingreso.
- La ruta de almacenamiento no deriva del nombre entregado por la persona usuaria. El nombre original se conserva como procedencia de la carga.
- La coincidencia legal es determinista y explicable. `EXACT_UNIQUE` permite proponer una sola sentencia; `MULTIPLE_EXACT`, `PARTIAL_CANDIDATE` y `NO_MATCH` no habilitan un vínculo automático.
- Confirmar un vínculo vuelve a comprobar el estado del documento y de la sentencia dentro de una transacción. Una sentencia que ya tiene otro PDF no se sobrescribe.

## Archivo, extracción y Search

El máximo se impone en el interceptor y el servicio: un PDF y 100 MiB. La validación comprueba extensión/nombre, tipo PDF, firma `%PDF-`, parseabilidad y al menos una página. Un PDF malformado no crea un archivo canónico utilizable. Los PDF cifrados se envían a revisión; no se intenta descifrar ni adivinar contraseñas.

La ingestión reutiliza `CorpusDocument`, `CorpusDocumentFile`, `CorpusIngestionRecord`, `CorpusExtraction`, `CorpusDocumentPage`, el extractor existente y el storage canónico. PostgreSQL mantiene la verdad de workflow y metadatos; el filesystem conserva los bytes; Search sigue siendo una proyección alimentada por el camino actual de Corpus/outbox.

El documento creado por ingreso empieza con visibilidad `INTERNAL`. Un vínculo conserva la publicación de la sentencia existente; un borrador nuevo queda sin publicar. Viewer y Search mantienen los filtros y ACL existentes. No se crea una arquitectura de índice paralela ni se escribe directamente en OpenSearch.

## API y persistencia

Base: `/api/corpus/institutional-ingestions`

- `POST /upload` — multipart de un PDF; admite `Idempotency-Key`.
- `GET /` — cola con página, tamaño, estado y búsqueda.
- `GET /:id` — detalle e historial.
- `PATCH /:id/metadata` — confirma datos y calcula candidatos deterministas.
- `POST /:id/link` — confirma el vínculo a una sentencia elegida.
- `POST /:id/draft` — crea un borrador explícitamente.
- `POST /:id/retry-extraction` — reintenta estados admitidos.
- `POST /:id/cancel` — cancela antes del vínculo legal.

La migración `20261026160000_institutional_ingestion_workflow` agrega `InstitutionalIngestion` y `InstitutionalIngestionEvent`. La primera registra el intento y referencias a objetos canónicos. La segunda registra eventos con actor, transición y resultado seguro; no copia bytes ni texto documental.

Las acciones de usuario también se registran en el `AuditLog` existente. Auditoría y eventos no contienen el texto íntegro del fallo ni bytes del PDF.

## Límites operativos

La certificación de Sprint 7 usa sólo PostgreSQL `127.0.0.1:55434/buscador_juridico_civil_deepqa`, OpenSearch QA `127.0.0.1:19200`, backend/frontend loopback y almacenamiento sintético aislado. No se escribe en PostgreSQL principal `55432`, Search principal `9200`, Corpus real ni Sytec10. No se cargan fallos institucionales reales durante QA.

La carga llega al servicio mediante el buffer multipart limitado a 100 MiB del framework; no se presenta como streaming. El benchmark exploratorio mide tiempo total de solicitud HTTP y no separa fases internas ni sustituye una prueba institucional de capacidad.
