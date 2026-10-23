# 41 — Descubrimiento de fuente oficial CIJ / CSJN

**Verificado:** 2026-10-07. **Alcance:** consultas públicas puntuales; sin crawling ni descarga de corpus.

## Resultado

La URL histórica `https://www.cij.gov.ar/sentencias.html` redirige al buscador **Tribunales Federales y Nacionales** de CSJN: `https://www.csjn.gov.ar/tribunales-federales-nacionales/sentencias.html`. El buscador ofrece filtros de jurisdicción, expediente, cámara, tipo de oficina, tribunal, fecha, carátula y palabras clave. Su ayuda fija el comienzo de cobertura en **21/08/2013** (Acordada CSJN 24/2013) e informa que las resoluciones disponibles son publicadas por los tribunales que las dictan.

La noticia institucional del 05/09/2025 informa que el buscador incorporó sentencias de primera instancia conforme a Acordada 10/2025. La página actual muestra el catálogo de cámaras y un resultado identificado como juzgado civil de primera instancia. No se tomó ese resultado como piloto ni se conservaron datos personales del listado.

## Mecanismo e identidad observados

| Aspecto | Evidencia / límite |
|---|---|
| Fuente actual | CSJN, superficie Tribunales Federales y Nacionales. “CIJ” es una URL histórica/redirección; no se atribuye la publicación actual al CIJ sin evidencia. |
| Buscador actual | HTML público en `/tribunales-federales-nacionales/sentencias.html`; buscador detallado en `/tribunales-federales-nacionales/buscador-de-fallos.html`. |
| Consulta | Formulario visible con campos jurisdicción, expediente, cámara/tipo de oficina/tribunal, fechas, carátula y palabras clave. La página detallada usa formulario POST. No se llamó al endpoint de búsqueda ni se derivó un API estable. |
| CAPTCHA / autenticación | No se observó CAPTCHA ni autenticación en las páginas informativas y formularios visibles. Esto no demuestra permiso para automatizar descarga. |
| Metadatos | En la superficie actual se observan tribunal, expediente, carátula, fecha y enlaces “Descargar” / “Ver Fallo”. No inferir campos no publicados. |
| PDF e ID | Un enlace oficial inspeccionado muestra patrón `sentencia-SGU-<UUID>.pdf` bajo `/tribunales-federales-nacionales/d/`. UUID es candidato a ID de archivo; no se probó su estabilidad frente a reemplazo/actualización. No usar expediente como ID único. |
| Paginación / checkpoint | La búsqueda visible tiene resultados paginados, pero no se validaron parámetros/cursor ni API de paginación. No implementar resume hasta tener canal autorizado y contrato observado. |
| ETag / Last-Modified / rate limits | No medidos: no se hizo adquisición de documentos ni secuencia de requests. |

## Restricción decisiva

El `robots.txt` oficial de `https://www.csjn.gov.ar/robots.txt` contiene `Disallow` para:

```text
/tribunales-federales-nacionales/d/
/tribunales-federales-nacionales/scp/d/
/tribunales-federales-nacionales/adj/pdfs/
/tribunales-federales-nacionales/adj/fallos/
/tribunales-federales-nacionales/adj/docs/
/archivo-cij/adj/pdfs/
```

El `robots.txt` que sigue sirviendo CIJ (`https://www.cij.gov.ar/robots.txt`) también prohíbe `/d/`, `/adj/pdfs/`, `/adj/fallos/` y `/sentencias.html`. La ruta de descarga oficial identificada está expresamente disallow en el host actual. Durante la verificación inicial, el visor web abrió un enlace y previsualizó un PDF; no se guardó en el workspace ni se incorporó a Corpus. Al confirmar la restricción no se repitió el acceso, no se creó adapter de descarga y no se intentó evadirla. La previsualización no constituye un piloto de adquisición ni autorización para ingesta automatizada o masiva.

## Datos Abiertos

`https://datos.csjn.gov.ar/` declara ser el portal de datos abiertos de CSJN y expone 307 datasets al momento de verificación. Se consultó su API CKAN pública `package_search` para `fallos`, `sentencia` y `jurisprudencia`: las tres consultas devolvieron cero datasets coincidentes. No se encontró un export/dataset de resoluciones civiles utilizable en esas consultas. Esto no prueba que no exista un conjunto con otra denominación.

## Decisión

La fuente es adecuada para **descubrimiento manual delimitado** y demuestra publicación Civil de ambas instancias en la superficie actual; no es una fuente aprobada para ingesta automatizada de PDF mientras se mantenga el `Disallow`. El piloto real, adapter descargador e inventario quedan bloqueados hasta que CSJN/CIJ ofrezca un canal oficial autorizado (export/API o autorización expresa que resuelva la restricción) y sus términos/condiciones de reutilización.

## Fuentes oficiales

- [Buscador CSJN — Tribunales Federales y Nacionales](https://www.csjn.gov.ar/tribunales-federales-nacionales/sentencias.html)
- [Buscador detallado CSJN](https://www.csjn.gov.ar/tribunales-federales-nacionales/buscador-de-fallos.html)
- [CIJ — URL histórica de sentencias](https://www.cij.gov.ar/sentencias.html)
- [Robots CSJN](https://www.csjn.gov.ar/robots.txt)
- [Robots CIJ](https://www.cij.gov.ar/robots.txt)
- [Datos Abiertos CSJN](https://datos.csjn.gov.ar/)
- [Noticia CSJN: primera instancia en el buscador, 05/09/2025](https://w1.csjn.gov.ar/novedades/detalle/10964)
