export type CitationSource = {
  actor?: string | null;
  demandado?: string | null;
  sala?: string | null;
  fecha?: Date | null;
  expediente?: string | null;
  numeroSentencia?: string | null;
  citaPersonalizada?: string | null;
};

export type CitationData = {
  citaBreve: string;
  citaCompleta: string;
  citaCopiable: string;
};

function present(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function formatCitation(source: CitationSource): CitationData {
  const actor = present(source.actor);
  const demandado = present(source.demandado);
  const caratula = [actor, demandado].filter(Boolean).join(' c/ ');
  const salaValue = present(source.sala);
  const sala = salaValue ? `Sala ${salaValue}` : null;
  const fecha =
    source.fecha && !Number.isNaN(source.fecha.getTime())
      ? new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC' }).format(
          source.fecha,
        )
      : null;
  const expedienteValue = present(source.expediente);
  const numeroValue = present(source.numeroSentencia);
  const expediente = expedienteValue ? `Expte. ${expedienteValue}` : null;
  const numero = numeroValue ? `Sentencia ${numeroValue}` : null;
  const citaBreve = [caratula || 'Sentencia sin caratula', sala, fecha]
    .filter(Boolean)
    .join(', ');
  const citaCompleta =
    present(source.citaPersonalizada) ||
    [citaBreve, expediente, numero].filter(Boolean).join(', ');

  return { citaBreve, citaCompleta, citaCopiable: citaCompleta };
}
