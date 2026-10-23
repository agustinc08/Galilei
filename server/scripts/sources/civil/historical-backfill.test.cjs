'use strict';
const assert=require('node:assert/strict');
const {parsePage}=require('./historical-backfill.cjs');
const html=`<html><body><p>226.770 Resultados encontrados</p>
<div class="result"><ul class="info"><li><span>Jurisdicci&oacute;n:</span> Capital Federal</li><li><span>Tribunal:</span> C&aacute;mara Nacional de Apelaciones en lo Civil</li><li><span>Expediente N&deg;:</span> 621.227</li><li><span>Car&aacute;tula:</span> E. R. A. s/ da&ntilde;os</li><li><span>Fecha de sentencia:</span> 28/08/2013</li></ul><form><input name="acc" value="showFile"><input name="flid" value="220222"></form></div>
<div class="result"><ul class="info"><li><span>Jurisdicci&oacute;n:</span> Córdoba</li><li><span>Tribunal:</span> C&aacute;mara Federal de Apelaciones</li><li><span>Expediente N&deg;:</span> 8/12</li><li><span>Car&aacute;tula:</span> Caso federal</li><li><span>Fecha de sentencia:</span> 01/01/2012</li></ul><form><input name="acc" value="showFile"><input name="flid" value="42"></form></div></body></html>`;
const parsed=parsePage(html);assert.equal(parsed.total,226770);assert.equal(parsed.results.length,2);assert.equal(parsed.results[0].sourceId,'220222');assert.equal(parsed.results[0].civilStatus,'CIVIL_EXACT');assert.equal(parsed.results[0].fechaSentencia,'28/08/2013');assert.equal(parsed.results[1].civilStatus,'NON_CIVIL');const commercial=html.replace('226.770 Resultados encontrados','226.770 Resultados encontrados').replace('Cámara Federal de Apelaciones','Cámara Nacional de Apelaciones en lo Civil y Comercial Federal');
assert.equal(parsePage(commercial).results[1].civilStatus,'NON_CIVIL');
console.log('civil parser: 7 assertions PASS');
