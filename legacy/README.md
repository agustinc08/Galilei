# Código legado

## Digesto

legacy/digesto/ preserva el código versionado de la aplicación CRA/Nest anterior. No forma parte del runtime Galilei ni se conecta a una base remota. El producto actual integra Digesto como dominio/colección dentro de client/ y server/; no se infieren IDs, metadatos, ACL o publicación desde los datos antiguos.

Los PDFs ignorados que existían en el checkout principal bajo digesto/server/pdfs/ son una fuente local independiente y read-only. La reorganización Git no los mueve ni los borra. En un checkout limpio pueden no existir.

El código legado se mantiene para consulta y recuperación histórica. No instalar ni arrancar sus paquetes para servir Galilei. Sus builds y dependencias reproducibles no son parte de esta carpeta versionada.
