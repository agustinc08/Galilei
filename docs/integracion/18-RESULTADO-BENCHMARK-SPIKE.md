# 18 — Resultado benchmark del Search spike

## Resumen

Se conservaron las 55 filas y los valores de `docs/integracion/benchmark-busqueda.json`. Los casos medidos usan el fixture local con conexión inmutable y solo lectura. Los cinco IDs de control se comprobaron por pertenencia y grupos de fecha, sin imponer un orden entre empates. `total` se contrasta separado de la ventana paginada.

| Estado | Casos |
|---|---:|
| PASS | 42 |
| FAIL | 0 |
| PARCIAL | 1 |
| NO APLICA | 12 |
| Total | 55 |

BJC-033 tiene PASS para la consulta de control legacy `daños` pedida por el benchmark; no es una medición PostgreSQL del campo moderno `tema:daños`. BJC-052 es PARCIAL porque la sintaxis nueva admite siete términos, mientras el legacy rechazaba más de seis. Los casos modernos no admitidos por el parser antiguo, los valores redactados y el filtro público que no existía se dejan como NO APLICA, no como fallos.

## Matriz

| ID | Legacy esperado | Parser nuevo | SQLite spike | Estado |
|---|---|---|---|---|
| BJC-001 | n=2708; visible≤300 | AST válido | n=2708; ventana≤300 | PASS |
| BJC-002 | n=2708; visible≤300 | AST válido | n=2708; ventana≤300 | PASS |
| BJC-003 | n=1; visible≤1 | AST válido | n=1; ventana≤1 | PASS |
| BJC-004 | n=1294; visible≤300 | AST válido | n=1294; ventana≤300 | PASS |
| BJC-005 | n=995; visible≤300 | AST válido | n=995; ventana≤300 | PASS |
| BJC-006 | n=3007; visible≤300 | AST válido | n=3007; ventana≤300 | PASS |
| BJC-007 | n=1713; visible≤300 | AST válido | n=1713; ventana≤300 | PASS |
| BJC-008 | n=956; visible≤300 | AST válido | n=956; ventana≤300 | PASS |
| BJC-009 | n=3269; visible≤300 | AST válido | n=3269; ventana≤300 | PASS |
| BJC-010 | n=0; visible≤0 | AST válido | n=0; ventana≤0 | PASS |
| BJC-011 | n=4758; visible≤300 | AST válido | n=4758; ventana≤300 | PASS |
| BJC-012 | n=413; visible≤300 | AST válido | n=413; ventana≤300 | PASS |
| BJC-013 | n=3064; visible≤300 | AST válido | n=3064; ventana≤300 | PASS |
| BJC-014 | n=285; visible≤285 | AST válido | n=285; ventana≤285 | PASS |
| BJC-015 | n=674; visible≤300 | AST válido | n=674; ventana≤300 | PASS |
| BJC-016 | n=3155; visible≤300 | AST válido | n=3155; ventana≤300 | PASS |
| BJC-017 | n=600; visible≤300 | AST válido | n=600; ventana≤300 | PASS |
| BJC-018 | n=2572; visible≤300 | AST válido | n=2572; ventana≤300 | PASS |
| BJC-019 | n=7831; visible≤300 | AST válido | n=7831; ventana≤300 | PASS |
| BJC-020 | n=25003; visible≤300 | AST válido | n=25003; ventana≤300 | PASS |
| BJC-021 | n=21655; visible≤300 | AST válido | n=21655; ventana≤300 | PASS |
| BJC-022 | n=599; visible≤300 | AST válido | n=599; ventana≤300 | PASS |
| BJC-023 | n=39; visible≤39 | AST válido | n=39; ventana≤39 | PASS |
| BJC-024 | n=5449; visible≤300 | AST válido | n=5449; ventana≤300 | PASS |
| BJC-025 | n=658; visible≤300 | AST válido | n=658; ventana≤300 | PASS |
| BJC-026 | n=1099; visible≤300 | AST válido | n=1099; ventana≤300 | PASS |
| BJC-027 | error legacy: legacy accepts only *, +, - as connectors; sintaxis moderna no admitida por legacy | AST moderno válido | — | NO APLICA |
| BJC-028 | error legacy: legacy accepts only *, +, - as connectors; sintaxis moderna no admitida por legacy | AST moderno válido | — | NO APLICA |
| BJC-029 | n=1713; visible≤300 | AST válido | n=1713; ventana≤300 | PASS |
| BJC-030 | n=0; visible≤0 | AST campo sala:A; literal en dialecto legacy | n=0; modo legacy-reference | PASS |
| BJC-031 | n=288; visible≤288 | AST «daño» + filtro estructurado sala=A | n=288; sala=A | PASS |
| BJC-032 | n=93; visible≤93 | AST «daño» + filtro estructurado 2015 | n=93; rango 2015 | PASS |
| BJC-033 | n=9798; control legacy «daños» | AST campo tema:daños | n=9798; control «daños» | PASS |
| BJC-034 | sin comparación; valor redactado | Campo validado; valor redactado | —; no se inventó un valor | NO APLICA |
| BJC-035 | sin comparación; valor redactado | Campo validado; valor redactado | —; no se inventó un valor | NO APLICA |
| BJC-036 | sin comparación; valor redactado | Campo validado; valor redactado | —; no se inventó un valor | NO APLICA |
| BJC-037 | sin comparación; valor redactado | Campo validado; valor redactado | —; no se inventó un valor | NO APLICA |
| BJC-038 | sin comparación; valor redactado | Campo validado; valor redactado | —; no se inventó un valor | NO APLICA |
| BJC-039 | n=0; visible≤0 | AST campo sala:A; literal en dialecto legacy | n=0; modo legacy-reference | PASS |
| BJC-040 | sin filtro público legacy equivalente | AST campo tipoFallo:L | —; filtro no comparable | NO APLICA |
| BJC-041 | sin comparación; valor redactado | Campo validado; valor redactado | —; no se inventó un valor | NO APLICA |
| BJC-042 | sin comparación; valor redactado | Campo validado; valor redactado | —; no se inventó un valor | NO APLICA |
| BJC-043 | n=599; visible≤300 | AST válido | n=599; ventana≤300 | PASS |
| BJC-044 | n=61; visible≤61 | AST válido | n=61; ventana≤61 | PASS |
| BJC-045 | n=108; visible≤108 | AST válido | n=108; ventana≤108 | PASS |
| BJC-046 | n=1107; visible≤300 | AST válido | n=1107; ventana≤300 | PASS |
| BJC-047 | n=1107; visible≤300 | AST válido | n=1107; ventana≤300 | PASS |
| BJC-048 | n=0; visible≤0 | AST válido | n=0; ventana≤0 | PASS |
| BJC-049 | n=6250; visible≤300 | AST válido | n=6250; ventana≤300 | PASS |
| BJC-050 | error legacy: operator without left term | Error de parseo claro | — | PASS |
| BJC-051 | error legacy: missing right-hand term or malformed operator sequence | Error de parseo claro | — | PASS |
| BJC-052 | error legacy: more than six search terms; el parser nuevo no conserva el límite de 6 | AST válido (7 términos) | —; sin resultado comparable | PARCIAL |
| BJC-053 | error legacy: Parentheses are not operators in legacy; OR is not an allowed connector.; sintaxis moderna no admitida por legacy | AST moderno válido | — | NO APLICA |
| BJC-054 | n=2729; visible≤300 | AST válido | n=2729; ventana≤300 | PASS |
| BJC-055 | error legacy: Legacy no admite palabras AND/OR ni paréntesis.; sintaxis moderna no admitida por legacy | AST moderno válido | — | NO APLICA |

## Límites de interpretación

- Los conteos PASS acreditan el dialecto de referencia y las consultas equivalentes expresamente definidas en el benchmark; no acreditan resultados de PostgreSQL.
- El orden histórico solo está definido por fecha. El test coteja pertenencia de los IDs conocidos y su grupo de fecha; el orden entre filas con fecha empatada puede variar.
- El filtro BJC-031/032 se reconstruye como filtro estructurado de la consulta original, no como sintaxis embebida en el texto libre.
- BJC-030/039 preservan el comportamiento de texto libre del dialecto legacy. En sintaxis moderna `sala:A` se interpreta como un campo.
- El benchmark histórico no se modificó. Los valores no comparables permanecen explícitamente sin ejecución.
