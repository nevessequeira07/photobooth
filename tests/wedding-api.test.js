const test=require('node:test');
const assert=require('node:assert/strict');
const {
  Readable
}
=require('node:stream');
const {
  createApi
}
=require('../lib/wedding-api');
const jpeg=Buffer.from([255,216,255,224,0,2,255,217]);
const body= {
  name:'Lavina',
  uploadId:'a'.repeat(32),
  data:jpeg.toString('base64')
};
const entry= {
  id:123,
  parent_id:42,
  mime:'image/jpeg',
  name:`oe--${Buffer.from('Lavina').toString('base64url')}--${body.uploadId}.jpg`,
  file_size:8,
  created_at:'2026-11-13'
};
const json=value=>new Response(JSON.stringify(value), {
  headers: {
    'Content-Type':'application/json'
  }
});
async function call(api,url,method='GET',body,headers= {
}) {
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  Object.assign(req, {
    url,method,headers: {
      host:'localhost','content-type':'application/json',...headers
    },socket: {
      remoteAddress:'127.0.0.1'
    }
  });
  const res= {
    statusCode:200,
    headers: {
    },
    setHeader(k,v) {
      this.headers[k]=v;
    },
    end(value) {
      this.data=value;
    }
  };
  await api(req,res);
  return res;
}
test('gallery filters unrelated folders and preserves pagination',async()=> {
  const api=createApi( {
    token:'secret',folderId:42,fetchImpl:async(url,options)=> {
      assert.equal(new URL(url).searchParams.get('parentIds[]'),'42');assert.equal(options.headers.Authorization,'Bearer secret');return json( {
        data:[entry, {
          ...entry,id:999,parent_id:43
        }],last_page:2
      });
    }
  }); const res=await call(api,'/api/gallery');const data=JSON.parse(res.data);assert.equal(data.photos.length,1);assert.equal(data.photos[0].name,'Lavina');assert.equal(data.hasMore,true);assert.ok(!res.data.includes('secret'));
});
test('photo outside wedding folder never fetches its bytes',async()=> {
  let calls=0;const api=createApi( {
    token:'secret',folderId:42,fetchImpl:async()=> {
      calls++;return json( {
        fileEntry: {
          ...entry,parent_id:99
        }
      });
    }
  });const res=await call(api,'/api/photo?id=123');assert.equal(res.statusCode,404);assert.equal(calls,1);
});
test('valid upload uses configured folder and returns saved photo',async()=> {
  const api=createApi( {
    token:'secret',folderId:42,fetchImpl:async(url,options)=> {
      if(url.endsWith('/uploads')) {
        assert.equal(options.body.get('parentId'),'42');assert.equal(options.body.get('file').name,entry.name);return json( {
          fileEntry:entry
        });
      }
      return json( {
        data:[],last_page:1
      });
    }
  }); const res=await call(api,'/api/upload','POST',body);assert.equal(res.statusCode,201);assert.equal(JSON.parse(res.data).photo.id,'123');
});
test('retry returns saved photo without creating duplicate',async()=> {
  let calls=0;const api=createApi( {
    token:'secret',folderId:42,fetchImpl:async()=> {
      calls++;return json( {
        data:[entry],last_page:1
      });
    }
  });assert.equal((await call(api,'/api/upload','POST',body)).statusCode,201);assert.equal(calls,1);
});
test('invalid images and cross-site uploads rejected before storage access',async()=> {
  const api=createApi( {
    token:'secret',folderId:42,fetchImpl:async()=>assert.fail('Unexpected storage access')
  });assert.equal((await call(api,'/api/upload','POST', {
    ...body,data:Buffer.from('<html>').toString('base64')
  })).statusCode,400);assert.equal((await call(api,'/api/upload','POST',body, {
    origin:'https://other.test'
  })).statusCode,403);
});
test('upstream failure never exposes provider response or token',async()=> {
  const api=createApi( {
    token:'secret',folderId:42,fetchImpl:async()=>new Response('secret account details', {
      status:401
    })
  });const res=await call(api,'/api/gallery');assert.equal(res.statusCode,502);assert.ok(!res.data.includes('secret'));
});
test('Vercel entrypoints serve upload, gallery, and photo directly', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/uploads')) {
      assert.equal(options.method, 'POST');
      return json({fileEntry: entry});
    }
    if (path.endsWith('/file-entries/123/model')) return json({fileEntry: entry});
    if (path.endsWith('/file-entries/123')) return new Response(jpeg);
    return json({data: [], last_page: 1});
  });
  for (const [key, value] of Object.entries({DRIME_API_TOKEN: 'test-token', DRIME_FOLDER_ID: '42'})) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
    process.env[key] = value;
  }

  const upload = await call(require('../api/upload'), '/api/upload', 'POST', body);
  assert.equal(upload.statusCode, 201);
  assert.equal(JSON.parse(upload.data).photo.src, '/api/photo?id=123');

  const gallery = await call(require('../api/gallery'), '/api/gallery?page=2');
  assert.equal(gallery.statusCode, 200);
  assert.equal(JSON.parse(gallery.data).page, 2);

  const photo = await call(require('../api/photo'), '/api/photo?id=123');
  assert.equal(photo.headers['Content-Type'], 'image/jpeg');
  assert.deepEqual(photo.data, jpeg);
});
test('storage guard refuses new upload above soft album limit',async()=> {
  const api=createApi( {
    token:'secret',folderId:42,fetchImpl:async()=>json( {
      data:[ {
        ...entry,name:'different.jpg',file_size:9000000000
      }],last_page:1
    })
  });assert.equal((await call(api,'/api/upload','POST',body)).statusCode,409);
});

test('downloads preserve bytes, set safe filenames, and keep folder restrictions', async()=> {
  for(const [mime,bytes,extension] of [
    ['image/jpeg',jpeg,'jpg'],
    ['image/png',Buffer.from([137,80,78,71,13,10,26,10]),'png'],
    ['image/webp',Buffer.from('RIFF0000WEBP'),'webp']
  ]) {
    const api=createApi({token:'secret',folderId:42,fetchImpl:async url=>url.endsWith('/model')?json({fileEntry:{...entry,mime}}):new Response(bytes)});
    const download=await call(api,'/api/photo?id=123&download=1');
    assert.equal(download.statusCode,200);
    assert.equal(download.headers['Content-Disposition'],`attachment; filename="our-evening-123.${extension}"`);
    assert.equal(download.headers['Content-Type'],mime);
    assert.deepEqual(download.data,bytes);
    const preview=await call(api,'/api/photo?id=123');
    assert.equal(preview.headers['Content-Disposition'],undefined);
  }
  let calls=0;
  const api=createApi({token:'secret',folderId:42,fetchImpl:async()=>{calls++;return json({fileEntry:{...entry,parent_id:99}});}});
  assert.equal((await call(api,'/api/photo?id=123&download=1')).statusCode,404);
  assert.equal(calls,1);
  assert.equal((await call(api,'/api/photo?id=bad%0D%0Aheader&download=1')).statusCode,400);
  assert.equal(calls,1);
});

test('likes validate origin, cookie, body and folder before writing',async()=> {
  let writes=0,storageCalls=0;
  const store={enabled:true,identity:req=>req.headers.cookie==='valid'?'voter':null,write:async()=>{writes++;return {likes:1,liked:true};}};
  const api=createApi({token:'secret',folderId:42,likesStore:store,fetchImpl:async()=>{storageCalls++;return json({fileEntry:entry});}});
  const headers={origin:'http://localhost',cookie:'valid'};
  assert.equal((await call(api,'/api/like','POST',{id:'123',liked:true},headers)).statusCode,200);
  assert.equal(writes,1);
  assert.equal((await call(api,'/api/like','POST',{id:'123',liked:true},{...headers,origin:'https://evil.test'})).statusCode,403);
  assert.equal((await call(api,'/api/like','POST',{id:'123',liked:true},{...headers,cookie:'forged'})).statusCode,403);
  assert.equal((await call(api,'/api/like','POST',null,headers)).statusCode,400);
  assert.equal((await call(api,'/api/like','POST',{id:'123',liked:'true'},headers)).statusCode,400);
  assert.equal((await call(api,'/api/like','POST',{id:'123',liked:true,extra:'x'.repeat(1024)},headers)).statusCode,413);
  assert.equal(storageCalls,1);
  const outside=createApi({token:'secret',folderId:42,likesStore:store,fetchImpl:async()=>json({fileEntry:{...entry,parent_id:99}})});
  assert.equal((await call(outside,'/api/like','POST',{id:'123',liked:true},headers)).statusCode,404);
  assert.equal(writes,1);
});

test('gallery works during a likes outage and rate limits are returned safely',async()=> {
  const likesStore={enabled:true,identity:()=> 'voter',read:async()=>{throw Error('secret');},write:async()=>({limited:true})};
  const api=createApi({token:'secret',folderId:42,likesStore,fetchImpl:async url=>url.endsWith('/model')?json({fileEntry:entry}):json({data:[entry],last_page:1})});
  const gallery=await call(api,'/api/gallery');
  assert.equal(gallery.statusCode,200);
  assert.equal(JSON.parse(gallery.data).likesAvailable,false);
  assert.equal(JSON.parse(gallery.data).photos.length,1);
  assert.ok(!gallery.data.includes('secret'));
  assert.equal((await call(api,'/api/like','POST',{id:'123',liked:true},{origin:'http://localhost'})).statusCode,429);
});
