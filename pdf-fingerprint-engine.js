/* In The Void — PDF Fingerprint Engine
 * Mirrors the marker format used by the main platform (IVFP2) and adds a
 * self-contained PDF stream reader so the scanner does not depend on PDF.js.
 */
(function(){
  'use strict';
  const PREFIX='IVFP2:';
  const MAX=512;
  const textDecoder=new TextDecoder('latin1');
  const utf8Decoder=new TextDecoder('utf-8',{fatal:false});

  function bytesToLatin1(bytes){ return textDecoder.decode(bytes); }
  function bytesToUtf8(bytes){ return utf8Decoder.decode(bytes); }
  function normalizeB64(s){
    s=String(s||'').replace(/\s+/g,'').replace(/-/g,'+').replace(/_/g,'/');
    return s+'='.repeat((4-s.length%4)%4);
  }
  function decodeB64Utf8(token){
    try{
      const bin=atob(normalizeB64(token));
      const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
      return bytesToUtf8(bytes);
    }catch(_){ return ''; }
  }
  function addFromText(text,out,seen){
    if(!text || out.length>=MAX) return;
    const re=/IVFP2:([A-Za-z0-9+\/_=-]+)/g;
    let m;
    while((m=re.exec(String(text))) && out.length<MAX){
      const token=m[1].replace(/[^A-Za-z0-9+\/_=-].*$/,'');
      const decoded=decodeB64Utf8(token);
      if(!decoded) continue;
      try{
        const obj=JSON.parse(decoded);
        if(obj && obj.v===2 && obj.f){
          const key=String(obj.f).toUpperCase();
          if(!seen.has(key)){seen.add(key);out.push(obj);}
        }
      }catch(_){ /* false positive / truncated token */ }
    }
  }


  function addFromPdfStrings(bytes,out,seen){
    const s=bytesToLatin1(bytes);
    // The platform's current PDF writer encodes marker text as a PDF hex string
    // inside a FlateDecode content stream: <49564650323A...>.
    const hexRe=/<([0-9A-Fa-f\s]{8,})>/g; let m;
    while((m=hexRe.exec(s)) && out.length<MAX){
      const h=m[1].replace(/\s+/g,'');
      if(h.length%2) continue;
      const b=new Uint8Array(h.length/2);
      for(let i=0;i<b.length;i++) b[i]=parseInt(h.slice(i*2,i*2+2),16);
      addFromText(bytesToLatin1(b),out,seen);
    }
    // Also support ordinary PDF literal strings for future marker revisions.
    const litRe=/\((?:\\.|[^\)]){6,}\)/g;
    while((m=litRe.exec(s)) && out.length<MAX){
      addFromText(m[0].slice(1,-1),out,seen);
    }
  }

  function findEndStream(bytes,start){
    const needle=new Uint8Array([101,110,100,115,116,114,101,97,109]);
    for(let i=start;i<=bytes.length-needle.length;i++){
      let ok=true; for(let j=0;j<needle.length;j++){if(bytes[i+j]!==needle[j]){ok=false;break;}}
      if(ok) return i;
    }
    return -1;
  }
  function asciiHexDecode(bytes){
    const s=bytesToLatin1(bytes).replace(/[>\s]/g,'');
    const even=s.length%2?s+'0':s; const out=new Uint8Array(Math.floor(even.length/2));
    for(let i=0;i<out.length;i++) out[i]=parseInt(even.slice(i*2,i*2+2),16)||0;
    return out;
  }
  function ascii85Decode(bytes){
    const s=bytesToLatin1(bytes).replace(/\s+/g,'').replace(/^<~/,'').replace(/~>$/,'');
    const arr=[]; let group=[];
    const pushGroup=(g)=>{
      let acc=0; for(let i=0;i<5;i++) acc=acc*85+(g[i]-33);
      arr.push((acc>>>24)&255,(acc>>>16)&255,(acc>>>8)&255,acc&255);
    };
    for(let i=0;i<s.length;i++){
      const ch=s[i];
      if(ch==='z' && group.length===0){arr.push(0,0,0,0);continue;}
      if(ch<'!'||ch>'u') continue;
      group.push(ch.charCodeAt(0));
      if(group.length===5){pushGroup(group);group=[];}
    }
    if(group.length){ const n=group.length; while(group.length<5)group.push('u'.charCodeAt(0)); const before=arr.length; pushGroup(group); arr.length=before+(n-1); }
    return new Uint8Array(arr);
  }
  async function inflate(bytes,raw){
    if(typeof DecompressionStream==='undefined') return null;
    try{
      const ds=new DecompressionStream(raw?'deflate-raw':'deflate');
      const stream=new Blob([bytes]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }catch(_){ return null; }
  }
  async function decodeStream(dictBytes,streamBytes){
    const dict=bytesToLatin1(dictBytes);
    let data=streamBytes;
    const filters=[];
    const fm=dict.match(/\/Filter\s*(?:\[([^\]]+)\]|(\/\w+))/s);
    if(fm){
      const body=fm[1]||fm[2]||'';
      const re=/\/([A-Za-z0-9]+)/g; let m; while((m=re.exec(body))) filters.push(m[1]);
    }
    if(!filters.length){
      if(/\/FlateDecode\b/.test(dict)) filters.push('FlateDecode');
      if(/\/ASCIIHexDecode\b/.test(dict)) filters.push('ASCIIHexDecode');
      if(/\/ASCII85Decode\b/.test(dict)) filters.push('ASCII85Decode');
    }
    for(const f of filters){
      if(f==='FlateDecode'||f==='Fl'){
        let d=await inflate(data,false); if(!d) d=await inflate(data,true); if(!d) return null; data=d;
      } else if(f==='ASCIIHexDecode'||f==='AHx') data=asciiHexDecode(data);
      else if(f==='ASCII85Decode'||f==='A85') data=ascii85Decode(data);
    }
    return data;
  }

  function scanRawNeedles(bytes,out,seen){
    try{ addFromText(bytesToLatin1(bytes),out,seen); }catch(_){ }
    try{
      const s=bytesToLatin1(bytes).toUpperCase();
      const prefix='49564650323A';
      let pos=0;
      while(out.length<MAX && (pos=s.indexOf(prefix,pos))>=0){
        let end=pos+prefix.length;
        while(end<s.length && /[0-9A-F\s]/.test(s[end])) end++;
        const h=s.slice(pos,end).replace(/\s+/g,'');
        if(h.length>=prefix.length && h.length%2===0){
          const b=new Uint8Array(h.length/2);
          for(let i=0;i<b.length;i++) b[i]=parseInt(h.slice(i*2,i*2+2),16)||0;
          addFromText(bytesToLatin1(b),out,seen);
        }
        pos+=prefix.length;
      }
    }catch(_){ }
  }

  async function extractFromStreams(buffer,out,seen){
    const bytes=new Uint8Array(buffer);
    const streamRe=new TextEncoder().encode('stream');
    for(let i=0;i<bytes.length-streamRe.length && out.length<MAX;i++){
      if(bytes[i]!==115||bytes[i+1]!==116||bytes[i+2]!==114||bytes[i+3]!==101||bytes[i+4]!==97||bytes[i+5]!==109) continue;
      // Look backwards to the nearest object marker and dictionary.
      const dictStart=Math.max(0,i-4096);
      const prefix=bytesToLatin1(bytes.subarray(dictStart,i));
      const objIdx=prefix.lastIndexOf('obj');
      const dictText=objIdx>=0?prefix.slice(objIdx+3):prefix;
      let dataStart=i+6;
      if(bytes[dataStart]===13&&bytes[dataStart+1]===10)dataStart+=2;
      else if(bytes[dataStart]===10||bytes[dataStart]===13)dataStart+=1;
      const end=findEndStream(bytes,dataStart); if(end<0) continue;
      const raw=bytes.subarray(dataStart,end);
      let decoded=null;
      if(/\/FlateDecode\b|\/Fl\b|\/ASCIIHexDecode\b|\/ASCII85Decode\b/.test(dictText)) decoded=await decodeStream(new TextEncoder().encode(dictText),raw);
      const target=decoded||raw;
      addFromText(bytesToLatin1(target),out,seen);
      addFromPdfStrings(target,out,seen);
    }
  }

  async function extract(buffer){
    const out=[],seen=new Set();
    // Fast path + tolerant raw scan.
    try{ const rawBytes=new Uint8Array(buffer); scanRawNeedles(rawBytes,out,seen); addFromPdfStrings(rawBytes,out,seen); }catch(_){ }
    // Correct path for the platform's compressed page content streams.
    try{ await extractFromStreams(buffer,out,seen); }catch(_){ }
    // Optional PDF.js fallback if a host already supplies it.
    try{
      if(!out.length && window.pdfjsLib){
        const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(buffer),disableWorker:true,verbosity:0}).promise;
        for(let p=1;p<=pdf.numPages && out.length<MAX;p++){
          const page=await pdf.getPage(p);
          try{
            const ops=await page.getOperatorList();
            for(const a of ops.argsArray||[]){
              const walk=v=>{
                if(v==null||out.length>=MAX)return;
                if(typeof v==='string'){addFromText(v,out,seen);return;}
                if(v instanceof Uint8Array){addFromText(bytesToLatin1(v),out,seen);return;}
                if(Array.isArray(v))v.forEach(walk);
                else if(typeof v==='object')Object.keys(v).forEach(k=>k!=='font'&&walk(v[k]));
              }; walk(a);
            }
          }catch(_){ }
          if(!out.length) try{ const tc=await page.getTextContent({includeMarkedContent:true}); addFromText((tc.items||[]).map(x=>x.str||'').join('\n'),out,seen); }catch(_){ }
          page.cleanup();
        }
      }
    }catch(_){ }
    return out;
  }
  window.InTheVoidPDFFingerprint={extract,decodeB64Utf8,addFromText,PREFIX};
})();
