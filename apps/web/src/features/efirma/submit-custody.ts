import { apiClientResponse, ApiError } from '../../lib/api-client';
import { credentialFileError, type CustodyState } from './credential-state';

/** Keep credential material in this request only; never enqueue or persist a retry body. */
export async function submitCustody(entityId:string,input:{certificate:File;key:File;password:string;grant:string;replacesId?:string},signal:AbortSignal):Promise<CustodyState> {
  const invalid=credentialFileError(input.certificate,'.cer')??credentialFileError(input.key,'.key');
  if(invalid)throw new ApiError(400,invalid,'EFIRMA_INPUT_INVALID');
  const body=new FormData();body.set('certificate',input.certificate);body.set('key',input.key);body.set('password',input.password);body.set('grant',input.grant);
  if(input.replacesId)body.set('replacesId',input.replacesId);
  try {
    const response=await apiClientResponse<CustodyState>(`/legal-entities/${encodeURIComponent(entityId)}/efirma-sessions`,{
      method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body,signal,cache:'no-store',
    },30000);
    if(response.status!==202)throw new ApiError(502,'La API no confirmó la intención durable.','INVALID_API_RESPONSE');
    const row=response.data;
    return {id:row.id,legalEntityId:row.legalEntityId,status:row.status,createdAt:row.createdAt,expiresAt:row.expiresAt,
      localValidation:row.localValidation,revocationStatus:row.revocationStatus,synthetic:row.synthetic,errorCode:row.errorCode,cleanup:row.cleanup};
  } finally {for(const name of ['password','grant','certificate','key'])body.delete(name);input.password='';input.grant='';}
}
