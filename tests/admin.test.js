const test=require('node:test'),assert=require('node:assert/strict');
const {createApi}=require('../lib/wedding-api');
const password='test-only-password-123456';
function setup({parent=42,passwordValue=password,result={status:'success'}}={}){
  const writes=[];
  const api=createApi({token:'storage-secret',folderId:42,adminPassword:passwordValue,fetchImpl:async(url,options)=>{
    if(options.method==='POST'&&url.endsWith('/file-entries/delete')){writes.push(JSON.parse(options.body));return Response.json(result);}
    if(url.endsWith('/model'))return Response.json({fileEntry:{id:123,parent_id:parent,mime:'image/jpeg'}});
    return Response.json({data:[],last_page:1});
  }});
  async function call(action,body,cookie='',origin='http://localhost'){
    const req={url:'/api/admin?action='+action,method:body===undefined?'GET':'POST',body,headers:{host:'localhost',origin,'content-type':'application/json',cookie},socket:{remoteAddress:'test'}};
    const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(b){this.data=JSON.parse(b);}};
    await api(req,res);return res;
  }
  return {call,writes};
}
async function login(call){const r=await call('login',{password});assert.equal(r.statusCode,200);return r.headers['Set-Cookie'].split(';')[0];}
test('admin denies unauthenticated deletion and wrong passwords',async()=>{
  const {call,writes}=setup();
  assert.equal((await call('delete',{ids:['123']})).statusCode,401);
  assert.equal((await call('login',{password:'wrong'})).statusCode,401);
  assert.equal(writes.length,0);
});
test('admin session cookie is protected; tampering and cross-origin mutations are denied',async()=>{
  const {call,writes}=setup();const r=await call('login',{password});
  assert.match(r.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);
  const cookie=r.headers['Set-Cookie'].split(';')[0];
  assert.equal((await call('session',undefined,cookie)).statusCode,200);
  assert.equal((await call('session',undefined,cookie+'x')).statusCode,401);
  assert.equal((await call('delete',{ids:['123']},cookie,'https://evil.example')).statusCode,403);
  assert.equal(writes.length,0);
});
test('admin deletes only selected photos with permanent deletion disabled',async()=>{
  const {call,writes}=setup();const cookie=await login(call);
  const res=await call('delete',{ids:['123']},cookie);
  assert.equal(res.statusCode,200);assert.deepEqual(writes,[{entryIds:['123'],deleteForever:false}]);
  assert.equal((await call('logout',{},cookie)).headers['Set-Cookie'].includes('Max-Age=0'),true);
});
test('admin refuses other folders, invalid IDs and oversize selections without mutations',async()=>{
  const {call,writes}=setup({parent:99});const cookie=await login(call);
  assert.equal((await call('delete',{ids:['123']},cookie)).statusCode,404);
  assert.equal((await call('delete',{ids:['../123']},cookie)).statusCode,400);
  assert.equal((await call('delete',{ids:Array(21).fill('123')},cookie)).statusCode,400);
  assert.equal(writes.length,0);
});
test('admin fails closed for missing password, limits attempts, and detects provider errors',async()=>{
  assert.equal((await setup({passwordValue:''}).call('session')).statusCode,503);
  const {call}=setup();for(let i=0;i<5;i++)assert.equal((await call('login',{password:'wrong'})).statusCode,401);
  assert.equal((await call('login',{password})).statusCode,429);
  const broken=setup({result:{status:'error',errors:{123:'private provider details'}}});
  const r=await broken.call('delete',{ids:['123']},await login(broken.call));
  assert.equal(r.statusCode,502);assert.ok(!JSON.stringify(r.data).includes('private provider details'));
});

