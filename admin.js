const $=s=>document.querySelector(s);
let photos=[],selected=new Set(),page=0,busy=false;
function message(text){$('#status').textContent=text;}
function lock(value){busy=value;for(const el of document.querySelectorAll('button,input'))el.disabled=value;$('#delete').disabled=value||!selected.size;}
function signedIn(value){$('#login-form').hidden=value;$('#dashboard').hidden=!value;$('#logout').hidden=!value;if(!value){photos=[];selected.clear();render();}}
async function api(action,body){
  const r=await fetch('/api/admin?action='+action,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
  const d=await r.json();
  if(!r.ok){if(r.status===401)signedIn(false);throw Error(d.error||'Request failed. Please retry.');}
  return d;
}
function render(){
  $('#admin-grid').replaceChildren();
  for(const p of photos){
    const label=document.createElement('label');label.className='admin-card';
    const img=document.createElement('img');img.src=p.src;img.alt='Photo shared by '+p.name;img.loading='lazy';
    const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(p.id);check.disabled=busy;check.setAttribute('aria-label','Select photo '+p.id+' shared by '+p.name);
    check.onchange=()=>{if(check.checked&&selected.size>=20){check.checked=false;message('Select up to 20 photos at a time.');return;}if(check.checked)selected.add(p.id);else selected.delete(p.id);updateSelection();};
    const name=document.createElement('span');name.textContent=p.name;
    const date=document.createElement('small');date.textContent=new Date(p.time).toLocaleDateString();
    label.append(img,check,name,date);$('#admin-grid').append(label);
  }
  updateSelection();
}
function updateSelection(){$('#selection').textContent=selected.size+' selected';$('#delete').disabled=busy||!selected.size;}
async function load(append=false){
  if(busy)return;lock(true);message('Loading photos…');
  try{const data=await api('photos&page='+(append?page+1:1));photos=append?[...photos,...data.photos]:data.photos;page=data.page;if(!append)selected.clear();$('#more').hidden=!data.hasMore;render();message(photos.length?photos.length+' photos loaded.':'No photos in the album yet.');}
  catch(e){message(e.message);}finally{lock(false);}
}
$('#login-form').onsubmit=async e=>{e.preventDefault();if(busy)return;lock(true);try{await api('login',{password:$('#password').value});$('#password').value='';signedIn(true);lock(false);await load();}catch(e){message(e.message);}finally{lock(false);}};
$('#refresh').onclick=()=>load();$('#more').onclick=()=>load(true);
$('#clear').onclick=()=>{selected.clear();render();};
$('#delete').onclick=()=>{$('#confirm-count').textContent=selected.size+' photo(s) selected.';$('#confirm-dialog').showModal();$('#cancel').focus();};
$('#cancel').onclick=()=>$('#confirm-dialog').close();
$('#confirm-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('#confirm-delete').onclick=async()=>{
  if(busy||!selected.size)return;lock(true);message('Deleting selected photos…');
  try{const data=await api('delete',{ids:[...selected]});photos=photos.filter(p=>!data.deleted.includes(p.id));selected.clear();render();$('#confirm-dialog').close();message(data.deleted.length+' photo(s) deleted. Refresh the guest gallery to see the change.');}
  catch(e){$('#confirm-dialog').close();message(e.message);}finally{lock(false);}
};
$('#logout').onclick=async()=>{if(busy)return;lock(true);try{await api('logout',{});signedIn(false);message('Signed out.');}catch(e){message(e.message);}finally{lock(false);}};
(async()=>{lock(true);try{await api('session');signedIn(true);lock(false);await load();}catch(e){signedIn(false);message(e.message==='Please sign in.'?'Enter your password to manage the album.':e.message);}finally{lock(false);}})();
