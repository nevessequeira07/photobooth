// Read-only Drime connection check. Never prints credentials or full responses.
const fs = require('node:fs');
const path = require('node:path');
const token = process.env.DRIME_API_TOKEN?.trim();
const base = 'https://app.drime.cloud/api/v1';
async function request(route) {
  const response = await fetch(base + route, {
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json'
    }, signal: AbortSignal.timeout(20000), redirect: 'error',
  });
  if (!response.ok) {
    const descriptions = {
      401:'Token was rejected. Check the value in .env.local.',
      403:'Token permissions do not allow this request.',
      429:'Too many requests. Try again shortly.'
    };
    throw new Error(descriptions[response.status] || `Drime returned HTTP ${response.status}.`);
  }
  return response.json();
}
async function main() {
  if (!token || token === 'PASTE_YOUR_TOKEN_HERE') throw new Error('Add your token to .env.local first.');
  await request('/users/me');
  console.log('Authentication: OK (token not displayed)');
  const folders = [];
  for (let page=1; page<=20; page++) {
    const result = await request(`/drive/file-entries?workspaceId=0&page=${page}`);
    const entries = Array.isArray(result.data) ? result.data : result.data?.data;
    if (!Array.isArray(entries)) {
      console.log('Connection works, but the folder response needs inspection.');
      console.log('Response field names:', Object.keys(result).join(', '));
      return;
    }
    for (const entry of entries) {
      if (entry.type === 'folder' && /^wedding photos$/i.test(entry.name?.trim())) folders.push(entry);
    }
    if (!entries.length || !result.last_page || page >= result.last_page) break;
  }
  const unique = [...new Map(folders.map(f=>[String(f.id),f])).values()];
  if (unique.length !== 1 || !/^\d+$/.test(String(unique[0]?.id))) {
    console.log(unique.length ? 'More than one Wedding Photos folder found; select the intended folder.' : 'Wedding Photos folder not found in the returned personal-drive entries.');
    console.log('Please share the wedding folder URL, not your token.');
    return;
  }
  const id = String(unique[0].id);
  console.log('Wedding Photos folder found. ID:', id);
  const file = path.join(__dirname, '..', '.env.local');
  const contents = fs.readFileSync(file, 'utf8');
  const current = process.env.DRIME_FOLDER_ID?.trim();
  if (current && current !== id) {
    console.log('Existing folder setting differs; it was left unchanged.');
    return;
  }
  const updated = /^DRIME_FOLDER_ID=.*$/m.test(contents) ? contents.replace(/^DRIME_FOLDER_ID=.*$/m, `DRIME_FOLDER_ID=${id}`) : contents.trimEnd()+`\nDRIME_FOLDER_ID=${id}\n`;
  fs.writeFileSync(file, updated, {
    mode:0o600
  });
  console.log('Folder ID saved privately in .env.local.');
  console.log('Connection check complete. No photos were uploaded or changed.');
}
main().catch(error => {
  // Do not log fetch errors or provider response bodies, which may include secrets.
  if (error.cause?.code || error.name==='TimeoutError') console.error('Connection failed:',error.cause?.code || 'TIMEOUT'); else console.error(String(error.message).replaceAll(token || 'UNUSED_TOKEN_SENTINEL', '[redacted]')); process.exitCode=1;
});
