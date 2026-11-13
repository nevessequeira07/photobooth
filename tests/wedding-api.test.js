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
test('Vercel rewrite serves the same gallery handler',async()=> {
  const api=createApi( {
    token:'secret',folderId:42,fetchImpl:async()=>json( {
      data:[],last_page:1
    })
  });assert.equal((await call(api,'/api/index?route=gallery')).statusCode,200);
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
