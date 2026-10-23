# Checklist de Busqueda

Usar estos casos en `/consulta` y, con sesion iniciada, en `/busqueda-avanzada`.

1. Buscar por numero de sentencia exacto.
2. Buscar por numero de sumario exacto.
3. Buscar por expediente exacto.
4. Buscar `daño` y luego `dano`; comparar resultados.
5. Buscar `año` y luego `ano`; comparar resultados.
6. Buscar frase exacta `"daño moral"`.
7. Buscar `daño -penal`.
8. Buscar `accidente OR responsabilidad`.
9. Filtrar por sala.
10. Filtrar por tipo de fallo.
11. Filtrar por fecha desde/hasta.
12. Filtrar `PDF = Solo con PDF`; abrir los primeros resultados y verificar visor/descarga.
13. Filtrar `PDF = Solo sin PDF`; abrir un resultado y verificar mensaje sin PDF.
14. Buscar una sentencia publicada por numero, sumario, expediente, tema y sala; debe aparecer en publica e interna.
15. Verificar que la consulta publica no muestre sentencias borrador, sumarios no publicados, reseñas no publicadas ni observaciones internas.

Comandos de validacion:

```bash
cd server
pnpm build

cd ../client
pnpm lint
pnpm build
```

Mantenimiento PDF:

```bash
cd server
pnpm run mantenimiento:recalcular-pdfs:dry
pnpm run mantenimiento:recalcular-pdfs
```
