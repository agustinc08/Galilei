const {DatabaseSync}=require('node:sqlite'); const p='C:/proyecto triple/_recovery-work/sprint148/manifest.sqlite'; const d=new DatabaseSync(p,{readOnly:true});
console.log('rows/sha by status'); console.log(d.prepare(`select identity_status,count(*) records,count(distinct sha256) sha from source_records group by identity_status order by identity_status`).all());
console.log('per SHA classification summary');console.log(d.prepare(`select identity_status,count(*) shaGroups,sum(rows) records,max(rows) maxRows from (select sha256,identity_status,count(*) rows from source_records group by sha256,identity_status) group by identity_status`).all());
console.log('same-document records detail');console.log(d.prepare(`select normalized_case_number,chamber,decision_date,count(*) records,count(distinct sha256) representations from source_records where identity_status='SAME_DOCUMENT_DIFFERENT_FILE' group by normalized_case_number,chamber,decision_date order by records desc`).all());
console.log('file inventory');console.log(d.prepare(`select count(*) pdfs,sum(bytes) bytes,min(bytes) minbytes,max(bytes) maxbytes from objects`).get());
d.close();
