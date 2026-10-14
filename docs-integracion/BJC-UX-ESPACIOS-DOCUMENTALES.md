# UX de espacios documentales — contrato de Sprint 15.6

**Actualizado:** 2026-10-14. **Estado:** experiencia de dependencia y búsqueda implementada; visibilidad personal/restringida por carpeta no disponible en el modelo actual. La evaluación cero capacitación es heurística y E2E; UAT humana sigue pendiente.

## Lenguaje para el usuario

- Una persona con una sola dependencia entra directamente a los documentos de su Sala, Juzgado o Secretaría.
- Una persona con varias dependencias elige en una pantalla «¿Dónde querés trabajar?» usando sus nombres visibles. La selección queda en la URL de la sesión actual; cada carga de datos vuelve a validar la membresía.
- La dependencia activa se identifica de forma persistente en el encabezado. La búsqueda, las carpetas y la vista previa mantienen ese contexto.
- El buscador usa «Carpetas», «Documentos compartidos», «Vista previa», «Abrir» y «Descargar». Las carpetas jerárquicas se pueden contraer y expandir con controles accesibles por teclado.
- La configuración de carpetas de red se reserva a administración autorizada. El buscador normal muestra el nombre configurado de la carpeta y no la ruta UNC.
- Antes de cargar, la pantalla identifica destino y alcance: documentos compartidos con las personas autorizadas de la dependencia. No afirma que exista carga personal o acceso por carpeta.
- Errores de acceso y ausencia usan el mismo mensaje («No encontramos este documento o no tenés acceso») para no revelar si existe un documento ajeno.
- El procesamiento se expresa en lenguaje simple. «Texto reconocido automáticamente» explica el origen del texto sin exponer estados internos.

## Alcance de permisos confirmado

El contrato implementado en DEV concede acceso a los documentos mediante membresía activa de una dependencia. `WorkspaceDocument` vincula el documento a la dependencia y, opcionalmente, a una carpeta. Los endpoints de carpetas, búsqueda, metadatos, coincidencias y archivos validan esa membresía.

El modelo actual **no** tiene propietario de documento para acceso personal, política de visibilidad por carpeta, lista de personas autorizadas por carpeta ni operación para cambiar esa política. Por eso:

- «Compartido con [dependencia]» describe fielmente los documentos del área actual.
- «Privado — sólo yo», «Restringido — personas elegidas», «Mis documentos» y sus selectores no se muestran como funciones disponibles.
- El enum interno `RESTRICTED` de Corpus significa que el documento está aislado del corpus general y requiere pertenencia a la dependencia. No es una carpeta restringida para un subconjunto de sus miembros.
- No se crean badges, promesas, filtros o tareas E2E que aparenten una separación personal/restringida que el backend no aplica.

Para ofrecer esas funciones hace falta un diseño posterior de propietario, política heredable/no heredable de carpeta, mantenimiento transaccional de miembros autorizados y predicados ACL consistentes en listado, árbol, Search, conteos, preview, descarga, carga, movimiento y recuentos. Debe incluir regresiones de aislamiento por identidad y documentos con el mismo SHA en distintos ámbitos. No basta con ocultar controles del frontend.

## Perfiles y pantallas

| Perfil | Comportamiento de esta versión |
| --- | --- |
| Miembro de una dependencia | Entra directamente; lee y busca documentos compartidos con miembros activos; no administra personas ni fuentes. |
| Miembro de varias dependencias | Elige un nombre humano y puede cambiar de dependencia desde el encabezado. |
| Editor / responsable autorizado | Administra carpetas y cargas; antes de cargar ve la carpeta de destino y que el archivo quedará compartido con la dependencia. |
| Administrador autorizado de fuentes | Configura y diagnostica fuentes de red desde administración; la configuración operativa no forma parte del buscador normal. |
| Sin membresía | Ve una explicación de que aún no tiene una dependencia asignada; el backend no devuelve nombres de carpetas ajenas. |

## Búsqueda, carpetas y vista previa

- El alcance muestra el nombre de la dependencia o la carpeta seleccionada. La búsqueda existente sigue limitada por la ACL del backend.
- El buscador reúne coincidencias por contenido y nombre, y presenta archivo, carpeta, página, fecha y fragmento. Los resultados no exponen IDs, MIME interno, SHA, estado de OCR ni rutas de servidor.
- El árbol tiene selección visible, nivel y controles expandir/contraer; el teclado permite seleccionar, navegar resultados y expandir/contraer carpetas.
- La preview inicia con una instrucción directa, mantiene Abrir/Descargar y presenta carga/error con mensajes humanos. F3 se explica junto a los atajos existentes.
- El procesamiento no promete búsqueda lista antes de que termine. El texto OCR no recibe resaltado visual no certificado.
- Las fuentes legadas mantienen sus etiquetas humanas configuradas; cuando su origen está caído, el usuario ve un mensaje general sin ruta, credencial ni directorio temporal.

## Responsive y accesibilidad

El objetivo principal es 1366×768, con verificación también en 1440×900, 1536×864, 1600×900, 1920×1080, 1920×1200 y 2560×1440. Se verifica ausencia de overflow horizontal global, tres paneles visibles en escritorio, foco visible, controles etiquetados, selección del árbol y estados anunciables.

La interfaz conserva el shell global existente. No define la navegación global final entre Jurisprudencia y documentos privados; eso sigue coordinado con la integración de ramas.

## Paquete de evaluación humana pendiente

Preparar una sesión sin instrucciones de clic. Pedir a una persona que:

1. Entre a los documentos de su Juzgado o Sala.
2. Busque «responsabilidad» y abra un resultado.
3. Encuentre la coincidencia siguiente y descargue el archivo.
4. Abra una carpeta compartida e identifique con quién está compartida.
5. Compruebe qué ocurre al no tener acceso a otra dependencia.

Cuando existan permisos personales y restringidos en backend, agregar: cargar un documento sólo propio, compartir otro con la dependencia y autorizar una carpeta para dos personas. No presentar las tareas aún no implementadas como parte del UAT de esta versión.

## Resultado de Sprint 15.6

**PARTIAL.** Playwright autenticado pasó 2/2; cubrió usuario sin membresía, entrada directa, selector multi-dependencia, roles y cargas, árbol/alcance, Search por contenido y nombre, filtros, PDF/DOC/RTF, OCR, navegación del Viewer y denegación 404 genérica. La matriz responsive cubrió siete resoluciones desde 1366×768 hasta 2560×1440, con cero overflow horizontal y tres paneles visibles; capturas clave se inspeccionaron. Typecheck, lint dirigido, build frontend, Prisma validate/generate/migrate status, Search verify, golden Search y Source PostgreSQL pasaron. La integración PostgreSQL Workspace falló dos veces sólo en `attemptCount=1` del job OCR (observado `2`); no se detuvieron servicios activos y la causa de concurrencia no quedó confirmada.

El cleanup E2E removió 2 workspaces y 5 documentos sintéticos, eliminó el storage aislado y dejó el baseline igual al previo: 17.078 documentos, 17.098 archivos, 198.129 páginas, 17.685 ingestas, cero privados/workspaces y 18.799.500 tokens. Search verify reportó stale=0, mismatch=0/100 y rebuild=0.

La promesa «Mis documentos / sólo yo» y las carpetas restringidas por persona quedan pendientes de contrato y autorización backend; por lo tanto, este sprint no certifica la experiencia completa pedida para esas dos clases de visibilidad. UAT humana, aprobación institucional y producción siguen fuera del alcance.
