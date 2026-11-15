const test=require('node:test');
const assert=require('node:assert/strict');
const {createLikes,READ_SCRIPT,WRITE_SCRIPT}=require('../lib/likes');

test('voter cookies are signed, host-only on Vercel, reusable and reject tampering',t=>{
  const previous=process.env.VERCEL;
  process.env.VERCEL='1';
  t.after(()=>{if(previous===undefined)delete process.env.VERCEL;else process.env.VERCEL=previous;});
  const store=createLikes({folder:'42',url:'https://example.test',token:'test-only'});
  const res={setHeader(k,v){this[k]=v;}};
  const voter=store.identity({headers:{}},res,true);
  assert.match(res['Set-Cookie'],/^__Host-evening-voter=/);
  assert.match(res['Set-Cookie'],/HttpOnly; SameSite=Strict/);
  assert.match(res['Set-Cookie'],/; Secure$/);
  assert.equal(store.identity({headers:{cookie:res['Set-Cookie']}},res),voter);
  const forged=res['Set-Cookie'].replace(voter,'a'.repeat(32));
  assert.equal(store.identity({headers:{cookie:forged}},res),null);
  assert.equal(store.identity({headers:{}},res),null);
});

test('Redis adapter uses atomic membership updates and bounded rate keys, without exposing credentials',async()=>{
  const commands=[];
  const store=createLikes({folder:'42',url:'https://example.test',token:'test-only',fetchImpl:async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer test-only');
    assert.equal(options.redirect,'error');
    const cmd=JSON.parse(options.body);commands.push(cmd);
    return Response.json({result:cmd[1]===READ_SCRIPT?[[2,1],[0,0]]:[2,1]});
  }});
  assert.deepEqual(await store.read(['1','2'],'voter'),[{likes:2,liked:true},{likes:0,liked:false}]);
  assert.deepEqual(await store.write('1','voter',true),{likes:2,liked:true});
  assert.deepEqual(commands[1],['EVAL',WRITE_SCRIPT,2,'our-evening:{42}:photo:1','our-evening:{42}:rate:voter','voter','1']);
  await store.write('1','voter',false);
  assert.equal(commands[2].at(-1),'0');
});

test('Redis outage and malformed counts fail closed',async()=>{
  for(const response of [new Response('secret provider error',{status:500}),Response.json({result:[-2,1]})]) {
    const store=createLikes({folder:'42',url:'https://example.test',token:'test-only',fetchImpl:async()=>response});
    await assert.rejects(store.write('1','voter',true),/Likes storage unavailable|Invalid likes response/);
  }
});
