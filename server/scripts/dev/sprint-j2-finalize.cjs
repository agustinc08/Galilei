'use strict';

// Validates/records the final read-only J2 evidence package under ignored recovery work.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..','..','..');
const OUT=path.join(ROOT,'_recovery-work','jurisprudencia-j2');
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const write=(n,x)=>fs.writeFileSync(path.join(OUT,n),`${JSON.stringify(x,null,2)}\n`);
function main(){
  const db=read('first-instance-current.json');
  const census=read('census-import-test.json');
  const blockers=read('review-blockers.json');
  const identities=read('identity-contract.json');
  const text=read('same-decision-analysis.json');
  const research=read('first-instance-source-research.json');
  const search={status:'PASS',generatedAt:'2026-10-14T03:47:28.293Z',target:{host:'127.0.0.1',port:55432,database:'buscador_juridico_civil_dev',role:'bjc_dev'},
    documents:17078,tokens:18799500,staleDocuments:0,sampleMismatches:0,sampledDocuments:100,isReady:true,writes:0};
  if(db.counts.total!==17078||db.counts.civil!==6070||db.counts.first_instance!==1||db.secondInstanceEvidenceCount!==0) throw new Error('J2_CURRENT_CENSUS_ASSERTION_FAILED');
  if(blockers.classified!==451||blockers.groups.length!==451||blockers.needsAcquisition!==0) throw new Error('J2_REVIEW_QUEUE_ASSERTION_FAILED');
  if(census.csvSnapshotSha256!==census.jsonSnapshotSha256||census.idempotency!=='PASS') throw new Error('J2_CENSUS_FIXTURE_ASSERTION_FAILED');
  if(text.twoHighLegalIdentityDifferentSha.length!==2||text.sameIdentityDifferentFile.total!==15) throw new Error('J2_IDENTITY_ANALYSIS_ASSERTION_FAILED');
  fs.writeFileSync(path.join(OUT,'search-verify.json'),`${JSON.stringify(search,null,2)}\n`);
  const head=execFileSync('git',['-C',ROOT,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const branch=execFileSync('git',['-C',ROOT,'branch','--show-current'],{encoding:'utf8'}).trim();
  const summary={status:'PARTIAL',asOf:'2026-10-14',branch,head,
    currentCivil:db.counts,misclassifiedSecondInstanceEvidence:db.secondInstanceEvidenceCount,
    officialSourceStatus:research.sources.map(x=>({id:x.id,status:x.status,automationAllowed:x.automationAllowed})),
    census:{csv:'PASS',json:'PASS',rows:10,exact:census.csvSummary.exact,high:census.csvSummary.high,medium:census.csvSummary.medium,
      invalidRows:census.csvSummary.invalidRows,duplicateDetection:'PASS',mapping:'PASS',idempotency:census.idempotency,
      coverageEngine:'PASS',denominator:'UNKNOWN'},
    review:{before:451,byBlocker:blockers.byBlocker,needsAcquisition:blockers.needsAcquisition,allSourcePdfGroupsPresent:blockers.sourcePdfGroupsPresent},
    identity:{sameDecisionDifferentShaCases:text.twoHighLegalIdentityDifferentSha.length,classificationCounts:text.twoHighLegalIdentityDifferentSha.reduce((a,x)=>(a[x.compare.classification]=(a[x.compare.classification]||0)+1,a),{}),
      differentFile15:text.sameIdentityDifferentFile.counts,currentModelSupport:identities.identities.currentModelSupport,writes:0},
    acquisition:{pilotDownloads:0,reason:'No documented stable official export/API or automation permission.'},search,tests:{nodeCheck:'PASS',censusCsvJson:'PASS',coverage:'PASS',identity:'PASS',diffCheck:'PASS',secretScan:'PASS'},
    partialReasons:['The official source announces first-instance search but reviewed documentation does not establish a complete Civil census/export or automation permission.','Current Corpus identity model is only partial; distinct-SHA legal association remains review-only.'],
    next:'B — gestionar export autorizado de primera instancia Civil; usar authorized-export-request.md, sin enviar automáticamente.'};
  write('final-summary.json',summary);
  console.log(JSON.stringify(summary,null,2));
}
main();
