const {randomBytes,createHmac,timingSafeEqual}=require('node:crypto');
class LikesError extends Error {
  constructor(code) { super('Likes storage unavailable'); this.code=code; }
}
function normalizeSetting(value) {
  const text=String(value||'').trim();
  return /^(["']).*\1$/.test(text)?text.slice(1,-1).trim():text;
}
function likesErrorCode(error) {
  return error instanceof LikesError?error.code:'storage_unavailable';
}

// Sets, rather than an incrementing counter, make repeated likes idempotent.
const READ_SCRIPT=`
local out = {}
for i,key in ipairs(KEYS) do
  out[i] = {redis.call('SCARD',key),redis.call('SISMEMBER',key,ARGV[1])}
end
return out`;
const WRITE_SCRIPT=`
local requests = redis.call('INCR',KEYS[2])
if requests == 1 then redis.call('EXPIRE',KEYS[2],60) end
if requests > 120 then return {-1,0} end
if ARGV[2] == '1' then
  redis.call('SADD',KEYS[1],ARGV[1])
else
  redis.call('SREM',KEYS[1],ARGV[1])
end
return {redis.call('SCARD',KEYS[1]),redis.call('SISMEMBER',KEYS[1],ARGV[1])}`;

function createLikes({folder,url=process.env.UPSTASH_REDIS_REST_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN,fetchImpl=fetch}={}) {
  url=normalizeSetting(url);
  token=normalizeSetting(token);
  const enabled=Boolean(url&&token);
  const prefix=`our-evening:{${folder}}:`;
  function sign(id) {return createHmac('sha256',token).update(`photo-likes:${folder}:${id}`).digest('hex');}
  function identity(req,res,create=false) {
    const secure=process.env.VERCEL==='1'||req.socket?.encrypted;
    const cookieName=secure?'__Host-evening-voter':'evening-voter';
    const value=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
    const match=/^([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value);
    if(match&&timingSafeEqual(Buffer.from(match[2],'hex'),Buffer.from(sign(match[1]),'hex')))return match[1];
    if(!create)return null;
    const id=randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie',`${cookieName}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure?'; Secure':''}`);
    return id;
  }
  async function command(args) {
    let endpoint;
    try { endpoint=new URL(url); } catch { throw new LikesError('invalid_rest_url'); }
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw new LikesError('invalid_rest_url');
    let response;
    try {
      response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(8000),redirect:'error'});
    } catch(error) {
      throw new LikesError(error.name==='TimeoutError'?'connection_timeout':'connection_failed');
    }
    if(response.status===401)throw new LikesError('authentication_failed');
    if(response.status===403)throw new LikesError('permission_denied');
    if(response.status===429)throw new LikesError('rate_limited');
    if(!response.ok)throw new LikesError('storage_unavailable');
    let data;
    try { data=await response.json(); } catch { throw new LikesError('invalid_response'); }
    if(data?.error) {
      // Classify internally; never return the provider message or credentials.
      if(/WRONGPASS|unauthorized|invalid.*token/i.test(String(data.error)))throw new LikesError('authentication_failed');
      if(/NOPERM|permission|read.?only/i.test(String(data.error)))throw new LikesError('permission_denied');
      throw new LikesError('command_failed');
    }
    if(!Array.isArray(data?.result))throw new LikesError('invalid_response');
    return data.result;
  }
  function state(value) {
    if(!Array.isArray(value)||!Number.isSafeInteger(value[0])||value[0]<0||![0,1].includes(value[1]))throw new LikesError('invalid_response');
    return {likes:value[0],liked:value[1]===1};
  }
  return {
    enabled,identity,configurationStatus:!url?'missing_rest_url':!token?'missing_rest_token':'configured',
    async read(ids,voter) {
      if(!ids.length)return [];
      const result=await command(['EVAL',READ_SCRIPT,ids.length,...ids.map(id=>prefix+'photo:'+id),voter]);
      if(result.length!==ids.length)throw new LikesError('invalid_response');
      return result.map(state);
    },
    async write(id,voter,liked) {
      const result=await command(['EVAL',WRITE_SCRIPT,2,prefix+'photo:'+id,prefix+'rate:'+voter,voter,liked?'1':'0']);
      if(result[0]===-1)return {limited:true};
      return state(result);
    }
  };
}
module.exports={createLikes,READ_SCRIPT,WRITE_SCRIPT,likesErrorCode};
