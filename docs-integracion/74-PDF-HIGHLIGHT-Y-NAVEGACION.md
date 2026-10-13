# Sprint 10 — Visor PDF, highlight y navegación

El viewer Corpus usa React-PDF/PDF.js y su text layer. Los matches incluyen página, offset lógico, término y contexto. El visor diferencia coincidencia activa/restantes, navega y desplaza al match; permite buscar dentro del documento. El snippet lateral mantiene contexto si la geometría del text layer difiere del texto extraído.

Validado en navegador con un PDF Digesto del DEV: abrir, ver página, buscar dentro, renderizar `<mark>` y mostrar procedencia. El tiempo hasta primera página corresponde a una corrida, no es SLA ni prueba de todos los PDFs. Ligaduras y normalización pueden desalinear offsets; usar página/snippet como fallback.
