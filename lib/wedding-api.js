const {
  createHash
}
= require('node:crypto');
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 2900000;
const SOFT_STORAGE_LIMIT = 9 * 1000 ** 3;
const BASE = 'https://app.drime.cloud/api/v1';
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status=status;
  }
}
function isPhoto(entry) {
  return ['image/jpeg','image/png','image/webp'].includes(entry?.mime);
}
function guestFromFilename(filename) {
  const match = /^oe--([A-Za-z0-9_-]+)--[a-f0-9] {
    32
  }
  \.jpg$/.exec(filename || '');
  if (!match) return 'Wedding guest';
  const name=Buffer.from(match[1],'base64url').toString('utf8');
  return name.length<=60 ? name : 'Wedding guest';
}
function imageSignature(bytes) {
  if(bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 && bytes[bytes.length-2]===255 && bytes[bytes.length-1]===217) return 'image/jpeg';
  if(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(bytes.length>=12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return 'image/webp';
  return null;
}
function createApi( {
  token=process.env.DRIME_API_TOKEN,folderId=process.env.DRIME_FOLDER_ID,fetchImpl=fetch
}
= {
}) {
  const folder=String(folderId||'');
  const rates=new Map();
  let uploadQueue=Promise.resolve();
  async function drime(route, options= {
  }) {
    let result;
    try {
      result=await fetchImpl(BASE+route, {
        ...options,headers: {
          Authorization:`Bearer ${token}`,Accept:'application/json',...options.headers
        },signal:AbortSignal.timeout(45000)
      });
    }
    catch {
      throw new AppError(503,'Photo storage is temporarily unreachable. Please try again.');
    }
    if(!result.ok) {
      const messages= {
        401:'The photo storage connection needs attention from the host.',
        403:'The photo storage permissions need attention from the host.',
        429:'Photo storage is busy. Please try again in a moment.',
        413:'This photo is too large.',
        422:'Photo storage could not accept this upload.'
      };
      throw new AppError(result.status===429?429:502,messages[result.status]||'Photo storage could not complete the request. Please try again.');
    }
    return result;
  }
  async function json(route,options) {
    try {
      return await (await drime(route,options)).json();
    }
    catch(e) {
      if(e instanceof AppError)throw e;
      throw new AppError(502,'Photo storage returned an unexpected response.');
    }
  }
  async function list(page=1,perPage=40) {
    const params=new URLSearchParams( {
      workspaceId:'0',perPage:String(perPage),page:String(page),'parentIds[]':folder,orderBy:'created_at',orderDir:'desc'
    });
    const data=await json('/drive/file-entries?'+params);
    const envelope=Array.isArray(data.data)?data:data.data;
    if(!Array.isArray(envelope?.data))throw new AppError(502,'Unable to read the wedding gallery.');
    // Fail closed even if the upstream filter is ignored: never expose other folders.
    const entries=envelope.data.filter(e=>String(e.parent_id)===folder&&!e.deleted_at);
    return {
      entries,
      hasMore:Number(envelope.last_page||1)>page
    };
  }
  function photo(entry) {
    return {
      id:String(entry.id),
      name:guestFromFilename(entry.name),
      alt:'Wedding photo',
      src:`/api/photo?id=${entry.id}`,
      time:Date.parse(entry.created_at)||Date.now()
    };
  }
  async function readBody(req) {
    if(Number(req.headers['content-length'])>MAX_BODY_BYTES)throw new AppError(413,'This photo is too large.');
    if(req.body!==undefined) {
      const raw=typeof req.body==='object'?JSON.stringify(req.body):String(req.body);
      if(Buffer.byteLength(raw)>MAX_BODY_BYTES)throw new AppError(413,'This photo is too large.');
      try {
        return JSON.parse(raw);
      }
      catch {
        throw new AppError(400,'Invalid upload request.');
      }
    }
    const chunks=[];
    let length=0;
    for await (const chunk of req) {
      length+=chunk.length;
      if(length>MAX_BODY_BYTES)throw new AppError(413,'This photo is too large.');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    }
    catch {
      throw new AppError(400,'Invalid upload request.');
    }
  }
  function rateLimit(req) {
    const now=Date.now();
    for(const [key,value] of rates)if(value.until<now)rates.delete(key);
    const key=process.env.VERCEL?String(req.headers['x-forwarded-for']||'unknown').split(',')[0]:req.socket?.remoteAddress||'local';
    const entry=rates.get(key)|| {
      count:0,
      until:now+60000
    };
    if(entry.count>=40 || rates.size>10000)throw new AppError(429,'Please wait a minute before adding more photos.');
    entry.count++;
    rates.set(key,entry);
  }
  async function savePhoto(body) {
    const name=typeof body.name==='string'?body.name.trim().normalize('NFC'):'';
    if(!name||name.length>60||/[\x00-\x1f]/.test(name))throw new AppError(400,'Please enter your name (up to 60 characters).');
    if(typeof body.uploadId!=='string'||!/^[a-f0-9] {
      32
    }
    $/.test(body.uploadId))throw new AppError(400,'Invalid upload identifier.');
    if(typeof body.data!=='string'||!body.data.length||body.data.length>Math.ceil(MAX_IMAGE_BYTES/3)*4||!/^[A-Za-z0-9+/]+= {
      0,2
    }
    $/.test(body.data))throw new AppError(400,'Invalid photo data.');
    const bytes=Buffer.from(body.data,'base64');
    if(bytes.length>MAX_IMAGE_BYTES)throw new AppError(413,'This photo is too large.');
    if(imageSignature(bytes)!=='image/jpeg')throw new AppError(400,'Please upload a valid JPEG photo.');
    const filename=`oe--${Buffer.from(name).toString('base64url')}--${body.uploadId}.jpg`;
    let used=0,
    complete=false;
    for(let page=1;page<=150;page++) {
      const result=await list(page,100);
      const previous=result.entries.find(e=>e.name===filename);
      if(previous)return photo(previous);
      // Safe retry after lost response.
      used+=result.entries.reduce((sum,e)=>sum+(Number(e.file_size)||0),0);
      if(!result.hasMore) {
        complete=true;
        break;
      }
    }
    if(!complete||used+bytes.length>SOFT_STORAGE_LIMIT)throw new AppError(409,'The wedding album is full. Please contact the couple.');
    const form=new FormData();
    form.append('file',new Blob([bytes], {
      type:'image/jpeg'
    }),filename);
    form.append('parentId',folder);
    form.append('workspaceId','0');
    form.append('fileHash',createHash('sha256').update(bytes).digest('hex'));
    const result=await json('/uploads', {
      method:'POST',body:form
    });
    const entry=result.fileEntry||result.data?.fileEntry;
    if(!entry?.id||String(entry.parent_id)!==folder)throw new AppError(502,'The photo could not be confirmed in the wedding album. Please retry.');
    return photo(entry);
  }
  function send(res,status,value) {
    res.statusCode=status;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.end(JSON.stringify(value));
  }
  return async function handler(req,res) {
    try {
      if(!token||token==='PASTE_YOUR_TOKEN_HERE'||!/^\d+$/.test(folder))throw new AppError(503,'The host is still connecting photo storage. Please come back soon.');
      const url=new URL(req.url,'http://localhost');
      const route=url.pathname==='/api/index'?'/api/'+(url.searchParams.get('route')||''):url.pathname;
      if(route==='/api/gallery'&&req.method==='GET') {
        const page=Number(url.searchParams.get('page')||1);
        if(!Number.isInteger(page)||page<1||page>500)throw new AppError(400,'Invalid gallery page.');
        const result=await list(page);
        return send(res,200, {
          photos:result.entries.filter(isPhoto).map(photo),page,hasMore:result.hasMore
        });
      }
      if(route==='/api/photo'&&req.method==='GET') {
        const id=url.searchParams.get('id');
        if(!/^\d+$/.test(id||''))throw new AppError(400,'Invalid photo.');
        const data=await json(`/file-entries/${id}/model`);
        const entry=data.fileEntry;
        if(!entry||String(entry.parent_id)!==folder||entry.deleted_at||!isPhoto(entry))throw new AppError(404,'Photo not found.');
        if(Number(entry.file_size)>MAX_IMAGE_BYTES)throw new AppError(413,'This photo is too large for the web gallery.');
        const upstream=await drime(`/file-entries/${id}`);
        const chunks=[];
        let size=0;
        for await(const chunk of upstream.body) {
          size+=chunk.length;
          if(size>MAX_IMAGE_BYTES)throw new AppError(413,'This photo is too large for the web gallery.');
          chunks.push(Buffer.from(chunk));
        }
        const bytes=Buffer.concat(chunks);
        const mime=imageSignature(bytes);
        if(!mime)throw new AppError(502,'The photo preview is unavailable.');
        res.setHeader('Content-Type',mime);
        res.setHeader('X-Content-Type-Options','nosniff');
        res.setHeader('Cache-Control','private, max-age=300');
        return res.end(bytes);
      }
      if(route==='/api/upload'&&req.method==='POST') {
        const origin=req.headers.origin;
        if(origin) {
          let host;
          try {
            host=new URL(origin).host;
          }
          catch {
            throw new AppError(403,'Invalid request origin.');
          }
          if(host!==req.headers.host)throw new AppError(403,'Please upload through the wedding website.');
        }
        if(req.headers['sec-fetch-site']==='cross-site')throw new AppError(403,'Please upload through the wedding website.');
        if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AppError(415,'Expected a photo upload request.');
        rateLimit(req);
        const body=await readBody(req);
        const job=uploadQueue.then(()=>savePhoto(body));
        uploadQueue=job.catch(()=> {
        });
        return send(res,201, {
          photo:await job
        });
      }
      throw new AppError(404,'Not found.');
    }
    catch(error) {
      send(res,error instanceof AppError?error.status:500, {
        error:error instanceof AppError?error.message:'Unable to complete the request. Please try again.'
      });
    }
  };
}
module.exports= {
  createApi,
  imageSignature,
  guestFromFilename,
  MAX_IMAGE_BYTES
};
