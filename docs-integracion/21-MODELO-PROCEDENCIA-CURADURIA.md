# 21 — Modelo de procedencia y curaduría

## Principios

La base de jurisprudencia contiene fallos seleccionados mediante criterio humano; no representa automáticamente todo documento que llega de una fuente. Deben registrarse por separado la obtención, el documento recibido, el órgano emisor y la decisión editorial de incorporarlo al corpus jurisprudencial.

La proyección de búsqueda es un read model reconstruible. No reemplaza las entidades jurídicas, documentos, relaciones, decisiones de curaduría ni las reglas de acceso.

## Entidades conceptuales

### SourceSystem

Catálogo editable de fuentes de obtención, con identificador, código estable, nombre, tipo, estado activo y datos de referencia. Ejemplos iniciales: CIJ, CSJN, Lex100 bajo autorización, carga manual y otra fuente institucional. El catálogo no debe ser un enum cerrado ni asumir que una fuente es el órgano que dictó el fallo.

### IngestionRecord

Una recepción concreta desde una fuente: fuente, referencia externa si existe, fecha/hora de obtención, estado de proceso, checksum, metadatos originales, ubicación controlada y versión de extracción. Las nuevas recepciones conservan historial y permiten detectar duplicados por contenido sin asumir que dos copias idénticas equivalen a dos decisiones judiciales distintas.

### LegalDocument y Judgment

Documento original o derivado y, cuando corresponda, la resolución judicial a la que representa. Registrar IDs externos, fechas, tipo documental y sus relaciones sin concentrar toda la información en una tabla universal. Documento recibido no implica sentencia incorporada ni publicada.

### JudicialOrganization

Catálogo de órganos con tipo, nombre, jurisdicción, código opcional y relación jerárquica opcional. Puede representar una Cámara, un Juzgado o la Corte. Las salas son entidades o unidades subordinadas al órgano cuando corresponde; no son obligatorias.

### Instance

Catálogo editable de instancias, al menos primera, segunda, Corte y otras futuras. La instancia se asocia al documento/decisión correspondiente. No inferirla sólo por la existencia de una sala.

## Curaduría humana

Registrar decisiones append-only o con historial explícito: objeto revisado, estado editorial, actor, fecha, motivo del cambio, observación y temas asociados. El catálogo de motivos es editable e incluye conceptos como caso novedoso, criterio aislado, cambio de criterio, contradicción, actualización e interés jurídico. Permitir correcciones sin perder quién decidió y cuándo.

Flujo inicial sugerido: recibido, pendiente de revisión, seleccionado o descartado. Publicación editorial posterior puede progresar por pendiente, revisado, seleccionado y publicado. Estos estados no deben modelarse como si fueran ACL.

La relevancia y los temas deben mantener autoría/origen: propuesta automática, sugerencia de usuario o decisión de curador. Una clasificación propuesta no se convierte en verdad sin revisión humana.

## Publicación, acceso y privacidad

Separar tres ejes:

- Estado editorial: pendiente, revisado, seleccionado, publicado, retirado u otros estados controlados.
- Visibilidad/ACL: público, interno, restringido y permisos específicos por rol o contexto.
- Anonimización: estado, regla o versión aplicada, fecha y revisión; no es equivalente a publicar u ocultar.

El filtro de autorización debe ejecutarse antes de puntuar, generar snippets, calcular facets, contar resultados o servir previews y PDFs. Una etiqueta editorial de publicado no otorga automáticamente acceso irrestricto.

## Procedencia en resultados

La API global puede devolver campos comunes como dominio, tipo, fecha, título, fuente, organización, instancia y visibilidad efectiva, junto con metadata específica de cada dominio. Sala/chamber es opcional. El resultado de Digesto podrá incluir colección y dependencia; el de Jurisprudencia, órgano, sala e instancia. Evitar rellenar dimensiones ajenas con valores falsos.

## Decisiones pendientes de validación funcional

Confirmar con Secretaría los estados reales, quién puede seleccionar/publicar/retirar, si la fuente institucional conserva un identificador estable, retención del original, reglas de anonimización y alcance de cada visibilidad. Este documento es diseño conceptual y no altera el schema Prisma.
