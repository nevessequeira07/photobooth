const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('page initializes and every Add photos button opens the dialog', async()=> {
  const html=fs.readFileSync('index.html','utf8'); const elements=new Map(); function element() {
    return {
      value:'newest',classList: {
        add() {
        },remove() {
        },toggle() {
        }
      },addEventListener() {
      },replaceChildren() {
      },setAttribute() {
      },append(...children) {
        this.children=(this.children||[]).concat(children);
      },click() {
        this.clicked=true;
      },reportValidity() {
        return true;
      },focus() {
        this.focused=true;
      },showModal() {
        this.open=true;
      },close() {
        this.open=false;
      }
    };
  }
  for(const match of html.matchAll(/id="([^"]+)"/g))elements.set('#'+match[1],element());
 for(const cls of ['previous','next']){assert.ok(html.includes(cls));elements.set('.'+cls,element());}
 const uploads=Array.from(html.matchAll(/<button\b[^>]*\bdata-upload\b/g),()=>element());
 const filters=['all','mine'].map(value=>({...element(),dataset:{filter:value}}));
 const document={createElement:()=>element(),querySelector:s=>elements.get(s)||null,querySelectorAll:s=>s==='[data-upload]'?uploads:s==='[data-filter]'?filters:[]};
 const context={URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},crypto:{randomUUID:()=> 'a'.repeat(32)},document,localStorage:{getItem(){return null;}},window:{addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({photos:[],page:1,hasMore:false})}),setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync('app.js','utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(uploads.length>=3);
 for(const button of uploads){elements.get('#upload-dialog').open=false;assert.equal(typeof button.onclick,'function');button.onclick();assert.equal(elements.get('#upload-dialog').open,true);assert.equal(elements.get('#guest-name').focused,true);}
 assert.equal(typeof elements.get('#refresh-gallery').onclick,'function');
 assert.match(html, /id="camera-input"[^>]*capture="environment"/);
 const name=elements.get('#guest-name'),camera=elements.get('#camera-input'),take=elements.get('#take-photo');
 name.value='';take.onclick();assert.equal(camera.clicked,undefined);
 name.value='Lavina';take.onclick();assert.equal(camera.clicked,true);
 vm.runInNewContext('var cameraBatches=[];sharePhotos=async batch=>cameraBatches.push(batch);',context);
 await camera.onchange({target:{files:[],value:''}});assert.equal(context.cameraBatches.length,0);
 const existing={name:'existing.jpg',type:'image/jpeg',size:100};
 elements.get('#photo-input').onchange({target:{files:[existing],value:''}});
 const captured={name:'camera.jpg',type:'image/jpeg',size:200};
 await camera.onchange({target:{files:[captured],value:''}});
 assert.equal(context.cameraBatches.length,1);assert.equal(context.cameraBatches[0].length,1);assert.equal(context.cameraBatches[0][0].file,captured);
 assert.equal(vm.runInNewContext('selected.length',context),2);
 vm.runInNewContext('busy=true',context);camera.clicked=false;take.onclick();assert.equal(camera.clicked,false);

 context.XMLHttpRequest=class {
   upload={};
   status=404;
   response=null;
   open(method,url) {
     assert.equal(method,'POST');
     assert.equal(url,'/api/upload');
   }
   setRequestHeader() {}
   send() {
     assert.equal(this.responseType,'json');
     this.onload();
   }
 };
 await assert.rejects(vm.runInNewContext("upload({},'Photo 1 of 1')",context), /Upload failed \(HTTP 404\)/);
 vm.runInNewContext("photos=[{id:'123',name:'Guest',src:'/api/photo?id=123',alt:'Photo',time:1},{id:'456',name:'Other guest',src:'/api/photo?id=456',alt:'Photo',time:2}];render();openPhoto('123');",context);
 const card=elements.get('#gallery-grid').children[0];
 assert.equal(card.children[1].children[1].title,'Download photo');
 assert.equal(card.children[1].children[1].href,'/api/photo?id=456&download=1');
 assert.equal(card.children[1].children[1].download,'');
 assert.equal(elements.get('#lightbox-download').href,'/api/photo?id=123&download=1');
 elements.get('.next').onclick();
 assert.equal(elements.get('#lightbox-download').href,'/api/photo?id=456&download=1');
 context.AbortSignal=AbortSignal;
 let likeRequests=0,finishLike;
 context.fetch=async(url,options)=>{
   assert.equal(url,'/api/like');
   assert.deepEqual(JSON.parse(options.body),{id:'456',liked:true});
   likeRequests++;
   return new Promise(resolve=>{finishLike=()=>resolve({ok:true,json:async()=>({likes:1,liked:true})});});
 };
 vm.runInNewContext('likesAvailable=true;var firstLike=toggleLike("456");toggleLike("456");',context);
 assert.equal(likeRequests,1);
 assert.equal(elements.get('#lightbox-like').disabled,true);
 finishLike();await context.firstLike;
 assert.equal(elements.get('#lightbox-like').count.textContent,'1');
 assert.equal(elements.get('#lightbox-like').disabled,false);
 context.fetch=async(url,options)=>{
   assert.equal(JSON.parse(options.body).liked,false);
   return {ok:true,json:async()=>({likes:0,liked:false})};
 };
 await vm.runInNewContext('toggleLike("456")',context);
 assert.equal(elements.get('#lightbox-like').count.textContent,'0');
});
