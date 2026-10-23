'use strict';

function fold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase().replace(/[^A-Z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}
function docket(value) { return String(value || '').trim().toUpperCase().replace(/\s+/gu, ' '); }

function evaluateIdentity(source, candidate) {
  const shaEqual = Boolean(source.sha256 && candidate.sha256 && source.sha256.toLowerCase() === candidate.sha256.toLowerCase());
  const sameCase = docket(source.caseNumber || source.expediente) === docket(candidate.caseNumber || candidate.expediente);
  const sameCourt = fold(source.court) === fold(candidate.court);
  const sourceChamber = fold(source.chamber).replace(/^SALA /u, '');
  const candidateChamber = fold(candidate.chamber).replace(/^SALA /u, '');
  const sameChamber = Boolean(sourceChamber && candidateChamber && sourceChamber === candidateChamber);
  const sameDate = String(source.decisionDate || '').slice(0, 10) === String(candidate.decisionDate || '').slice(0, 10);
  const sameTitle = Boolean(source.title && candidate.title && fold(source.title) === fold(candidate.title));
  const legalFields = { sameCase, sameCourt, sameChamber, sameDate };
  const exactLegal = sameCase && sameCourt && sameChamber && sameDate;
  const reasons = Object.entries(legalFields).map(([key, value]) => `${key.toUpperCase()}_${value ? 'MATCH' : 'MISMATCH'}`);
  if (shaEqual && exactLegal) return { confidence: 'EXACT', legalIdentityMatch: true, fileIdentityMatch: true,
    reasons: [...reasons, 'SHA256_MATCH'], allowedAction: 'LINK_FILE_EXACT', proposedAction: 'LINK_FILE_EXACT' };
  if (sameCase && sameCourt && (sameChamber || !sourceChamber && !candidateChamber) && !sameDate)
    return { confidence: 'CONFLICT', legalIdentityMatch: false, fileIdentityMatch: shaEqual,
      reasons: [...reasons, 'SAME_CASE_COURT_CHAMBER_DIFFERENT_DECISION_DATE'], allowedAction: 'REJECT', proposedAction: 'REJECT' };
  if (exactLegal && !shaEqual) return { confidence: 'HIGH', legalIdentityMatch: true, fileIdentityMatch: false,
    reasons: [...reasons, 'DISTINCT_SHA_REPRESENTATION_REQUIRES_REVIEW'], allowedAction: 'REVIEW', proposedAction: 'LINK_LEGAL_IDENTITY' };
  if (sameCase && sameCourt && sameChamber) return { confidence: 'MEDIUM', legalIdentityMatch: null, fileIdentityMatch: shaEqual,
    reasons: [...reasons, 'DECISION_DATE_INCOMPLETE_OR_UNCONFIRMED'], allowedAction: 'REVIEW', proposedAction: 'REVIEW' };
  if (sameTitle) return { confidence: 'LOW', legalIdentityMatch: false, fileIdentityMatch: shaEqual,
    reasons: [...reasons, 'TITLE_ONLY'], allowedAction: 'REVIEW', proposedAction: 'REVIEW' };
  return { confidence: 'UNRESOLVED', legalIdentityMatch: false, fileIdentityMatch: shaEqual,
    reasons: [...reasons, 'INSUFFICIENT_IDENTITY_EVIDENCE'], allowedAction: 'REVIEW', proposedAction: 'REVIEW' };
}

module.exports = { evaluateIdentity };
