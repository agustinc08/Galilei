# OCR local — piloto Sprint 9

## Entorno verificado

Tesseract 5.5.3 instalado desde el manifiesto WinGet oficial; paquete validado por SHA256 del instalador bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4. Se instaló el modelo español spa de tessdata_best; el hash GitHub/local coincide (18ceb5679049d25f9e5486a1571359829530e7e0). La corrida usó Poppler 26.07.0 disponible localmente, 160 DPI y límite de 25 MB/20 páginas por PDF.

## Corrida medida

Run b06f3f24-6893-4b40-9d53-e33e4db6984f: 20 documentos elegibles, 20 procesados, 0 fallidos; 94 páginas, 174.292 caracteres y 29.424 palabras en 221.060 ms. El smoke de búsqueda sobre texto derivado pasó. SHA de los originales se verificó sin cambios. Cada texto OCR es una versión derivada content-addressed (version=0) con página, herramienta, modelo y procedencia; se conserva el original como versión 1. El visor sigue sirviendo el original.

El muestreo quedó bloqueado de manera idempotente al conjunto inicial de 20; una ejecución repetida no selecciona otros documentos. El estado del corpus pasa de 399 a 379 OCR_REQUIRED y de 10.332 a 10.352 INDEXED. El reporte íntegro está en _recovery-work/sprint9/ocr/pilot-b06f3f24-6893-4b40-9d53-e33e4db6984f/ocr-pilot-report.json.

## Evaluación y alcance

El éxito mide extracción no vacía, cobertura y smoke de búsqueda; no mide exactitud OCR porque no existe transcripción de referencia revisada. No se ejecutó OCR masivo. Mantener los restantes 379 pendientes y someter una muestra a revisión humana antes de ampliar.
