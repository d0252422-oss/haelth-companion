// Policy v1: findings are not execution errors; unreadable reports fail closed.
export const modes = ['fast', 'security', 'full', 'release', 'tools', 'regression', 'all'];
export const acceptable = s => ['PASS', 'INFO_BASELINED', 'NOT_APPLICABLE'].includes(s);
export const isBaselined = (baseline,file,hash) => baseline.files?.[file]?.sha256 === hash;
const fail = reason => ({status:'FAIL_BLOCKING', reason});
const warn = reason => ({status:'WARN_REVIEW_REQUIRED', reason});
export function classify(name, data, code) {
 if (![0,1,10,11,12,13,14].includes(code)) return fail('Tool execution failed');
 if (name === 'zizmor') {
  if (!Array.isArray(data) || data.some(f=>!f.ident || !f.determinations)) return fail('Invalid zizmor report');
  if (!data.length) return code===0 ? {status:'PASS'} : fail('Nonzero empty audit');
  if (data.some(f=>f.ident==='unpinned-uses'||f.determinations.confidence==='High')) return fail('Immutable pin or high-confidence security finding');
  return warn('Low/medium-confidence findings require documented review');
 }
 if (name === 'osv') {
  if (!Array.isArray(data?.results)) return fail('Invalid OSV report');
  const findings=data.results.flatMap(r=>r.packages||[]).flatMap(p=>p.vulnerabilities||[]);
  if(findings.length) return fail('Dependency vulnerabilities require severity/exploitability triage; no automatic acceptance');
  return code===0 ? {status:'PASS',coverage:'PARTIAL_COVERAGE'} : fail('OSV failed without usable results');
 }
 if (name === 'trivy') {
  if(!Array.isArray(data?.Results)) return fail('Invalid Trivy report');
  const findings=data.Results.flatMap(r=>[...(r.Vulnerabilities||[]),...(r.Secrets||[]),...(r.Misconfigurations||[]).filter(x=>x.Status!=='PASS')]);
  if(findings.some(f=>['CRITICAL','HIGH'].includes(f.Severity))) return fail('High/critical vulnerability, secret or configuration finding');
  return findings.length ? warn('Lower/unknown severity findings need review') : code===0 ? {status:'PASS',coverage:'PARTIAL_COVERAGE'} : fail('Trivy execution failure');
 }
 if(name==='syft')return code===0&&data?.bomFormat==='CycloneDX'&&Array.isArray(data.components)&&data.components.every(c=>typeof c.name==='string') ? {status:'PASS',components:data.components.length,coverage:'PARTIAL_COVERAGE'} : fail('Invalid SBOM');
 return fail('Unknown policy');
}
export function classifySql(files) {
 if(!Array.isArray(files)||files.some(f=>!Array.isArray(f.violations))) return fail('Invalid SQLFluff report');
 const violations=files.flatMap(f=>f.violations);
 // AM04: unknown SELECT column count; AM07: unequal set-operation columns.
 const blocking=violations.filter(v=>['PRS','LXR','TMP','AM04','AM07'].includes(v.code));
 const unknown=violations.filter(v=>!(/^(LT|CP|AL)\d+$/.test(v.code)||['RF04','PRS','LXR','TMP','AM04','AM07'].includes(v.code)));
 return {status:blocking.length?'FAIL_BLOCKING':violations.length?'WARN_REVIEW_REQUIRED':'PASS',blocking:blocking.length,review:unknown.length,nonblocking:violations.length-blocking.length,parser_errors:violations.filter(v=>['PRS','LXR','TMP'].includes(v.code)).length};
}
