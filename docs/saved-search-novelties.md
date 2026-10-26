# Novedades de búsquedas guardadas

La lista de búsquedas guardadas muestra el conteo de fallos que coinciden y quedaron disponibles desde la última revisión explícita. La fecha de novedad es `Sentencia.publishedAt`, que registra cuándo el fallo pasó a estar disponible en Galilei; no se usa `fecha`, que representa la fecha judicial. Así un fallo antiguo incorporado hoy puede aparecer como nuevo.

## Estado y evaluación

`BusquedaGuardada` guarda sólo `lastViewedAt`, `lastEvaluatedAt` y `lastNewCount`, además de la consulta que ya existía. Crear una búsqueda establece el baseline en ese momento. Las búsquedas previas, cuyos campos migrados quedan nulos, fijan un baseline en su primera evaluación y muestran cero; no presentan el corpus histórico como novedades.

La evaluación consulta IDs publicados y activos con `publishedAt > lastViewedAt` y `publishedAt <= evaluatedAt`, con un máximo acotado de 50.000 candidatos. Luego reutiliza `BusquedaService.federatedSearch` con la consulta guardada, filtros, facetas representadas por el contrato persistido, orden y semántica COPERNIC moderna. La restricción de IDs sólo se aplica a Jurisprudencia. Un resultado Search parcial, una respuesta no exacta o un error deja intacto el watermark.

`GET /api/busquedas-guardadas/:id/novedades` entrega resultados paginados y el corte `evaluatedAt`; no los marca como vistos. El cliente conserva ese corte al cambiar de página. `POST /api/busquedas-guardadas/:id/novedades/vistas` avanza el watermark sólo hasta un corte evaluado con éxito y usa una condición de concurrencia sobre el estado leído. Una consulta fallida no borra el badge. El primer baseline de una búsqueda antigua se establece al consultarla.

No hay correo, cron ni worker. La evaluación ocurre al abrir la lista y bajo demanda. Los resúmenes se procesan con concurrencia máxima cuatro.

## Validación

Las pruebas cubren baseline, fecha de publicación frente a fecha judicial, filtros, reutilización del contrato Search, candidato vacío, errores y watermark acotado. La suite E2E aislada comprueba badge, visualización y marcado explícito, y confirma que un error conserva la novedad.
