const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const base = 'http://127.0.0.1:4001/api/public/busqueda';
const endpoint = new URL(base);
if (endpoint.hostname !== '127.0.0.1' || endpoint.port !== '4001') throw new Error('LOCAL_API_TARGET_REJECTED');
const root = path.resolve(__dirname, '../../../../');
const output = path.join(root, '_recovery-work', 'jurisprudencia-j901', 'performance.json');
const families = {
  broad: '',
  medium: 'q=responsabilidad%20civil',
  narrow: 'expediente=CIV%20072119%2F2022',
  sala: 'sala=H',
  expediente: 'expediente=CIV%20072119%2F2022',
  caratula: 'caratula=ROBLEDO',
  fecha: 'fechaDesde=2022-01-01&fechaHasta=2022-12-31',
  magistrados: 'magistrados=P%C3%A9rez',
  tipo: 'tipoFallo=Sentencia%20civil',
  sentencia: 'numeroSentencia=12345',
  sumario: 'numeroSumario=1',
};
function percentile(sorted, fraction) { return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]; }

async function sample(name, query) {
  const url = `${base}${query ? `?${query}&page=1&pageSize=1` : '?page=1&pageSize=1'}`;
  const durations = [];
  const apiDurations = [];
  let total = null;
  let totalExact = null;
  for (let index = 0; index < 11; index++) {
    const start = performance.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const durationMs = performance.now() - start;
    if (!response.ok) throw new Error(`SEARCH_HTTP_${response.status}:${name}`);
    const body = await response.json();
    if (typeof body.meta?.totalExact !== 'boolean' || !Number.isFinite(body.meta?.total)) throw new Error(`SEARCH_COUNT_INVALID:${name}`);
    if (total === null) total = body.meta.total;
    else if (total !== body.meta.total) throw new Error(`SEARCH_COUNT_NONDETERMINISTIC:${name}`);
    if (totalExact === null) totalExact = body.meta.totalExact;
    else if (totalExact !== body.meta.totalExact) throw new Error(`SEARCH_EXACTNESS_NONDETERMINISTIC:${name}`);
    if (index > 0) {
      durations.push(Number(durationMs.toFixed(2)));
      if (Number.isFinite(body.meta?.tiempoMs)) apiDurations.push(Number(body.meta.tiempoMs));
    }
  }
  const sorted = [...durations].sort((a,b)=>a-b);
  const sortedApi = [...apiDurations].sort((a,b)=>a-b);
  return { name, query: query || '(broad/all published)', total, totalExact, samples:durations.length, networkP50Ms:percentile(sorted,.50), networkP95Ms:percentile(sorted,.95), minMs:sorted[0], maxMs:sorted[sorted.length-1], apiP50Ms:sortedApi.length ? percentile(sortedApi,.50) : null, apiP95Ms:sortedApi.length ? percentile(sortedApi,.95) : null };
}

async function main() {
  const results = [];
  for (const [name, query] of Object.entries(families)) results.push(await sample(name, query));
  const report = { action:'SPRINT_J9_0_1_PUBLIC_SEARCH_PERFORMANCE', target:'http://127.0.0.1:4001/api/public/busqueda', repetitions:10, warmups:1, methodology:'Sequential loopback HTTP requests, 1 result per page, total and totalExact checked for consistency; network p50/p95 include API time and response transfer, API time is the server-reported meta.tiempoMs.', results };
  fs.mkdirSync(path.dirname(output), { recursive:true });
  fs.writeFileSync(output, `${JSON.stringify(report,null,2)}\n`, 'utf8');
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error?.stack||String(error));process.exitCode=1;});
