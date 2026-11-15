// Local simulation by default. Live mode writes real photos: use only on your site.
// node scripts/load-test.js --live https://your-site.example path/to/test.jpg
const {createApi}=require('../lib/wedding-api');
const {Readable}=require('node:stream');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const batch=`LOAD TEST ${new Date().toISOString().replace(/[:.]/g,'-')}`;
const payload=(i,data)=>({name:`${batch} ${i+1}`,uploadId:randomUUID().replaceAll('-',''),data});
function summary(label,results,extra={}) {
  const sorted=results.map(r=>r.ms).sort((a,b)=>a-b);
  console.log(JSON.stringify({label,...extra,total:results.length,statuses:results.reduce((out,r)=>(out[r.status]=(out[r.status]||0)+1,out),{}),p50Ms:Math.round(sorted[Math.ceil(sorted.length*.5)-1]),p95Ms:Math.round(sorted[Math.ceil(sorted.length*.95)-1]),maxMs:Math.round(sorted.at(-1)),errors:[...new Set(results.filter(r=>r.status!==201).map(r=>r.error))]},null,2));
}
async function simulation(instances,sharedIp) {
  const entries=[];let storageCalls=0;
  const fetchImpl=async(url,options)=>{
    storageCalls++;await delay(100);
    if(url.endsWith('/uploads')) {
      const entry={id:entries.length+1,parent_id:42,mime:'image/jpeg',name:options.body.get('file').name,file_size:8,created_at:new Date().toISOString()};
      entries.push(entry);return Response.json({fileEntry:entry});
    }
    const page=Number(new URL(url).searchParams.get('page'));
    return Response.json({data:entries.slice((page-1)*100,page*100),last_page:Math.max(1,Math.ceil(entries.length/100))});
  };
  const handlers=Array.from({length:instances},()=>createApi({token:'fake-test-token',folderId:42,fetchImpl}));
  const results=await Promise.all(Array.from({length:100},async(_,i)=>{
    const start=performance.now();
    const req=Readable.from([Buffer.from(JSON.stringify(payload(i,'/9j/4AAC/9k=')))]);
    Object.assign(req,{url:'/api/upload',method:'POST',headers:{host:'localhost','content-type':'application/json'},socket:{remoteAddress:sharedIp?'192.0.2.1':`192.0.2.${i+1}`}});
    const res={statusCode:200,setHeader(){},end(value){this.body=JSON.parse(value);}};
    await handlers[i%instances](req,res);
    return {status:res.statusCode,ms:performance.now()-start,error:res.body?.error};
  }));
  summary('simulation',results,{instances,sharedIp,storageLatencyMs:100,storageCalls,saved:entries.length});
}
async function live() {
  const target=new URL(process.argv[3]);
  if(target.protocol!=='https:')throw Error('Live target must use HTTPS.');
  const bytes=fs.readFileSync(process.argv[4]);
  if(bytes.length>16384)throw Error('Use a test JPEG smaller than 16 KiB.');
  const check=await fetch(new URL('/api/gallery',target),{signal:AbortSignal.timeout(15000)});
  if(!check.ok||!Array.isArray((await check.json()).photos))throw Error('Gallery preflight failed; no uploads sent.');
  console.log(`Sending 100 real uploads: ${batch}; ${bytes.length} bytes each; one client IP; no retries.`);
  const results=await Promise.all(Array.from({length:100},async(_,i)=>{
    const start=performance.now();
    try {
      const response=await fetch(new URL('/api/upload',target),{method:'POST',headers:{'Content-Type':'application/json',Origin:target.origin},body:JSON.stringify(payload(i,bytes.toString('base64'))),signal:AbortSignal.timeout(120000)});
      const body=await response.json().catch(()=>({error:'Non-JSON response'}));
      return {status:response.status,ms:performance.now()-start,error:body.error,id:body.photo?.id};
    } catch(error) {return {status:'network/timeout',ms:performance.now()-start,error:error.name};}
  }));
  summary('live',results,{batch,confirmedPhotoIds:results.filter(r=>r.id).map(r=>r.id)});
  const health=await fetch(new URL('/api/gallery',target),{signal:AbortSignal.timeout(15000)});
  console.log(`Gallery after test: HTTP ${health.status}`);
}
(async()=>{
  if(process.argv[2]==='--live')return live();
  await simulation(1,false);
  await simulation(10,false);
  await simulation(1,true);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
