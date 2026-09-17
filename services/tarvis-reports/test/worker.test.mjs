import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker, {validateReport} from '../src/worker.mjs';

const report = {id:'ca9a22f9-c5b6-4d0f-a6ef-21449307bc74', reason:'unsafe', text:'Synthetic QA report. No personal data.', version:'1.7.2', consent:true};
function request(body = report, headers = {}) {
  return new Request('https://reports.example/v1/reports', {method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.1', ...headers},body:JSON.stringify(body)});
}
function bindings() {
  const messages=[];
  return {messages, REPORT_LIMIT:{limit:async()=>({success:true})}, TOTAL_LIMIT:{limit:async()=>({success:true})}, SUPPORT_EMAIL:{send:async msg=>messages.push(msg)}};
}
test('fixed private destination, plain text, explicit accepted receipt', async()=>{
  const env=bindings(); const res=await worker.fetch(request(),env);
  assert.equal(res.status,202); assert.deepEqual(await res.json(),{status:'accepted',id:report.id});
  assert.equal(env.messages[0].to,'t1arc.support@gmail.com'); assert.equal(env.messages[0].html,undefined);
});
test('rejects absent consent, extra fields, invalid values and excessive content', async()=>{
  for(const body of [{...report,consent:false},{...report,to:'elsewhere@example.com'},{...report,reason:'unknown'},{...report,id:'bad'},{...report,text:''},{...report,text:'a'.repeat(12001)},{...report,version:'v\r\nBcc: bad'}]) {
    assert.equal(validateReport(body),false);
    const env=bindings(); assert.equal((await worker.fetch(request(body),env)).status,400); assert.equal(env.messages.length,0);
  }
});
test('rejects browser origins and wrong content type',async()=>{
  assert.equal((await worker.fetch(request(report,{origin:'https://evil.example'}),bindings())).status,403);
  assert.equal((await worker.fetch(request(report,{'content-type':'text/plain'}),bindings())).status,415);
});
test('limits both per-IP and total traffic',async()=>{
  for(const name of ['REPORT_LIMIT','TOTAL_LIMIT']) {
    const env=bindings(); env[name].limit=async()=>({success:false});
    assert.equal((await worker.fetch(request(),env)).status,429); assert.equal(env.messages.length,0);
  }
});
test('does not return success when mail delivery fails',async()=>{
  const env=bindings(); env.SUPPORT_EMAIL.send=async()=>{throw new Error('sensitive server details');};
  const res=await worker.fetch(request(),env); assert.equal(res.status,503); assert.deepEqual(await res.json(),{error:'unavailable'});
});
test('bounds streamed body without trusting content length',async()=>{
  const env=bindings(); assert.equal((await worker.fetch(request({...report,text:'x'.repeat(53000)}),env)).status,400); assert.equal(env.messages.length,0);
});
