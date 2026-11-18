const {createHash,createHmac,timingSafeEqual,randomBytes}=require('node:crypto');
function createAdmin({password=process.env.ADMIN_PASSWORD,folder,list,photo,isPhoto,json,readBody,send,AppError}) {
  const attempts=new Map();
  const digest=value=>createHash('sha256').update(value).digest();
  const equal=(a,b)=>timingSafeEqual(digest(a),digest(b));
  const signature=value=>createHmac('sha256',password).update('wedding-admin:'+folder+':'+value).digest('hex');
  return async(req,res,url)=>{
    if(!password||password.length<16)throw new AppError(503,'Admin access is not configured. Set ADMIN_PASSWORD to at least 16 characters and restart or redeploy.');
    const secure=process.env.VERCEL==='1'||!!req.socket?.encrypted;
    const cookieName=secure?'__Host-wedding-admin':'wedding-admin';
    const cookie=(value,age)=>res.setHeader('Set-Cookie',cookieName+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(secure?'; Secure':''));
    const action=url.searchParams.get('action')||'session';
    if(req.method!=='GET') {
      let origin;try{origin=new URL(req.headers.origin);}catch{throw new AppError(403,'Open the dashboard on this website.');}
      if(!['http:','https:'].includes(origin.protocol)||origin.host!==req.headers.host||req.headers['sec-fetch-site']==='cross-site')throw new AppError(403,'Invalid request origin.');
      if(String(req.headers['content-type']).split(';')[0]!=='application/json')throw new AppError(415,'Expected JSON.');
    }
    if(action==='login'&&req.method==='POST') {
      const now=Date.now();
      for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
      const ip=process.env.VERCEL==='1'?String(req.headers['x-forwarded-for']||'unknown').split(',')[0]:req.socket?.remoteAddress||'local';
      const rate=attempts.get(ip)||{count:0,until:now+15*60*1000};
      if(rate.count>=5||attempts.size>=10000)throw new AppError(429,'Too many attempts. Try again in 15 minutes.');
      rate.count++;attempts.set(ip,rate);
      const body=await readBody(req,2048);
      if(typeof body?.password!=='string'||!equal(body.password,password))throw new AppError(401,'Incorrect password.');
      attempts.delete(ip);
      const value=String(now+8*60*60*1000)+'.'+randomBytes(24).toString('hex');
      cookie(value+'.'+signature(value),8*60*60);
      return send(res,200,{authenticated:true});
    }
    const raw=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
    const match=/^(\d{13})\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(raw);
    if(!match||Number(match[1])<=Date.now()||!equal(match[3],signature(match[1]+'.'+match[2])))throw new AppError(401,'Please sign in.');
    if(action==='logout'&&req.method==='POST'){cookie('',0);return send(res,200,{authenticated:false});}
    if(action==='session'&&req.method==='GET')return send(res,200,{authenticated:true});
    if(action==='photos'&&req.method==='GET'){
      const page=Number(url.searchParams.get('page')||1);
      if(!Number.isInteger(page)||page<1||page>500)throw new AppError(400,'Invalid page.');
      const result=await list(page);
      return send(res,200,{photos:result.entries.filter(isPhoto).map(photo),page,hasMore:result.hasMore});
    }
    if(action==='delete'&&req.method==='POST'){
      const body=await readBody(req,4096);
      if(!Array.isArray(body?.ids)||!body.ids.length||body.ids.length>20||body.ids.some(id=>typeof id!=='string'||!/^\d{1,20}$/.test(id)))throw new AppError(400,'Select between 1 and 20 photos.');
      const ids=[...new Set(body.ids)];
      // Validate every selected item before sending any mutation upstream.
      for(const id of ids){
        const entry=(await json('/file-entries/'+id+'/model')).fileEntry;
        if(!entry||String(entry.parent_id)!==folder||entry.deleted_at||!isPhoto(entry))throw new AppError(404,'A selected photo is no longer in this wedding album. Refresh and try again.');
      }
      const result=await json('/file-entries/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entryIds:ids,deleteForever:false})});
      if(result.status!=='success'||(result.errors&&Object.keys(result.errors).length))throw new AppError(502,'Deletion could not be fully confirmed. Refresh the dashboard before retrying.');
      return send(res,200,{deleted:ids});
    }
    throw new AppError(404,'Not found.');
  };
}
module.exports={createAdmin};

