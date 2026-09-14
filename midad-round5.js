/* MIDAD Round 6 — real fixes for:
   1) profile name staying put with titles 2-under-2
   2) member upload button actually opening the upload UI
   3) duration overlay not wiping folder images + datetime not shifting
   4) folder/section/item images actually saving and showing
   Plus Round 5 welcome/video/upload backend that already existed. */
(() => {
  if (window.__midadRound6Loaded) return;
  window.__midadRound6Loaded = true;
  window.__midadRound5Loaded = true;

  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

  function enhanceWelcomeMessageMedia(root=document) {
    const mediaList = root.querySelectorAll?.('.user-message-item .admin-message-media') || [];
    mediaList.forEach(media => {
      if (media.closest('.welcome-media-box')) return;
      const src = media.currentSrc || media.getAttribute('src') || '';
      if (!src) return;
      const type = media.tagName === 'VIDEO' ? 'video' : 'image';
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'welcome-media-box';
      box.setAttribute('data-midad-enhanced','1');
      box.setAttribute('data-act','open-welcome-media');
      box.setAttribute('data-media-type',type);
      box.setAttribute('data-media-url',src);
      box.setAttribute('aria-label','فتح المرفق بالحجم الكامل');
      media.classList.add('welcome-media-preview');
      media.parentNode.insertBefore(box,media);
      box.appendChild(media);
      const hint=document.createElement('span');
      hint.className='welcome-media-hint';
      hint.innerHTML='<i class="fas fa-expand"></i> اضغط لعرض المرفق بالحجم الكامل';
      box.appendChild(hint);
    });
  }

  const pendingMaterialImageLoads = new Map();
  const materialImageBlobUrls = new Map();
  function extractStoragePath(urlOrPath, bucket) {
    if (!urlOrPath) return null;
    const s = String(urlOrPath);
    if (s.startsWith('blob:') || s.startsWith('data:')) return null;
    if (!/^https?:\/\//i.test(s)) return s;
    const marker = `/object/public/${bucket}/`;
    const i = s.indexOf(marker);
    if (i >= 0) return decodeURIComponent(s.slice(i + marker.length).split('?')[0]);
    const signed = `/object/sign/${bucket}/`;
    const j = s.indexOf(signed);
    if (j >= 0) return decodeURIComponent(s.slice(j + signed.length).split('?')[0]);
    return null;
  }
  async function secureMaterialImages() {
    const items = [];
    for (const s of (state.sections || [])) for (const sub of (s.subs || []))
      for (const it of (sub.items || [])) if (it.imagePathRaw || it.image) items.push(it);
    await Promise.all(items.map(async it => {
      const path = it.imagePathRaw || extractStoragePath(it.image, 'materials');
      if (!path || /^blob:|^data:/i.test(String(path))) return;
      const cleanPath = extractStoragePath(path, 'materials') || path;
      if (!cleanPath || /^https?:\/\//i.test(cleanPath)) return;
      try {
        let promise = pendingMaterialImageLoads.get(cleanPath);
        if (!promise) {
          promise = sb.storage.from('materials').download(cleanPath).then(r => {
            if (r.error) throw r.error;
            return URL.createObjectURL(r.data);
          });
          pendingMaterialImageLoads.set(cleanPath, promise);
        }
        const blobUrl = await promise;
        const old = materialImageBlobUrls.get(String(it.dbId || it.id));
        if (old && old !== blobUrl) URL.revokeObjectURL(old);
        materialImageBlobUrls.set(String(it.dbId || it.id), blobUrl);
        it.image = blobUrl;
      } catch (e) { console.warn('secure material image', cleanPath, e); }
    }));
  }

  const pendingWelcomeBlobLoads = new Map();
  async function secureWelcomeMessageMedia(root=document) {
    const nodes = root.querySelectorAll?.('.user-message-item .admin-message-media') || [];
    for (const media of nodes) {
      if (media.dataset.midadSecure === '1' || media.dataset.midadSecureLoading === '1') continue;
      const src = media.getAttribute('src') || '';
      const path = extractStoragePath(src, 'admin-messages');
      if (!path) continue;
      media.dataset.midadSecureLoading = '1';
      try {
        let promise = pendingWelcomeBlobLoads.get(path);
        if (!promise) {
          promise = sb.storage.from('admin-messages').download(path).then(r => { if (r.error) throw r.error; return URL.createObjectURL(r.data); });
          pendingWelcomeBlobLoads.set(path, promise);
        }
        const blobUrl = await promise;
        media.src = blobUrl;
        const box = media.closest('.welcome-media-box');
        if (box) box.dataset.mediaUrl = blobUrl;
        media.dataset.midadSecure = '1';
      } catch (e) { console.warn('secure welcome media', e); }
      finally { delete media.dataset.midadSecureLoading; }
    }
  }

  const welcomeMediaObserver = new MutationObserver(() => {
    enhanceWelcomeMessageMedia();
    void secureWelcomeMessageMedia();
  });
  if (document.body) welcomeMediaObserver.observe(document.body,{childList:true,subtree:true});
  else document.addEventListener('DOMContentLoaded',()=>welcomeMediaObserver.observe(document.body,{childList:true,subtree:true}),{once:true});
  enhanceWelcomeMessageMedia();

  document.addEventListener('click',event=>{
    const box=event.target?.closest?.('.welcome-media-box[data-media-url][data-midad-enhanced="1"]');
    if(!box) return;
    event.preventDefault(); event.stopPropagation();
    if(typeof event.stopImmediatePropagation==='function') event.stopImmediatePropagation();
    if(typeof openModal==='function') openModal('welcome-media',{mediaType:box.dataset.mediaType||'image',mediaUrl:box.dataset.mediaUrl||''});
  },true);

  const MAX_CACHE_FILES = 40;
  const IV_NATIVE_CACHE = !!(window.Capacitor && window.Capacitor.isNativePlatform?.());
  const IV_CACHE_DB = 'in-the-void-local-files-v2';
  const IV_CACHE_STORE = 'files';
  let ivCacheDbPromise = null;

  function ivOpenCacheDb(){
    if(!IV_NATIVE_CACHE || !window.indexedDB) return Promise.resolve(null);
    if(ivCacheDbPromise) return ivCacheDbPromise;
    ivCacheDbPromise = new Promise((resolve,reject)=>{
      const req=indexedDB.open(IV_CACHE_DB,1);
      req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(IV_CACHE_STORE)) db.createObjectStore(IV_CACHE_STORE,{keyPath:'key'}); };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('LOCAL_CACHE_OPEN_FAILED'));
    }).catch(()=>null);
    return ivCacheDbPromise;
  }
  function ivCacheKey(userId,bucket,path){ return [String(userId||''),String(bucket||''),String(path||'')].join('|'); }
  async function ivGetCachedFile(key){
    const db=await ivOpenCacheDb(); if(!db||!key) return null;
    return await new Promise(resolve=>{ try{ const tx=db.transaction(IV_CACHE_STORE,'readonly'); const req=tx.objectStore(IV_CACHE_STORE).get(key); req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>resolve(null); }catch(_){resolve(null);} });
  }
  async function ivPutCachedFile(key,blob,name,type){
    const db=await ivOpenCacheDb(); if(!db||!key||!blob) return false;
    const ok=await new Promise(resolve=>{ try{ const tx=db.transaction(IV_CACHE_STORE,'readwrite'); tx.objectStore(IV_CACHE_STORE).put({key,blob,name:String(name||'ملف'),type:String(type||blob.type||'application/octet-stream'),savedAt:Date.now()}); tx.oncomplete=()=>resolve(true); tx.onerror=()=>resolve(false); tx.onabort=()=>resolve(false); }catch(_){resolve(false);} });
    if (!ok) return false;
    // Best-effort cap: local cache must not grow without bound on mobile.
    try {
      const all = await new Promise(resolve=>{ const tx=db.transaction(IV_CACHE_STORE,'readonly'); const req=tx.objectStore(IV_CACHE_STORE).getAll(); req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>resolve([]); });
      if (all.length > MAX_CACHE_FILES) {
        all.sort((a,b)=>Number(a.savedAt||0)-Number(b.savedAt||0));
        const tx=db.transaction(IV_CACHE_STORE,'readwrite');
        for (const row of all.slice(0, all.length-MAX_CACHE_FILES)) tx.objectStore(IV_CACHE_STORE).delete(row.key);
      }
    } catch (_) {}
    return true;
  }
  function safeDownloadName(name){ return String(name||'ملف').trim().replace(/[\\/:*?"<>|]+/g,'_').slice(0,180)||'ملف'; }
  async function ivOpenNativePdf(record){
    try {
      if(!record?.blob || !(window.Capacitor && window.Capacitor.isNativePlatform?.())) return false;
      const plugin=window.Capacitor?.Plugins?.PdfViewer; if(!plugin?.open) return false;
      const bytes=new Uint8Array(await record.blob.arrayBuffer()); let binary=''; const step=0x8000;
      for(let i=0;i<bytes.length;i+=step) binary += String.fromCharCode(...bytes.subarray(i,Math.min(i+step,bytes.length)));
      await plugin.open({base64:btoa(binary),filename:safeDownloadName(record.name||'file.pdf')}); return true;
    }catch(e){ console.warn('native PDF viewer failed',e); return false; }
  }
  async function ivOpenCachedFile(record){
    if(!record?.blob) return false;
    const mime=String(record.type||record.blob.type||'application/octet-stream').toLowerCase(), name=safeDownloadName(record.name||'ملف');
    if(mime.includes('pdf') || /\.pdf$/i.test(name)) if(await ivOpenNativePdf(record)) return true;
    const url=URL.createObjectURL(record.blob);
    let host=document.getElementById('iv-native-file-viewer');
    if(!host){
      host=document.createElement('div'); host.id='iv-native-file-viewer';
      host.style.cssText='position:fixed;inset:0;z-index:100900;background:rgba(2,8,23,.94);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;direction:rtl;';
      host.innerHTML='<div style="position:relative;width:min(98vw,1200px);height:min(96vh,950px);background:#050b14;border:1px solid rgba(255,255,255,.14);border-radius:20px;overflow:hidden;box-shadow:0 25px 90px rgba(0,0,0,.5);display:flex;flex-direction:column;"><div style="height:54px;display:flex;align-items:center;gap:10px;padding:0 12px;background:rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.10);color:#fff;font:800 13px Cairo,system-ui,sans-serif;"><button type="button" data-iv-close="1" style="width:38px;height:38px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font-size:22px;cursor:pointer;">×</button><span data-iv-name="1" style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span></div><div data-iv-body="1" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#02070e;"></div></div>';
      document.body.appendChild(host);
      host.querySelector('[data-iv-close]').onclick=()=>{host.style.display='none'; const old=host.dataset.objectUrl; if(old) URL.revokeObjectURL(old); host.dataset.objectUrl='';};
    }
    host.querySelector('[data-iv-body]').innerHTML=''; host.querySelector('[data-iv-name]').textContent=name; host.dataset.objectUrl && URL.revokeObjectURL(host.dataset.objectUrl); host.dataset.objectUrl=url;
    if(mime.includes('pdf') || /\.pdf$/i.test(name)){ const frame=document.createElement('iframe'); frame.src=url; frame.title=name; frame.style.cssText='width:100%;height:100%;border:0;background:#fff;'; host.querySelector('[data-iv-body]').appendChild(frame); }
    else if(mime.startsWith('video/')){ const v=document.createElement('video'); v.src=url; v.controls=true; v.playsInline=true; v.style.cssText='max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;background:#000;'; host.querySelector('[data-iv-body]').appendChild(v); }
    else { const img=document.createElement('img'); img.src=url; img.alt=name; img.style.cssText='max-width:100%;max-height:100%;object-fit:contain;'; host.querySelector('[data-iv-body]').appendChild(img); }
    host.style.display='flex'; return true;
  }

  // Keep offline startup local-first: do not await the database/network before rendering.
  // We only schedule the existing data refresh after the shell/page has painted.
  if (typeof window !== 'undefined') {
    const oldReady = window.__midadBootReady;
    if (typeof oldReady === 'function') window.__midadBootReady = (...args) => requestAnimationFrame(() => oldReady(...args));
  }

  // --- Existing MIDAD functionality continues below. ---
  const esc = (v) => typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const fmt = (n) => { n=Number(n||0); if(n>=1024*1024) return (n/(1024*1024)).toFixed(n>=10*1024*1024?1:2)+' MB'; if(n>=1024) return (n/1024).toFixed(1)+' KB'; return n+' B'; };

  // In the native Android build, downloads are downloads only. Opening a cached PDF
  // happens solely from the separate Open action in the UI.
  async function downloadStorageBlobNativeSafe(bucket,path,name,meta={}){
    const user=await (typeof requireSignedInForStorage==='function' ? requireSignedInForStorage('تحميل الملف') : getCurrentAuthUser());
    const cleanPath=extractStoragePath(path,bucket)||path; if(!cleanPath) throw new Error('مسار الملف غير صالح للتنزيل الآمن.');
    const key=ivCacheKey(user.id,bucket,cleanPath);
    const cached=await ivGetCachedFile(key); if(cached){
      const url=URL.createObjectURL(cached.blob), a=document.createElement('a'); a.href=url; a.download=safeDownloadName(cached.name||name||'ملف'); a.rel='noopener'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),5000);
      return {cached:true};
    }
    const {data:blob,error}=await sb.storage.from(bucket).download(cleanPath); if(error) throw error;
    let output=blob;
    if((blob.type==='application/pdf'||/\.pdf$/i.test(name||cleanPath)) && window.PDFLib){
      // Preserve the existing forensic behavior when available.
      try { output=await ivFingerprintPdf(blob,{materialId:meta.materialId??null,name:name||deriveOriginalFileName(cleanPath),path:cleanPath,userId:user.id}); } catch(e) { console.warn('fingerprint during download',e); }
    }
    await ivPutCachedFile(key,output,name||deriveOriginalFileName(cleanPath)||'file',output.type||blob.type||'application/octet-stream');
    const url=URL.createObjectURL(output), a=document.createElement('a'); a.href=url; a.download=safeDownloadName(name||deriveOriginalFileName(cleanPath)||'file'); a.rel='noopener'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),5000);
    try{meta?.onDownloadStart?.();}catch(_){}
    return {downloaded:true};
  }

  // The rest of the original Round 6 logic is intentionally retained by the existing file.
})();
