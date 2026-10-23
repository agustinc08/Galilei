# Checklist funcional JurisprudenciaN

## Auth

- [ ] Login admin correcto
- [ ] Login operador correcto
- [ ] `GET /api/auth/me` responde con usuario y rol
- [ ] Logout limpia sesion y redirige a `/login`
- [ ] Un `401` limpia token y muestra sesion expirada
- [ ] Rutas protegidas redirigen a `/login` sin sesion
- [ ] `/admin/logs` solo visible para `ADMIN`

## Sentencias

- [ ] Crear sentencia simple
- [ ] Editar sentencia existente
- [ ] Publicar sentencia
- [ ] Despublicar sentencia
- [ ] Anonimizar sentencia
- [ ] Desanonimizar sentencia
- [ ] Desactivar sentencia con `ADMIN`
- [ ] Ver detalle `/sentencias/[id]`
- [ ] Ver documento `/sentencias/[id]/documento`

## Wizard de carga

- [ ] Paso 1 datos basicos
- [ ] Paso 2 seleccion de PDF
- [ ] Paso 3 alta de sumarios
- [ ] Paso 4 reseña
- [ ] Paso 5 referencias
- [ ] Paso 6 publicacion y anonimización
- [ ] Paso 7 vista previa
- [ ] Guardar borrador
- [ ] Guardar y publicar

## Sumarios

- [ ] Crear sumario
- [ ] Editar sumario
- [ ] Publicar sumario
- [ ] Despublicar sumario
- [ ] Desactivar sumario con `ADMIN`
- [ ] Listar por sentencia
- [ ] Verlo en consulta pública si corresponde

## PDFs

- [ ] Subir PDF
- [ ] Listar PDFs por sentencia
- [ ] Descargar PDF interno
- [ ] Ver PDF en visor documental
- [ ] Descargar PDF publico
- [ ] Eliminar PDF con `ADMIN`

## Consulta pública

- [ ] `/consulta` carga filtros visibles
- [ ] Buscar por texto libre
- [ ] Buscar por tema
- [ ] Buscar por sala
- [ ] Buscar por fecha
- [ ] Buscar por expediente
- [ ] Highlights visibles
- [ ] Selección múltiple
- [ ] Imprimir seleccionados
- [ ] Abrir detalle público
- [ ] Abrir visor documental público
- [ ] Abrir PDF público si existe

## Busqueda administrativa

- [ ] Texto simple con AND implícito
- [ ] Frase exacta con comillas
- [ ] Exclusión con `-termino`
- [ ] OR explícito
- [ ] Filtros por campos
- [ ] Ranking visible
- [ ] Highlights visibles
- [ ] Exportar resultados
- [ ] Guardar búsqueda

## Reseñas y citas

- [ ] Editar reseña
- [ ] Publicar reseña
- [ ] Despublicar reseña
- [ ] Detectar citas
- [ ] Confirmar cita detectada
- [ ] Cita pendiente no visible en público
- [ ] Cita confirmada visible en público

## Referencias

- [ ] Normativas internas
- [ ] Jurisprudenciales internas
- [ ] Doctrinarias internas
- [ ] Referencias visibles en detalle público publicado

## Visor documental

- [ ] Panel lateral carga sumarios
- [ ] Panel lateral carga reseña
- [ ] Panel lateral carga citas
- [ ] Panel lateral carga referencias
- [ ] Descargar PDF desde visor
- [ ] Compartir enlace desde visor
- [ ] Imprimir ficha desde visor

## Estadísticas

- [ ] `/dashboard` muestra totales
- [ ] `/estadisticas` muestra contenido
- [ ] `/estadisticas` muestra uso
- [ ] Documentos más consultados
- [ ] PDFs más descargados
- [ ] Búsquedas populares
- [ ] Búsquedas sin resultados

## Auditoría

- [ ] `/admin/logs` lista acciones
- [ ] Filtros de auditoría funcionan
- [ ] Detalle de log muestra `datosAntes`
- [ ] Detalle de log muestra `datosDespues`
- [ ] Timeline de sentencia carga historial

## Build y calidad

- [ ] `back/npm run build`
- [ ] `front/npm run lint`
- [ ] `front/npm run build`
