const {randomBytes,createHmac,timingSafeEqual}=require('node:crypto');

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
    const endpoint=new URL(url);
    if(endpoint.protocol!=='https:')throw Error('Invalid likes configuration');
    const response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(8000),redirect:'error'});
    if(!response.ok)throw Error('Likes storage unavailable');
    const data=await response.json();
    if(data.error||!Array.isArray(data.result))throw Error('Likes storage unavailable');
    return data.result;
  }
  function state(value) {
    if(!Array.isArray(value)||!Number.isSafeInteger(value[0])||value[0]<0||![0,1].includes(value[1]))throw Error('Invalid likes response');
    return {likes:value[0],liked:value[1]===1};
  }
  return {
    enabled,identity,
    async read(ids,voter) {
      if(!ids.length)return [];
      const result=await command(['EVAL',READ_SCRIPT,ids.length,...ids.map(id=>prefix+'photo:'+id),voter]);
      if(result.length!==ids.length)throw Error('Invalid likes response');
      return result.map(state);
    },
    async write(id,voter,liked) {
      const result=await command(['EVAL',WRITE_SCRIPT,2,prefix+'photo:'+id,prefix+'rate:'+voter,voter,liked?'1':'0']);
      if(result[0]===-1)return {limited:true};
      return state(result);
    }
  };
}
module.exports={createLikes,READ_SCRIPT,WRITE_SCRIPT};
