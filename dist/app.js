const $=s=>document.querySelector(s);
let photos=[],
selected=[],
filter='all',
currentId=null,
busy=false,
loading=false,
page=0,
hasMore=false,
galleryError='';
const dialog=$('#upload-dialog');
function readLocal(key,fallback) {
  try {
    return JSON.parse(localStorage.getItem(key))??fallback;
  }
  catch {
    return fallback;
  }
}
function saveLocal(key,value) {
  try {
    localStorage.setItem(key,JSON.stringify(value));
  }
  catch {
  }
}
const mine=new Set(readLocal('evening-uploads',[]));
$('#guest-name').value=readLocal('evening-name','');
const visiblePhotos=()=>photos.filter(p=>filter==='all'||mine.has(p.id)).sort((a,b)=>$('#sort').value==='newest'?b.time-a.time:a.time-b.time);
const downloadUrl=id=>`/api/photo?id=${encodeURIComponent(id)}&download=1`;
let likesAvailable=false;
const pendingLikes=new Set();
const likeControls=new Map();
const icons={
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/></svg>',
  heart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>'
};
function icon(kind) {
  const span=document.createElement('span');
  span.className='action-icon';
  span.innerHTML=icons[kind]; // Fixed application SVG, never user content.
  return span;
}
function updateLikeControl(button,p) {
  button.hidden=!likesAvailable;
  button.disabled=pendingLikes.has(p.id);
  button.setAttribute('aria-pressed',String(!!p.liked));
  button.setAttribute('aria-label',`${p.liked?'Unlike':'Like'} photo shared by ${p.name}; ${p.likes||0} likes`);
  button.title=p.liked?'Unlike photo':'Like photo';
  button.classList.toggle('is-liked',!!p.liked);
  button.count.textContent=String(p.likes||0);
}
function syncLikeControls(id) {
  const p=photos.find(photo=>photo.id===id);
  if(!p)return;
  const button=likeControls.get(id);
  if(button)updateLikeControl(button,p);
  if(currentId===id)updateLikeControl(lightboxLike,p);
}
async function toggleLike(id) {
  const p=photos.find(photo=>photo.id===id);
  if(!likesAvailable||!p||pendingLikes.has(id))return;
  pendingLikes.add(id);
  syncLikeControls(id);
  let animateLike=false;
  try {
    const response=await fetch('/api/like',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,liked:!p.liked}),signal:AbortSignal.timeout(15000)});
    const state=await response.json();
    if(!response.ok)throw Error(state.error||'Unable to save your like. Please retry.');
    if(!Number.isSafeInteger(state.likes)||state.likes<0||typeof state.liked!=='boolean')throw Error('Unable to confirm your like. Refresh the gallery.');
    const current=photos.find(photo=>photo.id===id);
    if(current)Object.assign(current,{likes:state.likes,liked:state.liked});
    animateLike=state.liked;
  } catch(error) {
    $('#toast').textContent=error.name==='TimeoutError'?'Your like could not be confirmed. Refresh the gallery before trying again.':error.message;
    $('#toast').hidden=false;
    clearTimeout(window.toastTimer);
    window.toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);
  } finally {
    pendingLikes.delete(id);
    syncLikeControls(id);
    if(animateLike) {
      const controls=[likeControls.get(id),currentId===id?lightboxLike:null];
      for(const button of controls) {
        if(!button)continue;
        button.classList.add('like-pop');
        setTimeout(()=>button.classList.remove('like-pop'),300);
      }
    }
  }
}
function makeLikeButton(p) {
  const button=document.createElement('button');
  button.type='button';
  button.className='photo-like photo-action';
  button.count=document.createElement('span');
  button.append(icon('heart'),button.count);
  button.onclick=()=>toggleLike(p.id);
  updateLikeControl(button,p);
  return button;
}
const lightboxLike=$('#lightbox-like');
lightboxLike.count=document.createElement('span');
lightboxLike.append(icon('heart'),lightboxLike.count);
lightboxLike.onclick=()=>toggleLike(currentId);
$('#lightbox-download').replaceChildren(icon('download'));
function render() {
  const grid=$('#gallery-grid');
  grid.replaceChildren();
  likeControls.clear();
  const list=visiblePhotos();
  $('#empty-state').hidden=!!list.length||loading||!!galleryError;
  $('#all-count').textContent=photos.length+(hasMore?'+':'');
  $('#my-count').textContent=photos.filter(p=>mine.has(p.id)).length;
  $('#photo-count').textContent=`${photos.length}${hasMore?'+':''} moments`;
  $('#gallery-status').textContent=galleryError||(loading?'Loading memories…':hasMore?'More memories are waiting below.':'You’re all caught up.');
  $('#load-more').hidden=!hasMore;
  $('#load-more').disabled=loading;
  $('#refresh-gallery').disabled=loading;
  for(const p of list) {
    const card=document.createElement('article');
    card.className='photo-card';
    const open=document.createElement('button');
    open.type='button';
    open.className='photo-open';
    open.setAttribute('aria-label',`Open photo shared by ${p.name}`);
    const wrap=document.createElement('div');
    wrap.className='image-wrap';
    const img=document.createElement('img');
    img.src=p.src;
    img.alt=p.alt;
    img.loading='lazy';
    img.onerror=()=> {
      img.hidden=true;
      const note=document.createElement('span');
      note.className='image-error';
      note.textContent='Preview unavailable. Refresh to retry.';
      wrap.append(note);
    };
    wrap.append(img);
    const caption=document.createElement('div');
    caption.className='card-caption';
    const avatar=document.createElement('span');
    avatar.className='avatar';
    avatar.textContent=p.name.split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();
    const name=document.createElement('span');
    name.textContent=p.name;
    caption.append(avatar,name);
    if(mine.has(p.id)) {
      const badge=document.createElement('span');
      badge.className='sample-badge';
      badge.textContent='YOU';
      caption.append(badge);
    }
    open.append(wrap);
    open.onclick=()=>openPhoto(p.id);
    const download=document.createElement('a');
    download.className='photo-download photo-action';
    download.href=downloadUrl(p.id);
    download.download='';
    download.append(icon('download'));
    download.title='Download photo';
    download.setAttribute('aria-label',`Download photo shared by ${p.name}`);
    const actions=document.createElement('div');
    actions.className='photo-actions';
    const like=makeLikeButton(p);
    likeControls.set(p.id,like);
    actions.append(like,download);
    const media=document.createElement('div');
    media.className='photo-media';
    media.append(open,actions);
    card.append(media,caption);
    grid.append(card);
  }
  if(currentId)syncLikeControls(currentId);
}
async function loadGallery(append=false) {
  if(loading)return;
  loading=true;
  galleryError='';
  render();
  try {
    const response=await fetch(`/api/gallery?page=${append?page+1:1}`);
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Unable to load the gallery.');
    likesAvailable=data.likesAvailable===true;
    photos=Array.from(new Map((append?[...photos,...data.photos]:data.photos).map(p=>[p.id,p])).values());
    page=data.page;
    hasMore=data.hasMore;
  }
  catch(e) {
    galleryError=e.message==='Failed to fetch'?'The gallery is unreachable. Please refresh to try again.':e.message;
  }
  finally {
    loading=false;
    render();
  }
}
$('#refresh-gallery').onclick=()=>loadGallery();
$('#load-more').onclick=()=>loadGallery(true);
document.querySelectorAll('[data-upload]').forEach(b=>b.onclick=()=> {
  dialog.showModal();$('#guest-name').focus();
});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=> {
  if(b.dataset.close!=='upload-dialog'||!busy)document.getElementById(b.dataset.close).close();
});
dialog.addEventListener('cancel',e=> {
  if(busy)e.preventDefault();
});
window.addEventListener('beforeunload',e=> {
  if(busy) {
    e.preventDefault();e.returnValue='';
  }
});
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=> {
  filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(t=> {
    t.classList.toggle('active',t===b);t.setAttribute('aria-pressed',String(t===b));
  });render();
});
$('#sort').onchange=render;
function addFiles(files, {
  camera=false
}
= {
}) {
  if(busy)return [];
  const added=[];
  const errors=[];
  for(const file of files) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)&&!(camera&&(!file.type||file.type.startsWith('image/')))) {
      errors.push(`${file.name}: choose JPG, PNG or WebP. Convert HEIC photos to JPG first.`);
      continue;
    }
    if(file.size>20*1024*1024) {
      errors.push(`${file.name}: exceeds 20 MB.`);
      continue;
    }
    if(selected.length>=30) {
      errors.push('Choose up to 30 photos at a time.');
      break;
    }
    if(!camera&&selected.some(p=>p.file.name===file.name&&p.file.size===file.size))continue;
    const item= {
      file,
      url:URL.createObjectURL(file),
      uploadId:crypto.randomUUID().replaceAll('-','')
    };
    selected.push(item);
    added.push(item);
  }
  $('#upload-error').textContent=errors.join(' ');
  renderSelected();
  return added;
}
function renderSelected() {
  const target=$('#selected-files');
  target.replaceChildren();
  selected.forEach((p,i)=> {
    const tile=document.createElement('div');tile.className='selected-photo';const img=document.createElement('img');img.src=p.url;img.alt=p.file.name;const remove=document.createElement('button');remove.type='button';remove.className='remove-file';remove.textContent='×';remove.disabled=busy;remove.setAttribute('aria-label',`Remove ${p.file.name}`);remove.onclick=()=> {
      URL.revokeObjectURL(p.url);selected.splice(i,1);renderSelected();
    };tile.append(img,remove);target.append(tile);
  });
  $('#submit-upload').textContent=busy?'Saving your memories…':selected.length?`Share ${selected.length} photo${selected.length===1?'':'s'}`:'Add to the gallery';
}
$('#photo-input').onchange=e=> {
  addFiles(e.target.files);
  e.target.value='';
};
$('#take-photo').onclick=()=> {
  if(busy)return;
  const name=$('#guest-name');
  if(!name.value.trim()||!name.reportValidity()) {
    $('#upload-error').textContent='Please enter your name before taking a photo.';
    name.focus();
    return;
  }
  $('#upload-error').textContent='';
  $('#camera-input').click();
};
$('#camera-input').onchange=async e=> {
  if(busy)return;
  const files=Array.from(e.target.files||[]);
  e.target.value='';
  if(!files.length)return;
  const captured=addFiles(files.slice(0,1), {
    camera:true
  });
  if(captured.length)await sharePhotos(captured);
};
const drop=$('#drop-zone');
drop.tabIndex=0;
drop.onkeydown=e=> {
  if(!busy&&(e.key==='Enter'||e.key===' ')) {
    e.preventDefault();
    $('#photo-input').click();
  }
};
['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=> {
  e.preventDefault();if(!busy)drop.classList.add('dragging');
}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=> {
  e.preventDefault();drop.classList.remove('dragging');
}));
drop.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
async function decodePhoto(file) {
  if(typeof createImageBitmap==='function') {
    try {
      return await createImageBitmap(file);
    }
    catch {
    }
  }
  const url=URL.createObjectURL(file);
  const img=new Image();
  try {
    await new Promise((resolve,reject)=> {
      img.onload=resolve;img.onerror=()=>reject(Error('This phone could not read the photo. Try a JPG copy or use the camera Most Compatible format.'));img.src=url;
    });
    img.close=()=>URL.revokeObjectURL(url);
    return img;
  }
  catch(error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
async function optimize(file) {
  const image=await decodePhoto(file);
  try {
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,2560/Math.max(image.width,image.height));
    canvas.width=Math.max(1,Math.round(image.width*scale));
    canvas.height=Math.max(1,Math.round(image.height*scale));
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    let blob;
    for(const quality of [.85,.72,.6,.45]) {
      blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(blob&&blob.size<=2*1024*1024)break;
    }
    if(!blob||blob.size>2*1024*1024)throw Error('This image could not be made small enough. Please choose a smaller copy.');
    return await new Promise((resolve,reject)=> {
      const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('Unable to read this photo.'));reader.readAsDataURL(blob);
    });
  }
  finally {
    image.close();
  }
}
function upload(body,label) {
  return new Promise((resolve,reject)=> {
    const xhr=new XMLHttpRequest();xhr.open('POST','/api/upload');xhr.setRequestHeader('Content-Type','application/json');xhr.timeout=120000; xhr.upload.onprogress=e=> {
      if(e.lengthComputable)$('#upload-progress').textContent=`${label}: ${Math.round(e.loaded/e.total*100)}% sent — saving to the album…`;
    }; xhr.onload=()=> {
      try {
        const data=xhr.response;
        if(xhr.status<200||xhr.status>=300) {
          throw Error(data?.error||`Upload failed (HTTP ${xhr.status}). Please retry.`);
        }
        if(!data?.photo?.id)throw Error('The upload returned an unexpected response. Please retry.');
        resolve(data.photo);
      }
      catch(e) {
        reject(e);
      }
    }; xhr.onerror=()=>reject(Error('Connection lost. Your unsaved photos are ready to retry.'));xhr.ontimeout=()=>reject(Error('Saving took too long. Please retry; already saved photos will be recognised.'));xhr.responseType='json';xhr.send(JSON.stringify(body));
  });
}
$('#upload-form').onsubmit=e=> {
  e.preventDefault();
  return sharePhotos([...selected]);
};
async function sharePhotos(batch) {
  if(busy)return;
  const name=$('#guest-name').value.trim();
  if(!name||!batch.length) {
    $('#upload-error').textContent='Enter your name and choose at least one photo.';
    return;
  }
  busy=true;
  saveLocal('evening-name',name);
  $('#upload-error').textContent='';
  for(const el of [$('#submit-upload'),$('#photo-input'),$('#guest-name'),$('#take-photo'),$('#camera-input')])el.disabled=true;
  renderSelected();
  let count=0;
  const errors=[];
  for(let i=0;i<batch.length;i++) {
    const p=batch[i];
    const label=`Photo ${i+1} of ${batch.length}`;
    try {
      $('#upload-progress').textContent=`${label}: preparing…`;
      p.data=p.data||await optimize(p.file);
      p.name=p.name||name;
      const photo=await upload( {
        name:p.name,uploadId:p.uploadId,data:p.data
      },label);
      mine.add(photo.id);
      saveLocal('evening-uploads',[...mine]);
      photos=[photo,...photos.filter(x=>x.id!==photo.id)];
      selected=selected.filter(x=>x!==p);
      URL.revokeObjectURL(p.url);
      count++;
      render();
      renderSelected();
    }
    catch(error) {
      errors.push(`${p.file.name}: ${error.message}`);
    }
  }
  busy=false;
  for(const el of [$('#submit-upload'),$('#photo-input'),$('#guest-name'),$('#take-photo'),$('#camera-input')])el.disabled=false;
  renderSelected();
  $('#upload-error').textContent=errors.join(' ');
  $('#upload-progress').textContent=count?`${count} photo${count===1?'':'s'} saved to the shared album.`:'';
  if(!selected.length) {
    dialog.close();
    $('#toast').textContent=`${count} memories saved. Thank you, ${name}!`;
    $('#toast').hidden=false;
    clearTimeout(window.toastTimer);
    window.toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);
    loadGallery();
  }
};
function openPhoto(id) {
  currentId=id;
  const p=photos.find(p=>p.id===id);
  if(!p)return;
  $('#lightbox-image').src=p.src;
  $('#lightbox-image').alt=p.alt;
  $('#lightbox-name').textContent=`Shared by ${p.name}`;
  $('#lightbox-download').href=downloadUrl(p.id);
  updateLikeControl(lightboxLike,p);
  const list=visiblePhotos();
  $('#lightbox-position').textContent=`${list.findIndex(x=>x.id===id)+1} / ${list.length}`;
  if(!$('#lightbox').open)$('#lightbox').showModal();
}
function navigate(step) {
  const list=visiblePhotos();
  const i=list.findIndex(p=>p.id===currentId);
  if(list.length)openPhoto(list[(i+step+list.length)%list.length].id);
}
$('.previous').onclick=()=>navigate(-1);
$('.next').onclick=()=>navigate(1);
$('#lightbox').onkeydown=e=> {
  if(e.key==='ArrowLeft')navigate(-1);
  if(e.key==='ArrowRight')navigate(1);
};
loadGallery();

