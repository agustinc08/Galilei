# Seguridad, ACL, decisión editorial y anonimización

El backend mantiene ACL, estado editorial y anonimización como dimensiones separadas. Los endpoints de curaduría exigen usuario autenticado y ADMIN/OPERADOR; la regla de servicio prohíbe al OPERADOR curar documentos RESTRICTED. ADMIN crea taxonomía. La búsqueda y descarga Corpus conservan ACL previa a resultados/conteos/snippets. No se añadió acción de publicación ni la selección editorial vuelve público un documento.

Las auditorías usan AccionLog. El OCR atribuye la tarea a una cuenta técnica inactiva sistema-corpus@jurisprudencia.local con rol OPERADOR y hash aleatorio no entregado; no puede iniciar sesión. No se concedieron usuarios humanos ni permisos permanentes adicionales.

Pendiente de decisión institucional: correspondencia de identidades y permisos del Digesto, reglas por dependencia, anonimización de datos sensibles, retención, política de publicación y matriz de aceptación. No afirmar cumplimiento institucional ni habilitar producción hasta que se valide con responsables.
