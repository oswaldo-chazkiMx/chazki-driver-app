const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sb=supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_KEY);
const $=id=>document.getElementById(id);
const LOCAL_DB="chazki-driver-offline";
const WALMART_TARIFARIO_ENABLED=false; // Activar solo con migración y pagos Walmart validados.
const WALMART_VISITAS_ENABLED=false; // La captura adicional no forma parte del flujo simplificado.
const CANCEL_DAILY_LIMIT_EXEMPT_DRIVER_ID="f640638a-d9a6-4136-a7dd-481e86715c7e";
let OFFLINE_MODE=!navigator.onLine, syncBusy=false, syncCancelBusy=false, ROUTE_SYNC_ERROR=null;
function openLocalDb(){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in window)){reject(new Error("Este dispositivo no permite guardar registros sin conexión."));return}
    const request=indexedDB.open(LOCAL_DB,2);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("cache"))db.createObjectStore("cache",{keyPath:"key"});if(!db.objectStoreNames.contains("routes"))db.createObjectStore("routes",{keyPath:"key"});if(!db.objectStoreNames.contains("cancellations"))db.createObjectStore("cancellations",{keyPath:"key"})};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error("No se pudo abrir el almacenamiento local."));
  });
}
async function localGet(store,key){
  const db=await openLocalDb();
  return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readonly"),request=tx.objectStore(store).get(key);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error||new Error("No se pudo leer el almacenamiento local."));tx.oncomplete=()=>db.close();tx.onerror=()=>{db.close();reject(tx.error||new Error("No se pudo leer el almacenamiento local."))}});
}
async function localPut(store,value){
  const db=await openLocalDb();
  return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).put(value);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error||new Error("No se pudo guardar en el dispositivo."))};tx.onabort=()=>{db.close();reject(tx.error||new Error("No se pudo guardar en el dispositivo."))}});
}
async function localDelete(store,key){
  const db=await openLocalDb();
  return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).delete(key);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error||new Error("No se pudo actualizar el almacenamiento local."))}});
}
async function localGetAll(store){
  const db=await openLocalDb();
  return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readonly"),request=tx.objectStore(store).getAll();request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error||new Error("No se pudieron leer los registros pendientes."));tx.oncomplete=()=>db.close();tx.onerror=()=>{db.close();reject(tx.error||new Error("No se pudieron leer los registros pendientes."))}});
}
const routeLocalKey=()=>`route:${ME.id}`;
const networkError=e=>!navigator.onLine||e instanceof TypeError||/network|fetch|offline|connection|socket/i.test(String(e&&(e.message||e)));
function setNetStatus(message,offline=OFFLINE_MODE){
  const el=$("net-status");if(!el)return;
  el.textContent=message||"";el.classList.toggle("offline",offline);el.classList.toggle("hide",!message);
}
function setThemeByHour(){
  const hour=new Date().getHours(),night=hour<6||hour>=18;
  document.body.dataset.theme=night?"night":"day";
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=night?"#111827":"#4b2fd0";
}
setThemeByHour();setInterval(setThemeByHour,60000);
const fmt=n=>"$"+Number(n).toLocaleString("es-MX",{maximumFractionDigits:0});
const err=(el,e)=>{$(el).innerHTML=e?`<div class="errbox">${esc((e.message||e))}</div>`:""};
function toast(m){const t=$("toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)}
$("hdate").textContent=new Date().toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"});
const VTIPOS=[["🛵","Moto"],["🚗","Sedan"],["🚙","Small"],["🚐","Large"],["🚚","Pickup"],["🚛","Van"]];

let ME=null,DRIVER=null,VEHICULO=null,CLI=[],CAUSAS=[],INCID=[],vt=null,ACC={puede_ver_ganancias:true,es_flotillero:false};
const S={stage:0,zonas:[],route:null,fallos:{},inc:null,incSel:new Set()};

// ---------- Autenticación ----------
function authErrorMessage(error){
  if(error.code==="over_email_send_rate_limit"||/email rate limit exceeded/i.test(error.message))
    return "Se alcanzó el límite de correos de confirmación. Espera antes de intentar de nuevo y avisa al administrador si continúa.";
  if(error.code==="email_address_not_authorized")
    return "El servicio de correo aún no permite enviar confirmaciones a esta dirección. Contacta al administrador.";
  if(error.message==="Invalid login credentials")return "Correo o contraseña incorrectos.";
  if(/Database error saving new user/i.test(error.message))
    return "No se pudo crear la cuenta. Verifica con tu supervisor que exista una invitación aprobada para este correo; si el problema continúa, contacta al administrador.";
  return error.message;
}
let signup=false;
function authMode(s){signup=s;$("agroup-nombre").classList.toggle("hide",!s);$("abtn").textContent=s?"Crear cuenta":"Entrar";
  $("aswitch").textContent=s?"Ya tengo cuenta":"Crear cuenta nueva";$("amode-sub").textContent=s?"Crea tu cuenta de driver":"Inicia sesión con tu correo";
  $("apass").autocomplete=s?"new-password":"current-password";$("amsg").innerHTML=""}
$("aswitch").onclick=()=>authMode(!signup);
$("abtn").onclick=async()=>{
  const email=$("aemail").value.trim(),password=$("apass").value;
  if(!email||password.length<8){$("amsg").innerHTML='<div class="errbox">Escribe tu correo y una contraseña de al menos 8 caracteres.</div>';return}
  $("abtn").disabled=true;$("amsg").innerHTML="";
  let r;
  if(signup){const nombre=$("anombre").value.trim();if(!nombre){$("abtn").disabled=false;$("amsg").innerHTML='<div class="errbox">Escribe tu nombre completo.</div>';return}
    r=await sb.auth.signUp({email,password,options:{data:{nombre}}});
    if(!r.error&&!r.data.session){$("abtn").disabled=false;authMode(false);$("amsg").innerHTML='<div class="okbox">Revisa tu correo y confirma tu cuenta si recibiste un mensaje; después inicia sesión.</div>';return}
  }else r=await sb.auth.signInWithPassword({email,password});
  $("abtn").disabled=false;
  if(r.error){$("amsg").innerHTML=`<div class="errbox">${esc(authErrorMessage(r.error))}</div>`;return}
  boot();
};
$("blogout").onclick=async()=>{await sb.auth.signOut();location.reload()};

// ---------- Arranque ----------
async function boot(){
  const {data:{session}}=await sb.auth.getSession();
  $("loading").classList.add("hide");
  if(!session){$("auth").classList.remove("hide");return}
  $("auth").classList.add("hide");ME=session.user;
  let cached=null;
  try{cached=await localGet("cache",ME.id)}catch(e){if(!navigator.onLine)throw e}
  if(!navigator.onLine){
    if(!cached){$("auth").classList.remove("hide");$("amsg").innerHTML='<div class="errbox">Conéctate una vez e inicia sesión para preparar el modo sin conexión.</div>';OFFLINE_MODE=true;setNetStatus("Sin conexión. No hay datos guardados para este dispositivo.",true);return}
    ({driver:DRIVER,clients:CLI,causes:CAUSAS,incidents:INCID,access:ACC}=cached);VEHICULO=cached.vehicle||null;
    if(String(DRIVER.estatus||"").toLowerCase()!=="activo"){$("auth").classList.remove("hide");$("amsg").innerHTML='<div class="errbox">Tu cuenta de driver está inactiva. Conéctate a internet y contacta a tu flotillero para solicitar la reactivación.</div>';return}
    OFFLINE_MODE=true;
    $("hname").textContent=DRIVER.nombre.split(" ")[0];if(ACC.es_flotillero)$("navdr").classList.remove("hide");
    fillClientes($("cli"));fillClientes($("ccli"));prefillCliente();
    $("incchips").innerHTML=INCID.map(c=>`<span class="chip" data-i="${esc(c.id)}">${esc(c.nombre)}</span>`).join("");
    renderStepper();await restoreOfflineRoute();await loadCan();
    PNR_ERROR="Conéctate a internet para consultar PNR, enviar evidencias y ver penalizaciones.";drawPnrs();
    setNetStatus("Sin conexión · el check-in, check-out y las fotos se guardarán en este dispositivo.",true);
    return;
  }
  try{
    const [d,cl,ce,ca,ic]=await Promise.all([
      sb.from("drivers").select("*").eq("id",ME.id).single(),
      sb.from("clientes").select("id,nombre").eq("activo",true).order("nombre"),
      sb.from("cedis").select("id,nombre,lat,lng,radio_m,cliente_id"),
      sb.from("causas_fallo").select("*").order("orden"),
      sb.from("tipos_incidencia").select("*").order("orden")]);
    const failed=[d.error,cl.error,ce.error,ca.error,ic.error].find(Boolean);if(failed)throw failed;
    DRIVER=d.data;CLI=(cl.data||[]).map(c=>({...c,cedis:(ce.data||[]).filter(x=>String(x.cliente_id)===String(c.id))}));CAUSAS=ca.data||[];INCID=ic.data||[];
  }catch(e){
    if(!networkError(e)||!cached)throw e;
    ({driver:DRIVER,clients:CLI,causes:CAUSAS,incidents:INCID,access:ACC}=cached);VEHICULO=cached.vehicle||null;
    if(String(DRIVER.estatus||"").toLowerCase()!=="activo"){$("auth").classList.remove("hide");$("amsg").innerHTML='<div class="errbox">Tu cuenta de driver está inactiva. Conéctate a internet y contacta a tu flotillero para solicitar la reactivación.</div>';return}
    OFFLINE_MODE=true;
    $("hname").textContent=DRIVER.nombre.split(" ")[0];if(ACC.es_flotillero)$("navdr").classList.remove("hide");
    fillClientes($("cli"));fillClientes($("ccli"));prefillCliente();
    $("incchips").innerHTML=INCID.map(c=>`<span class="chip" data-i="${esc(c.id)}">${esc(c.nombre)}</span>`).join("");
    renderStepper();await restoreOfflineRoute();await loadCan();
    setNetStatus("Conexión intermitente · el check-in, check-out y las fotos se guardarán en este dispositivo.",true);
    return;
  }
  if(!DRIVER){toast("No se encontró tu perfil de driver");return}
  if(String(DRIVER.estatus||"").toLowerCase()!=="activo"){
    $("auth").classList.remove("hide");
    $("amsg").innerHTML='<div class="errbox">Tu cuenta de driver está inactiva. Contacta a tu flotillero para solicitar la reactivación.</div>';
    await sb.auth.signOut();return;
  }
  $("hname").textContent=DRIVER.nombre.split(" ")[0];
  fillClientes($("cli"));fillClientes($("ccli"));prefillCliente();
  $("incchips").innerHTML=INCID.map(c=>`<span class="chip" data-i="${esc(c.id)}">${esc(c.nombre)}</span>`).join("");
  renderStepper();
  const ac=await sb.rpc("mi_acceso_ganancias");if(ac.error&&networkError(ac.error)){OFFLINE_MODE=true;ACC=cached?cached.access:ACC}else if(ac.error)throw ac.error;else if(ac.data)ACC=ac.data;
  await localPut("cache",{key:ME.id,driver:DRIVER,clients:CLI,causes:CAUSAS,incidents:INCID,access:ACC});
  if(OFFLINE_MODE){
    $("hname").textContent=DRIVER.nombre.split(" ")[0];if(ACC.es_flotillero)$("navdr").classList.remove("hide");
    await restoreOfflineRoute();await loadCan();PNR_ERROR="Conéctate a internet para consultar PNR, enviar evidencias y ver penalizaciones.";drawPnrs();
    setNetStatus("Conexión intermitente · el check-in, check-out y las fotos se guardarán en este dispositivo.",true);
    return;
  }
  try{await Promise.all([loadPerfil(),loadGan(),loadCan(),loadPnrs(),resumeRoute()])}
  catch(e){if(!networkError(e))throw e;OFFLINE_MODE=true;await restoreOfflineRoute();await loadCan();setNetStatus("Conexión intermitente · el check-in, check-out y las fotos se guardarán en este dispositivo.",true);return}
  if(navigator.onLine)await syncPendingCancellations();
  suscribirAvisos();
  if(ACC.es_flotillero){$("navdr").classList.remove("hide");loadDrivers()}
  setNetStatus("");
}

// ---------- Navegación ----------
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x===b));
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.id==="t-"+b.dataset.t));window.scrollTo(0,0)});

// ---------- Cliente / CEDIS ----------
// El cliente de la base de fleet solo se precarga: el driver puede elegir cualquier otro
function prefillCliente(){
  const cedisDefaultId=DRIVER&&DRIVER.cedis_default_id;
  const habitual=cedisDefaultId&&CLI.flatMap(c=>c.cedis.map(e=>({...e,cliente_id:c.id,cliente_nombre:c.nombre}))).find(e=>String(e.id)===String(cedisDefaultId));
  const clienteId=habitual?.cliente_id??(DRIVER&&DRIVER.cliente_default_id);
  if(!clienteId||!CLI.some(c=>String(c.id)===String(clienteId)))return;
  ["cli","ccli"].forEach(sid=>{
    const sel=$(sid);sel.value=String(clienteId);
    const cedisSel=$(sid==="cli"?"cedis":"ccedis");fillCedis(cedisSel,clienteId);
    if(habitual)cedisSel.value=String(habitual.id);
  });
  const n=cliName(clienteId);$("cli-hint").textContent=`Tu ${habitual?"CEDIS habitual":"cliente habitual"} es ${habitual?habitual.cliente_nombre+" · "+habitual.nombre:n}. Puedes elegir otro si hoy trabajas en otra cuenta.`;
  checkIn();checkCan();
}
function fillClientes(sel){sel.innerHTML='<option value="">Selecciona cliente…</option>'+CLI.map(c=>`<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("")}
function fillCedis(sel,cid){const c=CLI.find(x=>String(x.id)===String(cid));const l=c?c.cedis.slice().sort((a,b)=>a.nombre.localeCompare(b.nombre)):[];
  sel.innerHTML='<option value="">Selecciona CEDIS…</option>'+l.map(e=>`<option value="${esc(e.id)}">${esc(e.nombre)}</option>`).join("");if(l.length===1)sel.selectedIndex=1}
function detectar(n){
  const box=$("detbox"+n),btn=$("det"+n),cs=n===1?"cli":"ccli",es=n===1?"cedis":"ccedis";
  if(!navigator.geolocation){box.innerHTML='<div class="note">Tu dispositivo no permite detectar la ubicación. Elige el CEDIS manualmente.</div>';return}
  btn.disabled=true;box.innerHTML='<div class="note">Detectando ubicación…</div>';
  navigator.geolocation.getCurrentPosition(pos=>{
    btn.disabled=false;const {latitude:la,longitude:lo}=pos.coords;let best=null;
    CLI.forEach(c=>c.cedis.forEach(e=>{if(e.lat==null||e.lng==null)return;const d=distM(la,lo,+e.lat,+e.lng);if(!best||d<best.d)best={d,c,e}}));
    if(!best||best.d>3000){box.innerHTML='<div class="note">No detecté un CEDIS cerca de ti. Elígelo manualmente.</div>';return}
    box.innerHTML=`<div class="okbox" style="margin-top:8px">Detecté <b>${esc(best.c.nombre)} · ${esc(best.e.nombre)}</b> (a ${best.d>=1000?(best.d/1000).toFixed(1)+" km":best.d+" m"}).<br>¿Es correcto?<div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm" type="button" id="det-si${n}">Sí, es correcto</button><button class="btn ghost sm" type="button" id="det-no${n}">No, lo elijo yo</button></div></div>`;
    $("det-si"+n).onclick=()=>{$(cs).value=String(best.c.id);$(cs).dispatchEvent(new Event("change"));$(es).value=String(best.e.id);$(es).dispatchEvent(new Event("change"));$(es).dispatchEvent(new Event("input"));box.innerHTML=`<div class="note">✔ ${esc(best.c.nombre)} · ${esc(best.e.nombre)}</div>`};
    $("det-no"+n).onclick=()=>{box.innerHTML='<div class="note">Elige el cliente y el CEDIS manualmente.</div>'};
  },()=>{btn.disabled=false;box.innerHTML='<div class="note">No pude obtener tu ubicación (revisa el permiso). Elige el CEDIS manualmente.</div>'},{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
}
$("det1").onclick=()=>detectar(1);$("det2").onclick=()=>detectar(2);
const cedObj=(cid,eid)=>{const c=CLI.find(x=>String(x.id)===String(cid));return c?c.cedis.find(y=>String(y.id)===String(eid)):null};
function distM(a,b,c,d){const R=6371000,r=x=>x*Math.PI/180,h=Math.sin(r(c-a)/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(r(d-b)/2)**2;return Math.round(2*R*Math.asin(Math.sqrt(h)))}
const fmtDist=m=>m<1000?m+" m":(m/1000).toFixed(1)+" km";
const cliName=id=>(CLI.find(x=>String(x.id)===String(id))||{}).nombre||"";
const cedObjById=id=>CLI.flatMap(c=>c.cedis.map(e=>({...e,cliente_id:c.id,cliente_nombre:c.nombre}))).find(e=>String(e.id)===String(id));
const cedNameById=id=>cedObjById(id)?.nombre||"";
const cedName=(cid,eid)=>{const c=CLI.find(x=>String(x.id)===String(cid));const e=c&&c.cedis.find(y=>String(y.id)===String(eid));return e?e.nombre:""};
$("cli").onchange=()=>{fillCedis($("cedis"),$("cli").value);checkIn()};
function resetFoto(){const hadEvidence=canBlob||canBitacoraBlob;canBlob=null;canMeta=null;canBitacoraBlob=null;canEvidenceGeneration++;canLocationGeneration++;$("cv").classList.add("hide");$("wm-can-status").textContent="";if(hadEvidence)$("cmeta").innerHTML='<span style="color:var(--bad)">Cambiaste el CEDIS: vuelve a tomar las fotos para validar tu ubicación.</span>'}
$("ccli").onchange=()=>{fillCedis($("ccedis"),$("ccli").value);resetFoto();checkCan()};
$("ccedis").onchange=()=>{resetFoto();checkCan()};

// ---------- Ruta ----------
function renderStepper(){const n=["Check-in","Fin de ruta","Incidencias","Check-out"];
  $("stepper").innerHTML=n.map((x,i)=>`<div class="${i<S.stage?"done":i===S.stage?"cur":""}"><i></i>${x}</div>`).join("")}
function unlock(id,on){$(id).classList.toggle("lock",!on)}
function setStage(n){
  S.stage=n;renderStepper();unlock("s2",n===1);unlock("s3",n===2);unlock("s4",n===3);
  if(n>=1&&S.route){$("s1").classList.add("hide");$("sresume").classList.remove("hide");const r=S.route;
    $("sresume").innerHTML=`<h2>✅ Ruta en curso</h2><div class="kv"><span>Cliente</span><b>${esc(r.cli)}</b></div><div class="kv"><span>CEDIS</span><b>${esc(r.cedis)}</b></div>
    <div class="kv"><span>ID de ruta</span><b>${esc(r.rid)}</b></div><div class="kv"><span>Paquetes</span><b>${esc(r.pk)}</b></div>
    <div class="kv"><span>Zonas</span><b>${esc(r.zonas.join(", "))}</b></div><div class="kv"><span>Modalidad</span><b>${r.auxiliarRequerido?(r.viajaConAuxiliar?"Con auxiliar":"Solo"):"No aplica"}</b></div><div class="kv"><span>Llegada a CEDIS</span><b>${esc(r.hora)}</b></div>`;
    $("hstate").className="pill ok";$("hstate").textContent="En ruta"}
}
async function resumeRoute(){
  const saved=await localGet("routes",routeLocalKey());
  if(saved){
    await restoreOfflineRoute(saved);
    if(navigator.onLine)await syncPendingRoute();
    return;
  }
  const {data}=await sb.from("rutas").select("*,cedis(id,nombre,cliente_id)").eq("driver_id",ME.id).eq("estado","en_ruta").order("checkin_at",{ascending:false}).limit(1);
  if(!data||!data.length)return;const r=data[0];
  S.route={unidad:r.tipo_unidad,auxiliarRequerido:r.auxiliar_requerido===true,viajaConAuxiliar:r.viaja_con_auxiliar===true,dbId:r.id,cli:cliName(r.cedis.cliente_id),cliId:r.cedis.cliente_id,cedis:r.cedis.nombre,cedisId:r.cedis.id,pk:r.paquetes_asignados,rid:r.id_ruta,zonas:r.zonas,
    hora:new Date(r.hora_llegada_cedis).toTimeString().slice(0,5),checkin:new Date(r.checkin_at)};
  await localPut("routes",{key:routeLocalKey(),driverId:ME.id,status:"active",serverRouteId:r.id,
    routeInfo:{unidad:r.tipo_unidad,auxiliarRequerido:S.route.auxiliarRequerido,viajaConAuxiliar:S.route.viajaConAuxiliar,cli:S.route.cli,cliId:S.route.cliId,cedis:S.route.cedis,cedisId:S.route.cedisId,pk:S.route.pk,rid:S.route.rid,zonas:S.route.zonas,hora:S.route.hora,checkin:S.route.checkin.toISOString()},
    routePayload:{driver_id:ME.id,cedis_id:r.cedis.id,id_ruta:r.id_ruta,paquetes_asignados:r.paquetes_asignados,zonas:r.zonas,hora_llegada_cedis:r.hora_llegada_cedis,tipo_unidad:r.tipo_unidad,auxiliar_requerido:S.route.auxiliarRequerido,viaja_con_auxiliar:S.route.viajaConAuxiliar,evidencia_auxiliar_checkin_path:r.evidencia_auxiliar_checkin_path||null,evidencia_auxiliar_checkout_path:r.evidencia_auxiliar_checkout_path||null,checkin_at:r.checkin_at},checkout:null,manifests:[],remoteManifests:[]});
  prefillCan();setStage(1);updFin();if(requiereManif())await loadManif();
}
async function restoreOfflineRoute(record){
  if(!record)return;
  ROUTE_SYNC_ERROR=record.syncError||null;
  const r=record.routeInfo;
  S.route={...r,viajaConAuxiliar:r.viajaConAuxiliar===true,dbId:record.serverRouteId||null,localKey:record.key,checkin:new Date(r.checkin)};
  S.zonas=[...r.zonas];prefillCan();setStage(1);updFin();
  if(record.checkout){
    S.result={ent:record.checkout.ent, fal:record.checkout.fal};
    S.inc=record.checkout.hubo_incidencias;
    S.incSel=new Set(record.checkout.incidencias.map(x=>String(x.incidencia_id)));
    S.routeLocalCheckout=record.checkout;
    showRouteDone(true);
  }else if(requiereManif()){
    MANIF=[...(record.remoteManifests||[]).map(m=>({...m,local:false,url:""})),...(record.manifests||[]).map(m=>({...m,local:true}))];
    drawManif();enableOut();
  }
}
async function syncAuxiliaryEvidence(record,stage){
  if(!record.routePayload.viaja_con_auxiliar)return;
  const isCheckin=stage==="checkin",field=isCheckin?"evidencia_auxiliar_checkin_path":"evidencia_auxiliar_checkout_path";
  const holder=isCheckin?record.auxiliary:record.checkout;
  const blobKey=isCheckin?"checkinBlob":"auxiliaryBlob",pathKey=isCheckin?"checkinPath":"auxiliaryEvidencePath";
  if(!holder)throw new Error(`Falta la evidencia fotográfica del auxiliar en el ${isCheckin?"check-in":"check-out"}.`);
  let path=holder[pathKey]||record.routePayload[field]||null;
  if(!path&&holder[blobKey]){
    const stamp=Date.parse(record.routeInfo.checkin);
    path=`${ME.id}/${stamp}/${stage}.jpg`;
    holder[pathKey]=path;
    if(isCheckin)record.routePayload[field]=path;else record.checkout[field]=path;
    await localPut("routes",record);
  }
  if(holder[blobKey]){
    const {error}=await sb.storage.from("ruta-auxiliares").upload(path,holder[blobKey],{contentType:"image/jpeg",upsert:true});
    if(error)throw error;
    holder[blobKey]=null;
    if(isCheckin)record.routePayload[field]=path;else record.checkout[field]=path;
    await localPut("routes",record);
  }
  if(!path)throw new Error(`No se guardó la foto requerida del auxiliar en el ${isCheckin?"check-in":"check-out"}.`);
}
async function syncPendingRoute(){
  if(syncBusy||!ME||!navigator.onLine)return false;
  const key=routeLocalKey();let record;
  try{record=await localGet("routes",key)}catch(e){setNetStatus(e.message,true);return false}
  if(!record){ROUTE_SYNC_ERROR=null;OFFLINE_MODE=false;setNetStatus("");return true}
  ROUTE_SYNC_ERROR=record.syncError||null;
  syncBusy=true;
  let syncStep="preparando el envío de la ruta";
  try{
    syncStep="sincronizando evidencia del check-in";
    await syncAuxiliaryEvidence(record,"checkin");
    if(!record.serverRouteId){
      syncStep="verificando si el check-in ya existe en Supabase";
      const {data:existing,error:lookupError}=await sb.from("rutas").select("id")
        .eq("driver_id",record.routePayload.driver_id)
        .eq("id_ruta",record.routePayload.id_ruta)
        .eq("checkin_at",record.routePayload.checkin_at)
        .maybeSingle();
      if(lookupError)throw lookupError;
      let route=existing;
      if(!route){
        syncStep="registrando el check-in en Supabase";
        const inserted=await sb.from("rutas").insert(record.routePayload).select("id").single();
        if(inserted.error)throw inserted.error;
        route=inserted.data;
      }
      record.serverRouteId=route.id;record.status="active";await localPut("routes",record);
      if(S.route)S.route.dbId=route.id;
    }
    for(let i=0;i<(record.manifests||[]).length;i++){
      const photo=record.manifests[i];
      if(!photo.photoPath){
        syncStep="subiendo una foto del manifiesto";
        const path=`${ME.id}/${record.serverRouteId}/offline-${photo.id}.jpg`;
        const {error}=await sb.storage.from("manifiestos").upload(path,photo.blob,{contentType:"image/jpeg",upsert:true});
        if(error)throw error;
        photo.photoPath=path;await localPut("routes",record);
      }
      if(!photo.rowSaved){
        syncStep="registrando la foto del manifiesto";
        const {data:existing,error:lookupError}=await sb.from("ruta_manifiestos").select("id")
          .eq("ruta_id",record.serverRouteId).eq("foto_path",photo.photoPath).maybeSingle();
        if(lookupError)throw lookupError;
        if(!existing){
          const {error}=await sb.from("ruta_manifiestos").insert({ruta_id:record.serverRouteId,foto_path:photo.photoPath});
          if(error)throw error;
        }
        photo.rowSaved=true;await localPut("routes",record);
      }
    }
    if(record.manifests&&record.manifests.length){record.manifests=[];await localPut("routes",record)}
    if(record.checkout){
      syncStep="sincronizando evidencia del check-out";
      await syncAuxiliaryEvidence(record,"checkout");
      if(record.checkout.fallos.length){syncStep="registrando los paquetes fallidos";const rows=record.checkout.fallos.map(x=>({...x,ruta_id:record.serverRouteId}));const {error}=await sb.from("ruta_fallos").upsert(rows);if(error)throw error}
      if(record.checkout.incidencias.length){syncStep="registrando las incidencias de la ruta";const rows=record.checkout.incidencias.map(x=>({...x,ruta_id:record.serverRouteId}));const {error}=await sb.from("ruta_incidencias").upsert(rows);if(error)throw error}
      syncStep="cerrando la ruta en Supabase";
      const {data:closedRoute,error}=await sb.from("rutas").update({estado:"cerrada",checkout_at:record.checkout.checkoutAt,
        entregados:record.checkout.ent,fallidos:record.checkout.fal,hubo_incidencias:record.checkout.hubo_incidencias,
        evidencia_auxiliar_checkout_path:record.checkout.evidencia_auxiliar_checkout_path||null,...record.checkout.extras})
        .eq("id",record.serverRouteId).select("id").single();
      if(error)throw error;
      if(!closedRoute)throw new Error("Supabase no confirmó el cierre de la ruta.");
      ROUTE_SYNC_ERROR=null;
      await localDelete("routes",key);S.routeLocalCheckout=record.checkout;showRouteDone(false);
    }else{
      ROUTE_SYNC_ERROR=null;
      delete record.syncError;
      record.status="active";await localPut("routes",record);
      if(S.route)S.route.dbId=record.serverRouteId;
      if(requiereManif())await loadManif();
    }
    OFFLINE_MODE=false;setNetStatus("");
    return true;
  }catch(e){
    ROUTE_SYNC_ERROR={
      step:syncStep,
      message:String(e?.message||e||"Error desconocido"),
      code:e?.code||null,
      details:e?.details||null,
      hint:e?.hint||null,
      status:e?.status||null
    };
    record.syncError=ROUTE_SYNC_ERROR;
    try{await localPut("routes",record)}
    catch(saveError){ROUTE_SYNC_ERROR.saveError=String(saveError?.message||saveError)}
    if(networkError(e)){OFFLINE_MODE=true;setNetStatus("Conexión intermitente · hay registros guardados en este dispositivo y se enviarán al recuperar la red.",true)}
    else{const target=record.checkout?"outerr":"inerr";err(target,e);setNetStatus("El servidor no aceptó la sincronización. Tus datos siguen guardados en este dispositivo.",true)}
    renderRouteSyncError();
    return false;
  }finally{syncBusy=false}
}
async function retryPendingRouteSync(){
  const button=$("sync-route");
  if(button.disabled)return;
  button.disabled=true;button.textContent="⏳";
  try{
    if(!ME)throw new Error("Inicia sesión para sincronizar la ruta.");
    if(!navigator.onLine){setNetStatus("Sin conexión · la ruta sigue guardada en este dispositivo.",true);toast("Conéctate a internet e inténtalo de nuevo.");return}
    if(syncBusy){toast("La sincronización ya está en curso.");return}
    const record=await localGet("routes",routeLocalKey());
    if(!record){toast("No hay rutas pendientes de sincronizar.");return}
    const wasOffline=OFFLINE_MODE,synced=await syncPendingRoute();
    if(synced){toast("Ruta sincronizada correctamente.");if(wasOffline)location.reload()}
    else toast("No se pudo sincronizar. La ruta sigue guardada en el dispositivo.");
  }catch(e){
    setNetStatus(`No se pudo sincronizar la ruta: ${e.message||e}`,true);
    toast("No se pudo sincronizar. La ruta sigue guardada en el dispositivo.");
  }finally{button.disabled=false;button.textContent="🔄"}
}
$("sync-route").onclick=retryPendingRouteSync;
function routeDoneMarkup(pending){
  const r=S.route,res=S.result,t=S.routeLocalCheckout?new Date(S.routeLocalCheckout.checkoutAt):new Date();
  const incs=S.incSel.size?[...S.incSel].map(i=>(INCID.find(x=>String(x.id)===String(i))||{}).nombre).filter(Boolean):[];
  ["s2","s3","s4","sresume"].forEach(x=>$(x).classList.add("hide"));$("sdone").classList.remove("hide");
  $("sdone").innerHTML=`<div class="${pending?"alerta w":"okbox"}"><b>${pending?"📴 Ruta guardada en este dispositivo":"🏁 Ruta finalizada"}</b><br>${pending?"Se enviará automáticamente cuando se resuelva el problema.":""}<br>${esc(r.cli)} · ${esc(r.cedis)} · ${esc(r.rid)}</div>
  <div id="route-sync-error" aria-live="polite"></div>
  <div class="kv"><span>Entregados</span><b>${esc(res.ent)}</b></div><div class="kv"><span>Fallidos</span><b>${esc(res.fal)}</b></div>
  <div class="kv"><span>Efectividad</span><b>${Math.round(res.ent/r.pk*100)}%</b></div>
  <div class="kv"><span>Incidencias</span><b>${incs.length?incs.join(", "):"Ninguna"}</b></div>
  <div class="kv"><span>Check-out</span><b>${t.toTimeString().slice(0,5)}</b></div><button class="btn" id="bnew">Iniciar nueva ruta</button>`;
  $("hstate").className=`pill ${pending?"w":"ok"}`;$("hstate").textContent=pending?"Pendiente de envío":"Ruta cerrada";
  renderRouteSyncError();
  $("bnew").onclick=()=>location.reload();
}
function renderRouteSyncError(){
  const box=$("route-sync-error");
  if(!box||!ROUTE_SYNC_ERROR)return;
  const e=ROUTE_SYNC_ERROR;
  box.innerHTML=`<div class="errbox"><b>No se sincronizó durante: ${esc(e.step)}.</b><br>${esc(e.message)}
    ${e.code?`<br><small>Código: ${esc(e.code)}</small>`:""}
    ${e.status?`<br><small>HTTP: ${esc(e.status)}</small>`:""}
    ${e.details?`<br><small>Detalle: ${esc(e.details)}</small>`:""}
    ${e.hint?`<br><small>Sugerencia del servidor: ${esc(e.hint)}</small>`:""}
    ${e.saveError?`<br><small>No se pudo guardar el diagnóstico en el dispositivo: ${esc(e.saveError)}</small>`:""}
    <br><small>Tus datos siguen guardados en este dispositivo. Usa 🔄 para reintentar.</small></div>`;
}
function showRouteDone(pending=false){routeDoneMarkup(pending)}
function prefillCan(){const r=S.route;resetFoto();$("ccli").value=r.cliId;fillCedis($("ccedis"),r.cliId);$("ccedis").value=r.cedisId;checkCan()}

$("zinp").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addZona()}});
$("zinp").addEventListener("blur",addZona);
function addZona(){const v=$("zinp").value.trim();if(v&&!S.zonas.includes(v))S.zonas.push(v);$("zinp").value="";$("zchips").innerHTML=S.zonas.map((z,i)=>`<span class="chip on" data-i="${i}">${esc(z)} ✕</span>`).join("");checkIn()}
$("zchips").onclick=e=>{const i=e.target.dataset.i;if(i!==undefined){S.zonas.splice(+i,1);addZona()}};
$("bnow").onclick=()=>{$("hora").value=new Date().toTimeString().slice(0,5);checkIn()};
["pk","rid","hora","cedis"].forEach(id=>$(id).addEventListener("input",checkIn));
const esCoppel=()=>/^COPPEL/i.test(cliName($("cli").value)||"");
const TIPOS_SIN_EQUIVALENCIA=["4.5T","5T","RABÓN","TORTON SECO","TORTON REFRIGERADO","TRAILER 53 SECO","TRAILER 53 REFRIGERADO"];
function tipoUnidadRuta(){
  const tipo=VEHICULO?.tipo||DRIVER?.tipo_unidad||null;
  return TIPOS_SIN_EQUIVALENCIA.includes(tipo)?tipo:esCoppel()?$("unidad").value:tipo;
}
function syncUnidad(){const on=esCoppel();$("unidad-w").classList.toggle("hide",!on);if(on&&!$("unidad").value&&/BT/i.test(cliName($("cli").value)))$("unidad").value="3.5T";if(!on)$("unidad").value=""}
$("unidad").onchange=()=>checkIn();
document.querySelector("#cedis").addEventListener("change",checkIn);
const textoAux=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
const AUX_CAMERA={in:{stream:null,blob:null,url:null},out:{stream:null,blob:null,url:null}};
function requiereAuxiliarRuta(){
  const cliente=textoAux(cliName($("cli").value)+" "+cedName($("cli").value,$("cedis").value));
  const ruta=textoAux([cedName($("cli").value,$("cedis").value),$("rid").value,...S.zonas,$("unidad").value,VEHICULO?.tipo,VEHICULO?.marca_modelo,DRIVER?.tipo_vehiculo,DRIVER?.tipo_unidad,DRIVER?.esquema].join(" "));
  return /MERCADO\s*LIBRE|\bMELI\b|\bML\b|LIVERPOOL|WALMART/.test(cliente)
    || /SMALL|LARGE|3[.,]?\s*5|(?:^|\W)BT(?:$|\W)|CIRCUIT/.test(ruta);
}
function syncAuxiliary(){
  const required=requiereAuxiliarRuta();
  $("aux-checkin").classList.toggle("hide",!required);
  $("aux-checkin-proof").classList.toggle("hide",!required||$("aux-mode").value!=="auxiliar");
  if(!required){$("aux-mode").value="";clearAuxCapture("in")}
}
function stopAuxCamera(stage){
  const camera=AUX_CAMERA[stage],video=$(`aux-${stage}-camera`);
  if(camera.stream)camera.stream.getTracks().forEach(track=>track.stop());
  camera.stream=null;video.srcObject=null;video.classList.add("hide");
  $(`aux-${stage}-capture`).disabled=true;
}
function clearAuxCapture(stage){
  stopAuxCamera(stage);
  const camera=AUX_CAMERA[stage],preview=$(`aux-${stage}-preview`);
  camera.blob=null;
  if(camera.url)URL.revokeObjectURL(camera.url);
  camera.url=null;preview.removeAttribute("src");preview.classList.add("hide");
}
async function abrirCamaraAuxiliar(stage){
  clearAuxCapture(stage);
  if(stage==="in")checkIn();else enableOut();
  err(`aux-${stage}-error`,null);
  if(!navigator.mediaDevices?.getUserMedia){err(`aux-${stage}-error`,new Error("Este dispositivo no permite abrir la cámara desde la app. Usa la app en una conexión segura o contacta a Operaciones."));return}
  stopAuxCamera(stage);
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:"user",width:{ideal:1280},height:{ideal:960}}});
    const camera=AUX_CAMERA[stage],video=$(`aux-${stage}-camera`);
    camera.stream=stream;video.srcObject=stream;video.classList.remove("hide");
    await video.play();
    $(`aux-${stage}-capture`).disabled=false;
  }catch(e){stopAuxCamera(stage);err(`aux-${stage}-error`,new Error(`No se pudo abrir la cámara: ${e.message||e}`))}
}
function textoMarcaAgua(ctx,text,maxWidth){
  const words=String(text).split(/\s+/),lines=[];let line="";
  for(const word of words){const test=line?`${line} ${word}`:word;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word}else line=test}
  if(line)lines.push(line);
  return lines;
}
async function capturarFotoAuxiliar(stage){
  const camera=AUX_CAMERA[stage],video=$(`aux-${stage}-camera`),canvas=$(`aux-${stage}-canvas`);
  if(!camera.stream||!video.videoWidth||!video.videoHeight)throw new Error("Abre la cámara y espera a que se vea la imagen antes de tomar la foto.");
  const capturedAt=new Date(),loc=await getLoc(),scale=Math.min(1,1600/video.videoWidth);
  canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
  const ctx=canvas.getContext("2d");ctx.drawImage(video,0,0,canvas.width,canvas.height);
  const isCheckin=stage==="in",client=isCheckin?cliName($("cli").value):S.route?.cli,cedis=isCheckin?cedName($("cli").value,$("cedis").value):S.route?.cedis;
  const routeId=isCheckin?$("rid").value.trim():S.route?.rid;
  const unit=isCheckin?tipoUnidadRuta():S.route?.unidad;
  const time=capturedAt.toLocaleString("es-MX",{dateStyle:"medium",timeStyle:"medium"});
  const lines=[
    `CHAZKI · EVIDENCIA DE ${isCheckin?"CHECK-IN":"CHECK-OUT"}`,
    `${DRIVER.nombre||"Driver"} · ${DRIVER.codigo||ME.id}`,
    `Cliente: ${client||"—"}`,
    `CEDIS: ${cedis||"—"} · Ruta: ${routeId||"—"}`,
    `Unidad: ${unit||"—"} · Placa: ${VEHICULO?.placas||"—"}`,
    `Fecha y hora: ${time}`,
    loc?`GPS: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)} · ±${Math.round(loc.accuracy)} m`:"GPS no disponible · activa Ubicación y concede permiso"
  ];
  const fontSize=Math.max(15,Math.round(canvas.width/48)),padding=fontSize*.7,lineHeight=fontSize*1.35;
  ctx.font=`${fontSize}px sans-serif`;
  const wrapped=lines.flatMap(line=>textoMarcaAgua(ctx,line,canvas.width-padding*2));
  const blockHeight=wrapped.length*lineHeight+padding*2;
  ctx.fillStyle="rgba(0,0,0,.68)";ctx.fillRect(0,canvas.height-blockHeight,canvas.width,blockHeight);
  ctx.textAlign="left";ctx.textBaseline="top";
  wrapped.forEach((line,index)=>{ctx.font=index===0?`bold ${fontSize}px sans-serif`:`${fontSize}px sans-serif`;ctx.fillStyle="#fff";ctx.fillText(line,padding,canvas.height-blockHeight+padding+index*lineHeight)});
  ctx.save();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(-.38);ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.font=`bold ${Math.round(canvas.width/9)}px sans-serif`;ctx.fillStyle="rgba(255,255,255,.16)";ctx.fillText("CHAZKI",0,0);ctx.restore();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.82));
  if(!blob)throw new Error("No se pudo procesar la foto capturada.");
  if(blob.size>10*1024*1024)throw new Error("La foto procesada excede el límite de 10 MB.");
  camera.blob=blob;
  if(camera.url)URL.revokeObjectURL(camera.url);
  camera.url=URL.createObjectURL(blob);
  const preview=$(`aux-${stage}-preview`);preview.src=camera.url;preview.classList.remove("hide");
  stopAuxCamera(stage);err(`aux-${stage}-error`,null);
  if(stage==="in")checkIn();else enableOut();
}
["in","out"].forEach(stage=>{
  $(`aux-${stage}-open`).onclick=()=>abrirCamaraAuxiliar(stage);
  $(`aux-${stage}-capture`).onclick=async()=>{
    $(`aux-${stage}-capture`).disabled=true;err(`aux-${stage}-error`,null);
    try{await capturarFotoAuxiliar(stage)}catch(e){err(`aux-${stage}-error`,e);$(`aux-${stage}-capture`).disabled=!AUX_CAMERA[stage].stream}
  };
});
document.addEventListener("visibilitychange",()=>{if(document.hidden){stopAuxCamera("in");stopAuxCamera("out")}});
$("aux-mode").onchange=()=>{if($("aux-mode").value!=="auxiliar")clearAuxCapture("in");checkIn()};
async function procesarFotoAuxiliar(stage){
  const blob=AUX_CAMERA[stage].blob;
  if(!blob)throw new Error("Abre la cámara y toma una foto nueva con tu auxiliar.");
  return blob;
}
function checkIn(){syncUnidad();syncAuxiliary();const required=requiereAuxiliarRuta(),auxMode=$("aux-mode").value;
  const auxiliaryOk=!required||auxMode==="solo"||(auxMode==="auxiliar"&&!!AUX_CAMERA.in.blob);
  const ok=$("cli").value&&$("cedis").value&&(!esCoppel()||$("unidad").value)&&+$("pk").value>0&&$("rid").value.trim()&&S.zonas.length&&$("hora").value&&auxiliaryOk;
  $("bin").disabled=!ok;$("inhint").textContent=ok?(TIPOS_SIN_EQUIVALENCIA.includes(tipoUnidadRuta())?`Se registrará ${tipoUnidadRuta()}; requiere una tarifa propia vigente.`:"Todo listo. Presiona Check IN para iniciar tu ruta."):"Completa todos los campos para habilitar el check-in."}
$("bin").onclick=async()=>{
  $("bin").disabled=true;err("inerr",null);
  const hoy=new Date().toLocaleDateString("en-CA");
  const checkinAt=new Date(),llegada=new Date(`${hoy}T${$("hora").value}`).toISOString(),withAux=requiereAuxiliarRuta()&&$("aux-mode").value==="auxiliar";
  let checkinBlob=null;
  try{if(withAux)checkinBlob=await procesarFotoAuxiliar("in")}
  catch(e){err("inerr",e);$("bin").disabled=false;return}
  const tipoUnidad=tipoUnidadRuta();
  const routeRequiresAuxiliary=requiereAuxiliarRuta();
  const routePayload={driver_id:ME.id,cedis_id:+$("cedis").value,id_ruta:$("rid").value.trim(),paquetes_asignados:+$("pk").value,zonas:[...S.zonas],hora_llegada_cedis:llegada,tipo_unidad:tipoUnidad,auxiliar_requerido:routeRequiresAuxiliary,viaja_con_auxiliar:withAux,evidencia_auxiliar_checkin_path:null,evidencia_auxiliar_checkout_path:null,checkin_at:checkinAt.toISOString()};
  const routeInfo={cli:cliName($("cli").value),cliId:$("cli").value,cedis:cedName($("cli").value,$("cedis").value),cedisId:$("cedis").value,pk:+$("pk").value,rid:$("rid").value.trim(),zonas:[...S.zonas],hora:$("hora").value,checkin:checkinAt.toISOString(),unidad:routePayload.tipo_unidad,auxiliarRequerido:routeRequiresAuxiliary,viajaConAuxiliar:withAux};
  const record={key:routeLocalKey(),driverId:ME.id,status:"checkin_pending",serverRouteId:null,routeInfo,routePayload,auxiliary:{checkinBlob,checkinPath:null},checkout:null,manifests:[]};
  try{await localPut("routes",record)}
  catch(e){err("inerr",e);$("bin").disabled=false;return}
  let synced=false;
  if(navigator.onLine)synced=await syncPendingRoute();else{OFFLINE_MODE=true;setNetStatus("Sin conexión · check-in y evidencia guardados en este dispositivo; se enviarán al recuperar la red.",true)}
  const saved=await localGet("routes",routeLocalKey());
  S.route={...routeInfo,dbId:saved?.serverRouteId||null,localKey:record.key,checkin:checkinAt};
  clearAuxCapture("in");
  prefillCan();setStage(1);$("ent").value="";$("fal").value="";$("wm-asignadas").value="";$("wm-realizadas").value="";$("wm-folios").value="";updFin();
  $("hstate").className=`pill ${synced?"ok":"w"}`;$("hstate").textContent=synced?"En ruta":"Check-in pendiente de enviar";
  if(synced){toast("Check-in registrado · ¡Buena ruta!")}
  else{setNetStatus("Sin conexión o sincronización pendiente · check-in y evidencia guardados en este dispositivo.",true);toast("Check-in guardado en este dispositivo")}
};

["ent","fal","wm-asignadas","wm-realizadas","wm-folios"].forEach(id=>$(id).addEventListener("input",updFin));
const esRutaWalmart=()=>WALMART_TARIFARIO_ENABLED&&WALMART_VISITAS_ENABLED&&String(S.route?.cli||"").trim().toUpperCase()==="WALMART";
function datosVisitasWalmart(){
  const asignadas=$("wm-asignadas").value.trim(),realizadas=$("wm-realizadas").value.trim();
  const folios=$("wm-folios").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!/^\d+$/.test(asignadas)||!/^\d+$/.test(realizadas)||
     !Number.isSafeInteger(Number(asignadas))||!Number.isSafeInteger(Number(realizadas))||
     Number(asignadas)<1||Number(asignadas)>2147483647||Number(realizadas)>Number(asignadas))
    return {error:"Indica visitas asignadas y realizadas válidas; las realizadas no pueden superar las asignadas."};
  if(folios.length>100||folios.some(x=>x.length>120))
    return {error:"Puedes registrar hasta 100 folios de máximo 120 caracteres cada uno."};
  if(+$("fal").value>0&&!folios.length)return {error:"Captura al menos un folio Avaya cuando haya entregas fallidas."};
  return {datos:{walmart_visitas_asignadas:Number(asignadas),walmart_visitas_realizadas:Number(realizadas),walmart_folios_avaya:folios}};
}
function sumC(){return Object.values(S.fallos).reduce((a,b)=>a+b,0)}
function updFin(){
  const pk=S.route?S.route.pk:0,e=+$("ent").value||0,f=+$("fal").value||0,filled=$("ent").value!==""&&$("fal").value!=="";
  let ok=filled&&e+f===pk;
  $("s2note").innerHTML=filled?(e+f===pk?`<span style="color:var(--ok)">✔ Cuadra con los ${pk} paquetes asignados</span>`:`<span style="color:var(--bad)">Entregados + fallidos = ${e+f}; debes cuadrar con ${pk}</span>`):`Asignados: <b>${pk}</b>`;
  $("causes").classList.toggle("hide",!(f>0));$("ftot").textContent=f;
  if(f>0){drawCauses();const s=sumC();ok=ok&&s===f;$("csum").innerHTML=s===f?`<span style="color:var(--ok)">✔ Causas completas (${s}/${f})</span>`:`<span style="color:var(--bad)">Asignadas ${s} de ${f}</span>`}else S.fallos={};
  const walmart=esRutaWalmart();$("walmart-visitas").classList.toggle("hide",!walmart);
  if(walmart){const result=datosVisitasWalmart();$("wm-error").textContent=result.error||"";ok=ok&&!result.error}
  $("b2").disabled=!ok;
}
function drawCauses(){$("clist").innerHTML=CAUSAS.map(c=>`<div class="cause"><span>${esc(c.nombre)}</span><div class="qty"><button data-c="${esc(c.id)}" data-d="-1">−</button><span>${S.fallos[c.id]||0}</span><button data-c="${esc(c.id)}" data-d="1">+</button></div></div>`).join("")}
$("clist").onclick=e=>{const b=e.target.closest("button");if(!b)return;const i=b.dataset.c,d=+b.dataset.d,f=+$("fal").value||0;
  if(d>0&&sumC()>=f)return;S.fallos[i]=Math.max(0,(S.fallos[i]||0)+d);updFin()};
$("b2").onclick=()=>{S.result={ent:+$("ent").value,fal:+$("fal").value};setStage(2);$("s3").scrollIntoView({behavior:"smooth"})};

$("inc-no").onclick=()=>{S.inc=false;$("inclist").classList.add("hide");mark();enableOut()};
$("inc-si").onclick=()=>{S.inc=true;$("inclist").classList.remove("hide");mark();enableOut()};
function mark(){$("inc-no").className="btn "+(S.inc===false?"ok":"ghost");$("inc-si").className="btn "+(S.inc===true?"bad":"ghost")}
$("incchips").onclick=e=>{const i=e.target.dataset.i;if(i===undefined)return;S.incSel.has(i)?S.incSel.delete(i):S.incSel.add(i);e.target.classList.toggle("on");enableOut()};
const CLI_EXTRAS=["FULLER","PRIVALIA","SODEXO","SMURFIT","TTAIO"];
const llevaExtras=()=>S.route&&CLI_EXTRAS.includes(String(S.route.cli||"").toUpperCase().replace(/[^A-Z0-9]/g,""));
const requiereManif=()=>S.route&&S.route.unidad==="3.5T"&&/^COPPEL/i.test(S.route.cli||"");
let MANIF=[],manifCargado=false;
let MANIF_URLS=[];
async function loadManif(){
  manifCargado=true;
  const record=await localGet("routes",routeLocalKey()),local=(record&&record.manifests||[]).map(m=>({...m,local:true}));
  let remote=[];
  if(S.route.dbId&&navigator.onLine){
    const {data,error}=await sb.from("ruta_manifiestos").select("id,foto_path").eq("ruta_id",S.route.dbId).order("id");
    if(error){if(!networkError(error)){err("manif-err",error);return}OFFLINE_MODE=true}
    else{
      if(record){record.remoteManifests=(data||[]).map(x=>({id:x.id,foto_path:x.foto_path}));await localPut("routes",record)}
      const paths=(data||[]).map(x=>x.foto_path),signed=paths.length?(await sb.storage.from("manifiestos").createSignedUrls(paths,3600)):null;
      if(signed&&signed.error){if(!networkError(signed.error)){err("manif-err",signed.error);return}OFFLINE_MODE=true}
      remote=(data||[]).map(x=>({...x,url:((signed&&signed.data)||[]).find(y=>y.path===x.foto_path)?.signedUrl}));
    }
  }
  MANIF=[...remote,...local];drawManif();enableOut()
}
function drawManif(){
  MANIF_URLS.forEach(url=>URL.revokeObjectURL(url));MANIF_URLS=[];
  $("manif-grid").innerHTML=MANIF.map(m=>{
    const src=m.local&&m.blob?URL.createObjectURL(m.blob):m.url||"";
    if(m.local&&m.blob)MANIF_URLS.push(src);
    return `<div style="position:relative">${src?`<img src="${esc(src)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px">`:'<div class="doc" style="justify-content:center;height:100%;background:var(--bg);border-radius:10px">🖼️<small>Foto ya enviada</small></div>'}<button type="button" data-mx="${esc(m.id)}" style="position:absolute;top:4px;right:4px;border:0;border-radius:99px;width:24px;height:24px;background:#000a;color:#fff">✕</button></div>`;
  }).join("");
  $("manif-add").textContent=`📷 Agregar fotos (${esc(MANIF.length)}/10)`;$("manif-add").disabled=MANIF.length>=10;
  $("manif-grid").querySelectorAll("[data-mx]").forEach(b=>b.onclick=async()=>{
    const m=MANIF.find(x=>String(x.id)===b.dataset.mx);if(!m)return;
    if(m.local){
      const record=await localGet("routes",routeLocalKey());record.manifests=record.manifests.filter(x=>x.id!==m.id);await localPut("routes",record);MANIF=MANIF.filter(x=>x!==m);drawManif();enableOut();return;
    }
    if(!navigator.onLine){err("manif-err",new Error("No se pueden eliminar fotos sincronizadas sin conexión."));return}
    const removed=await sb.storage.from("manifiestos").remove([m.foto_path]);if(removed.error){err("manif-err",removed.error);return}
    const deleted=await sb.from("ruta_manifiestos").delete().eq("id",m.id);if(deleted.error){err("manif-err",deleted.error);return}
    await loadManif();
  })}
async function comprimir(file){const bmp=await createImageBitmap(file);const k=Math.min(1,1600/Math.max(bmp.width,bmp.height));const c=document.createElement("canvas");c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);return new Promise(r=>c.toBlob(r,"image/jpeg",0.8))}
$("manif-add").onclick=()=>$("manif-file").click();
$("manif-file").onchange=async e=>{
  err("manif-err",null);const fs=[...e.target.files].slice(0,10-MANIF.length);e.target.value="";if(!fs.length)return;$("manif-add").disabled=true;
  try{
    const record=await localGet("routes",routeLocalKey());if(!record)throw new Error("No existe un registro local de la ruta para guardar las fotos.");
    for(const f of fs){const blob=await comprimir(f);if(!blob)throw new Error("No se pudo procesar una de las fotos.");record.manifests.push({id:crypto.randomUUID(),blob,name:f.name,createdAt:new Date().toISOString(),photoPath:null,rowSaved:false})}
    await localPut("routes",record);MANIF=(record.manifests||[]).map(m=>({...m,local:true}));drawManif();enableOut();
    if(navigator.onLine){const ok=await syncPendingRoute();if(ok)await loadManif()}
    else setNetStatus("Sin conexión · foto guardada en este dispositivo y pendiente de envío.",true);
  }catch(x){err("manif-err",x)}
  $("manif-add").disabled=MANIF.length>=10;
};
function enableOut(){const rm=!!requiereManif(),aux=!!S.route?.viajaConAuxiliar;$("manif").classList.toggle("hide",!rm);if(rm&&!manifCargado&&S.route)loadManif();$("extras").classList.toggle("hide",!llevaExtras());$("aux-checkout-proof").classList.toggle("hide",!aux);const auxOk=!aux||!!AUX_CAMERA.out.blob;const ok=(S.inc===false||(S.inc===true&&S.incSel.size>0))&&(!rm||MANIF.length>0)&&auxOk;if(S.stage>=2)setStage((S.inc===false||(S.inc===true&&S.incSel.size>0))?3:2);$("bout").disabled=!(ok&&S.stage>=3)}
$("bout").onclick=async()=>{
  $("bout").disabled=true;err("outerr",null);const r=S.route,res=S.result;
  let record;
  try{record=await localGet("routes",routeLocalKey());if(!record)throw new Error("No existe una copia local de esta ruta. No se cerró para evitar perder el registro.")}catch(e){err("outerr",e);$("bout").disabled=false;return}
  let auxiliaryBlob=null;
  try{if(r.viajaConAuxiliar)auxiliaryBlob=await procesarFotoAuxiliar("out")}
  catch(e){err("outerr",e);$("bout").disabled=false;return}
  const checkoutAt=new Date().toISOString();
  const fl=Object.entries(S.fallos).filter(([,q])=>q>0).map(([c,q])=>({causa_id:+c,cantidad:q}));
  const ic=S.inc?[...S.incSel].map(i=>({incidencia_id:+i,comentario:$("inctxt").value.trim()||null})):[];
  const walmart=esRutaWalmart()?datosVisitasWalmart():null;
  if(walmart?.error){err("outerr",new Error(walmart.error));$("bout").disabled=false;return}
  record.status="checkout_pending";
  record.checkout={checkoutAt,ent:res.ent,fal:res.fal,hubo_incidencias:!!S.inc,fallos:fl,incidencias:ic,auxiliaryBlob,auxiliaryEvidencePath:null,
    extras:{...(llevaExtras()?{maniobras:$("x-man").value.trim()||null,estadia:$("x-est").value.trim()||null,otros:$("x-otr").value.trim()||null}:{}),...(walmart?.datos||{})}};
  try{await localPut("routes",record)}catch(e){err("outerr",e);$("bout").disabled=false;return}
  S.routeLocalCheckout=record.checkout;
  let synced=false;
  if(navigator.onLine)synced=await syncPendingRoute();
  else{OFFLINE_MODE=true;setNetStatus("Sin conexión · check-out guardado en este dispositivo; se enviará al recuperar la red.",true)}
  showRouteDone(!synced);
};

// ---------- Cancelación ----------
let canBlob=null,canMeta=null,canBitacoraBlob=null,canEvidenceGeneration=0,canLocationGeneration=0;
$("bcam").onclick=()=>$("cfile").click();
$("cfile").onchange=e=>{const f=e.target.files[0];e.target.value="";if(!f)return;canBlob=null;canMeta=null;const generation=++canLocationGeneration;checkCan();const img=new Image(),url=URL.createObjectURL(f);img.onload=async()=>{try{await stamp(img,generation)}catch(error){err("canerr",error)}finally{URL.revokeObjectURL(url)}};img.onerror=()=>{URL.revokeObjectURL(url);err("canerr",new Error("No se pudo leer la foto de evidencia."))};img.src=url};
const esCancelacionWalmart=()=>WALMART_TARIFARIO_ENABLED&&cliName($("ccli").value).trim().toUpperCase()==="WALMART";
$("wm-can-camera").onclick=()=>$("wm-can-file").click();
$("wm-can-file").onchange=async e=>{
  const file=e.target.files[0];e.target.value="";if(!file)return;
  const generation=++canEvidenceGeneration;
  canBitacoraBlob=null;$("wm-can-status").textContent="Procesando foto…";checkCan();
  try{
    const blob=await comprimir(file);
    if(generation!==canEvidenceGeneration)return;
    if(!blob)throw new Error("No se pudo procesar la foto de la bitácora.");
    canBitacoraBlob=blob;$("wm-can-status").textContent="Foto de bitácora capturada.";
  }catch(error){if(generation===canEvidenceGeneration){$("wm-can-status").textContent="";err("canerr",error)}}
  checkCan();
};
function getLoc(){
  if(!navigator.geolocation)return Promise.resolve(null);
  const locate=options=>new Promise(resolve=>{
    try{
      navigator.geolocation.getCurrentPosition(
        p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),
        ()=>resolve(null),
        options
      );
    }catch{resolve(null)}
  });
  return (async()=>{
    const accurate=await locate({enableHighAccuracy:true,timeout:20000,maximumAge:30000});
    return accurate||await locate({enableHighAccuracy:false,timeout:12000,maximumAge:120000});
  })();
}
async function stamp(img,generation){
  $("cmeta").textContent="Obteniendo ubicación…";err("canerr",null);
  const loc=await getLoc();
  if(generation!==canLocationGeneration)return;
  const d=new Date(),iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height,w=Math.min(1000,iw),h=Math.round(ih*w/iw);
  const cv=$("cv");cv.width=w;cv.height=h;const x=cv.getContext("2d");x.drawImage(img,0,0,w,h);
  const cli=cliName($("ccli").value)||"—",ced=cedName($("ccli").value,$("ccedis").value)||"—";
  const co=cedObj($("ccli").value,$("ccedis").value);let val={estado:loc?"sin_coordenadas":"sin_ubicacion",dist:null};
  if(loc&&co&&co.lat!=null&&co.lng!=null){const dm=distM(loc.lat,loc.lng,co.lat,co.lng);val={estado:dm<=co.radio_m?"dentro":"fuera",dist:dm,radio:co.radio_m}}
  const dia=d.toLocaleDateString("es-MX",{weekday:"long"}),fecha=d.toLocaleDateString("es-MX",{day:"2-digit",month:"2-digit",year:"numeric"}),hora=d.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  const lines=["CANCELADO POR EL CLIENTE",`${cli} · ${ced}`,`${dia} ${fecha} · ${hora}`,loc?`GPS: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`:"GPS: ubicación no disponible",val.estado==="sin_ubicacion"?"Ubicación sin validar: se revisará":val.estado==="sin_coordenadas"?"Ubicación del CEDIS: sin validar":`A ${fmtDist(val.dist)} del CEDIS · ${val.estado==="dentro"?"DENTRO":"FUERA"} del radio`,`Driver: ${esc(DRIVER.nombre)} · ${esc(DRIVER.codigo||"")}`];
  const fs=Math.max(14,Math.round(w/34)),pad=fs*.7,bh=lines.length*fs*1.35+pad*2;
  x.fillStyle="rgba(0,0,0,.62)";x.fillRect(0,h-bh,w,bh);x.textAlign="left";
  lines.forEach((l,i)=>{x.font=(i===0?"bold ":"")+fs+"px sans-serif";x.fillStyle=i===0?"#ffb4b6":"#fff";x.fillText(l,pad,h-bh+pad+fs*1.1+i*fs*1.35)});
  x.save();x.translate(w/2,h/2);x.rotate(-.4);x.font="bold "+Math.round(w/9)+"px sans-serif";x.fillStyle="rgba(255,255,255,.18)";x.textAlign="center";x.fillText("CHAZKI",0,0);x.restore();
  cv.classList.remove("hide");
  const blob=await new Promise(r=>cv.toBlob(r,"image/jpeg",.78));
  if(generation!==canLocationGeneration)return;
  if(!blob)throw new Error("No se pudo procesar la foto de evidencia.");
  canBlob=blob;canMeta={loc,d,val};
  const vm=val.estado==="dentro"?`<span style="color:var(--ok)">✔ Estás a ${fmtDist(val.dist)} del CEDIS: ubicación validada</span>`:
    val.estado==="fuera"?`<span style="color:var(--bad)">⚠ Estás a ${fmtDist(val.dist)} del CEDIS (máximo ${fmtDist(val.radio)}). Si el CEDIS es otro, cámbialo y toma la foto de nuevo. Si lo registras así, Operaciones lo revisará.</span>`:
    val.estado==="sin_ubicacion"?`<span style="color:var(--bad)">⚠ No se pudo detectar tu ubicación. Puedes registrar la cancelación igual: la foto lleva la marca de agua con fecha y hora, y Operaciones la revisará. Si puedes, activa el GPS y toma la foto otra vez.</span>`:
    `<span style="color:var(--mut)">Este CEDIS aún no tiene ubicación registrada; se registra sin validar.</span>`;
  $("cmeta").innerHTML=`📍 ${loc?loc.lat.toFixed(5)+", "+loc.lng.toFixed(5):"ubicación no disponible"} · ${dia} ${fecha} ${hora}<br>${vm}`;checkCan();
}
function checkCan(){const dailyLimitLocked=ME?.id!==CANCEL_DAILY_LIMIT_EXEMPT_DRIVER_ID&&(canUsedToday||canLimitUnknown),walmart=esCancelacionWalmart();$("wm-can-evidencia").classList.toggle("hide",!walmart);$("bcan").disabled=dailyLimitLocked||!(canBlob&&$("ccli").value&&$("ccedis").value&&(!walmart||canBitacoraBlob))}
$("bcan").onclick=async()=>{
  $("bcan").disabled=true;err("canerr",null);
  try{
    if(!canBlob||!canMeta||(esCancelacionWalmart()&&!canBitacoraBlob))throw new Error("Completa la evidencia requerida antes de registrar la cancelación.");
    const record={key:crypto.randomUUID(),driver_id:ME.id,ruta_id:S.route?S.route.dbId:null,cedis_id:+$("ccedis").value,id_ruta:S.route?.rid||null,
      lat:canMeta.loc?canMeta.loc.lat:null,lng:canMeta.loc?canMeta.loc.lng:null,capturado_at:canMeta.d.toISOString(),blob:canBlob,
      ...(esCancelacionWalmart()?{bitacoraBlob:canBitacoraBlob}:{})};
    await localPut("cancellations",record);
    canUsedToday=true;updateCancelAvailability();
    canBlob=null;canBitacoraBlob=null;canEvidenceGeneration++;$("wm-can-status").textContent="";$("cv").classList.add("hide");$("cmeta").textContent="";checkCan();
    if(navigator.onLine&&await syncPendingCancellations())toast("Cancelación registrada y enviada a Operaciones");
    else{OFFLINE_MODE=true;setNetStatus("Sin conexión o red intermitente · cancelación y foto guardadas en este dispositivo, pendientes de envío.",true);toast("Cancelación guardada en este dispositivo")}
    await loadCan();
  }catch(error){err("canerr",error);$("bcan").disabled=false}
};
let CAN2=[],CAN_SERVER=[],NOT=[],canUsedToday=false,canLimitUnknown=true;
const cuentaReg=v=>{const ms=new Date(v)-Date.now();if(ms<=0)return null;const m=Math.floor(ms/60000);return `${Math.floor(m/60)} h ${String(m%60).padStart(2,"0")} min`};
const estC=x=>((x.estatus==="aclaracion"||x.estatus==="rechazada")&&x.plazo_vence&&new Date(x.plazo_vence)<Date.now())?"vencida":x.estatus;
const diaCancelacion=v=>{
  const d=new Date(v);if(Number.isNaN(d.getTime()))return"";
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const values=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
function updateCancelAvailability(){
  const box=$("can-limit"),exempt=ME?.id===CANCEL_DAILY_LIMIT_EXEMPT_DRIVER_ID,locked=!exempt&&(canUsedToday||canLimitUnknown);
  box.classList.toggle("hide",!locked);
  if(exempt){box.classList.remove("hide");box.textContent="Cuenta de pruebas: no aplica el límite diario. Se mantienen los requisitos de autorización y evidencia."}
  else box.textContent=canUsedToday
    ?"Ya registraste una cancelación hoy. Solo se permite una cancelación por día."
    :"No se pudo verificar si ya registraste una cancelación hoy. Conéctate a internet y actualiza antes de continuar.";
  ["ccli","ccedis","det2","bcam","cfile","wm-can-camera","wm-can-file"].forEach(id=>$(id).disabled=locked);
  checkCan();
}
async function loadCan(){
  let serverRows=null;
  if(navigator.onLine){
    const {data,error}=await sb.rpc("mis_cancelaciones_estatus");
    if(!error){serverRows=data||[];CAN_SERVER=serverRows;canLimitUnknown=false;err("canerr",null);
      try{await localPut("cache",{key:`cancellations:${ME.id}`,rows:serverRows,cachedAt:new Date().toISOString()})}
      catch(cacheError){err("canerr",cacheError)}
    }else if(networkError(error)){
      OFFLINE_MODE=true;
      const cached=await localGet("cache",`cancellations:${ME.id}`);
      CAN_SERVER=cached?.rows||[];canLimitUnknown=!cached;
    }else{err("canerr",error);CAN_SERVER=[];canLimitUnknown=true}
  }else{
    const cached=await localGet("cache",`cancellations:${ME.id}`);
    CAN_SERVER=cached?.rows||[];canLimitUnknown=!cached;
  }
  const pending=(await localGetAll("cancellations")).filter(x=>String(x.driver_id)===String(ME.id));
  CAN2=[...CAN_SERVER,...pending.map(x=>({id:x.key,fecha:x.capturado_at,cliente:cedObjById(x.cedis_id)?.cliente_nombre||"Cliente",cedis:cedNameById(x.cedis_id)||"CEDIS",id_ruta:x.id_ruta,estatus:"pendiente",es_mia:true,local:true}))];
  const today=diaCancelacion(new Date());
  const myRows=CAN_SERVER.filter(x=>x.es_mia===true||(!("es_mia" in x)&&(!x.driver_id||String(x.driver_id)===String(ME.id))));
  canUsedToday=myRows.some(x=>diaCancelacion(x.fecha||x.capturado_at)===today)||pending.some(x=>String(x.driver_id)===String(ME.id)&&diaCancelacion(x.capturado_at)===today);
  updateCancelAvailability();
  drawCan()
}
async function syncPendingCancellations(){
  if(syncCancelBusy||!ME||!navigator.onLine)return false;
  syncCancelBusy=true;
  try{
    const pending=(await localGetAll("cancellations")).filter(x=>String(x.driver_id)===String(ME.id));
    for(const record of pending){
      const path=`${ME.id}/offline-${record.key}.jpg`;
      const {error:uploadError}=await sb.storage.from("cancelaciones").upload(path,record.blob,{contentType:"image/jpeg",upsert:true});
      if(uploadError)throw uploadError;
      let bitacoraPath=null;
      if(record.bitacoraBlob){
        bitacoraPath=`${ME.id}/offline-${record.key}-bitacora.jpg`;
        const {error}=await sb.storage.from("cancelaciones").upload(bitacoraPath,record.bitacoraBlob,{contentType:"image/jpeg",upsert:true});
        if(error)throw error;
      }
      const {data:existing,error:lookupError}=await sb.from("cancelaciones").select("id")
        .eq("driver_id",record.driver_id).eq("capturado_at",record.capturado_at).eq("foto_path",path).maybeSingle();
      if(lookupError)throw lookupError;
      if(!existing){
        const {driver_id,ruta_id,cedis_id,id_ruta,lat,lng,capturado_at}=record;
        const {error}=await sb.from("cancelaciones").insert({driver_id,ruta_id,cedis_id,id_ruta,lat,lng,capturado_at,foto_path:path,...(bitacoraPath?{foto_bitacora_path:bitacoraPath}:{})});
        if(error)throw error;
      }
      await localDelete("cancellations",record.key);
    }
    return true;
  }catch(error){
    if(networkError(error)){OFFLINE_MODE=true;setNetStatus("Conexión intermitente · la cancelación y su foto siguen guardadas en este dispositivo.",true)}
    else{err("canerr",error);setNetStatus("No se pudo sincronizar la cancelación. La foto sigue guardada en este dispositivo.",true)}
    return false;
  }finally{syncCancelBusy=false}
}
function drawCan(){const L=CAN2.filter(x=>x.es_mia).slice(0,10);
  $("canlist").innerHTML=L.length?L.map(r=>{const d=new Date(r.fecha),k=estC(r),esp=(r.estatus==="aclaracion"||r.estatus==="rechazada")&&k!==("vencida"),q=r.plazo_vence?cuentaReg(r.plazo_vence):null;
    const caja=r.local?'<div class="note" style="margin-top:6px;color:#946200">Guardada en este dispositivo; pendiente de sincronización.</div>':esp?`<div class="note" style="margin-top:8px;background:#fff4d6;color:#7a4b00;padding:10px;border-radius:10px"><b>${r.estatus==="aclaracion"?"Chazki te pide una aclaración":"Chazki rechazó tu cancelación"}</b><br>${esc(r.ultimo_mensaje||"")}<br><b>⏱ Te quedan ${q}</b> para ${r.estatus==="aclaracion"?"responder":"apelar"}.<br><button class="btn sm" type="button" data-resp="${esc(r.id)}" style="margin-top:8px">${r.estatus==="aclaracion"?"Responder":"Apelar"}</button></div>`:(k==="vencida"?`<div class="note" style="margin-top:6px;color:#b42318">El plazo de 12 horas venció${r.estatus==="rechazada"?"; la decisión queda firme.":" sin respuesta."}</div>`:"");
    return `<div class="item" style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><div><b>${esc(r.cliente)}</b> · ${esc(r.cedis)}<small>${d.toLocaleDateString("es-MX",{weekday:"long",day:"2-digit",month:"2-digit"})} · ${d.toTimeString().slice(0,5)}${esc(r.id_ruta?" · Ruta "+r.id_ruta:"")}</small></div>${pillE(k)}</div>${caja}</div>`}).join(""):'<div class="note">Aún no hay cancelaciones.</div>';
  document.querySelectorAll("[data-resp]").forEach(b=>b.onclick=()=>abrirRespuesta(+b.dataset.resp))}
setInterval(()=>{if(CAN2.length)drawCan()},30000);
function abrirSheet(h){$("sheet").innerHTML=`<div class="sheetbox">${h}</div>`;$("sheet").classList.remove("hide");$("sheet").onclick=e=>{if(e.target.id==="sheet")$("sheet").classList.add("hide")}}
function abrirRespuesta(id){const r=CAN2.find(x=>x.id===id);if(!r)return;const apela=r.estatus==="rechazada";
  abrirSheet(`<h2 style="margin:0 0 6px">${apela?"Apelar rechazo":"Responder aclaración"}</h2><div class="note" style="margin-top:0"><b>Mensaje de Chazki:</b><br>${esc(r.ultimo_mensaje||"")}</div><div class="note">⏱ Te quedan ${cuentaReg(r.plazo_vence)||"0 min"}</div>
   <label>${apela?"Explica por qué la cancelación debe aprobarse":"Tu aclaración"}</label><textarea id="rs-t" rows="4"></textarea>
   <label>Foto de apoyo (opcional)</label><input type="file" id="rs-f" accept="image/*"><div id="rs-e"></div>
   <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" id="rs-ok">Enviar</button><button class="btn ghost" id="rs-x">Cancelar</button></div>`);
  $("rs-x").onclick=()=>$("sheet").classList.add("hide");
  $("rs-ok").onclick=async()=>{const t=$("rs-t").value.trim();if(!t){$("rs-e").innerHTML='<div class="errbox">Escribe tu respuesta</div>';return}
    $("rs-ok").disabled=true;let path=null;const f=$("rs-f").files[0];
    try{if(f){const blob=await comprimir(f);path=`${esc(ME.id)}/aclaracion-${id}-${Date.now()}.jpg`;const up=await sb.storage.from("cancelaciones").upload(path,blob,{contentType:"image/jpeg"});if(up.error)throw up.error}
      const {error}=await sb.rpc("responder_cancelacion",{p_id:id,p_texto:t,p_foto_path:path});if(error)throw error}
    catch(e){$("rs-ok").disabled=false;$("rs-e").innerHTML=`<div class="errbox">${esc(e.message||e)}</div>`;return}
    $("sheet").classList.add("hide");toast(apela?"Apelación enviada ✔":"Aclaración enviada ✔");await loadCan();loadEstatus()}}
// ---------- Avisos ----------
async function loadNotifs(){const {data}=await sb.from("notificaciones").select("*").order("creada_en",{ascending:false}).limit(30);NOT=data||[];drawBell()}
function drawBell(){const n=NOT.filter(x=>!x.leida_en).length;$("bellc").textContent=n>9?"9+":n;$("bellc").classList.toggle("hide",!n)}
function abrirAvisos(){const f=x=>new Date(x).toLocaleString("es-MX",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
  const perm=("Notification" in window&&Notification.permission==="default")?'<button class="btn ghost sm" id="nt-perm" type="button" style="margin-bottom:8px">Activar avisos del navegador</button>':"";
  abrirSheet(`<h2 style="margin:0 0 8px">🔔 Avisos</h2>${perm}${NOT.length?NOT.map(n=>`<div class="item" data-nt="${esc(n.id)}" style="display:block;${n.leida_en?"opacity:.6":"background:#f3f0ff;border-radius:10px;padding:10px"}"><b>${esc(n.titulo)}</b>${n.cuerpo?`<small style="display:block">${esc(n.cuerpo)}</small>`:""}<small style="display:block;color:var(--mut)">${f(n.creada_en)}${n.vence_en&&new Date(n.vence_en)>Date.now()?" · vence en "+cuentaReg(n.vence_en):""}</small></div>`).join(""):'<div class="note">Sin avisos.</div>'}`);
  const pr=$("nt-perm");if(pr)pr.onclick=async()=>{await Notification.requestPermission();abrirAvisos()};
  document.querySelectorAll("[data-nt]").forEach(el=>el.onclick=()=>{const n=NOT.find(x=>x.id==el.dataset.nt);$("sheet").classList.add("hide");if(n&&n.ref_tipo==="cancelacion")document.querySelector("nav button[data-t=can]").click();if(n&&n.ref_tipo==="cambio_perfil")document.querySelector("nav button[data-t=per]").click()});
  sb.rpc("marcar_notificaciones_leidas",{p_ids:null}).then(()=>{NOT.forEach(n=>n.leida_en=n.leida_en||new Date().toISOString());drawBell()})}
$("bell").onclick=abrirAvisos;
function suscribirAvisos(){loadNotifs();setInterval(loadNotifs,60000);
  setInterval(()=>{if(navigator.onLine)loadPnrs()},60000);
  sb.channel("avisos-"+ME.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"notificaciones",filter:"usuario=eq."+ME.id},p=>{NOT.unshift(p.new);drawBell();toast("🔔 "+p.new.titulo);
    if("Notification" in window&&Notification.permission==="granted")try{new Notification(p.new.titulo,{body:p.new.cuerpo||""})}catch(e){}
    if(p.new.tipo&&p.new.tipo.startsWith("cancelacion"))loadCan().then(loadEstatus)}).subscribe()}

// ---------- Ganancias ----------
let PAGOS=[],PAGOS_ERROR="",BOLSA_WALMART=null,BOLSA_WALMART_ERROR="",gp="sem";
async function loadGan(){
  // Un driver que pertenece a un flotillero no ve los pagos: los ve su transportista
  if(!ACC.puede_ver_ganancias){$("t-gan").innerHTML='<div class="card"><h2>💰 Tus pagos</h2><div class="note" style="font-size:14px;margin-top:0">Los pagos de tus servicios los recibe y consulta tu transportista. Si tienes dudas sobre un pago, habla con él.</div></div><div class="card"><h2>Mis rutas y cancelaciones</h2><div id="gest"></div></div>';$("t-gan").insertAdjacentHTML("afterbegin",'<div id="gkpi-w"><div class="card" id="gkpi"></div></div>');loadEstatus();return}
  loadEstatus();
  const d=new Date();d.setDate(d.getDate()-62);
  const desde=d.toLocaleDateString("en-CA");
  const sel=ACC.es_flotillero?"*,drivers(nombre),rutas(id_ruta)":"*";
  const q=sb.from("pagos").select(sel).gte("fecha",desde).order("fecha",{ascending:false});
  const pagoQuery=ACC.es_flotillero?q:q.eq("driver_id",ME.id);
  const [pagosResult,bolsaResult]=await Promise.all([
    pagoQuery,
    ACC.es_flotillero&&WALMART_TARIFARIO_ENABLED?Promise.all([
      sb.rpc("walmart_mi_bolsa"),
      sb.rpc("walmart_mis_movimientos_bolsa",{p_desde:desde})
    ]).then(data=>({data}),error=>({error})):Promise.resolve(null)
  ]);
  if(pagosResult.error){PAGOS=[];PAGOS_ERROR=pagosResult.error.message||"Error al consultar los pagos";}
  else if(!Array.isArray(pagosResult.data)){PAGOS=[];PAGOS_ERROR="La respuesta de pagos no es válida";}
  else{PAGOS=pagosResult.data;PAGOS_ERROR=""}
  BOLSA_WALMART=null;BOLSA_WALMART_ERROR="";
  if(bolsaResult){
    const [saldoResult,movimientosResult]=bolsaResult.data||[];
    if(bolsaResult.error||saldoResult?.error||movimientosResult?.error)
      BOLSA_WALMART_ERROR=bolsaResult.error?.message||saldoResult?.error?.message||movimientosResult?.error?.message||"No se pudo consultar la bolsa Walmart";
    else if(!saldoResult?.data||!Array.isArray(movimientosResult?.data)||!movimientosResult.data.every(x=>
      x&&typeof x.id==="string"&&x.concepto==="liberacion_retencion_walmart"
      &&Number.isFinite(Number(x.monto))&&Number(x.monto)>0
      &&typeof x.fecha==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x.fecha)
      &&["pendiente","pagado"].includes(x.estatus)))
      BOLSA_WALMART_ERROR="La respuesta de la bolsa Walmart no es válida";
    else{
      BOLSA_WALMART=saldoResult.data;
      PAGOS.push(...movimientosResult.data.map(x=>({...x,monto:Number(x.monto),bolsa_walmart:true})));
    }
  }
  drawG()}
let RUTAS_K=[],CANS_K=[],kp="sem",PNRS=[],PNR_DISCOUNTS={},PNR_ERROR="",PNR_SEEN=false,NO_SHOW_CASES=[],NO_SHOW_EVENTS=[],NO_SHOW_ERROR="";
function rangoK(p,prev){const n=new Date();let a,b;
  if(p==="sem"){a=monday(n);if(prev)a.setDate(a.getDate()-7);b=new Date(a);b.setDate(b.getDate()+7)}
  else{a=new Date(n.getFullYear(),n.getMonth()-(prev?1:0),1);b=new Date(a.getFullYear(),a.getMonth()+1,1)}return [a,b]}
function statsK(p,prev){const [a,b]=rangoK(p,prev),ok=x=>{const d=new Date(x);return d>=a&&d<b};
  const R=RUTAS_K.filter(x=>ok(x.fecha)&&x.estatus!=="en_curso"),C=CANS_K.filter(x=>ok(x.fecha));
  const asg=R.reduce((s,x)=>s+(x.asignados||0),0),ent=R.reduce((s,x)=>s+(x.entregados||0),0),fal=R.reduce((s,x)=>s+(x.fallidos||0),0);
  const dias=new Set(R.map(x=>new Date(x.fecha).toDateString())).size;
  const tt=R.filter(x=>x.checkout).map(x=>new Date(x.checkout)-new Date(x.fecha)).filter(x=>x>0);
  return {R,C,asg,ent,fal,dias,ef:asg?ent/asg:null,prom:tt.length?tt.reduce((s,x)=>s+x,0)/tt.length:null,apr:R.filter(x=>x.estatus==="aprobada").length,inc:R.filter(x=>x.incidencias).length}}
function drawKpi(){const box=$("gkpi");if(!box)return;const s=statsK(kp,false),q=statsK(kp,true);
  const pct=v=>v==null?"—":Math.round(v*100)+"%",hm=ms=>{if(ms==null)return"—";const m=Math.round(ms/60000);return Math.floor(m/60)+" h "+String(m%60).padStart(2,"0")+" min"};
  const dl=(a,b,pts)=>{if(a==null||b==null)return"";const d=pts?Math.round((a-b)*100):a-b;if(!d)return'<small style="color:var(--mut)">= que el periodo anterior</small>';const up=d>0;return `<small style="color:${up?"#0f7a3d":"#b42318"}">${up?"▲":"▼"} ${Math.abs(d)}${pts?" pts":""} vs. anterior</small>`};
  const ef=s.ef,col=ef==null?"var(--mut)":ef>=0.9?"#0f7a3d":ef>=0.8?"#946200":"#b42318";
  const T=(l,v,x="",c="")=>{const tone=c==="#0f7a3d"?"metric-positive":c==="#946200"?"metric-warning":c?"metric-negative":"metric-value";return `<div class="metric-card" style="background:#f6f7fb;border-radius:12px;padding:10px"><div style="font-size:12px;color:var(--mut)">${l}</div><div class="${tone}" style="font-size:22px;font-weight:800;color:${c||"var(--ink)"}">${v}</div>${x}</div>`};
  let por="";if(ACC&&ACC.es_flotillero){const m={};s.R.forEach(x=>{const k=x.driver||"—";(m[k]=m[k]||{n:0,a:0,e:0}).n++;m[k].a+=x.asignados||0;m[k].e+=x.entregados||0});
    por=`<h3 style="margin:14px 0 4px">Por driver</h3>`+(Object.entries(m).map(([k,v])=>`<div class="item"><span>${esc(k)}</span><b>${esc(v.n)} ${v.n===1?"ruta":"rutas"} · ${pct(v.a?v.e/v.a:null)}</b></div>`).join("")||'<div class="note">Sin rutas en este periodo.</div>')}
  box.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">📊 Desempeño</h2><div class="seg" id="kseg" style="margin:0;width:150px"><button class="${kp==="sem"?"on":""}" data-k="sem">Semana</button><button class="${kp==="mes"?"on":""}" data-k="mes">Mes</button></div></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">${T("Efectividad",pct(ef),dl(s.ef,q.ef,true),col)}${T("Rutas",s.R.length,dl(s.R.length,q.R.length,false))}${T("Entregados",s.ent,`<small style="color:var(--mut)">de ${esc(s.asg)} asignados</small>`)}${T("Fallidos",s.fal)}${T("Cancelaciones",s.C.length)}${T("Aprobadas",s.apr,`<small style="color:var(--mut)">de ${esc(s.R.length)} rutas</small>`)}</div>
   <div class="item" style="margin-top:8px"><span>Días trabajados</span><b>${esc(s.dias)}</b></div><div class="item"><span>Tiempo promedio por ruta</span><b>${hm(s.prom)}</b></div><div class="item"><span>Rutas con incidencias</span><b>${esc(s.inc)}</b></div>${por}`;
  box.querySelectorAll("#kseg button").forEach(b=>b.onclick=()=>{kp=b.dataset.k;drawKpi()})}
const FLEET_PROFILE_ENABLED=true;
let DRVS=[],BAJAS=[],INVS=[],INVS_ERR="",dp="sem",dopen={},dform=null;
async function loadDrivers(){
  const [d,r,c,b,iv]=await Promise.all([sb.from("drivers").select("id,nombre,codigo,estatus,telefono").neq("id",ME.id).order("nombre"),sb.rpc("mis_rutas_estatus"),sb.rpc("mis_cancelaciones_estatus"),sb.from("bajas_solicitudes").select("*").order("solicitado_en",{ascending:false}),listarInvitacionesRed(sb,true).then(data=>({data,error:null}),error=>({data:null,error}))]);
  DRVS=d.data||[];RUTAS_K=r.data||RUTAS_K;CANS_K=c.data||CANS_K;BAJAS=b.data||[];INVS=iv.data||[];INVS_ERR=iv.error?"No se pudieron cargar las solicitudes: "+iv.error.message:"";drawDrivers()}
function invitarHtml(){
  const f=x=>new Date(x).toLocaleDateString("es-MX",{day:"2-digit",month:"short"});
  const est={pendiente_aprobacion:["Pendiente de aprobación del supervisor","#946200"],enviada:["Aprobada · falta que se registre","#1d4ed8"],aceptada:["Registrado","#0f7a3d"],rechazada:["Rechazada","#b42318"],cancelada:["Cancelada","#555b7a"]};
  const ced=CLI.flatMap(c=>(c.cedis||[]).map(x=>`<option value="${esc(x.id)}">${esc(c.nombre+" · "+x.nombre)}</option>`)).join("");
  const fila=x=>{const e=est[x.estatus]||[x.estatus,"#555b7a"];
    const appUrl=location.protocol==="https:"?location.origin:"https://chazki-driver-app.vercel.app";
    const mensaje=`Hola${x.nombre?" "+x.nombre:""}, tu solicitud para Chazki Driver fue aprobada. Abre ${appUrl}/ y ${x.estatus==="aceptada"?"entra":"regístrate o entra"} con ${x.email}.`;
    const activo=x.aceptada_por&&DRVS.some(d=>d.id===x.aceptada_por&&String(d.estatus||"").toLowerCase()==="activo");
    const accion=x.estatus==="cancelada"?`<button class="btn ghost" data-iv-eliminar="${esc(x.id)}">Eliminar de la lista</button>`:x.estatus==="pendiente_aprobacion"?`<button class="btn ghost" data-iv-reenviar="${esc(x.id)}">Reenviar solicitud</button>`:["enviada","aceptada"].includes(x.estatus)&&!activo?`<a class="btn ghost" href="mailto:${encodeURIComponent(x.email)}?subject=${encodeURIComponent("Acceso a Chazki Driver")}&body=${encodeURIComponent(mensaje)}">Preparar correo</a>`:"";
    const cancelar=["enviada","pendiente_aprobacion"].includes(x.estatus)?`<button class="btn ghost" data-iv-cancelar="${esc(x.id)}">Cancelar invitación</button>`:"";
    return `<div class="item"><div><b>${esc(x.nombre||x.email)}</b><small>${esc(x.email)} · ${f(x.creado_en)}${x.motivo?" · "+esc(x.motivo):""}</small>${correoInvitacionHtml(x)}${accion}${cancelar}</div><span style="color:${e[1]};font-size:12px;font-weight:700;text-align:right">${esc(e[0])}</span></div>`};
  const canceladas=INVS.filter(x=>x.estatus==="cancelada");
  const lista=INVS.filter(x=>x.estatus!=="cancelada").map(fila).join("")+`<h3>Canceladas (${esc(canceladas.length)})</h3>`+(canceladas.map(fila).join("")||'<div class="note">Sin invitaciones canceladas.</div>');
  return `<div class="card"><h2 style="margin:0">✉️ Invitar a un driver</h2><label>Nombre</label><input id="iv-n" placeholder="Nombre del driver"><label>Correo</label><input id="iv-m" type="email" placeholder="correo@ejemplo.com"><label>CEDIS donde operará</label><select id="iv-c"><option value="">Selecciona…</option>${ced}</select><div id="iv-e" class="note" style="color:#b42318">${esc(INVS_ERR)}</div><button class="btn" id="iv-ok" style="margin-top:8px">Enviar solicitud</button><button class="btn ghost" id="iv-actualizar">Actualizar estados</button><div class="note" style="margin-top:6px">Tu supervisor debe aprobarla. El registro requiere una invitación aprobada; el correo preparado se envía desde tu aplicación de correo. Supabase envía la validación al registrarse, sujeto al límite del servicio, no en un horario programado. La fecha es el último envío registrado, no garantiza entrega en bandeja.</div>${lista}</div>`}
function drawDrivers(){
  const box=$("drbox");if(!box)return;const pct=v=>v==null?"—":Math.round(v*100)+"%";
  const [a,z]=rangoK(dp,false),ok=x=>{const t=new Date(x);return t>=a&&t<z};
  const f=x=>new Date(x).toLocaleDateString("es-MX",{day:"2-digit",month:"short"});
  const cards=DRVS.map(d=>{
    const R=RUTAS_K.filter(x=>x.driver_id===d.id),Rp=R.filter(x=>ok(x.fecha)&&x.estatus!=="en_curso"),C=CANS_K.filter(x=>x.driver===d.nombre&&ok(x.fecha));
    const asg=Rp.reduce((s,x)=>s+(x.asignados||0),0),ent=Rp.reduce((s,x)=>s+(x.entregados||0),0),fal=Rp.reduce((s,x)=>s+(x.fallidos||0),0);
    const bj=BAJAS.find(x=>x.driver_id===d.id),pend=bj&&bj.estatus==="pendiente",rech=bj&&bj.estatus==="rechazada",activo=String(d.estatus||"").toLowerCase()==="activo";
    const ck=(v)=>v?"✅":"⏳";
    const estado=pend?`<div class="note" style="margin-top:8px;background:#e3ecff;color:#1d4ed8;padding:8px;border-radius:10px"><b>Desactivación solicitada</b> · ${f(bj.solicitado_en)}<br>Supervisor ${ck(bj.aprob_supervisor)} · Coordinador ${ck(bj.aprob_coord)}</div>`:(!activo?`<div class="note" style="margin-top:8px;color:#b42318">Driver desactivado · su historial se conserva</div>`:(rech?`<div class="note" style="margin-top:8px;color:#b42318">Última solicitud de desactivación: rechazada (${f(bj.resuelto_en)})</div>`:""));
    const lista=dopen[d.id]?(R.slice(0,8).map(x=>`<div class="item"><div><b>Ruta ${esc(x.id_ruta)}</b><small>${f(x.fecha)} · ${esc(x.cliente)} · ${x.entregados==null?"—":x.entregados}/${esc(x.asignados)}</small></div>${pillE(x.estatus)}</div>`).join("")||'<div class="note">Sin rutas recientes.</div>'):"";
    const form=dform===d.id?`<div style="margin-top:10px"><label>Motivo de la desactivación</label><textarea id="bj-m" rows="2" placeholder="Indica por qué se desactivará al driver"></textarea><div id="bj-e" class="note" style="color:#b42318"></div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn" data-bjok="${esc(d.id)}">Enviar solicitud</button><button class="btn ghost" data-bjx="1">Cancelar</button></div><div class="note" style="margin-top:6px">Requiere autorización del supervisor y del coordinador de Chazki. Se conserva el perfil y todo su historial.</div></div>`:"";
    return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h2 style="margin:0">${esc(d.nombre)}</h2><small style="color:var(--mut)">${esc(d.codigo||"")}${esc(d.telefono?" · "+d.telefono:"")}</small></div>${pillE(activo?"aprobada":"rechazada").replace(/Aprobada/,"Activo").replace(/Rechazada/,"Inactivo")}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px;text-align:center"><div><b style="font-size:18px">${esc(Rp.length)}</b><br><small>Rutas</small></div><div><b style="font-size:18px">${pct(asg?ent/asg:null)}</b><br><small>Efect.</small></div><div><b style="font-size:18px">${fal}</b><br><small>Fallidos</small></div><div><b style="font-size:18px">${esc(C.length)}</b><br><small>Cancel.</small></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn ghost" data-dv="${esc(d.id)}">${dopen[d.id]?"Ocultar rutas":"Ver rutas"}</button>${FLEET_PROFILE_ENABLED?`<button class="btn ghost" data-driver-perfil="${esc(d.id)}">Ver perfil y documentos</button>`:""}${pend?"":activo?`<button class="btn ghost" data-bj="${esc(d.id)}" style="color:#b42318">Solicitar desactivación</button>`:`<button class="btn ghost" data-reactivar="${esc(d.id)}">Reactivar driver</button>`}</div>${estado}${lista}${form}</div>`}).join("");
  box.innerHTML=`${invitarHtml()}<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">🚚 Mis drivers (${esc(DRVS.length)})</h2><div class="seg" id="dseg" style="margin:0;width:150px"><button class="${dp==="sem"?"on":""}" data-p="sem">Semana</button><button class="${dp==="mes"?"on":""}" data-p="mes">Mes</button></div></div></div>${cards||'<div class="card"><div class="note">Aún no tienes drivers en tu flotilla.</div></div>'}`;
  const ivOk=$("iv-ok");if(ivOk)ivOk.onclick=async()=>{const m=$("iv-m").value.trim(),c=$("iv-c").value;if(!m||!c){$("iv-e").textContent="Escribe el correo y elige el CEDIS";return}
    ivOk.disabled=true;const {data,error}=await sb.rpc("invitar_a_red",{p_email:m,p_nombre:$("iv-n").value.trim(),p_tipo:"driver",p_esquema:null,p_cedis_id:+c});if(error){$("iv-e").textContent=error.message;ivOk.disabled=false;return}
    toast(data);await loadDrivers()};
  box.querySelectorAll("[data-iv-reenviar]").forEach(b=>b.onclick=async()=>{b.disabled=true;const {data,error}=await sb.rpc("reenviar_solicitud_invitacion_red",{p_id:+b.dataset.ivReenviar});if(error){$("iv-e").textContent=error.message;b.disabled=false;return}toast(data);await loadDrivers()});
  const actualizar=$("iv-actualizar");if(actualizar)actualizar.onclick=async()=>{actualizar.disabled=true;await loadDrivers()};
  for(const [atributo,rpc] of [["iv-eliminar","eliminar_invitacion_red"],["iv-cancelar","cancelar_invitacion_red"]]){
    box.querySelectorAll(`[data-${atributo}]`).forEach(b=>b.onclick=async()=>{
      const eliminar=atributo==="iv-eliminar";
      if(!confirm(eliminar?"¿Eliminar esta invitación cancelada de la lista? Se conservará su historial; no se eliminará ninguna cuenta.":"¿Cancelar esta invitación?"))return;
      b.disabled=true;
      try{
        const {data,error}=await sb.rpc(rpc,{p_id:+b.getAttribute("data-"+atributo)});
        if(error)throw error;
        toast(data||(eliminar?"Invitación eliminada de la lista":"Invitación cancelada"));await loadDrivers();
      }catch(error){$("iv-e").textContent=error.message;b.disabled=false}
    });
  }
  box.querySelectorAll("#dseg button").forEach(b=>b.onclick=()=>{dp=b.dataset.p;drawDrivers()});
  box.querySelectorAll("[data-dv]").forEach(b=>b.onclick=()=>{dopen[b.dataset.dv]=!dopen[b.dataset.dv];drawDrivers()});
  box.querySelectorAll("[data-driver-perfil]").forEach(b=>b.onclick=()=>abrirPerfilDriver(b.dataset.driverPerfil));
  box.querySelectorAll("[data-bj]").forEach(b=>b.onclick=()=>{dform=b.dataset.bj;drawDrivers()});
  box.querySelectorAll("[data-bjx]").forEach(b=>b.onclick=()=>{dform=null;drawDrivers()});
  box.querySelectorAll("[data-reactivar]").forEach(b=>b.onclick=async()=>{b.disabled=true;const {error}=await sb.rpc("reactivar_driver",{p_driver_id:b.dataset.reactivar});if(error){toast(error.message);b.disabled=false;return}await loadDrivers()});
  box.querySelectorAll("[data-bjok]").forEach(b=>b.onclick=async()=>{const m=$("bj-m").value.trim();if(!m){$("bj-e").textContent="Escribe el motivo";return}
    b.disabled=true;const {error}=await sb.rpc("solicitar_baja_driver",{p_driver_id:b.dataset.bjok,p_motivo:m});if(error){$("bj-e").textContent=error.message;b.disabled=false;return}
    dform=null;await loadDrivers()})}
async function abrirPerfilDriver(id){
  abrirSheet('<h2>Perfil del driver</h2><p>Cargando perfil y documentos…</p><div id="fleet-profile-error"></div><button class="btn ghost" id="fleet-profile-close">Cerrar</button>');
  $("fleet-profile-close").onclick=()=>$("sheet").classList.add("hide");
  const [profile,documents]=await Promise.all([
    sb.rpc("perfil_driver_de_flotilla",{p_driver_id:id}),
    sb.from("driver_documents").select("id,tipo,estado,vigencia,storage_path,nota").eq("driver_id",id).order("creado_en",{ascending:false})
  ]);
  if(profile.error||documents.error){$("fleet-profile-error").innerHTML=`<div class="errbox">${esc((profile.error||documents.error).message)}</div>`;return}
  const p=profile.data,docs=documents.data||[],paths=docs.map(d=>d.storage_path).filter(Boolean);
  let urls=[];
  if(paths.length){
    const result=await sb.storage.from("driver-documents").createSignedUrls(paths,3600);
    if(result.error){$("fleet-profile-error").innerHTML=`<div class="errbox">No se pudieron abrir los archivos: ${esc(result.error.message)}</div>`;return}
    urls=result.data||[];
    if(paths.some(path=>!urls.some(u=>u.path===path&&u.signedUrl))){$("fleet-profile-error").innerHTML='<div class="errbox">No se pudieron abrir todos los archivos del expediente.</div>';return}
  }
  const fields=[["Nombre",p.nombre],["Código",p.codigo],["Teléfono",p.telefono],["Correo de contacto",p.correo_contacto],["Contacto de emergencia",p.emergencia_nombre],["Teléfono de emergencia",p.emergencia_telefono],["Parentesco",p.emergencia_parentesco],["Placas",p.vehiculo?.placas],["Tipo de vehículo",p.vehiculo?.tipo],["Marca / modelo",p.vehiculo?.marca_modelo],["Número de licencia",p.licencia?.numero],["Tipo de licencia",p.licencia?.tipo],["Vigencia de licencia",p.licencia?.vigencia]];
  const rows=fields.map(([name,value])=>`<div class="kv"><span>${esc(name)}</span><b>${esc(value||"—")}</b></div>`).join("");
  const types=DOC_TIPOS.filter(t=>!t.soloFlotillero);
  const docRows=types.map(t=>{
    const approved=docs.find(d=>d.tipo===t.k&&d.estado==="aprobado"),pending=docs.find(d=>d.tipo===t.k&&d.estado==="pendiente");
    const url=approved&&urls.find(u=>u.path===approved.storage_path)?.signedUrl;
    return `<div class="item"><div><b>${esc(t.n)}</b><small>${pending?"Actualización en revisión":approved?"Vigente":"Sin registrar"}</small></div><div>${url?`<a href="${esc(url)}" target="_blank" rel="noopener">Ver</a> `:""}<button class="btn ghost" data-fleet-doc="${esc(t.k)}" ${pending?"disabled":""}>${approved?"Actualizar":"Subir"}</button></div></div>`;
  }).join("");
  abrirSheet(`<h2>Perfil de ${esc(p.nombre)}</h2><p>Los datos son de consulta; solo el driver puede solicitar cambios.</p>${rows}<h2>Documentos</h2><p>La primera carga queda vigente; los reemplazos requieren aprobación de Operaciones.</p>${docRows}<button class="btn ghost" id="fleet-profile-close">Cerrar</button>`);
  $("fleet-profile-close").onclick=()=>$("sheet").classList.add("hide");
  $("sheet").querySelectorAll("[data-fleet-doc]").forEach(b=>b.onclick=()=>abrirCargaDocumentoFlotilla(id,b.dataset.fleetDoc));
}
function abrirCargaDocumentoFlotilla(driverId,tipo){
  const config=DOC_TIPOS.find(t=>t.k===tipo&&!t.soloFlotillero);
  if(!config){toast("Documento no permitido.");return}
  abrirSheet(`<h2>Subir ${esc(config.n)}</h2>${config.sinVigencia?"<p>Sin vencimiento.</p>":'<label>Fecha de vencimiento</label><input id="fleet-doc-date" type="date">'}<label>Archivo (PDF o imagen, máximo 10 MB)</label><input id="fleet-doc-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><div id="fleet-doc-error"></div><button class="btn" id="fleet-doc-save">Enviar documento</button><button class="btn ghost" id="fleet-doc-back">Volver</button>`);
  $("fleet-doc-back").onclick=()=>abrirPerfilDriver(driverId);
  $("fleet-doc-save").onclick=async()=>{
    const file=$("fleet-doc-file").files[0],vigencia=config.sinVigencia?null:$("fleet-doc-date").value,button=$("fleet-doc-save"),error=$("fleet-doc-error");
    if(!file||(!config.sinVigencia&&!vigencia)||file.size>10*1024*1024||!["application/pdf","image/jpeg","image/png","image/webp"].includes(file.type)){error.innerHTML='<div class="errbox">Selecciona un PDF o imagen válida de hasta 10 MB y la fecha cuando corresponda.</div>';return}
    button.disabled=true;
    const ext=(file.name.split(".").pop()||"bin").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8)||"bin";
    const path=`${driverId}/${tipo}/flotilla/${ME.id}/${crypto.randomUUID()}.${ext}`;
    const upload=await sb.storage.from("driver-documents").upload(path,file,{contentType:file.type,upsert:false});
    if(upload.error){button.disabled=false;error.innerHTML=`<div class="errbox">${esc(upload.error.message)}</div>`;return}
    const result=await sb.rpc("enviar_documento_flotillero",{p_driver_id:driverId,p_tipo:tipo,p_storage_path:path,p_vigencia:vigencia});
    if(result.error){button.disabled=false;error.innerHTML=`<div class="errbox">${esc(result.error.message)}. El archivo cargado no se vinculó al expediente; contacta a Operaciones.</div>`;return}
    if(result.data==="aprobado")toast("Documento vigente");
    else if(result.data==="pendiente")toast("Documento enviado a revisión");
    else toast("Documento enviado, pero se recibió un estado inesperado. Revisa el expediente.");
    await abrirPerfilDriver(driverId);
  };
}
const EST={por_validar:["Por validar","#946200","#fff4d6"],en_revision:["En revisión","#1d4ed8","#e3ecff"],aprobada:["Aprobada","#0f7a3d","#dff5e6"],rechazada:["Rechazada","#b42318","#fde4e1"],en_curso:["En curso","#555b7a","#ececf4"],aclaracion:["Aclaración solicitada","#7a4b00","#ffe9b8"],respondida:["Respondida · en revisión","#1d4ed8","#e3ecff"],apelada:["Apelada · en revisión","#1d4ed8","#e3ecff"],vencida:["Plazo vencido","#b42318","#fde4e1"]};
const pillE=k=>{const e=EST[k]||EST.por_validar;return `<span style="background:${e[2]};color:${e[1]};font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;white-space:nowrap">${e[0]}</span>`};
async function loadEstatus(){
  const box=$("gest");if(!box)return;
  const [r,c]=await Promise.all([sb.rpc("mis_rutas_estatus"),sb.rpc("mis_cancelaciones_estatus")]);
  RUTAS_K=r.data||[];CANS_K=c.data||[];drawKpi();
  const fl=ACC.es_flotillero,f=x=>new Date(x).toLocaleDateString("es-MX",{day:"2-digit",month:"short"});
  const rows=(r.data||[]).map(x=>`<div class="item"><div><b>Ruta ${esc(x.id_ruta)}</b><small>${f(x.fecha)} · ${esc(x.cliente)} · ${esc(x.cedis)}${esc(fl?" · "+x.driver:"")} · ${x.entregados==null?"—":x.entregados}/${esc(x.asignados)}</small></div>${pillE(x.estatus)}</div>`).join("");
  const can=(c.data||[]).map(x=>`<div class="item"><div><b>Cancelación${esc(x.id_ruta?" · Ruta "+x.id_ruta:"")}</b><small>${f(x.fecha)} · ${esc(x.cliente)} · ${esc(x.cedis)}${esc(fl?" · "+x.driver:"")}</small></div>${pillE(estC(x))}</div>`).join("");
  box.innerHTML=`<h3 style="margin:4px 0">Rutas</h3>${rows||'<div class="note">Aún no tienes rutas.</div>'}<h3 style="margin:14px 0 4px">Cancelaciones</h3>${can||'<div class="note">Aún no tienes cancelaciones.</div>'}`}
const parseF=s=>{const [y,m,d]=s.split("-");return new Date(+y,m-1,+d)};
const monday=d=>{const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x};
function drawG(){
  if(PAGOS_ERROR){
    $("glabel").textContent="Pagos no disponibles";$("gtot").textContent="—";$("gsub").textContent="Vuelve a intentarlo cuando tengas conexión.";
    $("bars").innerHTML="";$("gdes").innerHTML="";$("gflo").innerHTML="";
    $("gflota").classList.toggle("hide",true);
    $("gpag").innerHTML=`${vistaBolsaWalmart()}<div class="errbox">No se pudieron cargar los pagos: ${esc(PAGOS_ERROR)}</div>`;
    return;
  }
  const all=pagosConNoShow(),hoy=new Date(),lm=monday(hoy);let xs,vals,sel;
  if(gp==="sem"){xs=["L","M","X","J","V","S","D"];vals=Array(7).fill(0);sel=all.filter(p=>monday(parseF(p.fecha)).getTime()===lm.getTime());sel.forEach(p=>vals[(parseF(p.fecha).getDay()+6)%7]+=+p.monto)}
  else{const y=hoy.getFullYear(),m=hoy.getMonth();xs=["S1","S2","S3","S4","S5"];vals=Array(5).fill(0);sel=all.filter(p=>{const f=parseF(p.fecha);return f.getFullYear()===y&&f.getMonth()===m});sel.forEach(p=>vals[Math.min(4,Math.floor((parseF(p.fecha).getDate()-1)/7))]+=+p.monto)}
  const tot=vals.reduce((a,b)=>a+b,0),mx=Math.max(...vals.map(Math.abs),1);
  $("glabel").textContent=gp==="sem"?"Ganancias de la semana":"Ganancias del mes";$("gtot").textContent=fmt(tot);
  $("gsub").textContent=`${sel.filter(p=>p.concepto==="servicio").length} servicios registrados · incluye pendientes y pagados`;
  $("bars").innerHTML=vals.map((v,i)=>`<div><span>${v?fmt(v):""}</span><b style="height:${Math.max(3,Math.abs(v)/mx*100)}%;${v<0?"background:#d94848":""}"></b>${xs[i]}</div>`).join("");
  const by=c=>sel.filter(p=>p.concepto===c).reduce((a,p)=>a+ +p.monto,0);
  $("gdes").innerHTML=[["Servicios","servicio"],["Bonos","bono"],["Propinas","propina"],["Ajustes","ajuste"],["Penalizaciones NO SHOW","penalizacion_no_show"],["Reversiones NO SHOW","reversion_no_show"]].map(([l,c])=>`<div class="item"><span>${l}</span><b>${fmt(by(c))}</b></div>`).join("");
  $("gflota").classList.toggle("hide",!ACC.es_flotillero);
  if(ACC.es_flotillero){const m={};sel.filter(p=>p.concepto!=="liberacion_retencion_walmart").forEach(p=>{const n=p.drivers?p.drivers.nombre:"—";m[n]=(m[n]||0)+ +p.monto});
    $("gflo").innerHTML=Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`<div class="item"><span>${n}</span><b>${fmt(v)}</b></div>`).join("")||'<div class="note">Sin pagos en este periodo.</div>'}
  const paymentLabel=p=>({penalizacion_no_show:"Penalización NO SHOW",reversion_no_show:"Reversión NO SHOW",liberacion_retencion_walmart:"Liberación retención Walmart"}[p.concepto]||p.concepto[0].toUpperCase()+p.concepto.slice(1));
  $("gpag").innerHTML=`${vistaBolsaWalmart()}${all.length?all.slice(0,ACC.es_flotillero?15:8).map(p=>`<div class="item"><div>${esc(paymentLabel(p))}${esc(ACC.es_flotillero&&p.drivers?" · "+p.drivers.nombre:"")}<small>${parseF(p.fecha).toLocaleDateString("es-MX",{day:"2-digit",month:"short"})}${esc(p.rutas?" · Ruta "+p.rutas.id_ruta:"")}</small></div><div style="text-align:right"><b>${fmt(p.monto)}</b><small><span class="pill ${p.estatus==="pagado"?"ok":"w"}">${esc(p.estatus)}</span></small></div></div>`).join(""):'<div class="note">Aún no tienes pagos registrados.</div>'}`;
}
function vistaBolsaWalmart(){
  if(!ACC?.es_flotillero||!WALMART_TARIFARIO_ENABLED)return "";
  if(BOLSA_WALMART_ERROR)return `<div class="errbox">No se pudo cargar la bolsa del flotillero: ${esc(BOLSA_WALMART_ERROR)}</div>`;
  if(!BOLSA_WALMART)return "";
  const saldo=BOLSA_WALMART.saldo,plazo=BOLSA_WALMART.plazo;
  const monto=Number(saldo?.saldo_total);
  if(!saldo||!plazo||!Number.isFinite(monto)||monto<0
    ||!["calculado","requiere_revision","sin_ruta_confirmada"].includes(plazo.estado)
    ||typeof plazo.plazo_cumplido!=="boolean"
    ||(plazo.estado==="calculado"&&!plazo.disponible_desde)
    ||(plazo.plazo_cumplido&&(plazo.estado!=="calculado"||!plazo.disponible_desde))
    ||BOLSA_WALMART.liberacion_validada!==false)
    return '<div class="errbox">La bolsa Walmart devolvió una respuesta inválida.</div>';
  const fecha=plazo.estado==="calculado"&&plazo.disponible_desde?new Date(plazo.disponible_desde):null;
  if(fecha&&Number.isNaN(fecha.getTime()))return '<div class="errbox">La fecha de vencimiento de la bolsa no es válida.</div>';
  const aviso=plazo.estado==="requiere_revision"
    ?"Hay rutas pendientes de identificar o sincronizar; no se puede estimar el vencimiento."
    :plazo.estado==="sin_ruta_confirmada"
      ?"Aún no hay una ruta confirmada para calcular el vencimiento."
      :plazo.plazo_cumplido
        ?`El plazo de retención venció el ${fecha.toLocaleString("es-MX",{timeZone:"America/Mexico_City"})}; la bolsa aún requiere revisión y no representa un pago.`
        :`El plazo de retención vence el ${fecha.toLocaleString("es-MX",{timeZone:"America/Mexico_City"})}.`;
  return `<div class="note" style="margin-bottom:10px"><b>Bolsa Walmart retenida: ${fmt(monto)}</b><br>${esc(aviso)}<br>El vencimiento del plazo no autoriza ni confirma la liberación del saldo.</div>`;
}
function pagosConNoShow(){
  const penalties=new Set(NO_SHOW_CASES.map(c=>c.pago_penalizacion_id).filter(id=>id!=null).map(String));
  const reversals=new Set(NO_SHOW_CASES.map(c=>c.pago_reversion_id).filter(id=>id!=null).map(String));
  return PAGOS.map(p=>({
    ...p,
    concepto:penalties.has(String(p.id))?"penalizacion_no_show":reversals.has(String(p.id))?"reversion_no_show":p.concepto
  })).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
}
document.querySelectorAll("#gseg button").forEach(b=>b.onclick=()=>{document.querySelectorAll("#gseg button").forEach(x=>x.classList.toggle("on",x===b));gp=b.dataset.p;drawG()});

const PNR_ESTADOS={
  esperando_driver:["Pendiente de tu respuesta","w"],
  revision:["En revisión por Operaciones","w"],
  esperando_soporte:["Soporte adicional solicitado","bad"],
  cerrada_sin_cargo:["Cerrado · sin descuento","ok"],
  cerrada_con_cargo:["Cerrado · descuento aplicado","bad"]
};
const fechaPnR=value=>value?new Date(value).toLocaleString("es-MX",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
const fmtPnR=value=>"$"+Number(value||0).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2});
async function loadPnrs(){
  if(!navigator.onLine){PNR_ERROR="El seguimiento de PNR requiere conexión a internet.";NO_SHOW_ERROR="Conéctate a internet para consultar los NO SHOW.";drawPnrs();return}
  const noShowQuery=sb.from("no_show_casos").select("*").order("creado_en",{ascending:false}).limit(1000);
  const [claims,discounts,noShows]=await Promise.all([
    sb.from("pnr_reclamos").select("*,pnr_reclamo_eventos(*)").eq("driver_id",ME.id).order("creado_en",{ascending:false}),
    sb.from("pnr_descuentos").select("reclamo_id,saldo_pendiente,monto_aplicado").eq("driver_id",ME.id),
    ACC.es_flotillero?noShowQuery:noShowQuery.eq("driver_id",ME.id)
  ]);
  if(noShows.error){NO_SHOW_CASES=[];NO_SHOW_EVENTS=[];NO_SHOW_ERROR="No se pudieron cargar los NO SHOW. Verifica que Operaciones haya instalado el flujo en Supabase: "+noShows.error.message}
  else{
    NO_SHOW_CASES=noShows.data||[];NO_SHOW_ERROR="";
    const ids=NO_SHOW_CASES.map(c=>c.id);
    if(ids.length){
      const {data,error}=await sb.from("no_show_eventos").select("*").in("caso_id",ids).order("creado_en");
      if(error){NO_SHOW_EVENTS=[];NO_SHOW_ERROR="No se pudo cargar el historial de NO SHOW: "+error.message}
      else NO_SHOW_EVENTS=data||[];
    }else NO_SHOW_EVENTS=[];
  }
  if(claims.error){PNR_ERROR="No se pudieron cargar tus reclamos. Verifica que Operaciones haya habilitado el módulo PNR: "+claims.error.message;PNRS=[];drawPnrs();if($("gpag")&&ACC.puede_ver_ganancias)await loadGan();return}
  if(discounts.error){PNR_ERROR="No se pudo cargar el estado de tus descuentos: "+discounts.error.message;PNR_DISCOUNTS={}}
  else PNR_DISCOUNTS=Object.fromEntries((discounts.data||[]).map(x=>[x.reclamo_id,x]));
  const previousPnrs=PNRS;PNRS=claims.data||[];PNR_ERROR="";
  if(PNR_SEEN){
    const known=new Set(previousPnrs.map(x=>x.id));
    const incoming=PNRS.filter(x=>!known.has(x.id));
    if(incoming.length){
      toast(incoming.length===1?"🔔 Tienes un nuevo reclamo PNR. Revisa tu plazo de respuesta.":`🔔 Tienes ${incoming.length} nuevos reclamos PNR.`);
      if("Notification" in window&&Notification.permission==="granted")try{new Notification("Nuevo reclamo PNR",{body:"Revisa los detalles y responde dentro de las 24 horas."})}catch(e){}
    }
  }
  PNR_SEEN=true;
  const paths=PNRS.flatMap(x=>(x.pnr_reclamo_eventos||[]).flatMap(e=>e.adjuntos||[]));
  if(paths.length){
    const {data,error}=await sb.storage.from("pnr-evidence").createSignedUrls(paths,3600);
    if(error){PNR_ERROR="No se pudieron abrir algunas evidencias: "+error.message}
    else{
      const urls=Object.fromEntries((data||[]).filter(x=>x.signedUrl).map(x=>[x.path,x.signedUrl]));
      PNRS=PNRS.map(x=>({...x,pnr_reclamo_eventos:(x.pnr_reclamo_eventos||[]).map(e=>({...e,urls:(e.adjuntos||[]).map(path=>({path,url:urls[path]})).filter(x=>x.url)}))}));
    }
  }
  drawPnrs();
  if($("gpag")&&ACC.puede_ver_ganancias)await loadGan();
}
function drawPnrs(){
  const errorBox=$("pnr-error"),list=$("pnr-list");
  if(!errorBox||!list)return;
  err("pnr-error",PNR_ERROR?new Error(PNR_ERROR):null);
  drawNoShows();
  list.innerHTML=PNRS.length?PNRS.map(claim=>{
    const [label,style]=PNR_ESTADOS[claim.estado]||["Estatus desconocido","w"];
    const events=(claim.pnr_reclamo_eventos||[]).slice().sort((a,b)=>new Date(a.creado_en)-new Date(b.creado_en));
    const canRespond=["esperando_driver","esperando_soporte"].includes(claim.estado)&&claim.vence_en&&new Date(claim.vence_en)>Date.now();
    const discount=PNR_DISCOUNTS[claim.id];
    return `<article class="card" style="border:1px solid var(--line);box-shadow:none">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><b>PNR ${esc(claim.pnr)}</b><span class="pill ${style}">${esc(label)}</span></div>
      <div class="note">Cliente: <b>${esc(claim.cliente)}</b>${claim.ruta_id?` · Ruta: ${esc(claim.ruta_id)}`:""}<br>Recibido: ${esc(fechaPnR(claim.creado_en))} · Importe del reclamo: <b>${esc(fmtPnR(claim.monto))}</b><br>${canRespond?`Responde antes del: <b>${esc(fechaPnR(claim.vence_en))}</b>`:claim.estado==="esperando_driver"||claim.estado==="esperando_soporte"?"El plazo venció; el reclamo se cerrará automáticamente.":""}</div>
      ${discount?`<div class="item"><span>Descuento del reclamo</span><b>${esc(fmtPnR(discount.monto_aplicado))} aplicado · ${esc(fmtPnR(discount.saldo_pendiente))} pendiente de próximas liquidaciones</b></div>`:""}
      <h3>Línea del tiempo</h3>${events.map(event=>`<div class="item" style="display:block"><b>${esc(pnrEventLabel(event.tipo))}</b><small style="display:block">${esc(fechaPnR(event.creado_en))}${event.actor_email?" · "+esc(event.actor_email):""}</small>${event.mensaje?`<div style="white-space:pre-wrap;margin-top:5px">${esc(event.mensaje)}</div>`:""}${(event.urls||[]).length?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${event.urls.map((file,i)=>`<a href="${esc(file.url)}" target="_blank" rel="noopener">Evidencia ${i+1}</a>`).join("")}</div>`:""}</div>`).join("")||'<div class="note">Aún no hay movimientos.</div>'}
      ${canRespond?`<label for="pnr-msg-${esc(claim.id)}">${claim.estado==="esperando_soporte"?"Respuesta con soporte adicional":"Tu respuesta o apelación"}</label>
      <textarea id="pnr-msg-${esc(claim.id)}" rows="3" maxlength="5000" placeholder="Explica lo ocurrido y agrega la información relevante"></textarea>
      <label for="pnr-files-${esc(claim.id)}">Imágenes de evidencia (opcional, máximo 5)</label><input id="pnr-files-${esc(claim.id)}" type="file" accept="image/jpeg,image/png,image/webp" multiple>
      <button class="btn" data-pnr-send="${esc(claim.id)}">Enviar respuesta</button>`:""}
    </article>`;
  }).join(""):'<div class="note">No tienes PNR ni penalizaciones registrados.</div>';
  list.querySelectorAll("[data-pnr-send]").forEach(button=>button.onclick=()=>responderPnR(button.dataset.pnrSend,button));
}
const estadoNoShowDriver={
  reportado:["Penalización aplicada · apelación disponible","w"],
  apelado:["Apelación pendiente de Coordinación","bad"],
  apelacion_aceptada:["Apelación aceptada · penalización revertida","ok"],
  apelacion_rechazada:["Apelación rechazada · penalización vigente","bad"]
};
const fechaNoShow=value=>value?new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}):"—";
function drawNoShows(){
  const errorBox=$("no-show-error"),list=$("no-show-list");
  if(!errorBox||!list)return;
  err("no-show-error",NO_SHOW_ERROR?new Error(NO_SHOW_ERROR):null);
  list.innerHTML=NO_SHOW_CASES.length?NO_SHOW_CASES.map(c=>{
    const [label,style]=estadoNoShowDriver[c.estado]||["Estatus desconocido","w"];
    const vence=c.vence_apelacion_en?new Date(c.vence_apelacion_en):null;
    const canAppeal=navigator.onLine&&c.estado==="reportado"&&vence&&vence>Date.now();
    const events=NO_SHOW_EVENTS.filter(e=>e.caso_id===c.id);
    return `<article class="card" style="border:1px solid var(--line);box-shadow:none">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><b>NO SHOW · ${esc(c.cliente_nombre)}</b><span class="pill ${style}">${esc(label)}</span></div>
      <div class="note">Fecha del servicio: <b>${esc(fechaNoShow(c.fecha_servicio))}</b> · CEDIS: <b>${esc(c.cedis_nombre)}</b><br>Reportado: ${esc(fechaPnR(c.creado_en))}<br>Penalización en tus ganancias: <b>${esc(fmtPnR(-Number(c.monto_penalizacion||0)))}</b></div>
      <div class="item" style="display:block"><b>Observaciones del Supervisor</b><div style="white-space:pre-wrap;margin-top:4px">${esc(c.observaciones_supervisor)}</div></div>
      ${c.apelacion?`<div class="item" style="display:block"><b>Tu contestación</b><div style="white-space:pre-wrap;margin-top:4px">${esc(c.apelacion)}</div><small>${esc(fechaPnR(c.apelacion_en))}</small></div>`:""}
      ${c.resolucion?`<div class="item" style="display:block"><b>Resolución de Coordinación</b><div style="white-space:pre-wrap;margin-top:4px">${esc(c.resolucion)}</div></div>`:""}
      ${events.length?`<details><summary>Historial (${events.length} movimientos)</summary>${events.map(e=>`<div class="item" style="display:block"><b>${esc(({reportado:"Reporte creado",apelacion_driver:"Apelación enviada",apelacion_aceptada:"Apelación aceptada",apelacion_rechazada:"Apelación rechazada"})[e.tipo]||e.tipo)}</b><small>${esc(fechaPnR(e.creado_en))}</small><div style="white-space:pre-wrap">${esc(e.mensaje)}</div></div>`).join("")}</details>`:""}
      ${canAppeal?`<label for="ns-appeal-${esc(c.id)}">Apela una sola vez (máximo 300 caracteres; vence ${esc(fechaPnR(c.vence_apelacion_en))})</label><textarea id="ns-appeal-${esc(c.id)}" rows="3" maxlength="300" placeholder="Explica por qué solicitas revisar la penalización"></textarea><div style="text-align:right;color:var(--mut);font-size:12px"><span data-ns-count="${esc(c.id)}">0</span>/300</div><button class="btn" data-ns-appeal="${esc(c.id)}">Enviar apelación</button>`:c.estado==="reportado"?"<div class=\"note\">El plazo de 6 horas para apelar venció.</div>":""}
    </article>`;
  }).join(""):'<div class="note">No tienes reportes NO SHOW.</div>';
  list.querySelectorAll("[data-ns-appeal]").forEach(button=>button.onclick=()=>apelarNoShow(button.dataset.nsAppeal,button));
  list.querySelectorAll("textarea[id^=\"ns-appeal-\"]").forEach(textarea=>textarea.oninput=()=>{const id=textarea.id.slice("ns-appeal-".length);const counter=list.querySelector(`[data-ns-count="${id}"]`);if(counter)counter.textContent=String(textarea.value.length)});
}
function textoInapropiadoNoShow(value){
  const normalized=String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ");
  return /(^| )(puta|puto|putas|putos|mierda|chingar|chingado|chingada|chingados|chingadas|chingue|chingues|verga|vergas|pendejo|pendeja|pendejos|pendejas|culero|culera|culeros|culeras|cabron|cabrona|cabrones|cabronas|pinche|pinches|jodido|jodida|joder|maricon|maricona|maricones|fuck|fucking|shit|bitch|asshole|bastard)( |$)/.test(normalized);
}
async function apelarNoShow(id,button){
  const field=$("ns-appeal-"+id),message=field.value.trim();
  if(!message||message.length>300||textoInapropiadoNoShow(message)){err("no-show-error",new Error("Escribe una contestación de hasta 300 caracteres y sin groserías."));return}
  button.disabled=true;err("no-show-error",null);
  try{
    const {error}=await sb.rpc("apelar_no_show",{p_caso_id:id,p_contestacion:message});
    if(error)throw error;
    toast("Apelación enviada a Coordinación");await loadPnrs();
  }catch(error){err("no-show-error",error);button.disabled=false}
}
function pnrEventLabel(type){
  return ({creado:"Reclamo generado por Operaciones",respuesta_driver:"Primera respuesta del driver",solicitud_soporte:"Operaciones solicitó soporte adicional",evidencia_adicional:"Soporte adicional enviado",evidencia_aceptada:"Evidencia aceptada · reclamo cerrado sin cargo",evidencia_rechazada:"Evidencia insuficiente · reclamo cerrado con cargo",vencido:"Plazo vencido · reclamo cerrado con cargo",descuento_aplicado:"Descuento aplicado a liquidación"})[type]||type;
}
async function responderPnR(id,button){
  const message=$("pnr-msg-"+id).value.trim(),files=[...$("pnr-files-"+id).files];
  if(!message&&!files.length){$("pnr-error").innerHTML='<div class="errbox">Escribe una respuesta o adjunta al menos una imagen.</div>';return}
  if(files.length>5||files.some(file=>file.size>10*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type))){
    $("pnr-error").innerHTML='<div class="errbox">Adjunta hasta 5 imágenes JPEG, PNG o WebP de máximo 10 MB cada una.</div>';return
  }
  button.disabled=true;err("pnr-error",null);const paths=[];let submitted=false;
  try{
    for(const file of files){
      const ext=file.type==="image/jpeg"?"jpg":file.type==="image/png"?"png":"webp";
      const path=`${ME.id}/${crypto.randomUUID()}.${ext}`;
      const {error}=await sb.storage.from("pnr-evidence").upload(path,file,{contentType:file.type,upsert:false});
      if(error)throw error;paths.push(path);
    }
    const {error}=await sb.rpc("responder_reclamo_pnr",{p_reclamo_id:id,p_mensaje:message||"Se adjunta evidencia.",p_adjuntos:paths});
    if(error)throw error;
    submitted=true;
    toast("Respuesta enviada a Operaciones");await loadPnrs();
  }catch(error){
    let cleanupError=null;
    if(!submitted&&paths.length){const result=await sb.storage.from("pnr-evidence").remove(paths);cleanupError=result.error}
    err("pnr-error",new Error((submitted?"La respuesta quedó enviada, pero no se pudo actualizar la vista: ":"")+(error.message||error)+(cleanupError?` · No se pudieron limpiar archivos temporales: ${cleanupError.message}`:"")));
    button.disabled=false;
  }
}

// ---------- Perfil ----------
let LICENCIA=null;
const TIPOS_PERFIL=["Moto","Auto hatch","Auto sedan","Small van","Large van","3.5T","4.5T","5T","RABÓN","TORTON SECO","TORTON REFRIGERADO","TRAILER 53 SECO","TRAILER 53 REFRIGERADO"];
async function loadPerfil(){
  const [v,l,d,c]=await Promise.all([sb.from("vehiculos").select("*").eq("driver_id",ME.id).eq("activo",true).maybeSingle(),sb.from("licencias").select("*").eq("driver_id",ME.id).maybeSingle(),sb.from("drivers").select("*").eq("id",ME.id).single(),sb.from("cambios_perfil").select("estatus,nota,solicitado_en").eq("driver_id",ME.id).order("solicitado_en",{ascending:false}).limit(1)]);
  const fallo=v.error||l.error||d.error||c.error;
  if(fallo){err("contact-err",new Error("No se pudo cargar el perfil: "+fallo.message));return}
  err("contact-err",null);
  DRIVER=d.data||DRIVER;  VEHICULO=v.data;LICENCIA=l.data;const V=VEHICULO,L=LICENCIA;
  $("pnom").textContent=DRIVER.nombre;$("pcod").textContent=DRIVER.codigo||"—";$("pmail").textContent=ME.email;
  $("vpl").textContent=V?V.placas:"Sin registrar";$("vtp").textContent=V?(V.tipo_detalle||V.tipo):"—";$("vmm").textContent=(V&&V.marca_modelo)||"—";
  $("lnum").textContent=(L&&L.numero)||"Sin registrar";$("ltip").textContent=(L&&L.tipo)||"—";
  $("lvig").textContent=L&&L.vigencia?parseF(L.vigencia).toLocaleDateString("es-MX"):"—";
  $("utel").value=DRIVER.telefono||"";$("ucorreo").value=DRIVER.correo_contacto||"";
  $("uemergencia-nombre").value=DRIVER.emergencia_nombre||"";$("uemergencia-telefono").value=DRIVER.emergencia_telefono||"";$("uemergencia-parentesco").value=DRIVER.emergencia_parentesco||"";
  const cambio=c.data?.[0];
  $("perfil-estado").textContent=cambio?(cambio.estatus==="pendiente"?"Tienes una solicitud de perfil pendiente de aprobación.":cambio.estatus==="rechazada"?`Última solicitud rechazada${cambio.nota?": "+cambio.nota:""}.`:"Última solicitud aprobada."):"";
  const cached=await localGet("cache",ME.id);
  if(cached)await localPut("cache",{...cached,vehicle:VEHICULO});
  await loadDocs();
}
$("save-contact").onclick=async()=>{
  err("contact-err",null);
  const correo=$("ucorreo").value.trim().toLowerCase();
  if(correo&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)){err("contact-err",new Error("Escribe un correo de contacto válido."));return}
  const button=$("save-contact");button.disabled=true;
  const {data,error}=await sb.rpc("solicitar_contacto_perfil",{p_datos:{telefono:$("utel").value.trim()||null,correo_contacto:correo||null,emergencia_nombre:$("uemergencia-nombre").value.trim()||null,emergencia_telefono:$("uemergencia-telefono").value.trim()||null,emergencia_parentesco:$("uemergencia-parentesco").value.trim()||null}});
  button.disabled=false;
  if(error){err("contact-err",error);return}
  if(data==="guardado")toast("Datos de contacto guardados ✔");
  else if(data==="pendiente")toast("Datos nuevos guardados; cambios enviados a Operaciones");
  else if(data==="sin_cambios")toast("No hay cambios");
  else {err("contact-err",new Error("Respuesta inesperada al guardar el contacto."));return}
  await loadPerfil();
};
$("edit-vehicle").onclick=()=>{
  const v=VEHICULO||{},actual=v.tipo_detalle||({"Sedan":"Auto sedan","Small":"Small van","Large":"Large van"}[v.tipo])||v.tipo||"";
  abrirSheet(`<h2>Vehículo</h2><p>La primera captura se guarda; los cambios requieren aprobación. Los tipos sin tarifa configurada no se calculan automáticamente.</p><label>Placas</label><input id="vp-placas" value="${esc(v.placas||"")}"><label>Tipo de vehículo</label><select id="vp-tipo"><option value="">Selecciona…</option>${!TIPOS_PERFIL.includes(actual)&&actual?`<option value="" selected>${esc(actual)} · selecciona un tipo vigente</option>`:""}${TIPOS_PERFIL.map(t=>`<option value="${esc(t)}" ${t===actual?"selected":""}>${esc(t)}</option>`).join("")}</select><label>Marca / modelo</label><input id="vp-marca" value="${esc(v.marca_modelo||"")}"><div id="vp-error"></div><button class="btn" id="vp-save">Guardar o solicitar</button><button class="btn ghost" id="vp-cancel">Cancelar</button>`);
  $("vp-cancel").onclick=()=>$("sheet").classList.add("hide");
  $("vp-save").onclick=()=>enviarPerfil("solicitar_vehiculo_perfil",{p_placas:$("vp-placas").value.trim(),p_tipo:$("vp-tipo").value,p_marca_modelo:$("vp-marca").value.trim()||null},"vp-save","vp-error");
};
$("edit-license").onclick=()=>{
  const l=LICENCIA||{};
  abrirSheet(`<h2>Licencia</h2><p>La primera captura se guarda; los cambios requieren aprobación.</p><label>Número</label><input id="lp-numero" value="${esc(l.numero||"")}"><label>Tipo</label><input id="lp-tipo" value="${esc(l.tipo||"")}"><label>Vigencia</label><input id="lp-vigencia" type="date" value="${esc(l.vigencia||"")}"><div id="lp-error"></div><button class="btn" id="lp-save">Guardar o solicitar</button><button class="btn ghost" id="lp-cancel">Cancelar</button>`);
  $("lp-cancel").onclick=()=>$("sheet").classList.add("hide");
  $("lp-save").onclick=()=>enviarPerfil("solicitar_licencia_perfil",{p_numero:$("lp-numero").value.trim(),p_tipo:$("lp-tipo").value.trim(),p_vigencia:$("lp-vigencia").value||null},"lp-save","lp-error");
};
async function enviarPerfil(rpc,args,buttonId,errorId){
  const button=$(buttonId);button.disabled=true;err(errorId,null);
  const {data,error}=await sb.rpc(rpc,args);
  if(error){button.disabled=false;err(errorId,error);return}
  if(!["guardado","pendiente","sin_cambios"].includes(data)){button.disabled=false;err(errorId,new Error("Respuesta inesperada al actualizar el perfil."));return}
  $("sheet").classList.add("hide");
  toast(data==="guardado"?"Datos guardados":data==="pendiente"?"Cambio enviado a Operaciones":"No hay cambios");
  await loadPerfil();
}
const DOC_TIPOS=[
  {k:"seguro",n:"Seguro del vehículo",ic:"🛡️"},
  {k:"licencia",n:"Licencia de conducir",ic:"🪪"},
  {k:"tarjeta",n:"Tarjeta de circulación",ic:"🚗"},
  {k:"ine",n:"INE",ic:"🆔"},
  {k:"domicilio",n:"Comprobante de domicilio",ic:"🏠",sinVigencia:true},
  {k:"constancia_fiscal",n:"Constancia de situación fiscal",ic:"📄",sinVigencia:true,soloFlotillero:true},
  {k:"estado_cuenta",n:"Estado de cuenta a su nombre",ic:"📄",sinVigencia:true,soloFlotillero:true}
];
const docTiposActuales=()=>DOC_TIPOS.filter(t=>!t.soloFlotillero||DRIVER?.rol==="flotillero");
let DOCS=[],DOC_ALERTS=[],DOCS_ERR="";
const docTypeName=k=>(DOC_TIPOS.find(x=>x.k===k)||{}).n||k;
function diasVencimiento(value){
  if(!value)return null;
  const today=new Date(),start=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  const expiry=new Date(`${value}T00:00:00`);
  return Number.isNaN(expiry.getTime())?null:Math.floor((expiry-start)/86400000);
}
function estadoDoc(d){
  if(!d)return {txt:"Sin registrar",cls:"w",dias:null};
  const dias=diasVencimiento(d.vigencia);
  if(dias===null)return {txt:d.vigencia?"Fecha inválida":"Sin vencimiento",cls:d.vigencia?"w":"ok",dias:null};
  if(dias<0)return {txt:`Vencido hace ${-dias} ${dias===-1?"día":"días"}`,cls:"bad",dias};
  if(dias<=15)return {txt:`Vence en ${dias} ${dias===1?"día":"días"}`,cls:"bad",dias};
  if(dias<=30)return {txt:`Vence en ${dias} días`,cls:"w",dias};
  return {txt:"Vigente",cls:"ok",dias};
}
async function loadDocs(){
  DOCS_ERR="";
  const {data,error}=await sb.from("driver_documents").select("id,driver_id,tipo,storage_path,vigencia,estado,origen,creado_en,nota").eq("driver_id",ME.id).order("creado_en",{ascending:false});
  if(error){DOCS=[];DOC_ALERTS=[];DOCS_ERR="No se pudieron cargar los documentos. Verifica que esté instalada la configuración de documentos en Supabase: "+error.message;drawDocs();return}
  DOCS=data||[];
  const paths=DOCS.map(x=>x.storage_path).filter(Boolean);
  if(paths.length){
    const {data:urls,error:urlError}=await sb.storage.from("driver-documents").createSignedUrls(paths,3600);
    if(urlError){DOCS_ERR="No se pudieron abrir los archivos: "+urlError.message}
    else DOCS=DOCS.map(x=>({...x,url:(urls||[]).find(y=>y.path===x.storage_path)?.signedUrl||null}));
  }
  const {data:alerts,error:alertError}=await sb.from("driver_document_alerts").select("id,driver_document_id,alert_date,message").eq("driver_id",ME.id).order("alert_date",{ascending:false}).limit(30);
  DOC_ALERTS=alertError?[]:alerts||[];
  if(alertError)DOCS_ERR+=(DOCS_ERR?" ":"")+"No se pudieron cargar las alertas: "+alertError.message;
  drawDocs();
}
function drawDocs(){
  const alerts=[];
  $("docs-list").innerHTML=docTiposActuales().map(t=>{
    const approved=DOCS.find(x=>x.tipo===t.k&&x.estado==="aprobado");
    const pending=DOCS.find(x=>x.tipo===t.k&&x.estado==="pendiente");
    const lastRejected=DOCS.find(x=>x.tipo===t.k&&x.estado==="rechazado");
    const state=estadoDoc(approved);
    if(approved&&state.dias!==null&&state.dias<=15&&!pending)alerts.push({cls:"bad",text:`${t.n}: ${state.txt.toLowerCase()}. Sube el reemplazo para dejar de recibir alertas.`});
    const date=approved?.vigencia?new Date(`${approved.vigencia}T00:00:00`).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}):"";
    return `<div class="doc"><div class="ic">${esc(t.ic)}</div><div class="info"><b>${esc(t.n)}</b>
      <small>${approved?(t.sinVigencia?"Sin fecha de vencimiento":`Vigencia hasta ${esc(date)}`):"Aún no hay un documento autorizado"}</small>
      <span class="pill ${approved?state.cls:"w"}" style="margin-top:6px">${approved?esc(state.txt):"Sin registrar"}</span>
      ${pending?`<small class="pill w" style="display:inline-block;margin-top:5px">Actualización enviada · en espera de Operaciones</small>`:""}
      ${lastRejected?`<small class="pill bad" style="display:inline-block;margin-top:5px">Último archivo rechazado${lastRejected.nota?`: ${esc(lastRejected.nota)}`:""}</small>`:""}
      </div><div class="act">${approved?.url?`<a href="${esc(approved.url)}" target="_blank" rel="noopener">Ver</a>`:""}<button data-docsub="${esc(t.k)}" ${pending?"disabled":""}>${pending?"En revisión":approved?"Actualizar":"Subir"}</button></div></div>`;
  }).join("");
  const today=new Date().toLocaleDateString("en-CA");
  const todayAlerts=DOC_ALERTS.filter(x=>{
    if(x.alert_date!==today)return false;
    const alertDoc=DOCS.find(d=>d.id===x.driver_document_id);
    return alertDoc&&!DOCS.some(d=>d.tipo===alertDoc.tipo&&d.estado==="pendiente");
  });
  $("docs-banner").innerHTML=alerts.map(a=>`<div class="alerta ${a.cls}">⚠️ ${esc(a.text)}</div>`).join("")+
    todayAlerts.map(a=>`<div class="alerta bad">⛔ ${esc(a.message)}</div>`).join("");
  document.querySelector("nav button[data-t=per]").classList.toggle("alerta-dot",alerts.length>0||todayAlerts.length>0);
  $("docs-note").textContent=DOCS_ERR||"Los documentos son privados. La primera carga queda vigente; Operaciones debe aprobar los reemplazos.";
  document.querySelectorAll("[data-docsub]").forEach(b=>b.onclick=()=>abrirCargaDocumento(b.dataset.docsub));
  if(todayAlerts.length&&"Notification" in window&&Notification.permission==="granted"){
    const key=`doc-alert-${ME.id}-${today}`;
    if(localStorage.getItem(key)!=="1"){
      new Notification("Vigencia de documentos",{body:todayAlerts.map(x=>x.message).join("\n")});
      localStorage.setItem(key,"1");
    }
  }
}
function abrirCargaDocumento(tipo){
  const config=docTiposActuales().find(t=>t.k===tipo);
  if(!config){toast("Este documento no corresponde a tu categoría.");return}
  abrirSheet(`<h2>Subir ${esc(docTypeName(tipo))}</h2><p>La primera carga queda vigente. Los reemplazos requieren aprobación de Operaciones.</p>${config.sinVigencia?"<p>Este documento no requiere fecha de vencimiento.</p>":'<label for="doc-date">Fecha de vencimiento</label><input id="doc-date" type="date" required>'}
    <label for="doc-file">Archivo (PDF o imagen, máximo 10 MB)</label><input id="doc-file" type="file" accept="image/*,application/pdf" required>
    <div id="doc-upload-error"></div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn" id="doc-upload">Enviar documento</button><button class="btn ghost" id="doc-upload-cancel">Cancelar</button></div>`);
  $("doc-upload-cancel").onclick=()=>$("sheet").classList.add("hide");
  $("doc-upload").onclick=async()=>{
    const file=$("doc-file").files[0],vigencia=config.sinVigencia?null:$("doc-date").value,errorBox=$("doc-upload-error"),button=$("doc-upload");
    errorBox.innerHTML="";
    if(!file||(!config.sinVigencia&&!vigencia)){errorBox.innerHTML='<div class="errbox">Selecciona el documento y, cuando corresponda, su fecha de vencimiento.</div>';return}
    if(file.size>10*1024*1024){errorBox.innerHTML='<div class="errbox">El archivo supera el límite de 10 MB.</div>';return}
    if(!(file.type==="application/pdf"||["image/jpeg","image/png","image/webp"].includes(file.type))){errorBox.innerHTML='<div class="errbox">Solo se aceptan PDF, JPEG, PNG o WebP.</div>';return}
    button.disabled=true;
    const extension=(file.name.split(".").pop()||"bin").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8)||"bin";
    const storagePath=`${ME.id}/${tipo}/${crypto.randomUUID()}.${extension}`;
    const {error:uploadError}=await sb.storage.from("driver-documents").upload(storagePath,file,{contentType:file.type,upsert:false});
    if(uploadError){button.disabled=false;errorBox.innerHTML=`<div class="errbox">${esc(uploadError.message)}</div>`;return}
    const {data:estado,error:insertError}=await sb.rpc("enviar_documento_driver",{p_tipo:tipo,p_storage_path:storagePath,p_vigencia:vigencia});
    if(insertError){
      const {error:removeError}=await sb.storage.from("driver-documents").remove([storagePath]);
      button.disabled=false;
      errorBox.innerHTML=`<div class="errbox">${esc(insertError.message)}${removeError?` · No se pudo limpiar el archivo temporal: ${esc(removeError.message)}`:""}</div>`;
      return;
    }
    $("sheet").classList.add("hide");
    if(estado==="aprobado")toast("Documento guardado y vigente ✔");
    else if(estado==="pendiente")toast("Actualización enviada a Operaciones ✔");
    else toast("Documento enviado, pero se recibió un estado inesperado. Revisa tu expediente.");
    await loadDocs();
  };
}
drawDocs();

window.addEventListener("offline",()=>{OFFLINE_MODE=true;setNetStatus("Sin conexión · el check-in, check-out y las fotos se guardarán en este dispositivo.",true)});
window.addEventListener("online",async()=>{
  if(!ME)return;
  const wasOffline=OFFLINE_MODE,routeOk=await syncPendingRoute(),cancelOk=await syncPendingCancellations();
  if(routeOk&&cancelOk&&wasOffline)location.reload();
});
setInterval(async()=>{
  if(!ME||!navigator.onLine)return;
  const wasOffline=OFFLINE_MODE,routeOk=await syncPendingRoute(),cancelOk=await syncPendingCancellations();
  if(routeOk&&cancelOk&&wasOffline)location.reload();
},20000);
sb.auth.onAuthStateChange(ev=>{if(ev==="SIGNED_OUT")location.reload()});
if("serviceWorker" in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js").catch(()=>{});
boot().catch(e=>{const message=e&&e.message?e.message:"No se pudo iniciar la app.";setNetStatus(message,true);$("auth").classList.remove("hide");$("amsg").innerHTML=`<div class="errbox">${esc(message)}</div>`});
