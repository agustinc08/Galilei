# 153 — Deduplicación y reconciliación — Sprint 14

La identidad de bytes se compara sólo con SHA-256 tras descarga verificada. SHA igual significa duplicado exacto de archivo. IDs externos se comparan antes de adquirir; una coincidencia de fuente+ID puede vincular procedencia sin fusionar el texto institucional. Carátula, expediente, tribunal, fecha, número y tomo/página generan `LEGAL_DOCUMENT_CANDIDATE` sólo con evidencia coincidente; no se fusiona automáticamente.

En este sprint hubo 0 bytes descargados y 0 sentencias individuales adquiridas; por lo tanto SHA coincidentes, IDs externos reconciliados, candidatos jurídicos, nuevas sentencias y conflictos son **no evaluados**, no cero duplicados. Los 421 enlaces de tomos son referencias de archivos recopilatorios, no identidades de cada fallo. El corpus local conserva los conteos ya documentados; no se reescaneó.
