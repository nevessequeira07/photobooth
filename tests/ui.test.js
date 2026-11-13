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
      },append() {
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

});
