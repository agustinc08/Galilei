# Revisión de clasificaciones

Las reglas locales producen filas RULE con estado SUGGESTED; la interfaz /revision y el visor permiten aprobar, rechazar o corregir y aprobar. La operación individual conserva evidencia, usuario y fecha. La acción por lotes está limitada a 20 y permite aprobación/rechazo; corregir valores requiere una revisión individual. Las filas sugeridas se distinguen de las aprobadas en listados y resumen.

Al cierre hay 21.547 sugerencias, cero aprobadas en los datos persistentes. Esta misión no autoaceptó sugerencias y no usó IA. La precisión semántica sigue sin medir: no hay ground truth aprobado. La prueba integrada sólo usa registros sintéticos que se limpian tras el test; no altera ese conteo persistente.
