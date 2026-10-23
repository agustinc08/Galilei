# PDF streaming y viewer — Sprint 12

**Resultado: validación funcional PASS en el alcance de Sprint 11; límite técnico de buffering documentado.** Los endpoints admiten Range y devuelven 206. La auditoría previa probó PDFs de 1, 50 y 109 páginas; en la concurrencia Sprint 12 los 36 requests Range completaron con 206 y cero errores, aunque su p95 llegó a 19,58 s bajo 20 usuarios por contención general.

Inventario observado: 93 archivos de al menos 50 páginas, 4 de al menos 100; máximo 167 páginas / 11,35 MiB. El handler todavía bufferiza el archivo completo. No se hizo prueba específica de memoria de documentos mayores a ese máximo; el pico del proceso en la carga fue 838 MiB y no puede atribuirse sólo al viewer.

Playwright lector PASS: búsqueda, colección Digesto, PDF/highlight de contexto. `highlight` refiere al contexto/match de la aplicación; no hay resaltado pintado en la capa gráfica del PDF.js. Próximo paso: streaming real con límites de rango y medición aislada de memoria antes de introducir PDFs significativamente mayores.
