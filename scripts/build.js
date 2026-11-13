const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const out=path.join(root,'dist');
fs.mkdirSync(out, {
  recursive:true
});
for(const file of ['index.html','styles.css','app.js'])fs.copyFileSync(path.join(root,file),path.join(out,file));
console.log('Built public UI files. Secrets are excluded.');
