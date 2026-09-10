import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitCustody } from './submit-custody';
import { abortPendingApiRequests, ApiError } from '../../lib/api-client';

const input=()=>({certificate:new File(['certificate'],'synthetic.cer'),key:new File(['key'],'synthetic.key'),password:'synthetic-password',grant:'synthetic-grant'});
const state={id:'22222222-2222-4222-8222-222222222222',legalEntityId:'11111111-1111-4111-8111-111111111111',status:'ready',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),localValidation:'local_validation_passed',revocationStatus:'unknown',synthetic:true,errorCode:null,cleanup:'pending'};
test('custody submission uses a contextual multipart request and strips unexpected response fields',async()=>{
  const original=globalThis.fetch;let received:FormData|undefined;const material=input();
  globalThis.fetch=async(url,init)=>{assert.ok(String(url).includes(`/legal-entities/${state.legalEntityId}/efirma-sessions`));received=init?.body as FormData;
    assert.equal(received.get('password'),'synthetic-password');assert.equal(new Headers(init?.headers).has('Content-Type'),false);
    assert.ok(new Headers(init?.headers).get('Idempotency-Key'));assert.equal(init?.cache,'no-store');
    return new Response(JSON.stringify({...state,wrappedToken:'must not propagate'}),{status:202,headers:{'Content-Type':'application/json'}});};
  try{assert.deepEqual(await submitCustody(state.legalEntityId,material,new AbortController().signal),state);
    assert.equal(material.password,'');assert.equal(material.grant,'');assert.equal(received?.get('password'),null);assert.equal(received?.get('key'),null);
  }finally{globalThis.fetch=original;}
});
test('non-202 response clears material and fails safely',async()=>{
  const original=globalThis.fetch;const material=input();globalThis.fetch=async()=>new Response(JSON.stringify(state),{status:200,headers:{'Content-Type':'application/json'}});
  try{await assert.rejects(submitCustody(state.legalEntityId,material,new AbortController().signal),(error:unknown)=>error instanceof ApiError&&error.code==='INVALID_API_RESPONSE');assert.equal(material.password,'');}
  finally{globalThis.fetch=original;}
});
test('tenant/logout abort registry cancels the active request and clears its credentials',async()=>{
  const original=globalThis.fetch;const material=input();globalThis.fetch=(_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('cancelled'))));
  try{const pending=submitCustody(state.legalEntityId,material,new AbortController().signal);abortPendingApiRequests();await assert.rejects(pending);assert.equal(material.password,'');assert.equal(material.grant,'');}
  finally{globalThis.fetch=original;}
});
test('replacement carries the previous intention ID but obtains a new idempotency key',async()=>{
  const original=globalThis.fetch;const keys:string[]=[];globalThis.fetch=async(_url,init)=>{assert.equal((init?.body as FormData).get('replacesId'),state.id);keys.push(new Headers(init?.headers).get('Idempotency-Key')!);return new Response(JSON.stringify(state),{status:202,headers:{'Content-Type':'application/json'}});};
  try{for(let i=0;i<2;i++)await submitCustody(state.legalEntityId,{...input(),replacesId:state.id},new AbortController().signal);assert.notEqual(keys[0],keys[1]);}finally{globalThis.fetch=original;}
});
