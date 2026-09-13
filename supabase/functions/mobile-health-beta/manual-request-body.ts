// Bound ingress memory and time before SQL admission can be held by a stalled client.
export async function readManualRequest(request:Request,deadlineMs=10000):Promise<Record<string,any>>{
 const max=1048576;if(Number(request.headers.get('content-length')||0)>max)throw Error('BODY_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)throw Error('INVALID_PAYLOAD');
 const chunks:Uint8Array[]=[];let bytes=0,timer:ReturnType<typeof setTimeout>|undefined;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('REQUEST_BODY_TIMEOUT')),deadlineMs);});
 try{
  while(true){const part=await Promise.race([reader.read(),expired]);if(part.done)break;bytes+=part.value.byteLength;if(bytes>max)throw Error('BODY_TOO_LARGE');chunks.push(part.value);}
  const all=new Uint8Array(bytes);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
 }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{clearTimeout(timer);}
}
