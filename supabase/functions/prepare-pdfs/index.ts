import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("MIDAD_PDF_PREP_SECRET") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PREFIX = "IVFP2:";
const MAX_PARENTS = 64;
const BUCKET = "prepared-pdfs";

function b64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/,"");
}
function b64ToUtf8(value: string) {
  try {
    const token = String(value).replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(String(value).length/4)*4,"=");
    const bin = atob(token);
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  } catch { return ""; }
}
async function sha256(buffer: ArrayBuffer) {
  const h = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function cairoParts(ts: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
  });
  const p = Object.fromEntries(fmt.formatToParts(ts).map(x=>[x.type,x.value]));
  const weekday = new Intl.DateTimeFormat("en-US",{timeZone:"Africa/Cairo",weekday:"long"}).format(ts);
  const days:any = {Sunday:"الأحد",Monday:"الاثنين",Tuesday:"الثلاثاء",Wednesday:"الأربعاء",Thursday:"الخميس",Friday:"الجمعة",Saturday:"السبت"};
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}:${p.second}`,day:days[weekday]||weekday};
}
function roleLabel(role:string) {
  return role === "admin" || role === "super_admin" ? "أدمن ذهبي" : role === "moderator" ? "مشرف" : "عضو";
}
async function extractParents(input:ArrayBuffer) {
  const raw = new TextDecoder("latin1").decode(new Uint8Array(input));
  const re = /IVFP2:([A-Za-z0-9+\/_=-]+)/g;
  const out:any[] = [];
  let m;
  while ((m=re.exec(raw)) && out.length < MAX_PARENTS) {
    const decoded=b64ToUtf8(m[1]);
    if (!decoded) continue;
    try { const o=JSON.parse(decoded); if(o?.f) out.push(o); } catch {}
  }
  const seen=new Set<string>();
  return out.filter(x=>!seen.has(String(x.f).toUpperCase()) && seen.add(String(x.f).toUpperCase()));
}
async function isAdminRequest(req:Request) {
  const secret = req.headers.get("x-midad-pdf-prep-secret");
  if (CRON_SECRET && secret === CRON_SECRET) return true;
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  const {data:{user}} = await admin.auth.getUser(token);
  if (!user) return false;
  const {data:p} = await admin.from("profiles").select("role,status").eq("id",user.id).maybeSingle();
  return !!p && ["admin","super_admin"].includes(p.role) && !["pending","revoked"].includes(p.status || "active");
}
async function getTargetUsers(materialId:number|null, userId:string|null) {
  if (userId) return [userId];
  const {data,error}=await admin.from("profiles").select("id,role,status").not("status","in","(pending,revoked)");
  if(error) throw error;
  return (data||[]).map(x=>x.id);
}
async function prepareOne(material:any, user:any) {
  const materialId=Number(material.id);
  const filePath=String(material.file_path||"");
  if(!filePath || !/\.pdf$/i.test(filePath)) return {skipped:true,reason:"not_pdf"};
  const {data:existing}=await admin.from("iv_pdf_prepared_files").select("id,status,prepared_path,source_path").eq("material_id",materialId).eq("user_id",user.id).maybeSingle();
  if(existing?.status==="ready" && existing.source_path===filePath && existing.prepared_path) return {skipped:true,reason:"already_ready"};

  await admin.from("iv_pdf_prepared_files").upsert({
    material_id:materialId,user_id:user.id,status:"processing",progress:5,source_path:filePath,
    file_name:material.title || filePath.split("/").pop() || "file.pdf",error_message:null,updated_at:new Date().toISOString()
  },{onConflict:"material_id,user_id"});

  try {
    const {data:src,error:dlErr}=await admin.storage.from("materials").download(filePath);
    if(dlErr) throw dlErr;
    const input=await src.arrayBuffer();
    const parents=await extractParents(input);
    await admin.from("iv_pdf_prepared_files").update({progress:25,updated_at:new Date().toISOString()}).eq("material_id",materialId).eq("user_id",user.id);

    const now=new Date();
    const parts=cairoParts(now);
    const fingerprint=crypto.randomUUID().replaceAll("-","").toUpperCase();
    const payload={
      v:2,f:fingerprint,u:user.id,n:user.full_name||user.name||"عضو",
      r:roleLabel(user.role||"member"),d:parts.date,t:parts.time,w:parts.day,
      p:parents.map(x=>x.f).slice(0,MAX_PARENTS)
    };
    const marker=PREFIX+b64Utf8(JSON.stringify(payload));
    const pdf=await PDFDocument.load(input,{updateMetadata:false,ignoreEncryption:false});
    const font=await pdf.embedFont(StandardFonts.Helvetica);
    for(const page of pdf.getPages()){
      const {width,height}=page.getSize();
      page.drawText(marker,{x:-180,y:-180,size:0.01,font,color:rgb(1,1,1),opacity:0});
      page.drawText(marker,{x:-420,y:height+40,size:0.01,font,color:rgb(1,1,1),opacity:0});
      page.drawText(marker,{x:width+40,y:-420,size:0.01,font,color:rgb(1,1,1),opacity:0});
      page.drawText(marker,{x:width+20,y:height+20,size:0.01,font,color:rgb(1,1,1),opacity:0});
    }
    await admin.from("iv_pdf_prepared_files").update({progress:65,updated_at:new Date().toISOString()}).eq("material_id",materialId).eq("user_id",user.id);
    const output=await pdf.save({useObjectStreams:true,addDefaultPage:false});
    const finalHash=await sha256(output);
    const preparedPath=`${user.id}/${materialId}/${fingerprint}.pdf`;

    const {error:upErr}=await admin.storage.from(BUCKET).upload(preparedPath,new Blob([output],{type:"application/pdf"}),{
      upsert:true,contentType:"application/pdf",cacheControl:"31536000"
    });
    if(upErr) throw upErr;

    // Register the prepared fingerprint in the existing forensic table.
    const {error:fpErr}=await admin.from("iv_pdf_download_fingerprints").insert({
      fingerprint,user_id:user.id,user_name:user.full_name||user.name||"عضو",
      role:user.role||"member",role_label:roleLabel(user.role||"member"),
      material_id:String(materialId),file_name:material.title||filePath.split("/").pop(),
      source_path:filePath,parent_fingerprints:parents.map(x=>x.f).slice(0,MAX_PARENTS),
      parent_count:parents.length,final_sha256:finalHash,
      downloaded_at:null,prepared_at:now.toISOString(),is_prepared:true
    });
    if(fpErr && fpErr.code!=="23505") throw fpErr;

    await admin.from("iv_pdf_prepared_files").upsert({
      material_id:materialId,user_id:user.id,status:"ready",progress:100,source_path:filePath,
      prepared_path:preparedPath,file_name:material.title||filePath.split("/").pop()||"file.pdf",
      fingerprint,final_sha256:finalHash,prepared_at:now.toISOString(),updated_at:new Date().toISOString(),
      error_message:null
    },{onConflict:"material_id,user_id"});
    return {ready:true};
  } catch(e:any) {
    await admin.from("iv_pdf_prepared_files").update({
      status:"error",progress:0,error_message:String(e?.message||e),updated_at:new Date().toISOString()
    }).eq("material_id",materialId).eq("user_id",user.id);
    return {error:String(e?.message||e)};
  }
}

async function enqueueMaterial(materialId:number) {
  const {data:material,error}=await admin.from("materials").select("id,file_path").eq("id",materialId).maybeSingle();
  if(error) throw error;
  if(!material) throw new Error("MATERIAL_NOT_FOUND");
  if(!material.file_path || !/\.pdf$/i.test(material.file_path)) return {queued:0};
  const {data:users,error:ue}=await admin.from("profiles").select("id,status").not("status","in","(pending,revoked)");
  if(ue) throw ue;
  let queued=0;
  for(const u of (users||[])){
    const {data:exists}=await admin.from("iv_pdf_prepare_queue").select("id").eq("material_id",materialId).eq("user_id",u.id).in("status",["pending","processing"]).maybeSingle();
    if(!exists){ const {error:e}=await admin.from("iv_pdf_prepare_queue").insert({material_id:materialId,user_id:u.id,status:"pending"}); if(!e) queued++; }
  }
  return {material_id:materialId,queued};
}
async function enqueueUser(userId:string) {
  const {data:user,error:ue}=await admin.from("profiles").select("id,status").eq("id",userId).maybeSingle();
  if(ue) throw ue;
  if(!user || ["pending","revoked"].includes(user.status||"active")) throw new Error("USER_NOT_ACTIVE");
  const {data:mats,error}=await admin.from("materials").select("id,file_path").eq("is_active",true).not("file_path","is",null);
  if(error) throw error;
  let queued=0;
  for(const m of (mats||[])){
    if(!/\.pdf$/i.test(m.file_path||"")) continue;
    const {data:exists}=await admin.from("iv_pdf_prepare_queue").select("id").eq("material_id",m.id).eq("user_id",userId).in("status",["pending","processing"]).maybeSingle();
    if(!exists){ const {error:e}=await admin.from("iv_pdf_prepare_queue").insert({material_id:m.id,user_id:userId,status:"pending"}); if(!e) queued++; }
  }
  return {user_id:userId,queued};
}
async function processQueue(limit=5) {
  const {data:jobs,error}=await admin.from("iv_pdf_prepare_queue").select("*").eq("status","pending").not("material_id","is",null).not("user_id","is",null).order("created_at").limit(limit);
  if(error) throw error;
  const results=[];
  for(const job of (jobs||[])){
    const {data:claim}=await admin.from("iv_pdf_prepare_queue").update({status:"processing",started_at:new Date().toISOString()}).eq("id",job.id).eq("status","pending").select("id").maybeSingle();
    if(!claim) continue;
    try {
      const {data:material,error:me}=await admin.from("materials").select("id,title,file_path").eq("id",job.material_id).maybeSingle();
      if(me) throw me;
      const {data:user,error:ue}=await admin.from("profiles").select("id,name,full_name,role,status").eq("id",job.user_id).maybeSingle();
      if(ue) throw ue;
      if(!material || !user || ["pending","revoked"].includes(user.status||"active")) throw new Error("TARGET_NOT_AVAILABLE");
      const result=await prepareOne(material,user);
      await admin.from("iv_pdf_prepare_queue").update({status:result.error?"error":"done",finished_at:new Date().toISOString(),result,error_message:result.error||null}).eq("id",job.id);
      results.push(result);
    } catch(e:any) {
      await admin.from("iv_pdf_prepare_queue").update({status:"error",finished_at:new Date().toISOString(),error_message:String(e?.message||e)}).eq("id",job.id);
      results.push({error:String(e?.message||e)});
    }
  }
  return {processed:results.length,results};
}

Deno.serve(async (req)=>{
  try {
    if(req.method!=="POST") return new Response(JSON.stringify({error:"POST_ONLY"}),{status:405,headers:{"Content-Type":"application/json"}});
    const body=await req.json().catch(()=>({}));
    if(!(await isAdminRequest(req))) return new Response(JSON.stringify({error:"UNAUTHORIZED"}),{status:401,headers:{"Content-Type":"application/json"}});
    const action=body.action;
    let result;
    if(action==="prepare_material") { result=await enqueueMaterial(Number(body.material_id)); const run=await processQueue(5); result.processed=run.processed; }
    else if(action==="prepare_user") { result=await enqueueUser(String(body.user_id)); const run=await processQueue(5); result.processed=run.processed; }
    else if(action==="process_queue") result=await processQueue(5);
    else throw new Error("UNKNOWN_ACTION");
    return new Response(JSON.stringify({ok:true,...result}),{headers:{"Content-Type":"application/json"}});
  } catch(e:any) {
    return new Response(JSON.stringify({ok:false,error:String(e?.message||e)}),{status:500,headers:{"Content-Type":"application/json"}});
  }
});
