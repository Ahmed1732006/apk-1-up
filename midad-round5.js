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

  // Theme-independent welcome-message media presentation.
  // Some theme HTML files still render the old bare <img>/<video>. Wrap those
  // elements after render so every theme gets the same preview card + hint +
  // full-size viewer without changing the theme's own visual design.
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

  // Material-card images live in the private `materials` bucket. The base
  // theme still builds a public URL for those images, so after the database
  // metadata loads we replace each material image with an authenticated
  // blob URL. This keeps the bucket private while making the rectangle
  // thumbnail visible to signed-in users.
  const pendingMaterialImageLoads = new Map();
  const materialImageBlobUrls = new Map();
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
      } catch (e) {
        console.warn('secure material image', cleanPath, e);
      }
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
      } catch (e) {
        console.warn('secure welcome media', e);
      } finally { delete media.dataset.midadSecureLoading; }
    }
  }

  const welcomeMediaObserver = new MutationObserver(() => {
    enhanceWelcomeMessageMedia();
    void secureWelcomeMessageMedia();
  });
  if (document.body) welcomeMediaObserver.observe(document.body,{childList:true,subtree:true});
  else document.addEventListener('DOMContentLoaded',()=>welcomeMediaObserver.observe(document.body,{childList:true,subtree:true}),{once:true});
  enhanceWelcomeMessageMedia();

  // Delegated fallback for old themes whose wrapper is created after
  // attachEvents() has already wired the page.
  document.addEventListener('click',event=>{
    const box=event.target?.closest?.('.welcome-media-box[data-media-url][data-midad-enhanced="1"]');
    if(!box) return;
    event.preventDefault();
    event.stopPropagation();
    if(typeof event.stopImmediatePropagation==='function') event.stopImmediatePropagation();
    if(typeof openModal==='function') openModal('welcome-media',{mediaType:box.dataset.mediaType||'image',mediaUrl:box.dataset.mediaUrl||''});
  },true);

  const esc = (v) => typeof escapeHtml === 'function'
    ? escapeHtml(v)
    : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#039;'}[c]));

  const fmt = (n) => {
    n = Number(n || 0);
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 1 : 2) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  };

  function safeDownloadName(name) {
    return String(name || 'ملف').trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180) || 'ملف';
  }


  // Android APK local-download cache. On the native build we keep downloaded
  // blobs in IndexedDB, so the next press becomes "فتح" and never re-downloads
  // the same user/file pair while the local copy still exists. The normal web
  // site keeps its existing download behaviour unchanged.
  const IV_NATIVE_CACHE = !!(window.Capacitor && window.Capacitor.isNativePlatform?.());
  const IV_CACHE_DB = 'in-the-void-local-files-v1';
  const IV_CACHE_STORE = 'files';
  let ivCacheDbPromise = null;

  function ivOpenCacheDb(){
    if(!IV_NATIVE_CACHE || !window.indexedDB) return Promise.resolve(null);
    if(ivCacheDbPromise) return ivCacheDbPromise;
    ivCacheDbPromise = new Promise((resolve,reject)=>{
      const req=indexedDB.open(IV_CACHE_DB,1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(IV_CACHE_STORE)) db.createObjectStore(IV_CACHE_STORE,{keyPath:'key'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('LOCAL_CACHE_OPEN_FAILED'));
    }).catch(()=>null);
    return ivCacheDbPromise;
  }
  function ivCacheKey(userId,bucket,path){
    return [String(userId||''),String(bucket||''),String(path||'')].join('|');
  }
  async function ivGetCachedFile(key){
    const db=await ivOpenCacheDb();
    if(!db||!key) return null;
    return await new Promise(resolve=>{
      try{
        const tx=db.transaction(IV_CACHE_STORE,'readonly');
        const req=tx.objectStore(IV_CACHE_STORE).get(key);
        req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>resolve(null);
      }catch(_){ resolve(null); }
    });
  }
  async function ivPutCachedFile(key,blob,name,type){
    const db=await ivOpenCacheDb();
    if(!db||!key||!blob) return false;
    return await new Promise(resolve=>{
      try{
        const tx=db.transaction(IV_CACHE_STORE,'readwrite');
        tx.objectStore(IV_CACHE_STORE).put({key,blob,name:String(name||'ملف'),type:String(type||blob.type||'application/octet-stream'),savedAt:Date.now()});
        tx.oncomplete=()=>resolve(true); tx.onerror=()=>resolve(false); tx.onabort=()=>resolve(false);
      }catch(_){ resolve(false); }
    });
  }
  async function ivOpenNativePdf(record){
    try{
      if(!record?.blob || !(window.Capacitor && window.Capacitor.isNativePlatform?.())) return false;
      const plugin = window.Capacitor?.Plugins?.PdfViewer;
      if(!plugin?.open) return false;
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      let binary=''; const step=0x8000;
      for(let i=0;i<bytes.length;i+=step) binary += String.fromCharCode(...bytes.subarray(i,Math.min(i+step,bytes.length)));
      await plugin.open({base64:btoa(binary), filename:safeDownloadName(record.name||'file.pdf')});
      return true;
    }catch(e){ console.warn('native PDF viewer failed',e); return false; }
  }

  async function ivOpenCachedFile(record){
    if(!record?.blob) return false;
    const mime=String(record.type||record.blob.type||'application/octet-stream').toLowerCase();
    const name=safeDownloadName(record.name||'ملف');
    if(mime.includes('pdf') || /\.pdf$/i.test(name)){
      const opened=await ivOpenNativePdf(record);
      if(opened) return true;
    }
    const url=URL.createObjectURL(record.blob);
    let host=document.getElementById('iv-native-file-viewer');
    if(!host){
      host=document.createElement('div'); host.id='iv-native-file-viewer';
      host.style.cssText='position:fixed;inset:0;z-index:100900;background:rgba(2,8,23,.94);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;direction:rtl;';
      host.innerHTML='<div style="position:relative;width:min(98vw,1200px);height:min(96vh,950px);background:#050b14;border:1px solid rgba(255,255,255,.14);border-radius:20px;overflow:hidden;box-shadow:0 25px 90px rgba(0,0,0,.5);display:flex;flex-direction:column;"><div style="height:54px;display:flex;align-items:center;gap:10px;padding:0 12px;background:rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.10);color:#fff;font:800 13px Cairo,system-ui,sans-serif;"><button type="button" data-iv-close="1" style="width:38px;height:38px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font-size:22px;cursor:pointer;">×</button><span data-iv-name="1" style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span></div><div data-iv-body="1" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#02070e;"></div></div>';
      document.body.appendChild(host);
      host.querySelector('[data-iv-close]').onclick=()=>{host.style.display='none'; const old=host.dataset.objectUrl; if(old) URL.revokeObjectURL(old); host.dataset.objectUrl='';};
    }
    const body=host.querySelector('[data-iv-body]');
    const title=host.querySelector('[data-iv-name]');
    body.innerHTML=''; title.textContent=name;
    if(mime.includes('pdf') || /\.pdf$/i.test(name)){
      const frame=document.createElement('iframe'); frame.src=url; frame.title=name; frame.style.cssText='width:100%;height:100%;border:0;background:#fff;'; body.appendChild(frame);
    }else if(mime.startsWith('video/')){
      const v=document.createElement('video'); v.src=url; v.controls=true; v.playsInline=true; v.style.cssText='max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;background:#000;'; body.appendChild(v);
    }else if(mime.startsWith('image/')){
      const img=document.createElement('img'); img.src=url; img.alt=name; img.style.cssText='max-width:100%;max-height:100%;object-fit:contain;'; body.appendChild(img);
    }else{
      const a=document.createElement('a'); a.href=url; a.target='_blank'; a.rel='noopener'; a.textContent='فتح الملف'; a.style.cssText='color:#fff;padding:14px 20px;border-radius:14px;background:#2563eb;text-decoration:none;font:800 15px Cairo,system-ui,sans-serif;'; body.appendChild(a);
    }
    const previous=host.dataset.objectUrl; if(previous) URL.revokeObjectURL(previous); host.dataset.objectUrl=url; host.style.display='flex';
    return true;
  }
  async function ivIsFileCached(userId,bucket,path){
    if(!IV_NATIVE_CACHE) return null;
    const row=await ivGetCachedFile(ivCacheKey(userId,bucket,path));
    return row||null;
  }

  function deriveOriginalFileName(path) {
    if (!path) return '';
    const raw = decodeURIComponent(String(path).split('?')[0].split('/').pop() || '');
    const withName = raw.replace(/^[0-9a-f]{32}_/i, '');
    if (withName !== raw) return withName;
    // Old material objects were saved as UUID.ext without the original name.
    if (/^[0-9a-f-]{36}\.[a-z0-9]{1,12}$/i.test(raw)) return '';
    return raw;
  }

  async function requireSignedInForStorage(action='تحميل الملف') {
    const user = await getCurrentAuthUser();
    if (!user?.id) throw new Error(`يجب تسجيل الدخول أولًا لإتمام ${action}.`);
    return user;
  }

  // In-The-Void PDF forensic layer. The visible PDF is unchanged; the marker is
  // embedded as tiny/off-page text on every page and the exact final-byte hash is
  // registered server-side. Existing markers are preserved when a fingerprinted
  // PDF is uploaded back through the platform.
  const IV_PDF_FP_PREFIX = 'IVFP2:';
  const IV_PDF_MAX_PARENT_MARKERS = 64;

  function ivUtf8ToB64(value) {
    const bytes = new TextEncoder().encode(String(value));
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/=+$/,'');
  }
  function ivB64ToUtf8(value) {
    try {
      const token = String(value).replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(value).length/4)*4,'=');
      const bin = atob(token);
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch (_) { return ''; }
  }
  async function ivSha256Hex(buffer) {
    const h = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2,'0')).join('');
  }
  async function ivExtractMarkers(buffer) {
    try {
      if (window.InTheVoidPDFFingerprint?.extract) {
        const rows = await window.InTheVoidPDFFingerprint.extract(buffer);
        return (Array.isArray(rows) ? rows : []).slice(0, IV_PDF_MAX_PARENT_MARKERS);
      }
      const bytes = new Uint8Array(buffer);
      let raw = ''; const step = 0x8000;
      for (let i=0;i<bytes.length;i+=step) raw += new TextDecoder('latin1').decode(bytes.subarray(i,Math.min(i+step,bytes.length)));
      const out = [];
      const re = /IVFP2:([A-Za-z0-9+\/_=-]+)/g; let m;
      while ((m=re.exec(raw)) && out.length < IV_PDF_MAX_PARENT_MARKERS) {
        const decoded = ivB64ToUtf8(m[1]);
        if (!decoded) continue;
        try { const obj=JSON.parse(decoded); if (obj && obj.f) out.push(obj); } catch (_) {}
      }
      const seen = new Set();
      return out.filter(x => !seen.has(x.f) && seen.add(x.f));
    } catch (_) { return []; }
  }
  function ivRoleLabel(role) {
    return (role === 'admin' || role === 'super_admin') ? 'أدمن ذهبي' : (role === 'moderator' ? 'مشرف' : 'عضو');
  }
  function ivCairoParts(ts) {
    const d = new Date(ts);
    const fmt = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    const parts=Object.fromEntries(fmt.formatToParts(d).map(x=>[x.type,x.value]));
    const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',weekday:'long'}).format(d);
    const dayMap={Sunday:'الأحد',Monday:'الاثنين',Tuesday:'الثلاثاء',Wednesday:'الأربعاء',Thursday:'الخميس',Friday:'الجمعة',Saturday:'السبت'};
    return { date:`${parts.year}-${parts.month}-${parts.day}`, time:`${parts.hour}:${parts.minute}:${parts.second}`, day:dayMap[weekday] || weekday };
  }
  async function ivGetPdfBytes(blob) {
    if (blob.type !== 'application/pdf' && !/\.pdf$/i.test(blob.name || '')) return null;
    return await blob.arrayBuffer();
  }
  async function ivFingerprintPdf(blob, meta) {
    if (!window.PDFLib) throw new Error('مكتبة معالجة PDF غير متاحة.');
    const input = await blob.arrayBuffer();
    const parents = await ivExtractMarkers(input);
    const ts = new Date().toISOString();
    const parts = ivCairoParts(ts);
    const fpRow = await sb.rpc('midad_register_pdf_download', {
      p_material_id: meta.materialId ?? null,
      p_file_name: meta.name || null,
      p_source_path: meta.path || null,
      p_parent_fingerprints: parents.map(x=>x.f).slice(0,IV_PDF_MAX_PARENT_MARKERS),
      p_parent_count: parents.length
    });
    if (fpRow.error) throw fpRow.error;
    const rec = fpRow.data;
    const payload = { v:2, f:rec.fingerprint, u:rec.user_id, n:rec.user_name, r:rec.role_label || ivRoleLabel(rec.role), d:rec.download_date || parts.date, t:rec.download_time || parts.time, w:rec.download_day || parts.day, p:parents.map(x=>x.f).slice(0,IV_PDF_MAX_PARENT_MARKERS) };
    const marker = IV_PDF_FP_PREFIX + ivUtf8ToB64(JSON.stringify(payload));
    const pdf = await window.PDFLib.PDFDocument.load(input, { updateMetadata:false, ignoreEncryption:false });
    const font = await pdf.embedFont(window.PDFLib.StandardFonts.Helvetica);
    for (const page of pdf.getPages()) {
      // Tiny, white, off-canvas markers. Multiple copies per page provide redundancy
      // while remaining visually absent in normal viewing/printing.
      const { width, height } = page.getSize();
      const positions = [[-180,-180],[-420,height+40],[width+40,-420],[width+20,height+20]];
      for (const [x,y] of positions) page.drawText(marker,{x,y,size:0.01,font,color:window.PDFLib.rgb(1,1,1),opacity:0});
    }
    // A neutral, non-identifying internal producer value is deliberately omitted.
    const output = await pdf.save({ useObjectStreams:true, addDefaultPage:false });
    const finalHash = await ivSha256Hex(output);
    const downloadId = rec?.download_id || rec?.id;
    if (!downloadId) throw new Error('DOWNLOAD_ID_MISSING');
    const confirm = await sb.rpc('midad_finalize_pdf_download', { p_download_id: downloadId, p_final_sha256: finalHash, p_parent_fingerprints: parents.map(x=>x.f).slice(0,IV_PDF_MAX_PARENT_MARKERS) });
    if (confirm.error) throw confirm.error;
    return new Blob([output],{type:'application/pdf'});
  }

  const IV_PREP_POLL_MS = 2000;
  const IV_PREP_MAX_WAIT_MS = 30 * 60 * 1000;
  const ivPrepWaiters = new Map();

  function ivUpdatePrepStatus(message, type='info') {
    try { showToast(message, type); } catch (_) {}
    let el = document.getElementById('midad-pdf-prep-download-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'midad-pdf-prep-download-status';
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;min-width:min(360px,calc(100vw - 32px));max-width:calc(100vw - 32px);padding:12px 14px;border-radius:14px;background:rgba(20,20,24,.94);color:#fff;box-shadow:0 10px 35px rgba(0,0,0,.28);font:600 14px/1.45 system-ui,sans-serif;text-align:center;direction:rtl;backdrop-filter:blur(10px);';
      document.body.appendChild(el);
    }
    el.textContent = String(message || '');
    el.dataset.type = type;
    el.style.display = 'block';
    clearTimeout(el._hideTimer);
    if (type === 'success' || type === 'error') {
      el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
    }
  }

  async function ivGetPreparedRow(materialId, userId) {
    if (!materialId || !userId) return null;
    const { data, error } = await sb.from('iv_pdf_prepared_files')
      .select('id,status,progress,prepared_path,file_name,fingerprint,source_path,updated_at')
      .eq('material_id', Number(materialId))
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function ivWaitForPreparedPdf(materialId, userId, sourcePath) {
    const key = `${userId}:${Number(materialId)}`;
    if (ivPrepWaiters.has(key)) return ivPrepWaiters.get(key);

    const promise = (async () => {
      const started = Date.now();
      let lastProgress = -1;
      while (Date.now() - started < IV_PREP_MAX_WAIT_MS) {
        const row = await ivGetPreparedRow(materialId, userId);
        const progress = Math.max(0, Math.min(100, Number(row?.progress || 0)));
        const status = String(row?.status || 'pending');

        if (status === 'ready' && progress >= 100 && row?.prepared_path && (!row.source_path || row.source_path === sourcePath)) {
          ivUpdatePrepStatus('الملف جاهز — جارٍ بدء التحميل…', 'success');
          return row;
        }

        if (status === 'error') {
          throw new Error(row?.error_message || 'تعذر تجهيز نسخة PDF الجاهزة.');
        }

        if (progress !== lastProgress) {
          lastProgress = progress;
          ivUpdatePrepStatus(`جاري تجهيز الملف… ${progress}%`, 'info');
        }
        await new Promise(resolve => setTimeout(resolve, IV_PREP_POLL_MS));
      }
      throw new Error('تجهيز الملف استغرق وقتًا أطول من المتوقع. جرّب التحميل مرة أخرى بعد قليل.');
    })();

    ivPrepWaiters.set(key, promise);
    try { return await promise; } finally { ivPrepWaiters.delete(key); }
  }

  function ivOfflineDownloadNotice(err){
    const msg=String(err?.message||err||'').toLowerCase();
    const offline=(typeof navigator!=='undefined'&&navigator.onLine===false)||/network|fetch|load failed|networkerror|offline|timeout|connection/.test(msg);
    if(offline){ showToast('لا يوجد اتصال بالإنترنت — هذا المحتوى غير محفوظ على الجهاز.','info'); return true; }
    return false;
  }

  async function ivDownloadPreparedMaterial(materialId, sourcePath, name, user, meta={}) {
    const cacheKey = ivCacheKey(user.id, 'prepared-pdfs', sourcePath);
    const cached = await ivIsFileCached(user.id, 'prepared-pdfs', sourcePath);
    if (cached) {
      await ivOpenCachedFile(cached);
      return {cached:true};
    }
    let row = await ivGetPreparedRow(materialId, user.id);
    const sameSource = row && (!row.source_path || row.source_path === sourcePath);
    if (!(sameSource && row.status === 'ready' && Number(row.progress) >= 100 && row.prepared_path)) {
      ivUpdatePrepStatus(`جاري تجهيز الملف… ${Math.max(0, Math.min(100, Number(row?.progress || 0)))}%`, 'info');
      row = await ivWaitForPreparedPdf(materialId, user.id, sourcePath);
    }

    const { data: blob, error } = await sb.storage.from('prepared-pdfs').download(row.prepared_path);
    if (error) throw error;
    await ivPutCachedFile(cacheKey, blob, name || row.file_name || 'file.pdf', blob.type || 'application/pdf');

    // The prepared copy already contains its forensic marker. Do NOT run
    // pdf-lib again in the browser; that was the old slow path.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeDownloadName(name || row.file_name || deriveOriginalFileName(sourcePath) || 'file.pdf');
    a.rel = 'noopener';
    document.body.appendChild(a);

    // The browser starts the actual download only when the anchor is clicked.
    // Complete the visual animation at that exact hand-off point, not on a timer.
    try { meta?.onDownloadStart?.(); } catch (_) {}
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    // Best-effort notification only. The forensic copy was already registered
    // during preparation, so a failure here must never block the download.
    try {
      if (row.fingerprint) {
        await sb.rpc('midad_mark_prepared_pdf_download', { p_prepared_id: row.id });
      }
    } catch (e) { console.warn('prepared PDF download mark', e); }
    ivUpdatePrepStatus('تم بدء تحميل النسخة الجاهزة بالبصمة.', 'success');
  }

  async function downloadStorageBlob(bucket, path, name, meta={}) {
    const user = await requireSignedInForStorage('تحميل الملف');
    const cleanPath = extractStoragePath(path, bucket) || path;
    if (!cleanPath || /^https?:\/\//i.test(cleanPath)) throw new Error('مسار الملف غير صالح للتنزيل الآمن.');

    // Material PDFs use the pre-generated server-side copy. Other downloads
    // keep the original behavior, so member-upload ZIPs and non-PDF assets are
    // untouched.
    if (bucket === 'materials' && meta.materialId && /\.pdf$/i.test(name || cleanPath)) {
      return ivDownloadPreparedMaterial(Number(meta.materialId), cleanPath, name, user, meta);
    }

    const cacheKey = ivCacheKey(user.id, bucket, cleanPath);
    const cached = await ivIsFileCached(user.id, bucket, cleanPath);
    if (cached) {
      await ivOpenCachedFile(cached);
      return {cached:true};
    }

    const { data: blob, error } = await sb.storage.from(bucket).download(cleanPath);
    if (error) throw error;
    let output = blob;
    if ((blob.type === 'application/pdf' || /\.pdf$/i.test(name || cleanPath)) && window.PDFLib) {
      output = await ivFingerprintPdf(blob, {materialId:meta.materialId ?? null, name:name || deriveOriginalFileName(cleanPath), path:cleanPath, userId:user.id});
    }
    await ivPutCachedFile(cacheKey, output, name || deriveOriginalFileName(cleanPath) || 'file', output.type || blob.type || 'application/octet-stream');
    if((output.type === 'application/pdf' || /\.pdf$/i.test(name || cleanPath)) && IV_NATIVE_CACHE){
      const opened=await ivOpenNativePdf({blob:output,name:name || deriveOriginalFileName(cleanPath) || 'file.pdf',type:'application/pdf'});
      if(opened){ try{ meta?.onDownloadStart?.(); }catch(_){} return {opened:true}; }
    }
    const url = URL.createObjectURL(output);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeDownloadName(name || deriveOriginalFileName(cleanPath) || 'file');
    a.rel = 'noopener';
    document.body.appendChild(a);

    // Complete only when the real browser download is handed off.
    try { meta?.onDownloadStart?.(); } catch (_) {}
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }


  const originalUploadFile = uploadFile;
  uploadFile = async function(bucket, file, folder='uploads') {
    if (!(file instanceof File)) return originalUploadFile(bucket, file, folder);

    // Material files and material-card images both live in the `materials`
    // bucket. Force BOTH paths through an ASCII-only key generator. Some themes
    // were still sending the original Arabic image filename to Storage, which
    // causes `Storage: Invalid key` on the rectangle image upload only.
    const isMaterialAsset = bucket === 'materials' && (String(folder) === 'files' || String(folder) === 'images');
    if (!isMaterialAsset) return originalUploadFile(bucket, file, folder);

    const folderName = String(folder) === 'images' ? 'images' : 'files';
    const originalName = String(file.name || (folderName === 'images' ? 'image' : 'file'));
    const extMatch = originalName.match(/\.([A-Za-z0-9]{1,12})$/);
    const ext = (extMatch?.[1] || (folderName === 'images' ? 'bin' : 'bin')).toLowerCase();
    const storedName = `${crypto.randomUUID()}.${ext}`;
    const path = `${folderName}/${storedName}`;

    const { error } = await sb.storage.from(bucket).upload(path, file, {
      upsert:false,
      cacheControl:'3600',
      contentType:file.type || (folderName === 'images' ? 'application/octet-stream' : 'application/octet-stream')
    });
    if (error) throw new Error(`فشل رفع الملف إلى Storage: ${error.message}`);
    return path;
  };

  const authUid = () => currentAuthUser?.id || state.user?.id || null;
  const itemById = (id) => {
    for (const s of (state.sections || [])) for (const sub of (s.subs || [])) {
      const it = (sub.items || []).find(x => String(x.id) === String(id));
      if (it) return it;
    }
    return null;
  };
  const userById = (id) => (state.users || []).find(u => String(u.id) === String(id));
  const isExpired = (obj) => !!obj?.expiresAt && new Date(obj.expiresAt).getTime() <= Date.now();

  function pad2(n) { return String(n).padStart(2, '0'); }

  // datetime-local must be LOCAL, never UTC. toISOString().slice(0,16) was
  // shifting the saved duration by the timezone offset on every open/save.
  function toDatetimeLocalValue(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function fromDatetimeLocalValue(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

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

  function ensureRawPaths() {
    for (const s of (state.sections || [])) {
      if (!s.imagePathRaw) s.imagePathRaw = extractStoragePath(s.image, 'categories');
      for (const sub of (s.subs || [])) {
        if (!sub.imagePathRaw) sub.imagePathRaw = extractStoragePath(sub.image, 'subcategories');
        for (const it of (sub.items || [])) {
          if (!it.imagePathRaw) it.imagePathRaw = extractStoragePath(it.image, 'materials');
          if (!it.filePathRaw) it.filePathRaw = it.filePath || extractStoragePath(it.fileData, 'materials') || null;
        }
      }
    }
  }

  injectRound6Styles();

  // ---------------------------------------------------------------------------
  // Load/normalize backend fields
  // ---------------------------------------------------------------------------
  async function loadRound5Data() {
    try {
      const ids = [];
      for (const s of (state.sections || [])) for (const sub of (s.subs || [])) for (const it of (sub.items || [])) ids.push(it.dbId || it.id);
      if (ids.length) {
        const { data, error } = await sb.from('materials').select('id,image_path,file_path,upload_enabled,expires_at,show_expiry_to_members').in('id', ids);
        if (!error) {
          const map = new Map((data || []).map(r => [String(r.id), r]));
          for (const s of (state.sections || [])) for (const sub of (s.subs || [])) for (const it of (sub.items || [])) {
            const r = map.get(String(it.dbId || it.id));
            if (!r) continue;
            it.imagePathRaw = r.image_path || it.imagePathRaw || null;
            it.filePathRaw = r.file_path || it.filePathRaw || null;
            it.fileName = deriveOriginalFileName(r.file_path) || it.fileName || null;
            it.uploadEnabled = !!r.upload_enabled;
            it.expiresAt = r.expires_at || null;
            it.showExpiryToMembers = r.show_expiry_to_members !== false;
          }
        }
      }
      const top = await sb.from('categories').select('id,image_path,expires_at,show_expiry_to_members').in('id', (state.sections || []).map(s => s.dbId || s.id));
      if (!top.error) (state.sections || []).forEach(s => {
        const r = (top.data || []).find(x => String(x.id) === String(s.dbId || s.id));
        if (r) {
          s.imagePathRaw = r.image_path || s.imagePathRaw || null;
          s.expiresAt = r.expires_at || null;
          s.showExpiryToMembers = r.show_expiry_to_members !== false;
        }
      });
      const subIds = [];
      for (const s of (state.sections || [])) for (const sub of (s.subs || [])) subIds.push(sub.dbId || sub.id);
      if (subIds.length) {
        const sr = await sb.from('subcategories').select('id,image_path,expires_at,show_expiry_to_members').in('id', subIds);
        if (!sr.error) for (const s of (state.sections || [])) for (const sub of (s.subs || [])) {
          const r = (sr.data || []).find(x => String(x.id) === String(sub.dbId || sub.id));
          if (r) {
            sub.imagePathRaw = r.image_path || sub.imagePathRaw || null;
            sub.expiresAt = r.expires_at || null;
            sub.showExpiryToMembers = r.show_expiry_to_members !== false;
          }
        }
      }
    } catch (e) { console.warn('round6 metadata load', e); }
    ensureRawPaths();
    // `materials` is private for member-only access, so material card images
    // must be hydrated through the authenticated Storage API too.
    await secureMaterialImages();
    if (isAdmin()) { await loadMemberUploadData(); await loadWelcomeMessageViews(); }
    else await loadMemberOwnUploadStatus();
  }

  async function loadMemberOwnUploadStatus() {
    state.memberUploadOwn = state.memberUploadOwn || {};
    const items = [];
    for (const s of (state.sections || [])) for (const sub of (s.subs || [])) for (const it of (sub.items || [])) if (it.uploadEnabled) items.push(it);
    await Promise.all(items.map(async it => {
      try {
        const r = await sb.rpc('member_upload_status', { p_material_id: Number(it.dbId || it.id) });
        state.memberUploadOwn[String(it.dbId || it.id)] = !!r.data?.already_uploaded;
      } catch (_) {}
    }));
  }

  async function loadWelcomeMessageViews() {
    if (!isAdmin()) return;
    try {
      const r = await sb.from('midad_welcome_message_views').select('message_id,user_id,viewed_at').order('viewed_at', { ascending: false });
      state.welcomeMessageViews = r.error ? [] : (r.data || []);
    } catch (_) { state.welcomeMessageViews = []; }
  }

  async function loadMemberUploadData() {
    if (!isAdmin()) return;
    try {
      const b = await sb.from('member_upload_batches').select('*').order('created_at', { ascending: false });
      if (b.error) throw b.error;
      const f = await sb.from('member_upload_files').select('*').order('created_at', { ascending: true });
      if (f.error) throw f.error;
      state.memberUploadBatches = b.data || [];
      state.memberUploadFiles = f.data || [];
    } catch (e) {
      state.memberUploadBatches = [];
      state.memberUploadFiles = [];
      console.warn('round6 uploads load', e);
    }
  }

  function filterExpiredForMembers() {
    if (isAdmin()) return;
    state.sections = (state.sections || []).filter(s => !isExpired(s)).map(s => ({
      ...s,
      subs: (s.subs || []).filter(sub => !isExpired(sub)).map(sub => ({
        ...sub,
        items: (sub.items || []).filter(it => !isExpired(it))
      }))
    }));
  }

  // ---------------------------------------------------------------------------
  // Member upload UI — files live on state.modal so re-renders don't lose them.
  // Click is bound via capture-phase delegation (the previous data-act buttons
  // were injected AFTER attachEvents, so they never received a listener).
  // ---------------------------------------------------------------------------
  function renderUploadModal() {
    const m = state.modal || {};
    if (m.step === 'already') {
      return `<div class="overlay midad-upload-overlay" data-act="close-modal-overlay">
        <div class="modal midad-upload-modal midad-upload-done-modal" data-stop="1">
          <div class="midad-already-hero"><i class="fas fa-circle-check"></i></div>
          <h3>تم الرفع بالفعل</h3>
          <p>أنت استخدمت عملية الرفع الوحيدة المتاحة لك داخل هذا المستطيل. لا يمكن رفع ملفات أخرى من هنا.</p>
          <div class="midad-upload-actions"><button class="btn-save" data-act="close-modal" type="button">حسنًا</button></div>
        </div>
      </div>`;
    }
    if (m.step === 'confirm') {
      const files = m.files || [];
      const used = files.reduce((n, f) => n + Number(f.size || 0), 0);
      return `<div class="overlay midad-upload-overlay" data-act="close-modal-overlay">
        <div class="modal midad-upload-modal" data-stop="1">
          <div class="midad-upload-head"><div class="midad-upload-icon warn"><i class="fas fa-triangle-exclamation"></i></div><div><h3>تأكيد الرفع</h3><p>اقرأ التنبيه كويس قبل ما تبعت.</p></div><button type="button" class="midad-upload-x" data-act="close-modal">×</button></div>
          <div class="midad-once-warning">
            <i class="fas fa-ban"></i>
            <div>
              <strong>عملية رفع واحدة فقط داخل هذا المستطيل.</strong>
              <span>لو أكدت دلوقتي، مش هتقدر ترفع مرة تانية من نفس المستطيل — لا ملف ولا صورة. الاسم: <b>${esc(m.displayName || '')}</b> · الملفات: <b>${files.length}</b> · الحجم: <b>${fmt(used)}</b></span>
            </div>
          </div>
          <div class="midad-upload-files-list">${files.map(f => `<div class="midad-file-row"><i class="fas fa-file"></i><span>${esc(f.name)}</span><b>${fmt(f.size)}</b></div>`).join('')}</div>
          <div class="midad-upload-actions">
            <button class="btn-save" id="midad-upload-confirm" type="button">تأكيد الرفع</button>
            <button class="btn-cancel" id="midad-upload-back" type="button">رجوع</button>
          </div>
        </div>
      </div>`;
    }
    const files = m.files || [];
    const used = files.reduce((n, f) => n + Number(f.size || 0), 0);
    const over = used > MAX_UPLOAD_BYTES;
    return `<div class="overlay midad-upload-overlay" data-act="close-modal-overlay">
      <div class="modal midad-upload-modal" data-stop="1">
        <div class="midad-upload-head"><div class="midad-upload-icon"><i class="fas fa-cloud-arrow-up"></i></div><div><h3>رفع الملفات</h3><p>اكتب اسمك، اختار الملفات، وبعدين أكّد. العملية مرة واحدة فقط.</p></div><button type="button" class="midad-upload-x" data-act="close-modal">×</button></div>
        <div class="midad-upload-note"><i class="fas fa-circle-info"></i><span>تقدر تختار أكثر من ملف في نفس العملية (صور، PDF، Word، Excel، PowerPoint وأي نوع)، بإجمالي أقصى <b>50 MB</b>.</span></div>
        <div class="field"><label>اسمك <span class="midad-req">*</span></label><input id="midad-upload-name" type="text" maxlength="120" value="${esc(m.displayName || state.user?.name || '')}" placeholder="اكتب اسمك" required></div>
        <div class="midad-dropzone" id="midad-upload-dropzone">
          <input id="midad-upload-files" type="file" multiple>
          <div class="midad-drop-icon"><i class="fas fa-file-circle-plus"></i></div>
          <strong>اختار الملفات</strong>
          <span>اضغط هنا أو اسحب الملفات إلى هنا</span>
          <small>يمكنك اختيار عدة ملفات معًا</small>
        </div>
        <div id="midad-upload-files-list" class="midad-upload-files-list">${renderFilesHtml(files, used)}</div>
        <div class="midad-upload-meter">
          <div class="midad-upload-meter-top"><span>الحجم المستخدم</span><strong id="midad-upload-used">${fmt(used)} / 50 MB</strong><span id="midad-upload-left">المتبقي ${fmt(Math.max(0, MAX_UPLOAD_BYTES - used))}</span></div>
          <div class="midad-progress"><i id="midad-upload-progress" style="width:${Math.min(100, used / MAX_UPLOAD_BYTES * 100)}%"></i></div>
        </div>
        <div class="midad-upload-actions">
          <button class="btn-save" id="midad-upload-submit" type="button" ${(!files.length || over) ? 'disabled' : ''}>متابعة إلى التأكيد</button>
          <button class="btn-cancel" data-act="close-modal">إلغاء</button>
        </div>
      </div>
    </div>`;
  }

  function renderFilesHtml(files, used) {
    if (used > MAX_UPLOAD_BYTES) {
      return `<div class="midad-upload-error"><i class="fas fa-triangle-exclamation"></i> إجمالي الملفات ${fmt(used)} وتجاوز حد 50 MB. امسح ملفًا بزر ×.</div>` +
        files.map((f, i) => fileRowHtml(f, i)).join('');
    }
    if (!files.length) return '<div class="midad-empty-upload">لم يتم اختيار ملفات بعد.</div>';
    return files.map((f, i) => fileRowHtml(f, i)).join('');
  }
  function fileRowHtml(f, i) {
    return `<div class="midad-file-row"><i class="fas fa-file"></i><span>${esc(f.name)}</span><b>${fmt(f.size)}</b><button type="button" class="midad-file-x" data-remove-upload-index="${i}" aria-label="حذف الملف">×</button></div>`;
  }

  function modalFiles() { return [...((state.modal && state.modal.files) || [])]; }

  function setModalFiles(next) {
    if (!state.modal) return;
    const kept = [];
    let used = 0;
    for (const f of next) {
      if (used + Number(f.size || 0) > MAX_UPLOAD_BYTES) {
        showToast('إجمالي الملفات لا يمكن أن يتجاوز 50 MB.', 'error');
        continue;
      }
      kept.push(f);
      used += Number(f.size || 0);
    }
    state.modal.files = kept;
    state.modal.usedBytes = used;
    refreshUploadList();
  }

  function refreshUploadList() {
    if (!state.modal || state.modal.kind !== 'midad-member-upload') return;
    const files = modalFiles();
    const used = files.reduce((n, f) => n + Number(f.size || 0), 0);
    const list = document.getElementById('midad-upload-files-list');
    const usedEl = document.getElementById('midad-upload-used');
    const leftEl = document.getElementById('midad-upload-left');
    const bar = document.getElementById('midad-upload-progress');
    const btn = document.getElementById('midad-upload-submit');
    if (list) list.innerHTML = renderFilesHtml(files, used);
    if (usedEl) usedEl.textContent = `${fmt(used)} / 50 MB`;
    if (leftEl) leftEl.textContent = `المتبقي ${fmt(Math.max(0, MAX_UPLOAD_BYTES - used))}`;
    if (bar) bar.style.width = `${Math.min(100, used / MAX_UPLOAD_BYTES * 100)}%`;
    if (btn) btn.disabled = !files.length || used > MAX_UPLOAD_BYTES || used <= 0;
    list?.querySelectorAll('[data-remove-upload-index]').forEach(btnEl => {
      btnEl.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const i = Number(btnEl.dataset.removeUploadIndex);
        setModalFiles(modalFiles().filter((_, j) => j !== i));
      });
    });
  }

  function attachUploadModal() {
    const m = state.modal || {};
    if (m.kind !== 'midad-member-upload') return;
    if (m.step === 'confirm') {
      document.getElementById('midad-upload-confirm')?.addEventListener('click', submitMemberUpload);
      document.getElementById('midad-upload-back')?.addEventListener('click', () => {
        if (!state.modal) return;
        state.modal.step = 'form';
        render();
        setTimeout(attachUploadModal, 0);
      });
      return;
    }
    if (m.step === 'already') return;
    const input = document.getElementById('midad-upload-files');
    const zone = document.getElementById('midad-upload-dropzone');
    const nameInput = document.getElementById('midad-upload-name');
    if (nameInput) {
      nameInput.addEventListener('input', () => { if (state.modal) state.modal.displayName = nameInput.value; });
    }
    const addFiles = (list) => {
      const incoming = [...list];
      if (!incoming.length) return;
      const existing = modalFiles();
      const next = [...existing];
      for (const f of incoming) {
        const duplicate = existing.some(x => x.name === f.name && Number(x.size||0) === Number(f.size||0) && Number(x.lastModified||0) === Number(f.lastModified||0));
        if (!duplicate) next.push(f);
      }
      setModalFiles(next);
    };
    if (input) input.addEventListener('change', () => { addFiles(input.files || []); });
    if (zone) {
      zone.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('input')) return;
        input?.click();
      });
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag');
        addFiles(e.dataTransfer?.files || []);
      });
    }
    document.getElementById('midad-upload-submit')?.addEventListener('click', () => {
      const name = (document.getElementById('midad-upload-name')?.value || '').trim();
      const files = modalFiles();
      if (!name) return showToast('اكتب اسمك أولًا. الاسم إجباري.', 'error');
      if (!files.length) return showToast('اختار ملفًا واحدًا على الأقل.', 'error');
      const total = files.reduce((n, f) => n + Number(f.size || 0), 0);
      if (total > MAX_UPLOAD_BYTES) return showToast('إجمالي الملفات لا يمكن أن يتجاوز 50 MB.', 'error');
      if (!state.modal) return;
      state.modal.displayName = name;
      state.modal.step = 'confirm';
      render();
      setTimeout(attachUploadModal, 0);
    });
    refreshUploadList();
  }

  async function submitMemberUpload() {
    const m = state.modal || {};
    const materialId = m.materialId;
    const name = (m.displayName || '').trim();
    const files = modalFiles();
    if (!name) return showToast('اكتب اسمك أولًا.', 'error');
    if (!files.length) return showToast('اختار ملفًا واحدًا على الأقل.', 'error');
    const total = files.reduce((n, f) => n + Number(f.size || 0), 0);
    if (total > MAX_UPLOAD_BYTES) return showToast('إجمالي الملفات لا يمكن أن يتجاوز 50 MB.', 'error');
    const btn = document.getElementById('midad-upload-confirm') || document.getElementById('midad-upload-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري الرفع…'; }
    let batchId = null;
    try {
      const { data, error } = await sb.rpc('begin_member_upload', { p_material_id: Number(materialId), p_display_name: name, p_total_bytes: total });
      if (error) throw error;
      batchId = data;
      const uploaded = [];
    const uploadedPaths = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        // Supabase Storage object keys must stay ASCII-safe here. The previous
        // key included the original filename, so Arabic/non-ASCII filenames
        // could be rejected with: "Invalid key". Keep the real filename in
        // member_upload_files.original_name and use an ASCII-only object key.
        const path = `${materialId}/${authUid()}/${batchId}/${crypto.randomUUID()}_${String(i + 1).padStart(3, '0')}.bin`;
        const up = await sb.storage.from('member-uploads').upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream' });
        if (up.error) throw up.error;
        uploadedPaths.push(path);
        uploaded.push({ original_name: f.name, size_bytes: Number(f.size || 0), content_type: f.type || 'application/octet-stream', object_path: path });
        const p = Math.round(((i + 1) / files.length) * 100);
        const bar = document.getElementById('midad-upload-progress');
        if (bar) bar.style.width = p + '%';
      }
      const fin = await sb.rpc('complete_member_upload', { p_batch_id: batchId, p_files: uploaded });
      if (fin.error) throw fin.error;
      state.memberUploadOwn = state.memberUploadOwn || {};
      state.memberUploadOwn[String(materialId)] = true;
      state.modal = null;
      await loadMemberUploadData();
      await loadMemberOwnUploadStatus();
      render();
      showToast('تم رفع الملفات بنجاح. لا يمكنك الرفع مرة أخرى من هذا المستطيل.', 'success');
    } catch (err) {
      // Finalization can fail after Storage has accepted the objects. Remove
      // only this attempt's files before cancelling the open batch so a retry
      // does not inherit orphaned objects.
      if (uploadedPaths.length) {
        try { await sb.storage.from('member-uploads').remove(uploadedPaths); } catch (_) {}
      }
      if (batchId) { try { await sb.rpc('cancel_member_upload', { p_batch_id: batchId }); } catch (_) {} }
      showToast(err?.message || 'تعذر إتمام الرفع.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'تأكيد الرفع'; }
    }
  }

  async function openMemberUpload(materialId) {
    if (!materialId) return;
    try {
      const { data, error } = await sb.rpc('member_upload_status', { p_material_id: Number(materialId) });
      if (error) return showToast(error.message || 'تعذر التحقق من حالة الرفع.', 'error');
      if (data?.already_uploaded) {
        openModal('midad-member-upload', { materialId: Number(materialId), step: 'already' });
        return;
      }
      if (data?.upload_enabled === false) return showToast('الرفع غير مفعّل لهذا المستطيل.', 'error');
      if (data?.expired) return showToast('انتهت مدة هذا المستطيل.', 'error');
      openModal('midad-member-upload', {
        materialId: Number(materialId),
        displayName: state.user?.name || '',
        usedBytes: 0,
        files: [],
        step: 'form'
      });
      setTimeout(attachUploadModal, 0);
    } catch (err) {
      showToast(err?.message || 'تعذر فتح نافذة الرفع.', 'error');
    }
  }

  if (!window.__midadUploadClickBound) {
    window.__midadUploadClickBound = true;
    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-midad-upload-open],[data-act="midad-upload-open"]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      openMemberUpload(btn.getAttribute('data-material-id') || btn.dataset.materialId);
    }, true);
  }

  // ---------------------------------------------------------------------------
  // openModal: copy expiry + raw image path onto the modal so save can
  // preserve images and show the exact duration the admin previously set.
  // ---------------------------------------------------------------------------
  const originalOpenModal = openModal;
  openModal = function (kind, data = {}) {
    const enrich = (obj, extra) => {
      if (!obj) return extra;
      return {
        ...extra,
        expiresAt: obj.expiresAt || null,
        expiryEnabled: !!obj.expiresAt,
        showExpiryToMembers: obj.showExpiryToMembers !== false,
        imagePathRaw: obj.imagePathRaw || extra.imagePathRaw || null,
        filePathRaw: obj.filePathRaw || extra.filePathRaw || null,
        fileName: obj.fileName || extra.fileName || deriveOriginalFileName(obj.filePathRaw || extra.filePathRaw) || null,
        uploadEnabled: obj.uploadEnabled != null ? !!obj.uploadEnabled : !!extra.uploadEnabled,
        clearImage: false,
        clearFile: false
      };
    };
    if ((kind === 'item' || kind === 'add-item') && data?.targetId) {
      const it = itemById(data.targetId);
      if (it) data = enrich(it, data);
    }
    if ((kind === 'section' || kind === 'add-section') && data?.targetId) {
      const x = typeof findSection === 'function' ? findSection(data.targetId) : null;
      if (x) data = enrich(x, data);
    }
    if ((kind === 'sub' || kind === 'add-sub') && data?.targetId) {
      const x = typeof findSub === 'function' ? findSub(state.currentSectionId, data.targetId) : null;
      if (x) data = enrich(x, data);
    }
    if (kind === 'add-item' || kind === 'add-section' || kind === 'add-sub') {
      data = { expiryEnabled: false, expiresAt: null, showExpiryToMembers: true, uploadEnabled: false, ...data };
    }
    return originalOpenModal(kind, data);
  };

  const originalRenderModal = renderModal;
  renderModal = function () {
    if (state.modal?.kind === 'midad-member-upload') return renderUploadModal();
    if (state.modal?.kind === 'welcome-media') {
      const m = state.modal || {};
      const type = String(m.mediaType || 'image') === 'video' ? 'video' : 'image';
      const url = String(m.mediaUrl || '');
      return `<div class="overlay welcome-media-overlay" data-act="close-modal-overlay">
        <div class="welcome-media-viewer" data-stop="1">
          <button type="button" class="welcome-media-close" data-act="close-modal" aria-label="إغلاق">×</button>
          ${type === 'video' ? `<video class="welcome-media-full" controls autoplay playsinline src="${esc(url)}"></video>` : `<img class="welcome-media-full" src="${esc(url)}" alt="المرفق">`}
        </div>
      </div>`;
    }
    let html = originalRenderModal();
    const m = state.modal || {};
    const expiryVal = toDatetimeLocalValue(m.expiresAt);
    const expiryOn = m.expiryEnabled === true || (!!m.expiresAt && m.expiryEnabled !== false);
    if (m.kind === 'item' || m.kind === 'add-item') {
      const panel = `<div class="midad-content-options">
        <div class="midad-option-card"><div><b><i class="fas fa-cloud-arrow-up"></i> رفع الأعضاء</b><small>عند التفعيل يستطيع كل عضو رفع ملفات مرة واحدة فقط داخل هذا المستطيل.</small></div><label class="midad-switch"><input id="midad-upload-enabled" type="checkbox" ${m.uploadEnabled ? 'checked' : ''}><span></span></label></div>
        <div class="midad-expiry-grid">
          <label class="midad-checkline"><input id="midad-expiry-enabled" type="checkbox" ${expiryOn ? 'checked' : ''}><span>تحديد المدة</span></label>
          <input id="midad-expires-at" type="datetime-local" value="${esc(expiryVal)}" ${expiryOn ? '' : 'disabled'}>
          <label class="midad-checkline"><input id="midad-show-expiry" type="checkbox" ${m.showExpiryToMembers !== false ? 'checked' : ''}><span>إظهار المدة للأعضاء</span></label>
        </div>
        <div class="midad-clear-grid">${m.image && !m.clearImage ? `<button type="button" data-act="midad-clear-image"><i class="fas fa-image"></i> إزالة الصورة الحالية</button>` : ''}${m.fileData && !m.clearFile ? `<button type="button" data-act="midad-clear-file"><i class="fas fa-file-circle-xmark"></i> إزالة الملف الحالي</button>` : ''}</div>
      </div>`;
      html = html.replace(/<div class="content-access-panel">/, panel + '<div class="content-access-panel">');
    }
    if (m.kind === 'section' || m.kind === 'add-section' || m.kind === 'sub' || m.kind === 'add-sub') {
      const panel = `<div class="midad-expiry-panel">
        <label class="midad-checkline"><input id="midad-expiry-enabled" type="checkbox" ${expiryOn ? 'checked' : ''}><span>تحديد المدة</span></label>
        <input id="midad-expires-at" type="datetime-local" value="${esc(expiryVal)}" ${expiryOn ? '' : 'disabled'}>
        <label class="midad-checkline"><input id="midad-show-expiry" type="checkbox" ${m.showExpiryToMembers !== false ? 'checked' : ''}><span>إظهار المدة للأعضاء</span></label>
      </div>`;
      html = html.replace(/<div class="content-access-panel">/, panel + '<div class="content-access-panel">');
    }
    return html;
  };

  // ---------------------------------------------------------------------------
  // saveModal: use m.imageFile (survives re-render). NEVER write image_path
  // unless a new file was uploaded or the admin explicitly cleared it.
  // That was why enabling duration wiped folder images, and why a newly
  // uploaded image said "saved" but never appeared — the round-5 saver read
  // the empty <input type=file> after render() had rebuilt the modal.
  // ---------------------------------------------------------------------------
  const originalSaveModal = saveModal;
  saveModal = async function () {
    const m = state.modal;
    if (!m || !['item', 'add-item', 'section', 'add-section', 'sub', 'add-sub'].includes(m.kind)) {
      return originalSaveModal();
    }
    if (!isAdmin()) return showToast('غير مصرح به', 'error');
    const btn = document.querySelector('[data-act="save-modal"]');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري الحفظ…'; }
    try {
      const name = (document.getElementById('modal-name')?.value || '').trim();
      if ((m.kind === 'section' || m.kind === 'add-section' || m.kind === 'sub' || m.kind === 'add-sub') && !name) {
        throw new Error('اكتب الاسم أولًا.');
      }
      m.name = name;

      const expiryEnabled = document.getElementById('midad-expiry-enabled')?.checked || false;
      const expiryRaw = document.getElementById('midad-expires-at')?.value || '';
      const expiresAt = expiryEnabled ? fromDatetimeLocalValue(expiryRaw) : null;
      if (expiryEnabled && !expiresAt) throw new Error('حدد تاريخ ووقت انتهاء صحيحين.');
      const showExpiry = document.getElementById('midad-show-expiry')?.checked !== false;
      const uploadEnabled = !!document.getElementById('midad-upload-enabled')?.checked;
      const visibilityMode = document.getElementById('content-visibility')?.value || m.visibilityMode || 'all';
      const allowed = [...(document.getElementById('content-allow-users')?.selectedOptions || [])].map(o => o.value);
      const denied = [...(document.getElementById('content-deny-users')?.selectedOptions || [])].map(o => o.value);
      const ownerId = (await getCurrentAuthUser()).id;
      const textBold = m.textBold !== false;
      const textColor = m.textColor || '#111827';

      const imageBucket = (m.kind === 'item' || m.kind === 'add-item') ? 'materials' : (String(m.kind).includes('sub') ? 'subcategories' : 'categories');
      const imageFile = m.imageFile instanceof File ? m.imageFile : null;
      const fileFile = m.fileFile instanceof File ? m.fileFile : null;
      let newImagePath = null;
      let newFilePath = null;
      if (imageFile) newImagePath = await uploadFile(imageBucket, imageFile, 'images');
      if (fileFile) newFilePath = await uploadFile('materials', fileFile, 'files');

      const saveAccess = async (table, col, id) => {
        await sb.from(table).delete().eq(col, id);
        const rows = [
          ...allowed.filter(x => x !== ownerId).map(user_id => ({ [col]: id, user_id, access_type: 'allow' })),
          ...denied.filter(x => x !== ownerId).map(user_id => ({ [col]: id, user_id, access_type: 'deny' }))
        ];
        if (rows.length) {
          const r = await sb.from(table).insert(rows);
          if (r.error) throw r.error;
        }
      };

      const extra = { expires_at: expiresAt, show_expiry_to_members: showExpiry };
      const applyImage = (payload, existingRaw) => {
        if (newImagePath) payload.image_path = newImagePath;
        else if (m.clearImage) payload.image_path = null;
        else if (m.kind.startsWith('add-')) payload.image_path = newImagePath || null;
        // updates: omit image_path so the existing DB value is preserved
        void existingRaw;
        return payload;
      };

      if (m.kind === 'add-section' || m.kind === 'section') {
        const payload = applyImage({
          name,
          sort_order: m.kind === 'add-section' ? state.sections.length : undefined,
          is_active: true,
          visibility_mode: visibilityMode,
          owner_id: ownerId,
          text_bold: textBold,
          text_color: textColor,
          ...extra
        }, m.imagePathRaw);
        Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
        let id = m.targetId;
        if (m.kind === 'add-section') {
          const r = await sb.from('categories').insert(payload).select('id').single();
          if (r.error) throw r.error;
          id = r.data.id;
        } else {
          delete payload.sort_order;
          delete payload.is_active;
          const r = await sb.from('categories').update(payload).eq('id', m.targetId);
          if (r.error) throw r.error;
        }
        await saveAccess('category_user_access', 'category_id', id);
      } else if (m.kind === 'add-sub' || m.kind === 'sub') {
        const sec = findSection(state.currentSectionId);
        if (!sec) throw new Error('اختر قسمًا أولًا.');
        const payload = applyImage({
          category_id: sec.dbId,
          name,
          sort_order: m.kind === 'add-sub' ? sec.subs.length : undefined,
          visibility_mode: visibilityMode,
          owner_id: ownerId,
          text_bold: textBold,
          text_color: textColor,
          ...extra
        }, m.imagePathRaw);
        Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
        let id = m.targetId;
        if (m.kind === 'add-sub') {
          const r = await sb.from('subcategories').insert(payload).select('id').single();
          if (r.error) throw r.error;
          id = r.data.id;
        } else {
          delete payload.sort_order;
          delete payload.category_id;
          const r = await sb.from('subcategories').update(payload).eq('id', m.targetId);
          if (r.error) throw r.error;
        }
        await saveAccess('subcategory_user_access', 'subcategory_id', id);
      } else {
        const sec = findSection(state.currentSectionId);
        const sub = findSub(state.currentSectionId, state.currentSubId);
        if (!sub) throw new Error('اختر قسمًا فرعيًا أولًا.');
        const payload = applyImage({
          title: name || null,
          subcategory_id: sub.dbId,
          sort_order: m.kind === 'add-item' ? sub.items.length : undefined,
          is_active: true,
          visibility_mode: visibilityMode,
          owner_id: ownerId,
          text_bold: textBold,
          text_color: textColor,
          upload_enabled: uploadEnabled,
          ...extra
        }, m.imagePathRaw);
        if (newFilePath) payload.file_path = newFilePath;
        else if (m.clearFile) payload.file_path = null;
        else if (m.kind === 'add-item') payload.file_path = newFilePath || null;
        Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
        let id = m.targetId;
        if (m.kind === 'add-item') {
          if (sub.items.length >= 30) throw new Error('وصلت للحد الأقصى (30 مستطيل).');
          const r = await sb.from('materials').insert(payload).select('id').single();
          if (r.error) throw r.error;
          id = r.data.id;
        } else {
          delete payload.subcategory_id;
          delete payload.sort_order;
          delete payload.is_active;
          const r = await sb.from('materials').update(payload).eq('id', m.targetId);
          if (r.error) throw r.error;
        }
        await saveAccess('material_user_access', 'material_id', id);
      }
      // Publish announcement MUST live here because round-5 replaces the original saveModal.
      // This keeps the existing content save flow unchanged while making the automatic
      // notification actually run after a successful material publish.
      const publishedFilePath = newFilePath || m.fileData || m.filePath || null;
      if ((m.kind === 'item' || m.kind === 'add-item') && publishedFilePath && document.getElementById('announce-on-publish')?.checked) {
        try {
          const announceAudienceMode = document.getElementById('announce-audience-mode')?.value || 'all';
          const announceTitle = (document.getElementById('announce-title')?.value || 'رفع ملف جديد 🙂').trim() || 'رفع ملف جديد 🙂';
          const announceSubName = findSub(state.currentSectionId, state.currentSubId)?.name || '';
          const announceFileName = fileFile?.name || name || 'ملف';
          let targetType = 'all';
          let targetUserIds = [];
          let excludedUserIds = [];

          if (announceAudienceMode === 'selected') {
            targetType = 'selected';
            targetUserIds = [...(document.getElementById('announce-users')?.selectedOptions || [])]
              .map(o => o.value).filter(Boolean);
            if (!targetUserIds.length) throw new Error('إعلان بالنشر: اختر شخصًا واحدًا على الأقل.');
          } else if (announceAudienceMode === 'excluded') {
            targetType = 'excluded';
            excludedUserIds = [...(document.getElementById('announce-excluded')?.selectedOptions || [])]
              .map(o => o.value).filter(Boolean);
          }

          const announceBody = `تم رفع ${announceFileName}${announceSubName ? ` في ${announceSubName}` : ''}`;
          const ok = window.confirm(`هيتبعت الإشعار ده:\n\nالعنوان: ${announceTitle}\nالموضوع: ${announceBody}\n\nتوافق على الإرسال؟`);
          if (ok) {
            const payload = {
              title: announceTitle,
              body: announceBody,
              target_type: targetType,
              target_user_ids: targetUserIds,
              excluded_user_ids: excludedUserIds
            };
            const {data: notifId, error: notifError} = await sb.rpc('midad_notif_center_admin_send', {
              p_title: payload.title,
              p_body: payload.body,
              p_target_type: payload.target_type,
              p_target_user_ids: payload.target_user_ids,
              p_excluded_user_ids: payload.excluded_user_ids,
              p_media_path: null,
              p_media_type: null
            });
            if (notifError) throw notifError;
            if (!notifId) throw new Error('قاعدة البيانات لم تُرجع رقم الإشعار بعد الحفظ.');
            showToast('تم نشر الملف وإرسال الإشعار تلقائيًا ✅', 'success');
          }
        } catch (announceErr) {
          console.error('publish announcement failed', announceErr);
          showToast(`تم حفظ الملف لكن تعذر إرسال الإشعار: ${announceErr.message || 'خطأ غير معروف'}`, 'error');
        }
      }

      await loadData();
      closeModal();
      render();
      showToast('تم الحفظ بنجاح في قاعدة البيانات.', 'success');
    } catch (err) {
      console.error('round6 save', err);
      showToast(err?.message || 'تعذر الحفظ.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'حفظ'; }
    }
  };

  const originalDownloadMaterial = downloadMaterial;
  downloadMaterial = async function(item) {
    const activeButton = window.__midadActiveDownloadButton;
    try {
      if (IV_NATIVE_CACHE) {
        const user = await getCurrentAuthUser();
        const rawPath = item?.filePath || item?.fileData;
        const cleanPath = extractStoragePath(rawPath,'materials') || rawPath;
        const cached = user?.id && cleanPath ? await ivIsFileCached(user.id,'materials',cleanPath) : null;
        if (cached) {
          await ivOpenCachedFile(cached);
          return;
        }
      }
    } catch (_) {}
    if (activeButton && typeof window.__midadStartDownloadAnimation === 'function') {
      window.__midadStartDownloadAnimation(activeButton);
    }
    try {
      const rawPath = item?.filePath || item?.fileData;
      if (!rawPath) throw new Error('لا يوجد ملف لهذه المادة.');
      await downloadStorageBlob(
        'materials',
        rawPath,
        item?.fileName || item?.name || deriveOriginalFileName(rawPath) || 'محاضرة',
        {
          materialId: item?.dbId || item?.id || null,
          onDownloadStart: () => {
            if (activeButton && typeof window.__midadCompleteDownloadAnimation === 'function') {
              window.__midadCompleteDownloadAnimation(activeButton);
            }
          }
        }
      );
    } catch (e) {
      if (activeButton && typeof window.__midadCancelDownloadAnimation === 'function') {
        window.__midadCancelDownloadAnimation(activeButton);
      }
      console.error('secure material download', e);
      if (!ivOfflineDownloadNotice(e)) showToast(e?.message || 'تعذّر تحميل الملف. سجّل الدخول وتأكد من صلاحية الحساب.', 'error');
    } finally {
      if (window.__midadActiveDownloadButton === activeButton) {
        window.__midadActiveDownloadButton = null;
      }
    }
  };

  async function deleteMaterialRows(materialIds) {
    const ids = [...new Set((materialIds || []).filter(Boolean))];
    if (!ids.length) return;

    // Member-upload records can reference materials. Remove those rows first
    // so deleting a whole folder cannot fail because an old upload exists.
    try {
      const batchesRes = await sb.from('member_upload_batches').select('id').in('material_id', ids);
      if (!batchesRes.error && batchesRes.data?.length) {
        const batchIds = batchesRes.data.map(r => r.id).filter(Boolean);
        if (batchIds.length) {
          const filesRes = await sb.from('member_upload_files').delete().in('batch_id', batchIds);
          if (filesRes.error) throw filesRes.error;
          const batchesDelete = await sb.from('member_upload_batches').delete().in('id', batchIds);
          if (batchesDelete.error) throw batchesDelete.error;
        }
      }
    } catch (err) {
      // If these optional upload tables are unavailable in an older database,
      // do not hide the real folder-delete operation behind that feature.
      if (!/does not exist|schema cache|relation .* does not exist/i.test(String(err?.message || ''))) throw err;
    }

    const access = await sb.from('material_user_access').delete().in('material_id', ids);
    if (access.error) throw access.error;

    const materials = await sb.from('materials').delete().in('id', ids);
    if (materials.error) throw materials.error;
  }

  async function deleteSubPersistently(subId) {
    const sid = Number(subId);
    if (!Number.isFinite(sid)) throw new Error('معرّف القسم الفرعي غير صالح.');

    const matsRes = await sb.from('materials').select('id').eq('subcategory_id', sid);
    if (matsRes.error) throw matsRes.error;
    await deleteMaterialRows((matsRes.data || []).map(r => r.id));

    const subAccess = await sb.from('subcategory_user_access').delete().eq('subcategory_id', sid);
    if (subAccess.error) throw subAccess.error;

    const subDelete = await sb.from('subcategories').delete().eq('id', sid);
    if (subDelete.error) throw subDelete.error;
  }

  async function deleteSectionPersistently(sectionId) {
    const cid = Number(sectionId);
    if (!Number.isFinite(cid)) throw new Error('معرّف القسم غير صالح.');

    const subsRes = await sb.from('subcategories').select('id').eq('category_id', cid);
    if (subsRes.error) throw subsRes.error;
    const subIds = (subsRes.data || []).map(r => r.id).filter(Boolean);

    if (subIds.length) {
      const matsRes = await sb.from('materials').select('id').in('subcategory_id', subIds);
      if (matsRes.error) throw matsRes.error;
      await deleteMaterialRows((matsRes.data || []).map(r => r.id));

      const subAccess = await sb.from('subcategory_user_access').delete().in('subcategory_id', subIds);
      if (subAccess.error) throw subAccess.error;

      const subsDelete = await sb.from('subcategories').delete().in('id', subIds);
      if (subsDelete.error) throw subsDelete.error;
    }

    const catAccess = await sb.from('category_user_access').delete().eq('category_id', cid);
    if (catAccess.error) throw catAccess.error;

    const catDelete = await sb.from('categories').delete().eq('id', cid);
    if (catDelete.error) throw catDelete.error;
  }

  const originalOnAction = onAction;
  onAction = async function (e) {
    const el = e.currentTarget;
    const act = el?.dataset?.act;
    if (act === 'delete-section' || act === 'delete-sub') {
      e.preventDefault();
      e.stopPropagation();
      if (!isAdmin()) return showToast('غير مصرح به', 'error');

      const isSection = act === 'delete-section';
      const id = isSection ? el.dataset.section : el.dataset.sub;
      if (!id) return showToast('تعذر تحديد العنصر المطلوب حذفه.', 'error');

      askConfirm(
        isSection ? 'هل أنت متأكد من حذف هذا القسم وكل محتوياته نهائيًا من قاعدة البيانات؟' : 'هل أنت متأكد من حذف هذا القسم الفرعي وكل محتوياته نهائيًا من قاعدة البيانات؟',
        async () => {
          try {
            if (isSection) {
              await deleteSectionPersistently(id);
            } else {
              await deleteSubPersistently(id);
            }
            closeConfirm();
            await loadData();
            render();
            if (isSection) go('home');
            showToast(isSection ? 'تم حذف القسم وكل محتوياته نهائيًا من قاعدة البيانات.' : 'تم حذف القسم الفرعي وكل محتوياته نهائيًا من قاعدة البيانات.', 'success');
          } catch (err) {
            closeConfirm();
            console.error('persistent folder delete', err);
            showToast(`تعذر الحذف: ${err?.message || 'خطأ غير معروف'}`, 'error');
          }
        },
        { confirmLabel: 'حذف نهائي', confirmClass: 'btn-danger' }
      );
      return;
    }

    if (act === 'midad-upload-open') {
      e.stopPropagation();
      e.preventDefault();
      return openMemberUpload(el.dataset.materialId);
    }
    if (act === 'midad-clear-image') {
      e.stopPropagation();
      if (state.modal) { state.modal.clearImage = true; state.modal.image = null; state.modal.imageFile = null; }
      return render();
    }
    if (act === 'midad-clear-file') {
      e.stopPropagation();
      if (state.modal) { state.modal.clearFile = true; state.modal.fileData = null; state.modal.fileName = null; state.modal.fileFile = null; }
      return render();
    }
    if (act === 'open-welcome-media') {
      e.preventDefault(); e.stopPropagation();
      openModal('welcome-media', { mediaType: el.dataset.mediaType || 'image', mediaUrl: el.dataset.mediaUrl || '' });
      return;
    }
    if (act === 'delete-modal') {
      const m = state.modal;
      if (!m || !['section', 'sub'].includes(m.kind)) return originalOnAction(e);
      e.preventDefault();
      e.stopPropagation();
      if (!isAdmin()) return showToast('غير مصرح به', 'error');
      const id = m.targetId;
      const isSection = m.kind === 'section';
      closeModal();
      if (!id) return showToast('تعذر تحديد العنصر المطلوب حذفه.', 'error');
      askConfirm(
        isSection ? 'هل أنت متأكد من حذف هذا القسم وكل محتوياته نهائيًا من قاعدة البيانات؟' : 'هل أنت متأكد من حذف هذا القسم الفرعي وكل محتوياته نهائيًا من قاعدة البيانات؟',
        async () => {
          try {
            if (isSection) await deleteSectionPersistently(id);
            else await deleteSubPersistently(id);
            closeConfirm();
            await loadData();
            render();
            if (isSection) go('home');
            showToast(isSection ? 'تم حذف القسم وكل محتوياته نهائيًا من قاعدة البيانات.' : 'تم حذف القسم الفرعي وكل محتوياته نهائيًا من قاعدة البيانات.', 'success');
          } catch (err) {
            closeConfirm();
            console.error('persistent modal delete', err);
            showToast(`تعذر الحذف: ${err?.message || 'خطأ غير معروف'}`, 'error');
          }
        },
        { confirmLabel: 'حذف نهائي', confirmClass: 'btn-danger' }
      );
      return;
    }

    if (act === 'close-modal' && state.modal?.kind === 'user-message') {
      const ids = (state.modal.messages || []).map(x => x.id).filter(Boolean);
      // Close immediately. A backend tracking error must never leave the user
      // trapped inside the welcome dialog.
      closeModal();
      if (ids.length) {
        try {
          const r = await sb.rpc('mark_my_messages_read', { p_message_ids: ids });
          if (r.error) throw r.error;
          const tracked = await sb.rpc('midad_mark_welcome_messages_viewed', { p_message_ids: ids });
          if (tracked.error) throw tracked.error;
        } catch (err) {
          console.warn('welcome view tracking', err);
        }
      }
      return;
    }
    return originalOnAction(e);
  };

  const originalLoadData = loadData;
  loadData = async function () {
    await originalLoadData();
    await loadRound5Data();
    filterExpiredForMembers();
  };

  const originalRender = render;
  render = function () {
    originalRender();
    setTimeout(() => {
      decorateRound5UI();
      if (typeof secureWelcomeMessageMedia === 'function') void secureWelcomeMessageMedia();
    }, 0);
  };

  function decorateRound5UI() {
    try {
      // Profile / welcome / header: name stays put, titles 2×2 underneath.
      // Do NOT add the old midad-profile-identity class — it centered the
      // block and lifted the name above the avatar.
      document.querySelectorAll('.profile-hero, .welcome-greeting-row, .profile-trigger').forEach(el => {
        el.classList.add('midad-name-stable');
      });
      document.querySelectorAll('.profile-title-chips, .welcome-title-chips, .header-title-chips, .title-chips').forEach(el => {
        el.classList.add('midad-title-grid');
      });

      if (state.view === 'users' && isAdmin()) {
        const host = document.querySelector('.message-compose-card');
        if (host && !host.nextElementSibling?.classList.contains('midad-welcome-status-card')) {
          const welcomes = (state.adminMessages || []).filter(m => m.message_kind === 'welcome' && m.target_user_id);
          const views = state.welcomeMessageViews || [];
          const pending = welcomes.map(m => { const v = views.find(x => String(x.message_id) === String(m.id)); const u = userById(m.target_user_id) || {}; return { m, u, v }; }).filter(x => !x.v);
          const seen = welcomes.map(m => { const v = views.find(x => String(x.message_id) === String(m.id)); const u = userById(m.target_user_id) || {}; return { m, u, v }; }).filter(x => x.v);
          const panel = document.createElement('div');
          panel.className = 'midad-welcome-status-card';
          panel.innerHTML = `<div class="midad-admin-upload-head"><b><i class="fas fa-envelope-open-text"></i> حالة رسائل الترحيب</b><span>${welcomes.length} رسالة</span></div><div class="midad-welcome-status-grid"><div><h4>لم يشاهدوا <b>${pending.length}</b></h4><div>${pending.length ? pending.map(x => `<div class="midad-welcome-status-row"><strong>${esc(userDisplayName(x.u))}</strong><small>${esc(x.u.email || '')}</small></div>`).join('') : '<div class="midad-status-empty">كل رسائل الترحيب تم إغلاقها.</div>'}</div></div><div><h4>شاهدوا وأغلقوا <b>${seen.length}</b></h4><div>${seen.length ? seen.map(x => `<div class="midad-welcome-status-row"><strong>${esc(userDisplayName(x.u))}</strong><small>${new Date(x.v.viewed_at).toLocaleString('ar-EG')}</small></div>`).join('') : '<div class="midad-status-empty">لا توجد مشاهدات مسجلة بعد.</div>'}</div></div>`;
          host.parentNode.insertBefore(panel, host.nextSibling);
        }
      }

      const placeCardExpiry = (row, obj) => {
        if (!row || !obj?.expiresAt) return;
        if (!(isAdmin() || obj.showExpiryToMembers)) return;
        if (row.querySelector('.midad-expiry-badge')) return;
        const d = document.createElement('span');
        d.className = 'midad-expiry-badge midad-expiry-badge--card';
        d.dataset.expiry = obj.expiresAt;
        d.innerHTML = '<i class="fas fa-clock"></i><b>متبقي…</b>';
        row.appendChild(d);
      };

      if (state.view === 'home') {
        const cards = [...document.querySelectorAll('.box-card')].filter(x => x.dataset.act === 'open-section');
        (state.sections || []).forEach((s, i) => placeCardExpiry(cards[i], s));
      }
      if (state.view === 'subsection') {
        const sub = findSub(state.currentSectionId, state.currentSubId);
        const rows = [...document.querySelectorAll('.item-row')];
        (sub?.items || []).forEach((it, idx) => {
          const row = rows[idx];
          if (!row || !it.fileData) return;
          const host = row.querySelector('.item-name');
          if (!host || host.parentElement.querySelector('.midad-file-name')) return;
          const name = it.fileName || deriveOriginalFileName(it.fileData);
          if (!name) return;
          const el = document.createElement('div');
          el.className = 'midad-file-name';
          el.innerHTML = `<i class="fas fa-paperclip"></i><span>${esc(name)}</span>`;
          host.parentElement.appendChild(el);
        });
      }

      if (state.view === 'section') {
        const sec = findSection(state.currentSectionId);
        const cards = [...document.querySelectorAll('.sub-card')].filter(x => x.dataset.act === 'open-subsection');
        (sec?.subs || []).forEach((sub, i) => placeCardExpiry(cards[i], sub));
      }

      const sub = findSub(state.currentSectionId, state.currentSubId);
      if (state.view === 'subsection' && sub) {
        document.querySelectorAll('.item-row').forEach((row, i) => {
          const it = sub.items[i];
          if (!it) return;
          row.dataset.midadItemId = it.id;
          const ownUploaded = !!state.memberUploadOwn?.[String(it.dbId || it.id)];
          const my = (state.memberUploadBatches || []).find(b => String(b.material_id) === String(it.dbId || it.id) && String(b.user_id) === String(authUid()) && b.status === 'completed');
          const uploaded = !!(my || ownUploaded);

          if (!isAdmin() && it.uploadEnabled) {
            row.querySelector('.midad-upload-action')?.remove();
            row.querySelector('.midad-upload-done-card')?.remove();
            const host = row.querySelector('.item-actions') || row;
            if (uploaded) {
              const d = document.createElement('div');
              d.className = 'midad-upload-done-card';
              d.innerHTML = '<i class="fas fa-circle-check"></i><div><strong>تم الرفع بنجاح</strong><span>لا يمكنك الرفع مرة أخرى من هذا المستطيل.</span></div>';
              host.appendChild(d);
            } else {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'btn-download midad-upload-action';
              btn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> رفع';
              btn.setAttribute('data-midad-upload-open', '1');
              btn.setAttribute('data-material-id', String(it.dbId || it.id));
              host.appendChild(btn);
            }
          }

          if (it.expiresAt && (isAdmin() || it.showExpiryToMembers) && !row.querySelector('.midad-expiry-badge')) {
            const d = document.createElement('span');
            d.className = 'midad-expiry-badge midad-expiry-badge--inline';
            d.dataset.expiry = it.expiresAt;
            d.innerHTML = '<i class="fas fa-clock"></i><b>متبقي…</b>';
            (row.querySelector('.item-info') || row).appendChild(d);
          }

          if (isAdmin() && it.uploadEnabled) {
            const batches = (state.memberUploadBatches || []).filter(b => String(b.material_id) === String(it.dbId || it.id) && b.status === 'completed');
            if (batches.length && !row.nextElementSibling?.classList.contains('midad-admin-upload-panel')) {
              const panel = document.createElement('div');
              panel.className = 'midad-admin-upload-panel';
              panel.innerHTML = `<div class="midad-admin-upload-head"><b><i class="fas fa-cloud-arrow-up"></i> ملفات الأعضاء المرفوعة</b><span>${batches.length} عملية</span></div>${batches.map(b => {
                const u = userById(b.user_id) || {};
                const files = (state.memberUploadFiles || []).filter(f => String(f.batch_id) === String(b.id));
                return `<div class="midad-member-upload-card"><div class="midad-member-upload-top"><div><strong>${esc(b.display_name || u.full_name || u.name || 'عضو')}</strong><small>${esc(u.email || '')}</small></div><button type="button" class="midad-download-all" data-download-batch="${esc(b.id)}">تحميل الكل</button></div><div class="midad-member-files">${files.map(f => `<div><span><i class="fas fa-file"></i>${esc(f.original_name)}</span><small>${fmt(f.size_bytes)}</small><button type="button" data-download-file="${esc(f.object_path)}" data-download-name="${esc(f.original_name)}">تحميل</button></div>`).join('')}</div></div>`;
              }).join('')}`;
              row.parentNode.insertBefore(panel, row.nextSibling);
            }
          }
        });
      }

      document.querySelectorAll('[data-expiry]').forEach(el => updateExpiryEl(el));
      if (!window.__midadExpiryTimer) {
        window.__midadExpiryTimer = setInterval(() => {
          document.querySelectorAll('[data-expiry]').forEach(updateExpiryEl);
        }, 1000);
      }
      if (!window.__midadAdminStatusTimer) {
        window.__midadAdminStatusTimer = setInterval(async () => {
          if (!isAdmin() || state.view !== 'users' || state.modal) return;
          await loadMemberUploadData();
          await loadWelcomeMessageViews();
          render();
        }, 5000);
      }

      wireExpiryFields();

      if (IV_NATIVE_CACHE) {
        void (async()=>{
          try {
            const user = await getCurrentAuthUser();
            if (!user?.id) return;
            document.querySelectorAll('.btn-download[data-act="download-file"]').forEach(async b=>{
              const path=b.dataset.file||'';
              if(!path || /^https?:\/\//i.test(path)) return;
              const cached=await ivIsFileCached(user.id,'materials',extractStoragePath(path,'materials')||path);
              if(cached){ b.classList.add('midad-local-open'); b.innerHTML='<i class="fas fa-folder-open"></i> فتح'; b.title='الملف محفوظ على هذا الجهاز'; b.dataset.cachedOpen='1'; }
            });
          } catch (_) {}
        })();
      }

      document.querySelectorAll('[data-download-file]').forEach(b => {
        if (b.dataset.wired) return;
        b.dataset.wired = '1';
        b.addEventListener('click', () => downloadMemberObject(b.dataset.downloadFile, b.dataset.downloadName));
      });
      document.querySelectorAll('[data-download-batch]').forEach(b => {
        if (b.dataset.wired) return;
        b.dataset.wired = '1';
        b.addEventListener('click', () => downloadMemberBatch(b.dataset.downloadBatch));
      });

      if (state.modal?.kind === 'midad-member-upload') attachUploadModal();
    } catch (e) { console.warn('round6 decorate', e); }
  }

  function wireExpiryFields() {
    const ex = document.getElementById('midad-expiry-enabled');
    const dt = document.getElementById('midad-expires-at');
    const show = document.getElementById('midad-show-expiry');
    const up = document.getElementById('midad-upload-enabled');
    if (ex && dt && !ex.dataset.wired) {
      ex.dataset.wired = '1';
      ex.addEventListener('change', () => {
        dt.disabled = !ex.checked;
        if (state.modal) {
          state.modal.expiryEnabled = ex.checked;
          if (ex.checked && !dt.value) {
            const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
            dt.value = toDatetimeLocalValue(d);
            state.modal.expiresAt = d.toISOString();
          }
        }
      });
      const persistDt = () => {
        if (!state.modal) return;
        state.modal.expiresAt = fromDatetimeLocalValue(dt.value);
        state.modal.expiryEnabled = !!ex.checked;
      };
      dt.addEventListener('change', persistDt);
      dt.addEventListener('input', persistDt);
    }
    if (show && !show.dataset.wired) {
      show.dataset.wired = '1';
      show.addEventListener('change', () => { if (state.modal) state.modal.showExpiryToMembers = show.checked; });
    }
    if (up && !up.dataset.wired) {
      up.dataset.wired = '1';
      up.addEventListener('change', () => { if (state.modal) state.modal.uploadEnabled = up.checked; });
    }
  }

  function updateExpiryEl(el) {
    const end = new Date(el.dataset.expiry).getTime();
    const left = end - Date.now();
    const label = el.querySelector('b') || el;
    if (left <= 0) {
      label.textContent = 'انتهت المدة';
      el.classList.add('expired');
      if (!isAdmin() && !window.__midadExpiryReloading) {
        window.__midadExpiryReloading = true;
        setTimeout(async () => {
          try { await loadData(); render(); }
          finally { window.__midadExpiryReloading = false; }
        }, 150);
      }
      return;
    }
    let s = Math.floor(left / 1000);
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    const parts = [];
    if (d) parts.push(d + ' يوم');
    parts.push(h + ' س');
    parts.push(m + ' د');
    parts.push(s + ' ث');
    label.textContent = 'متبقي ' + parts.join(' ');
  }

  async function downloadMemberObject(path, name) {
    try {
      await downloadStorageBlob('member-uploads', path, name || deriveOriginalFileName(path) || 'file');
    } catch (e) { if(!ivOfflineDownloadNotice(e)) showToast(e.message || 'تعذر تحميل الملف.', 'error'); }
  }
  async function downloadMemberBatch(batchId) {
    const files = (state.memberUploadFiles || []).filter(f => String(f.batch_id) === String(batchId));
    if (!files.length) return showToast('لا توجد ملفات في هذه العملية.', 'info');
    if (!window.JSZip) { for (const f of files) await downloadMemberObject(f.object_path, f.original_name); return; }
    const zip = new JSZip();
    const btn = [...document.querySelectorAll('[data-download-batch]')].find(x => x.dataset.downloadBatch === String(batchId));
    if (btn) { btn.disabled = true; btn.textContent = 'جاري التجهيز…'; }
    try {
      for (const f of files) {
        const r = await sb.storage.from('member-uploads').download(f.object_path);
        if (r.error) throw r.error;
        let batchBlob = r.data;
        if ((r.data?.type === 'application/pdf' || /\.pdf$/i.test(f.original_name || f.object_path || '')) && window.PDFLib) {
          batchBlob = await ivFingerprintPdf(r.data, {materialId: null, name: f.original_name || deriveOriginalFileName(f.object_path) || 'file', path: f.object_path, userId: state.user?.id || null});
        }
        zip.file(f.original_name, batchBlob);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ملفات-العضو.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { if(!ivOfflineDownloadNotice(e)) showToast(e.message || 'تعذر تجهيز الملفات.', 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'تحميل الكل'; } }
  }

  async function reliableWelcomeVideo() {
    try {
      const { data, error } = await sb.rpc('midad_get_welcome_video_for_me');
      if (error) throw error;
      return data?.video_path ? publicStorageUrl('welcome-videos', data.video_path) : null;
    } catch (e) {
      console.warn('round6 welcome video', e);
      return null;
    }
  }
  getWelcomeVideoToShow = reliableWelcomeVideo;
  markWelcomeVideoViewed = async function () {
    try {
      const r = await sb.rpc('midad_mark_welcome_video_finished');
      if (r.error) throw r.error;
    } catch (e) { console.warn('round6 mark welcome video', e); }
  };

  function injectRound6Styles() {
    const css = `
/* Round 6 visual fixes — tokens follow each theme via CSS variables. */
.midad-profile-identity{display:block!important;flex-direction:unset!important;align-items:unset!important;justify-content:unset!important}
.midad-profile-identity h3{margin:0 0 8px!important;text-align:inherit!important}
.profile-hero.midad-name-stable{align-items:flex-start!important;overflow:visible!important}
.profile-hero.midad-name-stable > div:last-child{display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:flex-start!important;gap:8px!important;min-width:0;flex:1}
.profile-hero.midad-name-stable h3{margin:8px 0 0!important;position:static!important;top:auto!important;transform:none!important;line-height:1.35!important;text-align:start!important}
.profile-hero .profile-large-avatar{align-self:flex-start!important}
.welcome-greeting-row.midad-name-stable{align-items:flex-start!important}
.welcome-section{overflow:visible!important}
.welcome-section .greeting h1{margin:0!important}
.profile-trigger.midad-name-stable{align-items:center!important}
.pname-wrap{display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;gap:3px!important;min-width:0}
.header{height:auto!important;min-height:68px!important;padding-top:8px!important;padding-bottom:8px!important}
.midad-title-grid,.profile-title-chips,.welcome-title-chips,.header-title-chips,.title-chips,.um-name-line .title-chips{
  display:grid!important;grid-template-columns:repeat(2,max-content)!important;gap:7px!important;margin-top:6px!important;justify-content:start!important;width:auto!important;max-width:100%
}
.header-title-chips{gap:4px!important;margin-top:0!important}
.welcome-title-chips{justify-content:start!important}
.midad-profile-badges{display:grid!important;grid-template-columns:repeat(2,max-content)!important;justify-content:start!important}
@media(max-width:700px){
  .profile-hero.midad-name-stable{align-items:center!important}
  .profile-hero.midad-name-stable > div:last-child{align-items:center!important}
  .profile-hero.midad-name-stable h3{text-align:center!important;margin-top:10px!important}
  .profile-hero .profile-title-chips,.welcome-title-chips{justify-content:center!important}
  .welcome-greeting-row.midad-name-stable{align-items:center!important}
}

/* Duration chip: high-contrast, sits at the TOP of the folder so it never
   covers the folder name at the bottom, and never replaces the image. */
.midad-expiry-badge{display:inline-flex;align-items:center;gap:6px;font-weight:900;direction:rtl;letter-spacing:0}
.midad-expiry-badge i{font-size:.85em;opacity:.95}
.midad-expiry-badge--card{
  position:absolute;top:10px;right:10px;z-index:4;margin:0!important;
  padding:7px 11px;border-radius:999px;max-width:calc(100% - 20px);
  background:rgba(8,12,24,.88)!important;color:#fff!important;
  border:1px solid rgba(255,255,255,.38)!important;
  box-shadow:0 10px 28px rgba(0,0,0,.38),inset 0 0 0 1px rgba(255,255,255,.08);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  text-shadow:0 1px 2px rgba(0,0,0,.45);font-size:11px;white-space:nowrap;
  pointer-events:none
}
.midad-expiry-badge--card.expired{background:rgba(127,29,29,.94)!important;border-color:rgba(254,202,202,.55)!important}
.midad-expiry-badge--inline{
  margin-top:7px;padding:5px 10px;border-radius:999px;
  background:rgba(8,12,24,.88)!important;color:#fff!important;
  border:1px solid rgba(255,255,255,.28);font-size:10px
}
.midad-expiry-badge--inline.expired{background:#7f1d1d!important}
.box-card,.sub-card{position:relative}
.box-card .card-image,.sub-card .card-image{z-index:0}
.box-card .card-title,.sub-card .card-title{position:relative;z-index:2}

.midad-content-options,.midad-expiry-panel{margin:14px 0;padding:12px;border:1px solid var(--border,#e2e8f0);border-radius:16px;background:var(--surface-alt,#f8fafc);display:grid;gap:10px}
.midad-option-card{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-radius:13px;background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0)}
.midad-option-card b{display:block;color:var(--text,#111827);font-weight:900}
.midad-option-card small{display:block;color:var(--text-muted,#64748b);margin-top:3px;line-height:1.6}
.midad-switch{position:relative;width:48px;height:28px;flex:none}
.midad-switch input{display:none}
.midad-switch span{position:absolute;inset:0;border-radius:999px;background:#cbd5e1;cursor:pointer;transition:.2s}
.midad-switch span:before{content:'';position:absolute;width:22px;height:22px;top:3px;right:3px;border-radius:50%;background:#fff;box-shadow:0 2px 7px #0002;transition:.2s}
.midad-switch input:checked+span{background:var(--primary,#2563eb)}
.midad-switch input:checked+span:before{transform:translateX(-20px)}
.midad-expiry-grid{display:grid;grid-template-columns:auto minmax(180px,1fr) auto;gap:10px;align-items:center}
.midad-checkline{display:flex;align-items:center;gap:7px;font-size:.78rem;font-weight:800;color:var(--text,#111827)}
.midad-checkline input{accent-color:var(--primary,#2563eb)}
.midad-expiry-grid input[type=datetime-local],.midad-expiry-panel input[type=datetime-local]{width:100%;border:1px solid var(--border,#e2e8f0);border-radius:11px;background:var(--surface,#fff);color:var(--text,#111827);padding:9px;font:700 12px inherit}
.midad-clear-grid{display:flex;flex-wrap:wrap;gap:7px}
.midad-clear-grid button{border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--danger,#c6493f);border-radius:10px;padding:7px 10px;font:800 11px inherit;cursor:pointer}

.midad-upload-action{border-color:var(--primary)!important;color:#fff!important;background:var(--primary,#2563eb)!important;cursor:pointer!important;pointer-events:auto!important;z-index:6;position:relative}
.midad-upload-done-card{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:12px;background:var(--success-bg,#ecfdf5);border:1px solid #a7f3d0;color:var(--success,#047857);max-width:260px}
.midad-upload-done-card i{margin-top:2px}
.midad-upload-done-card strong{display:block;font-size:.72rem}
.midad-upload-done-card span{display:block;font-size:.62rem;line-height:1.5;opacity:.9}

.midad-admin-upload-panel{margin:0 0 12px;padding:13px;border:1px solid var(--border,#e2e8f0);border-radius:16px;background:var(--surface-alt,#f8fafc);box-shadow:var(--shadow-sm,0 2px 10px #0000000b)}
.midad-admin-upload-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;color:var(--text,#111827);font-size:.82rem}
.midad-admin-upload-head span{font-size:.68rem;color:var(--text-muted,#64748b);padding:4px 8px;border-radius:999px;background:var(--surface,#fff)}
.midad-member-upload-card{padding:11px;border:1px solid var(--border,#e2e8f0);border-radius:13px;background:var(--surface,#fff);margin-top:8px}
.midad-member-upload-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.midad-member-upload-top strong{display:block;font-size:.8rem;color:var(--text,#111827)}
.midad-member-upload-top small{display:block;color:var(--text-muted,#64748b);font-size:.68rem;margin-top:2px;direction:ltr;text-align:right}
.midad-download-all{border:1px solid var(--primary,#2563eb);background:var(--primary-bg,#eff6ff);color:var(--primary,#2563eb);border-radius:9px;padding:6px 9px;font:800 10px inherit;cursor:pointer}
.midad-member-files{display:grid;gap:6px;margin-top:9px}
.midad-member-files>div{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:7px 8px;border-radius:9px;background:var(--surface-alt,#f8fafc);font-size:.68rem}
.midad-member-files span{min-width:0;overflow-wrap:anywhere;color:var(--text,#111827)}
.midad-member-files span i{margin-inline-end:5px;color:var(--primary,#2563eb)}
.midad-member-files small{color:var(--text-muted,#64748b)}
.midad-member-files button{border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--text-secondary,#475569);border-radius:8px;padding:5px 7px;font:800 9px inherit;cursor:pointer}

.midad-upload-overlay{z-index:100000}
.midad-upload-modal{width:min(620px,calc(100vw - 24px));max-height:90vh;overflow:auto}
.midad-upload-head{display:flex;align-items:center;gap:11px}
.midad-upload-head h3{margin:0;color:var(--text,#111827)}
.midad-upload-head p{margin:2px 0 0;color:var(--text-muted,#64748b);font-size:.72rem}
.midad-upload-icon{width:48px;height:48px;border-radius:15px;background:var(--primary-bg,#eff6ff);color:var(--primary,#2563eb);display:grid;place-items:center;font-size:1.15rem;flex:none}
.midad-upload-icon.warn{background:#fff7ed;color:#c2410c}
.midad-upload-x{margin-inline-start:auto;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--text-secondary,#64748b);width:34px;height:34px;border-radius:10px;font-size:1.3rem;cursor:pointer}
.midad-upload-note{display:flex;gap:8px;align-items:flex-start;margin:13px 0;padding:10px 12px;border-radius:12px;background:var(--primary-bg,#eff6ff);color:var(--text-secondary,#475569);font-size:.72rem;line-height:1.7}
.midad-upload-note i{color:var(--primary,#2563eb);margin-top:3px}
.midad-req{color:var(--danger,#c6493f)}
.midad-dropzone{border:2px dashed var(--primary-light,#93c5fd);border-radius:18px;padding:25px 16px;text-align:center;background:linear-gradient(135deg,var(--primary-bg,#eff6ff),var(--surface,#fff));cursor:pointer;transition:.2s}
.midad-dropzone:hover,.midad-dropzone.drag{transform:translateY(-1px);border-color:var(--primary,#2563eb);box-shadow:0 10px 30px #0000000d}
.midad-dropzone{position:relative;overflow:hidden}
.midad-dropzone input{display:block!important;position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:2}
.midad-drop-icon{width:54px;height:54px;margin:0 auto 8px;border-radius:16px;background:var(--surface,#fff);color:var(--primary,#2563eb);display:grid;place-items:center;font-size:1.35rem;box-shadow:0 7px 18px #00000010}
.midad-dropzone strong{display:block;color:var(--text,#111827);font-size:.9rem}
.midad-dropzone span,.midad-dropzone small{display:block;color:var(--text-muted,#64748b);font-size:.7rem;line-height:1.7}
.midad-upload-files-list{display:grid;gap:6px;margin-top:10px}
.midad-empty-upload{padding:11px;text-align:center;color:var(--text-muted,#64748b);font-size:.72rem;border:1px dashed var(--border,#e2e8f0);border-radius:10px}
.midad-file-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:8px 9px;border:1px solid var(--border,#e2e8f0);border-radius:10px;background:var(--surface,#fff);font-size:.7rem}
.midad-file-row span{overflow-wrap:anywhere}
.midad-file-row b{color:var(--text-muted,#64748b);font-size:.65rem}
.midad-file-row button,.midad-file-x{border:0;background:#fef2f2;color:#b91c1c;width:26px;height:26px;border-radius:8px;cursor:pointer;font-weight:900;font-size:1rem;line-height:1}
.midad-upload-error{padding:11px;border-radius:10px;background:#fef2f2;color:#b91c1c;font-size:.72rem;font-weight:800}
.midad-upload-meter{margin-top:12px}
.midad-upload-meter-top{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;font-size:.68rem;color:var(--text-muted,#64748b)}
.midad-upload-meter-top strong{color:var(--text,#111827);text-align:center}
.midad-progress{height:9px;margin-top:7px;border-radius:99px;background:var(--border-light,#e2e8f0);overflow:hidden}
.midad-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--primary,#2563eb),var(--purple,#7c3aed));border-radius:inherit;transition:width .2s}
.midad-upload-actions{display:flex;gap:8px;margin-top:14px}
.midad-upload-actions button{flex:1}
.midad-once-warning{display:flex;gap:10px;align-items:flex-start;margin:12px 0;padding:12px 14px;border-radius:14px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412}
.midad-once-warning strong{display:block;font-size:.84rem;margin-bottom:4px}
.midad-once-warning span{display:block;font-size:.72rem;line-height:1.7}
.midad-already-hero{width:72px;height:72px;margin:8px auto 12px;border-radius:50%;background:var(--success-bg,#ecfdf5);color:var(--success,#047857);display:grid;place-items:center;font-size:2rem}
.midad-upload-done-modal{text-align:center}
.midad-upload-done-modal h3{margin:0 0 8px}
.midad-upload-done-modal p{color:var(--text-muted,#64748b);line-height:1.8;font-size:.85rem}

.midad-welcome-status-card{margin-top:18px;padding:14px;border:1px solid var(--border,#e2e8f0);border-radius:16px;background:var(--surface,#fff);box-shadow:var(--shadow-sm,0 2px 10px #0000000b)}
.midad-welcome-status-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.midad-welcome-status-grid>div{border:1px solid var(--border,#e2e8f0);border-radius:12px;background:var(--surface-alt,#f8fafc);overflow:hidden}
.midad-welcome-status-grid h4{margin:0;padding:9px 10px;font-size:.72rem;color:var(--text,#111827);border-bottom:1px solid var(--border,#e2e8f0)}
.midad-welcome-status-grid h4 b{float:left;color:var(--primary,#2563eb)}
.midad-welcome-status-row{display:flex;flex-direction:column;gap:1px;padding:8px 10px;border-bottom:1px solid var(--border-light,#edf2f7)}
.midad-welcome-status-row:last-child{border-bottom:0}
.midad-welcome-status-row strong{font-size:.7rem}
.midad-welcome-status-row small{font-size:.62rem;color:var(--text-muted,#64748b)}
.midad-status-empty{padding:14px;text-align:center;color:var(--text-muted,#64748b);font-size:.68rem}
@media(max-width:650px){
  .midad-expiry-grid{grid-template-columns:1fr}
  .midad-upload-meter-top{grid-template-columns:1fr;text-align:center;gap:3px}
  .midad-member-files>div{grid-template-columns:minmax(0,1fr) auto}
  .midad-member-files button{grid-column:2;grid-row:1}
  .midad-member-files small{grid-column:1;grid-row:2;text-align:right}
  .midad-upload-actions{flex-direction:column}
  .midad-option-card{align-items:flex-start}
  .midad-welcome-status-grid{grid-template-columns:1fr}
  .midad-expiry-badge--card{font-size:10px;padding:6px 9px;top:8px;right:8px}
}
/* Targeted fix: profile names truncate from the end so the first name stays visible. */
.profile-trigger .pname{direction:ltr!important;unicode-bidi:plaintext!important;text-align:left!important;}

/* Targeted fix: welcome image/video stays inside a card; click opens a fullscreen viewer. */
.user-message-overlay{overflow:auto!important;padding:16px!important;}
.user-message-card{max-height:calc(100vh - 32px);overflow:auto;}
.welcome-media-box{display:block;position:relative;width:100%;margin-top:10px;padding:0;border:1px solid var(--border,#e2e8f0);border-radius:16px;overflow:hidden;background:var(--surface,#fff);cursor:pointer;box-shadow:var(--shadow-sm,0 4px 14px rgba(0,0,0,.08));appearance:none;font:inherit;color:inherit;}
.welcome-media-box:hover{transform:translateY(-1px);box-shadow:var(--shadow-md,0 10px 24px rgba(0,0,0,.12));}
.welcome-media-preview{display:block!important;width:100%!important;height:min(42vh,300px)!important;object-fit:contain!important;background:#07111f!important;}
.welcome-media-box .welcome-media-hint{display:flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:8px 10px;background:var(--surface,#fff);color:var(--text-secondary,#475569);font-weight:800;font-size:.72rem;}
.welcome-media-overlay{z-index:200000!important;background:rgba(3,8,20,.9)!important;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);}
.welcome-media-viewer{position:relative;width:min(96vw,1200px);height:min(92vh,900px);display:flex;align-items:center;justify-content:center;padding:18px;}
.welcome-media-full{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;border-radius:14px;background:#000;box-shadow:0 24px 80px rgba(0,0,0,.45);}
.welcome-media-close{position:absolute;top:0;right:0;z-index:3;width:44px;height:44px;border:1px solid rgba(255,255,255,.3);border-radius:50%;background:rgba(15,23,42,.86);color:#fff;font-size:1.7rem;line-height:1;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);}
.user-message-item .admin-message-media{display:block;width:100%;max-width:100%;height:min(42vh,300px);object-fit:contain;background:#07111f;border-radius:0;cursor:pointer;}
.user-message-item .welcome-media-box{margin-top:10px;}
.user-message-item .welcome-media-box .welcome-media-preview{height:min(42vh,300px)!important;max-width:100%!important;}
.midad-file-name{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:.72rem;line-height:1.5;color:var(--text-secondary,#64748b);direction:ltr;unicode-bidi:plaintext;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
.midad-file-name i{flex:none;opacity:.75;}
.midad-file-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* Upload picker: real transparent file input ensures chooser works on desktop/mobile. */
.midad-dropzone{position:relative;overflow:hidden;}
.midad-dropzone input[type=file]{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;opacity:0!important;cursor:pointer!important;z-index:5!important;}
.midad-dropzone>*:not(input){pointer-events:none;}

`;
    let el = document.getElementById('midad-round6-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'midad-round6-style';
      document.head.appendChild(el);
    }
    el.textContent = css;
  }

  /* -----------------------------------------------------------------------
     FINAL targeted welcome-video fix (shared by all themes)
     - Each selected member keeps their own saved video.
     - Selecting another member replaces the previous selection in the video
       picker so the UI cannot silently jump back to the old member.
     - The chosen library video is persisted as a draft before Save.
     - Exclusions are tied to the currently assigned video path, so removing
       an exclusion makes the same video pending again.
  ----------------------------------------------------------------------- */
  if (!window.__midadPerUserWelcomeVideoFix) {
    window.__midadPerUserWelcomeVideoFix = true;

    const _wvSafeString = (v) => v == null ? '' : String(v);
    const _wvIds = (ids) => [...new Set((ids || []).map(x => String(x)).filter(Boolean))];

    async function _wvLoadCampaignPerUser() {
      try {
        const { data: campaign, error: cErr } = await sb.from('welcome_video_campaign')
          .select('*').eq('id', 1).maybeSingle();
        if (cErr) throw cErr;

        let recipients = [];
        if (campaign?.audience_mode === 'selected') {
          const r = await sb.from('welcome_video_recipients')
            .select('user_id,video_path,viewed_at')
            .eq('campaign_id', 1);
          if (r.error) throw r.error;
          recipients = r.data || [];
        }

        const recipient_ids = recipients.map(r => String(r.user_id));
        const recipient_video_paths = {};
        recipients.forEach(r => { recipient_video_paths[String(r.user_id)] = r.video_path || ''; });

        state.welcomeVideoCampaign = campaign ? {
          ...campaign,
          recipient_ids,
          recipient_video_paths
        } : null;

        // Keep a separate unsaved draft video per member. This prevents the
        // library selector from jumping back to the campaign/default video
        // whenever the admin changes the selected member or the page re-renders.
        if (!state.welcomeVideoDraftByUser || typeof state.welcomeVideoDraftByUser !== 'object') {
          state.welcomeVideoDraftByUser = {};
        }
        recipient_ids.forEach(id => {
          if (!(id in state.welcomeVideoDraftByUser)) {
            state.welcomeVideoDraftByUser[id] = recipient_video_paths[id] || '';
          }
        });

        if (!state.welcomeVideoDraftAudience) {
          state.welcomeVideoDraftAudience = campaign?.audience_mode === 'selected' ? 'selected' : 'all';
        }

        if (!Array.isArray(state.welcomeVideoDraftRecipientIds)) {
          let lastId = '';
          try { lastId = localStorage.getItem('midad.welcomeVideoDraftUser') || ''; } catch (_) {}
          state.welcomeVideoDraftRecipientIds = lastId && recipient_ids.includes(lastId) ? [lastId] : [];
        } else if (state.welcomeVideoDraftAudience === 'selected') {
          state.welcomeVideoDraftRecipientIds = _wvIds(state.welcomeVideoDraftRecipientIds)
            .filter(id => recipient_ids.includes(id));
        }

        const ids = _wvIds(state.welcomeVideoDraftRecipientIds);
        if (state.welcomeVideoDraftAudience === 'selected') {
          if (ids.length === 1) {
            const id = ids[0];
            if (state.welcomeVideoDraftPath == null) {
              state.welcomeVideoDraftPath = state.welcomeVideoDraftByUser[id] || recipient_video_paths[id] || '';
            }
          } else if (ids.length > 1) {
            const paths = ids.map(id => state.welcomeVideoDraftByUser[id] || recipient_video_paths[id] || '').filter(Boolean);
            state.welcomeVideoDraftPath = paths.length === ids.length && paths.every(v => v === paths[0]) ? paths[0] : '';
          } else if (state.welcomeVideoDraftPath == null) {
            state.welcomeVideoDraftPath = '';
          }
        } else if (state.welcomeVideoDraftPath == null) {
          state.welcomeVideoDraftPath = campaign?.video_path || '';
        }
        return state.welcomeVideoCampaign;
      } catch (e) {
        console.warn('per-user welcome video campaign load', e);
        return state.welcomeVideoCampaign || null;
      }
    }

    async function _wvLoadExcluded() {
      try {
        const { data, error } = await sb.from('welcome_video_excluded')
          .select('user_id,video_path').eq('campaign_id', 1);
        if (error) throw error;
        const rows = data || [];
        // Keep the UI state as a simple ID array because the existing renderers
        // expect Set<string>; keep exact video assignments in a side structure.
        state.welcomeVideoExcluded = rows.map(x => String(x.user_id));
        state.welcomeVideoExcludedDetails = rows.map(x => ({
          user_id: String(x.user_id),
          video_path: x.video_path || null
        }));
      } catch (e) {
        console.warn('per-user welcome video excluded load', e);
        state.welcomeVideoExcluded = [];
        state.welcomeVideoExcludedDetails = [];
      }
      return state.welcomeVideoExcluded;
    }

    function _wvAssignmentPath(userId) {
      const id = String(userId || '');
      const map = state.welcomeVideoCampaign?.recipient_video_paths || {};
      return map[id] || '';
    }

    function _wvCurrentPathForMember(userId) {
      const camp = state.welcomeVideoCampaign || {};
      return camp.audience_mode === 'selected' ? _wvAssignmentPath(userId) : (camp.video_path || '');
    }

    function _wvIsExcluded(userId, path) {
      const id = String(userId || '');
      const p = _wvSafeString(path);
      return (state.welcomeVideoExcludedDetails || []).some(x => String(x.user_id) === id && (!x.video_path || x.video_path === p));
    }

    function _wvSyncDraftFromDom() {
      const audience = document.getElementById('welcome-video-audience')?.value === 'selected' ? 'selected' : 'all';
      const sel = document.getElementById('welcome-video-recipient-select');
      const ids = audience === 'selected' ? [...(sel?.selectedOptions || [])].map(o => String(o.value)) : [];
      state.welcomeVideoDraftAudience = audience;
      state.welcomeVideoDraftRecipientIds = _wvIds(ids);
      if (!state.welcomeVideoDraftByUser || typeof state.welcomeVideoDraftByUser !== 'object') state.welcomeVideoDraftByUser = {};

      if (audience === 'selected' && ids.length === 1) {
        const id = ids[0];
        try { localStorage.setItem('midad.welcomeVideoDraftUser', id); } catch (_) {}
        // The library selector is the authoritative unsaved choice. Only use
        // the saved member assignment when nothing new is selected.
        const chosen = document.getElementById('welcome-video-library-select')?.value || '';
        const current = chosen || state.welcomeVideoDraftByUser[id] || _wvAssignmentPath(id) || '';
        state.welcomeVideoDraftByUser[id] = current;
        state.welcomeVideoDraftPath = current;
      } else if (audience === 'selected' && ids.length > 1) {
        const chosen = document.getElementById('welcome-video-library-select')?.value || '';
        if (chosen) {
          ids.forEach(id => { state.welcomeVideoDraftByUser[id] = chosen; });
          state.welcomeVideoDraftPath = chosen;
        } else {
          const paths = ids.map(id => state.welcomeVideoDraftByUser[id] || _wvAssignmentPath(id)).filter(Boolean);
          state.welcomeVideoDraftPath = paths.length === ids.length && paths.every(p => p === paths[0]) ? paths[0] : '';
        }
      } else if (audience === 'all') {
        state.welcomeVideoDraftPath = document.getElementById('welcome-video-library-select')?.value || state.welcomeVideoCampaign?.video_path || '';
      }
    }

    function _wvApplyDraftToUI() {
      const audience = state.welcomeVideoDraftAudience || (state.welcomeVideoCampaign?.audience_mode === 'selected' ? 'selected' : 'all');
      const sel = document.getElementById('welcome-video-recipient-select');
      if (sel) {
        const ids = new Set(_wvIds(state.welcomeVideoDraftRecipientIds || state.welcomeVideoCampaign?.recipient_ids || []));
        [...sel.options].forEach(o => { o.selected = audience === 'selected' && ids.has(String(o.value)); });
        const custom = sel.nextElementSibling;
        if (custom?.classList?.contains('user-picker')) {
          [...custom.querySelectorAll('.user-picker-row')].forEach(row => {
            const idx = Number(row.dataset.idx);
            const opt = sel.options[idx];
            const checked = !!opt?.selected;
            const cb = row.querySelector('input[type=checkbox]');
            if (cb) cb.checked = checked;
            row.classList.toggle('checked', checked);
          });
          const count = custom.querySelector('.user-picker-count');
          if (count) {
            const n = [...sel.options].filter(o => o.selected).length;
            count.textContent = n ? `${n} محدد` : 'لا يوجد اختيار';
          }
        }
      }

      const aud = document.getElementById('welcome-video-audience');
      if (aud) aud.value = audience;
      const box = document.getElementById('welcome-video-recipients-box');
      if (box) box.classList.toggle('show', audience === 'selected');

      const lib = document.getElementById('welcome-video-library-select');
      const ids = _wvIds(state.welcomeVideoDraftRecipientIds || []);
      const memberDraft = state.welcomeVideoDraftAudience === 'selected' && ids.length === 1
        ? ((state.welcomeVideoDraftByUser || {})[ids[0]] || '')
        : '';
      const desired = state.welcomeVideoDraftPath ?? (memberDraft || (state.welcomeVideoDraftAudience === 'all' ? (state.welcomeVideoCampaign?.video_path || '') : '')); 
      if (lib) {
        const found = [...lib.options].some(o => o.value === desired);
        lib.value = found ? desired : '';
        const preview = document.getElementById('welcome-video-admin-preview');
        if (preview && desired) {
          preview.src = publicStorageUrl('welcome-videos', desired);
          preview.style.display = 'block';
        }
      }
    }

    // Replace the main loader before bootApp() runs.
    loadWelcomeVideoCampaign = _wvLoadCampaignPerUser;
    loadWelcomeVideoExcluded = _wvLoadExcluded;

    // Member side: database RPC is the single source of truth for the exact
    // video assigned to this authenticated member. Use a signed URL because the
    // welcome-videos bucket is private; fall back to the public URL only when the
    // project bucket is configured as public.
    getWelcomeVideoToShow = async function () {
      try {
        const uid = state.user?.id || currentAuthUser?.id;
        if (!uid || !state.user || isAdmin()) return null;

        const { data, error } = await sb.rpc('midad_get_welcome_video_for_me');
        if (error) throw error;
        if (!data?.should_show || !data?.video_path) return null;

        const signed = await sb.storage.from('welcome-videos').createSignedUrl(data.video_path, 600);
        if (!signed.error && signed.data?.signedUrl) return signed.data.signedUrl;

        return publicStorageUrl('welcome-videos', data.video_path);
      } catch (e) {
        console.warn('per-user welcome video show', e);
        return null;
      }
    };

    // ─── Pre-generated PDF status ────────────────────────────────────────
    let _pdfPrepStatusTimer = null;
    async function refreshPdfPrepStatus() {
      const card = document.getElementById('midad-pdf-prep-card');
      if (!card || !state.user?.id) return;
      try {
        const { data, error } = await sb.from('iv_pdf_prepared_files')
          .select('status,progress')
          .eq('user_id', state.user.id);
        if (error) throw error;
        const rows = Array.isArray(data) ? data : [];
        const total = rows.length;
        const ready = rows.filter(r => String(r.status) === 'ready' && Number(r.progress || 0) >= 100).length;
        const active = rows.filter(r => ['pending','processing'].includes(String(r.status))).length;
        const failed = rows.filter(r => String(r.status) === 'error').length;
        const pct = total ? Math.round(rows.reduce((sum,r)=>sum + Math.max(0,Math.min(100,Number(r.progress||0))),0) / total) : 0;
        const summary = document.getElementById('midad-pdf-prep-summary');
        const bar = document.getElementById('midad-pdf-prep-bar');
        const detail = document.getElementById('midad-pdf-prep-detail');
        if (summary) summary.textContent = total ? `${ready} من ${total} ملف جاهز — ${pct}%` : 'لا توجد ملفات PDF تحتاج تجهيزًا حاليًا.';
        if (bar) bar.style.width = `${pct}%`;
        if (detail) detail.innerHTML = `<bdi>${active} قيد التجهيز</bdi>${failed ? ` • <bdi>${failed} تعذر تجهيزها</bdi>` : ''}`;
      } catch (e) {
        console.warn('pdf preparation status', e);
      }
    }
    if (!_pdfPrepStatusTimer) {
      _pdfPrepStatusTimer = setInterval(() => {
        if (state.user?.id) void refreshPdfPrepStatus();
      }, 10000);
    }

    // Preserve the chosen user/video across every render.
    const _origRender = render;
    render = function (...args) {
      const out = _origRender.apply(this, args);
      try { _wvApplyDraftToUI(); } catch (_) {}
      try { void refreshPdfPrepStatus(); } catch (_) {}
      return out;
    };

    const _origAttach = attachEvents;
    attachEvents = function (...args) {
      const out = _origAttach.apply(this, args);
      try {
        const aud = document.getElementById('welcome-video-audience');
        if (aud && !aud.dataset.wvDraftBound) {
          aud.dataset.wvDraftBound = '1';
          aud.addEventListener('change', () => {
            state.welcomeVideoDraftAudience = aud.value === 'selected' ? 'selected' : 'all';
            const box = document.getElementById('welcome-video-recipients-box');
            if (box) box.classList.toggle('show', state.welcomeVideoDraftAudience === 'selected');
            _wvApplyDraftToUI();
          });
        }
        const lib = document.getElementById('welcome-video-library-select');
        if (lib && !lib.dataset.wvDraftBound) {
          lib.dataset.wvDraftBound = '1';
          lib.addEventListener('change', () => {
            const chosen = lib.value || '';
            state.welcomeVideoDraftPath = chosen;
            const audience = document.getElementById('welcome-video-audience')?.value === 'selected' ? 'selected' : 'all';
            const sel = document.getElementById('welcome-video-recipient-select');
            const ids = audience === 'selected' ? _wvIds([...(sel?.selectedOptions || [])].map(o => String(o.value))) : [];
            if (!state.welcomeVideoDraftByUser || typeof state.welcomeVideoDraftByUser !== 'object') state.welcomeVideoDraftByUser = {};
            if (ids.length === 1) state.welcomeVideoDraftByUser[ids[0]] = chosen;
            else if (ids.length > 1 && chosen) ids.forEach(id => { state.welcomeVideoDraftByUser[id] = chosen; });
            const v = document.getElementById('welcome-video-admin-preview');
            if (v && chosen) { v.src = publicStorageUrl('welcome-videos', chosen); v.style.display = 'block'; }
            else if (v) { v.removeAttribute('src'); v.style.display = 'none'; }
          });
        }
        const rec = document.getElementById('welcome-video-recipient-select');
        if (rec && !rec.dataset.wvDraftBound) {
          rec.dataset.wvDraftBound = '1';
          rec.addEventListener('change', () => {
            const ids = _wvIds([...rec.selectedOptions].map(o => String(o.value)));
            state.welcomeVideoDraftRecipientIds = ids;
            if (ids.length === 1) {
              try { localStorage.setItem('midad.welcomeVideoDraftUser', ids[0]); } catch (_) {}
              const id = ids[0];
              const chosen = (state.welcomeVideoDraftByUser || {})[id] || _wvAssignmentPath(id) || '';
              state.welcomeVideoDraftPath = chosen;
              if (!state.welcomeVideoDraftByUser || typeof state.welcomeVideoDraftByUser !== 'object') state.welcomeVideoDraftByUser = {};
              state.welcomeVideoDraftByUser[id] = chosen;
            }
            state.welcomeVideoDraftAudience = 'selected';
            _wvApplyDraftToUI();
          });

          // For the per-member video workflow, clicking another member means
          // "switch assignment to this member" rather than silently keeping the
          // previous member (e.g. Ahmed Mousa) selected. The user-picker itself
          // stays the same visually and all other access pickers remain multi.
          const picker = rec.nextElementSibling;
          if (picker && !picker.dataset.wvSingleMemberBound) {
            picker.dataset.wvSingleMemberBound = '1';
            picker.addEventListener('change', (ev) => {
              const cb = ev.target?.closest?.('input[type="checkbox"]');
              if (!cb || !cb.checked) return;
              const row = cb.closest('.user-picker-row');
              const idx = Number(row?.dataset.idx);
              if (!Number.isInteger(idx) || !rec.options[idx]) return;
              [...rec.options].forEach((opt, i) => {
                opt.selected = i === idx;
              });
              [...picker.querySelectorAll('.user-picker-row')].forEach(r => {
                const on = Number(r.dataset.idx) === idx;
                r.classList.toggle('checked', on);
                const c = r.querySelector('input[type="checkbox"]');
                if (c) c.checked = on;
              });
              const id = String(rec.options[idx].value);
              state.welcomeVideoDraftRecipientIds = [id];
              state.welcomeVideoDraftAudience = 'selected';
              if (!state.welcomeVideoDraftByUser || typeof state.welcomeVideoDraftByUser !== 'object') state.welcomeVideoDraftByUser = {};
              state.welcomeVideoDraftPath = state.welcomeVideoDraftByUser[id] || _wvAssignmentPath(id) || '';
              state.welcomeVideoDraftByUser[id] = state.welcomeVideoDraftPath;
              const count = picker.querySelector('.user-picker-count');
              if (count) count.textContent = '1 محدد';
              _wvApplyDraftToUI();
            });
          }
        }
      } catch (_) {}
      return out;
    };

    // Capture the SAVE click before the original case handler.
    // This MUST be a capture-phase listener: the legacy theme click handler is
    // registered earlier and otherwise starts a second upload at the same time.
    // Persistence goes through an admin SECURITY DEFINER RPC so recipient
    // assignments do not depend on client-side RLS.
    document.addEventListener('click', async (event) => {
      const btn = event.target?.closest?.('[data-act="save-welcome-video"]');
      if (!btn || btn.dataset.wvHandled === '1') return;
      btn.dataset.wvHandled = '1';
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!isAdmin()) return showToast('غير مصرح به','error');

      // Read the current audience/member selection, but NEVER rebuild the selected
      // video from the DOM during save. The per-member draft map is the source of
      // truth, so saving member B cannot silently reuse member A/default video.
      const audience = document.getElementById('welcome-video-audience')?.value === 'selected' ? 'selected' : 'all';
      const selNow = document.getElementById('welcome-video-recipient-select');
      const ids = audience === 'selected'
        ? _wvIds([...(selNow?.selectedOptions || [])].map(o => String(o.value)))
        : [];
      state.welcomeVideoDraftAudience = audience;
      state.welcomeVideoDraftRecipientIds = ids;
      if (!state.welcomeVideoDraftByUser || typeof state.welcomeVideoDraftByUser !== 'object') state.welcomeVideoDraftByUser = {};
      let path = '';
      if (audience === 'selected' && ids.length === 1) {
        path = _wvSafeString(state.welcomeVideoDraftByUser[ids[0]] || state.welcomeVideoDraftPath || _wvAssignmentPath(ids[0]) || '');
      } else if (audience === 'selected') {
        path = _wvSafeString(state.welcomeVideoDraftPath || '');
      } else {
        path = _wvSafeString(document.getElementById('welcome-video-library-select')?.value || state.welcomeVideoDraftPath || state.welcomeVideoCampaign?.video_path || '');
      }
      const active = document.getElementById('welcome-video-active')?.value !== 'false';
      const file = document.getElementById('welcome-video-file')?.files?.[0] || null;
      // A newly selected local file is itself a valid video choice even when
      // the library dropdown is still empty. Do not reject it before upload.
      if (!file && !path) { showToast('اختار فيديو أولًا من المكتبة أو ارفع فيديو جديدًا.','error'); delete btn.dataset.wvHandled; return; }
      if (audience === 'selected' && !ids.length) {
        showToast('اختار عضوًا واحدًا على الأقل.','error');
        delete btn.dataset.wvHandled;
        return;
      }

      state.welcomeVideoDraftPath = path;
      btn.disabled = true;
      const old = btn.innerHTML;
      btn.textContent = 'جاري الحفظ…';

      try {
        let finalPath = path;
        if (file) {
          if (!file.type.startsWith('video/')) throw new Error('اختار ملف فيديو صحيح.');
          // Upload to the permanent welcome-video folder (thumbs), where this project stores its video objects.
          finalPath = await uploadFile('welcome-videos', file, 'thumbs');

          // IMPORTANT: confirm the Storage upload immediately. Do not wait for
          // the database assignment or the (potentially slow) library refresh
          // before telling the admin that the file itself was uploaded.
          showToast(`تم رفع الملف «${file.name || 'الفيديو'}» بنجاح.`, 'success');

          // Register the uploaded object in local state immediately. The UI no
          // longer depends on a second Storage.list() request succeeding in the
          // same render cycle.
          const uploadedEntry = {
            path: finalPath,
            name: file.name || finalPath.split('/').pop() || 'video',
            size: file.size || 0,
            updated: new Date().toISOString()
          };
          state.welcomeVideoLibrary = [
            uploadedEntry,
            ...(Array.isArray(state.welcomeVideoLibrary) ? state.welcomeVideoLibrary : [])
          ].filter((v, i, arr) => arr.findIndex(x => x.path === v.path) === i);

          // Verify that Storage can actually read the object before we write
          // the database assignment. This catches an incomplete/misconfigured
          // Storage policy instead of reporting a false "saved" state.
          const verify = await sb.storage.from('welcome-videos').createSignedUrl(finalPath, 60);
          if (verify.error || !verify.data?.signedUrl) {
            throw new Error(`تم رفع الملف لكن تعذر التحقق منه في Storage: ${verify.error?.message || 'صلاحيات القراءة غير صحيحة.'}`);
          }
        }
        if (!finalPath) throw new Error('تعذر تحديد مسار الفيديو بعد الرفع.');

        const { error: saveErr } = await sb.rpc('midad_admin_save_welcome_video', {
          p_video_path: finalPath,
          p_audience_mode: audience,
          p_user_ids: ids,
          p_is_active: active
        });
        if (saveErr) throw saveErr;

        state.welcomeVideoDraftPath = finalPath;
        state.welcomeVideoDraftAudience = audience;
        state.welcomeVideoDraftRecipientIds = ids;
        if (!state.welcomeVideoDraftByUser || typeof state.welcomeVideoDraftByUser !== 'object') state.welcomeVideoDraftByUser = {};
        ids.forEach(id => { state.welcomeVideoDraftByUser[id] = finalPath; });

        // Refresh metadata in the background. The freshly uploaded object is
        // already in local state, so a slow Storage.list() cannot hide it or
        // delay the success message.
        void Promise.all([
          _wvLoadCampaignPerUser(),
          _wvLoadExcluded(),
          typeof loadWelcomeVideoRecipientsStatus === 'function'
            ? loadWelcomeVideoRecipientsStatus()
            : Promise.resolve(),
          typeof loadWelcomeVideoLibrary === 'function'
            ? loadWelcomeVideoLibrary()
            : Promise.resolve()
        ]).catch(e => console.warn('background welcome video refresh', e));
        // Keep the freshly uploaded object selected after the library refresh.
        state.welcomeVideoDraftPath = finalPath;
        render();
        showToast('تم حفظ الفيديو والحسابات المحددة بنجاح.','success');
      } catch (err) {
        console.error('per-user welcome video save', err);
        showToast(`تعذر حفظ فيديو الترحيب: ${err.message || 'خطأ غير معروف'}`,'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = old;
        delete btn.dataset.wvHandled;
      }
    }, true);

    // X = revoke the video assignment for this member completely.
    // The member returns to the same state as "this video was never sent".
    document.addEventListener('click', async (event) => {
      const btn = event.target?.closest?.('[data-act="exclude-welcome-video-user"]');
      if (!btn || btn.dataset.wvHandled === '1') return;
      btn.dataset.wvHandled = '1';
      event.preventDefault();
      event.stopImmediatePropagation();

      const uid = btn.dataset.userId;
      if (!uid || !isAdmin()) return;

      try {
        const { error } = await sb.rpc('midad_admin_revoke_welcome_video_recipient', {
          p_user_id: uid
        });
        if (error) throw error;

        // Clear a stale local draft for that member so the UI cannot snap back.
        const ids = _wvIds(state.welcomeVideoDraftRecipientIds || []);
        if (ids.includes(String(uid))) {
          state.welcomeVideoDraftRecipientIds = ids.filter(id => id !== String(uid));
        }
        if (String(state.welcomeVideoDraftRecipientIds?.[0] || '') === String(uid)) {
          state.welcomeVideoDraftPath = '';
        }
        try {
          if (localStorage.getItem('midad.welcomeVideoDraftUser') === String(uid)) {
            localStorage.removeItem('midad.welcomeVideoDraftUser');
          }
        } catch (_) {}

        await Promise.all([_wvLoadCampaignPerUser(), _wvLoadExcluded()]);
        if (typeof loadWelcomeVideoRecipientsStatus === 'function') await loadWelcomeVideoRecipientsStatus();
        render();

        const u = userById(uid) || {};
        showToast(`تم إلغاء إرسال الفيديو إلى ${userDisplayName(u)}.`, 'success');
      } catch (e) {
        showToast(`تعذر إلغاء إرسال الفيديو: ${e.message || 'خطأ غير معروف'}`, 'error');
      } finally {
        delete btn.dataset.wvHandled;
      }
    }, true);

    // Replace the old generic excluded-list save with path-aware rows.

    document.addEventListener('click', async (event) => {
      const btn = event.target?.closest?.('[data-act="save-welcome-video-excluded"]');
      if (!btn || btn.dataset.wvHandled === '1') return;
      btn.dataset.wvHandled = '1';
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!isAdmin()) return showToast('غير مصرح به','error');
      const sel = document.getElementById('welcome-video-excluded-select');
      const ids = _wvIds([...(sel?.selectedOptions || [])].map(o => o.value));
      btn.disabled = true;
      try {
        await sb.from('welcome_video_excluded').delete().eq('campaign_id',1);
        if (ids.length) {
          const rows = ids.map(user_id => ({ campaign_id:1, user_id, video_path:_wvCurrentPathForMember(user_id) || null }));
          const { error } = await sb.from('welcome_video_excluded').insert(rows);
          if (error) throw error;
        }
        await _wvLoadExcluded();
        render();
        showToast('تم حفظ قائمة المستبعدين.','success');
      } catch (e) {
        showToast(`تعذر حفظ قائمة المستبعدين: ${e.message || 'خطأ غير معروف'}`,'error');
      } finally { btn.disabled=false; delete btn.dataset.wvHandled; }
    }, true);
  }

})();

/* Final download-button animation.
   Adapted from the supplied download-button-animation package:
   same ready -> loading -> complete timing, SVG-style loader/check feel and burst,
   but mounted on the real .btn-download and started when the real download begins. */
(() => {
  if (window.__midadDownloadFxLoaded) return;
  window.__midadDownloadFxLoaded = true;

  const css = document.createElement('style');
  css.id = 'midad-download-fx-style';
  css.textContent = `
    .btn-download.midad-local-open{font-weight:900}
    .btn-download.midad-dl-fx{
      position:relative;
      overflow:hidden;
      isolation:isolate;
    }
    .btn-download.midad-dl-fx::before{
      content:'';
      position:absolute;
      inset:0;
      border-radius:inherit;
      transform:scaleX(1);
      transform-origin:center;
      transition:transform .3s ease;
      background:rgba(255,255,255,.10);
      pointer-events:none;
      z-index:0;
    }
    .btn-download.midad-dl-fx > *{position:relative;z-index:1}
    .btn-download.midad-dl-fx.midad-dl-loading{
      pointer-events:none;
      cursor:wait;
    }
    .btn-download.midad-dl-fx.midad-dl-loading .midad-dl-label{opacity:0;transition:opacity .15s ease}
    .btn-download.midad-dl-fx .midad-dl-label{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:6px;
      transition:opacity .15s ease;
    }
    .btn-download.midad-dl-fx .midad-dl-loader{
      position:absolute;
      inset:0;
      display:none;
      align-items:center;
      justify-content:center;
      gap:4px;
      z-index:2;
    }
    .btn-download.midad-dl-fx.midad-dl-loading .midad-dl-loader{display:flex}
    .midad-dl-loader i{
      width:5px;
      height:5px;
      border-radius:50%;
      background:currentColor;
      animation:midadDlDot 1s ease-in-out infinite;
    }
    .midad-dl-loader i:nth-child(2){animation-delay:.1s}
    .midad-dl-loader i:nth-child(3){animation-delay:.2s}
    .btn-download.midad-dl-fx.midad-dl-complete .midad-dl-label{opacity:0}
    .btn-download.midad-dl-fx .midad-dl-check{
      position:absolute;
      inset:0;
      display:none;
      align-items:center;
      justify-content:center;
      z-index:2;
      font-size:1.02em;
    }
    .btn-download.midad-dl-fx.midad-dl-complete .midad-dl-check{
      display:flex;
      animation:midadDlPop .35s ease-out;
    }
    @keyframes midadDlDot{
      0%,100%{transform:translateY(0);opacity:.45}
      25%{transform:translateY(-3px);opacity:1}
      50%{transform:translateY(0);opacity:.7}
    }
    @keyframes midadDlPop{
      0%{transform:scale(.5);opacity:0}
      70%{transform:scale(1.18);opacity:1}
      100%{transform:scale(1);opacity:1}
    }
    .midad-dl-confetti{
      position:fixed;
      inset:0;
      pointer-events:none;
      z-index:100600;
      overflow:hidden;
    }
    .midad-dl-confetti span{
      position:absolute;
      width:7px;
      height:11px;
      border-radius:2px;
      animation:midadDlFall .85s ease-out forwards;
      left:var(--x);
      top:var(--y);
      background:var(--c);
      transform:rotate(var(--r));
    }
    @keyframes midadDlFall{
      0%{opacity:1;transform:translate(0,0) rotate(0)}
      100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(260deg)}
    }
  `;
  document.head.appendChild(css);

  window.__midadStartDownloadAnimation = function(button){
    if(!button) return;
    button.classList.add('midad-dl-fx');

    if(!button.querySelector('.midad-dl-label')){
      const label=document.createElement('span');
      label.className='midad-dl-label';
      while(button.firstChild) label.appendChild(button.firstChild);
      button.appendChild(label);

      const loader=document.createElement('span');
      loader.className='midad-dl-loader';
      loader.innerHTML='<i></i><i></i><i></i>';
      button.appendChild(loader);

      const check=document.createElement('span');
      check.className='midad-dl-check';
      check.innerHTML='<i class="fas fa-check"></i>';
      button.appendChild(check);
    }

    // Start the original loading stage immediately on the user's click.
    // The dots remain visible until the real browser download is handed off.
    button.classList.remove('midad-dl-complete');
    button.classList.add('midad-dl-loading');
  };

  window.__midadCompleteDownloadAnimation = function(button){
    if(!button || !document.body.contains(button)) return;
    button.classList.remove('midad-dl-loading');
    button.classList.add('midad-dl-complete');

    // Keep the supplied animation's completion/burst rhythm:
    // success state first, burst shortly after.
    setTimeout(()=>{
      if(!document.body.contains(button)) return;
      const rect=button.getBoundingClientRect();
      const cs=getComputedStyle(button);
      const palette=[
        cs.getPropertyValue('--primary').trim() || '#2563eb',
        cs.getPropertyValue('--primary-light').trim() || '#93c5fd',
        cs.getPropertyValue('--purple').trim() || cs.getPropertyValue('--gold').trim() || '#7b5cff'
      ];
      const wrap=document.createElement('div');
      wrap.className='midad-dl-confetti';

      for(let i=0;i<18;i++){
        const s=document.createElement('span');
        s.style.setProperty('--x',(rect.left+rect.width/2)+'px');
        s.style.setProperty('--y',(rect.top+rect.height/2)+'px');
        s.style.setProperty('--dx',((Math.random()-.5)*170)+'px');
        s.style.setProperty('--dy',(-20-Math.random()*100)+'px');
        s.style.setProperty('--r',(Math.random()*360)+'deg');
        s.style.setProperty('--c',palette[i%palette.length]);
        wrap.appendChild(s);
      }
      document.body.appendChild(wrap);
      setTimeout(()=>wrap.remove(),1000);
    },320);

    // Reset after the same completion hold used by the supplied animation.
    setTimeout(()=>{
      if(!document.body.contains(button)) return;
      button.classList.remove('midad-dl-complete');
    },4320);
  };

  window.__midadCancelDownloadAnimation = function(button){
    if(!button || !document.body.contains(button)) return;
    button.classList.remove('midad-dl-loading','midad-dl-complete');
  };

  // Backward compatibility for any other code that still calls the old name.
  window.__midadPlayDownloadAnimation = function(button){
    window.__midadStartDownloadAnimation(button);
  };
})();
