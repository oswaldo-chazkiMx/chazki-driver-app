const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sb=supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_KEY);const $=id=>document.getElementById(id);
let R=[],C=[],tab="r",photos={},LIQ={},DRV=[],PRV=[],TAR=null,ANU=[],ANUERR="",AUD={},AUDERR="",DOCOPS=[],DOCOPSERR="",PNR_OPS=[],PNR_OPS_ERR="",analyticsGrain="dia",financeGrain="dia";
const fd=m=>m==null?"—":(m<1000?m+" m":(m/1000).toFixed(1)+" km");
const hh=s=>s?new Date(s).toTimeString().slice(0,5):"—";
const dd=s=>new Date(s).toLocaleDateString("es-MX",{day:"2-digit",month:"short"});
const dominioOk=e=>/^[^@\s]+@chazki\.com$/i.test((e||"").trim());
let ROL=null,PEND=[],BAJ=[],CAMB=[],DSET=[],DLOG=[];
$("apw-toggle").onclick=e=>{e.preventDefault();$("apw").classList.toggle("hide")};
// Google Workspace: la cuenta debe ser de la organización; el dominio se vuelve a exigir en la base de datos
$("agoogle").onclick=async()=>{
  $("amsg").innerHTML="";
  try{
    const {error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname,queryParams:{hd:"chazki.com",prompt:"select_account"}}});
    if(error)throw error;
  }catch(error){
    const disabled=/unsupported provider|provider is not enabled/i.test(error.message||"");
    const message=disabled
      ?"Google aún no está habilitado en Supabase. Actívalo en Authentication → Sign In / Providers → Google y configura el Client ID y Client Secret. Agrega https://chazki-driver-app.vercel.app/ops.html en Authentication → URL Configuration → Redirect URLs."
      :`No se pudo iniciar con Google: ${error.message||"Error inesperado"}`;
    $("amsg").innerHTML=`<div class="errbox">${esc(message)}</div>`;
  }};
$("abtn").onclick=async()=>{
  const email=$("aemail").value.trim(),password=$("apass").value;
  if(!dominioOk(email)){$("amsg").innerHTML='<div class="errbox">Solo personal de Chazki: usa tu correo @chazki.com.</div>';return}
  const r=await sb.auth.signInWithPassword({email,password});
  if(r.error){$("amsg").innerHTML='<div class="errbox">Correo o contraseña incorrectos.</div>';return}boot()};
const TABS={master:"rvalbkcifpedtnxyzgq",ops:"rvalbkcifpdtnxyzgq",coordinador:"rvalbkcifpdtxyzq",finanzas:"rlcpdxyzq",ih:"rvabkcifdx"};
const puede=t=>(TABS[ROL]||"").includes(t);
const veFin=()=>["master","ops","coordinador","finanzas"].includes(ROL);
const cargaFin=()=>veFin()||ROL==="ih";
const esCoord=()=>["master","ops","coordinador"].includes(ROL);
const esOps=()=>["master","ops"].includes(ROL);
const ROLES_TXT={master:"Cuenta maestra",ops:"Operaciones",coordinador:"Coordinador",ih:"Supervisor",finanzas:"Finanzas"};
const NAV_INFO={
  r:["Rutas","◫","Consulta y seguimiento de la operación diaria."],
  v:["Por validar","◷","Revisa rutas que requieren validación."],
  a:["Por aprobar","✓","Atiende las solicitudes pendientes de aprobación."],
  l:["Validadas","✓","Consulta rutas y liquidaciones ya validadas."],
  c:["Cancelaciones","⊘","Revisa cancelaciones reportadas por los drivers."],
  i:["Incidencias","!","Consulta incidentes reportados durante las rutas."],
  f:["Fallidos por causa","↘","Analiza paquetes no entregados por motivo."],
  g:["Documentos de drivers","▧","Importa documentos de Flota y autoriza actualizaciones."],
  q:["PNR y penalizaciones","⚖","Registra reclamos, revisa evidencias y consulta descuentos."],
  x:["Indicadores del negocio","▥","Consulta indicadores operativos del periodo."],
  y:["Finanzas por cliente","$","Consulta ventas, pagos, utilidad y penalizaciones."],
  z:["Desempeño de flotilla","♙","Compara resultados de flotilleros y drivers."],
  b:["Desactivaciones","−","Gestiona solicitudes de desactivación de drivers."],
  k:["Cambios de datos","✎","Revisa solicitudes de actualización de perfiles."],
  t:["Tarifario","$","Consulta y administra tarifas operativas."],
  d:["Descargas","⇩","Genera reportes y exportaciones."],
  p:["Proveedores y drivers","♙","Administra proveedores y sus conductores."],
  e:["Equipo","♧","Gestiona el acceso del equipo administrativo."]
};
function seleccionarTab(b){
  document.querySelectorAll(".role-nav button").forEach(x=>x.classList.toggle("on",x===b));
  tab=b.dataset.t;
  const [title,,description]=NAV_INFO[tab]||["Operación","",""];
  $("page-title").textContent=title;
  $("page-description").textContent=description;
  if(["l","x","y","z","g","q"].includes(tab)){load();return}
  render();
}
function aplicarRol(){
  document.querySelectorAll(".role-nav button").forEach(b=>{
    if(!puede(b.dataset.t)){b.remove();return}
    const [label,icon]=NAV_INFO[b.dataset.t]||[b.textContent,"•"];
    b.innerHTML=`<span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
  });
  document.querySelectorAll(".nav-group").forEach(group=>group.classList.toggle("hide",!group.querySelector("button")));
  document.querySelectorAll(".nav-caption").forEach(caption=>caption.classList.toggle("hide",caption.nextElementSibling.classList.contains("hide")));
  if(puede("e")){
    const b=document.createElement("button");b.dataset.t="e";
    const [label,icon]=NAV_INFO.e;
    b.innerHTML=`<span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
    b.onclick=()=>seleccionarTab(b);
    const group=document.querySelector('[data-nav-group="administracion"]');
    group.appendChild(b);group.classList.remove("hide");
    group.previousElementSibling.classList.remove("hide");
  }
  const f=document.querySelector(".role-nav button");if(f)seleccionarTab(f);
}
$("out").onclick=async()=>{await sb.auth.signOut();location.reload()};
$("lb").onclick=()=>$("lb").classList.add("hide");
document.querySelectorAll(".role-nav button").forEach(b=>b.onclick=()=>seleccionarTab(b));
$("go").onclick=load;
async function fetchPaged(buildQuery){
  const rows=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await buildQuery().range(offset,offset+999);
    if(error)throw error;
    const page=data||[];rows.push(...page);
    if(page.length<1000)return rows;
  }
}
async function boot(){
  $("loading").classList.remove("hide");
  const {data:{session}}=await sb.auth.getSession();
  if(!session){$("auth").classList.remove("hide");$("loading").classList.add("hide");return}
  const {data:authorized,error:authorizationError}=await sb.rpc("mi_acceso_administrativo");
  if(authorizationError){
    $("auth").classList.remove("hide");
    $("amsg").innerHTML=`<div class="errbox">No se pudo validar la lista de acceso administrativo. Ejecuta primero el SQL de autorización en Supabase. ${esc(authorizationError.message)}</div>`;
    $("loading").classList.add("hide");return;
  }
  if(authorized!==true){
    $("auth").classList.remove("hide");
    $("amsg").innerHTML='<div class="errbox">Esta cuenta no está autorizada para acceder al panel de operaciones. Contacta a la cuenta maestra.</div>';
    await sb.auth.signOut();$("loading").classList.add("hide");return;
  }
  const {data:me}=await sb.from("drivers").select("nombre,rol").eq("id",session.user.id).single();
  if(!me||!Object.keys(TABS).includes(me.rol)||!dominioOk(session.user.email)){$("auth").classList.remove("hide");$("amsg").innerHTML='<div class="errbox">Esta cuenta no tiene acceso al panel. Es solo para personal de Chazki con correo @chazki.com.</div>';await sb.auth.signOut();$("loading").classList.add("hide");return}
  ROL=me.rol;aplicarRol();suscribirAvisos(session.user.id);DSET=(await sb.rpc("datasets_disponibles")).data||[];cargaLog();
  $("auth").classList.add("hide");$("panel").classList.remove("hide");$("who").textContent=me.nombre+" · "+(ROLES_TXT[me.rol]||me.rol);
  const hoy=new Date().toLocaleDateString("en-CA");$("d1").value=hoy;$("d2").value=hoy;
  const {data:cl}=await sb.from("clientes").select("id,nombre").order("nombre");
  $("fcli").innerHTML='<option value="">Todos los clientes</option>'+(cl||[]).map(c=>`<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("");
  try{await load()}finally{$("loading").classList.add("hide")}
}
async function load(){
  const a=new Date($("d1").value+"T00:00:00").toISOString(),b=new Date($("d2").value+"T23:59:59").toISOString();
  let routeRows,cancelRows;
  try{
    [routeRows,cancelRows]=await Promise.all([
      fetchPaged(()=>sb.from("rutas").select("*,drivers(nombre,codigo,cliente_default_id),cedis(*,clientes(nombre)),ruta_fallos(cantidad,causas_fallo(nombre)),ruta_incidencias(comentario,tipos_incidencia(nombre)),ruta_manifiestos(foto_path)").gte("checkin_at",a).lte("checkin_at",b).order("checkin_at",{ascending:false})),
      fetchPaged(()=>sb.from("cancelaciones").select("*,drivers(nombre,codigo),cedis(*,clientes(nombre))").gte("capturado_at",a).lte("capturado_at",b).order("capturado_at",{ascending:false}))
    ]);
  }catch(error){toast("No se pudieron cargar las rutas y cancelaciones: "+(error.message||error));return}
  const f=$("fcli").value;const keep=x=>!f||String(x.cedis.cliente_id)===f;
  R=routeRows.filter(keep);C=cancelRows.filter(keep);
  const paths=C.map(x=>x.foto_path);photos={};
  if(paths.length){const s=await sb.storage.from("cancelaciones").createSignedUrls(paths,3600);(s.data||[]).forEach(x=>{photos[x.path]=x.signedUrl})}
  await cargaEventos();await cargaExtra();
  if(tab==="l")await cargarAnulaciones();
  if(veFin()&&["x","y","z"].includes(tab))await cargarAuditorias();
  if(esOps()&&tab==="g")await cargarDocumentosOps();
  if(tab==="q")await cargarPnrsOps();
  render();
}
async function cargarAnulaciones(){
  ANU=[];ANUERR="";
  const ids=R.map(x=>String(x.id));
  if(!ids.length)return;
  try{ANU=await fetchPaged(()=>sb.from("liquidacion_anulaciones").select("id,ruta_id,motivo,anulada_por_email,anulada_en").in("ruta_id",ids).order("anulada_en",{ascending:false}))}
  catch(error){ANUERR=error.message||String(error)}
}
async function cargarAuditorias(){
  AUD={};AUDERR="";
  const ids=R.map(x=>x.id);
  if(!ids.length)return;
  try{
    const data=[];
    for(let i=0;i<ids.length;i+=500)data.push(...await fetchPaged(()=>sb.from("liquidacion_validaciones").select("ruta_id,validado_por,validado_por_email,validado_en").in("ruta_id",ids.slice(i,i+500)).order("validado_en",{ascending:false})));
    for(const row of data)if(!AUD[String(row.ruta_id)])AUD[String(row.ruta_id)]=row;
  }catch(error){AUDERR=error.message||String(error)}
}
async function cargarPnrsOps(){
  PNR_OPS=[];PNR_OPS_ERR="";
  try{
    PNR_OPS=await fetchPaged(()=>sb.from("pnr_reclamos")
      .select("*,drivers(nombre,codigo),pnr_reclamo_eventos(*),pnr_descuentos(*)")
      .order("creado_en",{ascending:false}).limit(1000));
    const paths=PNR_OPS.flatMap(x=>(x.pnr_reclamo_eventos||[]).flatMap(e=>e.adjuntos||[]));
    if(paths.length){
      const {data,error}=await sb.storage.from("pnr-evidence").createSignedUrls(paths,3600);
      if(error)throw error;
      const urls=Object.fromEntries((data||[]).filter(x=>x.signedUrl).map(x=>[x.path,x.signedUrl]));
      PNR_OPS=PNR_OPS.map(x=>({...x,pnr_reclamo_eventos:(x.pnr_reclamo_eventos||[]).map(e=>({...e,urls:(e.adjuntos||[]).map(path=>({path,url:urls[path]})).filter(x=>x.url)}))}));
    }
  }catch(error){PNR_OPS_ERR=error.message||String(error)}
}
const PNR_OPS_STATE={
  esperando_driver:["Pendiente de respuesta del driver","w"],
  revision:["En revisión","w"],
  esperando_soporte:["Soporte adicional solicitado","bad"],
  cerrada_sin_cargo:["Cerrado · sin descuento","ok"],
  cerrada_con_cargo:["Cerrado · con descuento","bad"]
};
const pnrOpsDate=value=>value?new Date(value).toLocaleString("es-MX",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
const pnrOpsMoney=value=>fm(Number(value||0));
function vistaPnrsOps(){
  const puedeResolver=["master","ops","coordinador"].includes(ROL);
  const drivers=DRV.filter(d=>d.rol==="driver");
  const form=puedeResolver?`<section class="pnr-panel">
    <div class="pnr-form-head"><div><h3>Registrar reclamo</h3><p>Captura los datos del caso y adjunta evidencia para notificar al driver.</p></div></div>
    <div class="pnr-form-grid">
      <label class="pnr-field pnr-span-2">Número de PNR<input id="pnr-new-ref" maxlength="120" placeholder="Ej. PNR-123456" autocomplete="off"></label>
      <label class="pnr-field pnr-span-2">Driver<select id="pnr-new-driver"><option value="">Selecciona un driver…</option>${drivers.map(d=>`<option value="${esc(d.id)}">${esc(d.nombre)} · ${esc(d.codigo||"")}</option>`).join("")}</select></label>
      <label class="pnr-field pnr-span-2">Cliente<input id="pnr-new-client" maxlength="200" placeholder="Nombre del cliente"></label>
      <label class="pnr-field pnr-span-2">Ruta <span style="font-weight:400;color:var(--mut)">(opcional)</span><input id="pnr-new-route" maxlength="120" placeholder="ID o número de ruta"></label>
      <label class="pnr-field pnr-span-2">Importe del reclamo<input id="pnr-new-amount" type="number" min="0.01" step="0.01" placeholder="$0.00"></label>
      <label class="pnr-field pnr-span-6">Detalles del reclamo<textarea id="pnr-new-detail" rows="4" maxlength="5000" placeholder="Describe la entrega no reconocida y agrega la información relevante"></textarea></label>
      <label class="pnr-field pnr-span-6 pnr-upload">Evidencia fotográfica <small>Hasta 5 imágenes · JPEG, PNG o WebP · máximo 10 MB por archivo</small><input id="pnr-new-files" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>
    </div>
    <div id="pnr-new-error"></div>
    <div class="pnr-form-footer"><span style="color:var(--mut);font-size:12px">El driver tendrá 24 horas para responder.</span><button class="btn" id="pnr-new-save">Crear reclamo y notificar</button></div>
  </section>`
    :'<div class="note">Acceso de consulta. La captura y resolución de reclamos corresponde a Operaciones.</div>';
  const rows=PNR_OPS.map(claim=>{
    const [label,style]=PNR_OPS_STATE[claim.estado]||["Estatus desconocido","w"];
    const events=(claim.pnr_reclamo_eventos||[]).slice().sort((a,b)=>new Date(a.creado_en)-new Date(b.creado_en));
    const discount=(claim.pnr_descuentos||[])[0];
    let actions="";
    if(puedeResolver&&claim.estado==="revision"){
      actions=`<button class="btn sm" data-pnr-action="aceptar" data-pnr-id="${esc(claim.id)}">Aceptar evidencia</button>${claim.intentos===1?`<button class="btn ghost sm" data-pnr-action="solicitar_soporte" data-pnr-id="${esc(claim.id)}">Solicitar más soporte</button>`:`<button class="btn bad sm" data-pnr-action="rechazar" data-pnr-id="${esc(claim.id)}">Cerrar y descontar</button>`}`;
    }
    return `<article class="pnr-claim">
      <div class="pnr-claim-top"><div class="pnr-claim-title"><b>PNR ${esc(claim.pnr)}</b><span style="color:var(--mut)"> · ${esc(claim.drivers?.nombre||claim.driver_id)}</span></div><span class="pill ${style}">${esc(label)}</span></div>
      <div class="pnr-claim-meta"><span>Cliente: <b>${esc(claim.cliente)}</b></span>${claim.ruta_id?`<span>Ruta: <b>${esc(claim.ruta_id)}</b></span>`:""}<span>Importe: <b>${esc(pnrOpsMoney(claim.monto))}</b></span><span>Creado: <b>${esc(pnrOpsDate(claim.creado_en))}</b></span>${claim.vence_en?`<span>Vence: <b>${esc(pnrOpsDate(claim.vence_en))}</b></span>`:""}</div>
      ${discount?`<div class="item"><span>Descuento acumulado</span><b>${esc(pnrOpsMoney(discount.monto_aplicado))} aplicado · ${esc(pnrOpsMoney(discount.saldo_pendiente))} por aplicar a liquidaciones</b></div>`:""}
      <details><summary>Ver detalles y línea del tiempo (${events.length} movimientos)</summary>
      <div class="pnr-claim-detail">${esc(claim.detalle)}</div>
      <div class="pnr-timeline">${events.map(event=>`<div class="pnr-event"><b>${esc(pnrEventLabelOps(event.tipo))}</b><small>${esc(pnrOpsDate(event.creado_en))}${event.actor_email?" · "+esc(event.actor_email):""}</small>${event.mensaje?`<div style="white-space:pre-wrap">${esc(event.mensaje)}</div>`:""}${(event.urls||[]).length?`<div class="pnr-event-files">${event.urls.map((file,i)=>`<a href="${esc(file.url)}" target="_blank" rel="noopener">Ver imagen ${i+1}</a>`).join("")}</div>`:""}</div>`).join("")||'<div class="note">Sin movimientos.</div>'}</div></details>${actions?`<div class="pnr-actions">${actions}</div>`:""}
    </article>`;
  }).join("");
  return `<div class="pnr-layout">${PNR_OPS_ERR?`<div class="errbox">No se pudieron cargar los PNR. Ejecuta el SQL de configuración en Supabase y verifica el acceso. ${esc(PNR_OPS_ERR)}</div>`:""}
    ${form}<section class="pnr-list"><div class="pnr-list-head"><h3>PNR registrados</h3><span class="pnr-count">${PNR_OPS.length} ${PNR_OPS.length===1?"reclamo":"reclamos"}</span></div>${rows?`<div class="pnr-list">${rows}</div>`:'<div class="pnr-empty">Todavía no hay reclamos registrados.</div>'}</section></div>`;
}
function pnrEventLabelOps(type){
  return ({creado:"Reclamo generado",respuesta_driver:"Primera respuesta del driver",solicitud_soporte:"Se solicitó soporte adicional",evidencia_adicional:"Soporte adicional recibido",evidencia_aceptada:"Evidencia aceptada · caso cerrado",evidencia_rechazada:"Evidencia insuficiente · descuento aplicado",vencido:"Plazo vencido · descuento aplicado",descuento_aplicado:"Descuento aplicado a liquidación"})[type]||type;
}
function render(){
  const cer=R.filter(x=>x.estado==="cerrada"),asg=R.reduce((s,x)=>s+x.paquetes_asignados,0),ent=cer.reduce((s,x)=>s+x.entregados,0),fal=cer.reduce((s,x)=>s+x.fallidos,0);
  const incs=R.reduce((s,x)=>s+x.ruta_incidencias.length,0);
  $("kpis").innerHTML=[["Rutas",R.length],["En ruta",R.filter(x=>x.estado==="en_ruta").length],["Paquetes asignados",asg],["Entregados",ent],["Fallidos",fal],["Efectividad",(ent+fal)?Math.round(ent/(ent+fal)*100)+"%":"—"],["Cancelaciones",C.length],["Canc. a revisar",C.filter(x=>x.ubicacion_validada==="fuera"||x.ubicacion_validada==="sin_ubicacion").length],["Incidencias",incs]].concat(veFin()?[["Por validar",porValidar().length],["Pago validado",fm(sumLiq("pago_driver"))]]:[]).map(([k,v])=>`<div class="kpi"><small>${k}</small><b>${v}</b></div>`).join("");
  let h="";
  if(tab==="r")h=`<table><tr><th>Fecha</th><th>Driver</th><th>Cliente · CEDIS</th><th>Ruta</th><th>Zonas</th><th>Llegada</th><th>Auxiliar</th><th>Asig.</th><th>Entreg.</th><th>Fall.</th><th>Manif.</th><th>Estado</th></tr>`+
    (R.map(x=>`<tr><td>${dd(x.checkin_at)}</td><td>${esc(x.drivers.nombre)}<br><small>${esc(x.drivers.codigo||"")}</small></td><td><b>${esc(x.cedis.clientes.nombre)}</b>${x.drivers.cliente_default_id&&x.drivers.cliente_default_id!==x.cedis.cliente_id?` <span class="pill w">Otra cuenta</span>`:""}<br>${esc(x.cedis.nombre)}</td><td>${esc(x.id_ruta)}</td><td>${esc(x.zonas.join(", "))}</td><td>${hh(x.hora_llegada_cedis)}</td><td>${x.auxiliar_requerido?`<span class="pill ${x.viaja_con_auxiliar?"ok":"w"}">${x.viaja_con_auxiliar?"Con auxiliar":"Solo"}</span>`:"No aplica"}</td><td>${esc(x.paquetes_asignados)}</td><td>${esc(x.entregados??"—")}</td><td>${esc(x.fallidos??"—")}</td><td>${x.ruta_manifiestos&&x.ruta_manifiestos.length?`<button class="btn ghost sm" data-mf="${esc(x.id)}">📎 ${esc(x.ruta_manifiestos.length)}</button>`:(x.tipo_unidad==="3.5T"?'<span class="pill bad">Sin fotos</span>':"—")}</td><td><span class="pill ${x.estado==="cerrada"?"ok":"w"}">${x.estado==="cerrada"?"Cerrada "+hh(x.checkout_at):"En ruta"}</span></td></tr>`).join("")||`<tr><td colspan="12">Sin rutas en este periodo.</td></tr>`)+`</table>`;
  if(tab==="c")h=`<table><tr><th>Fecha y hora</th><th>Driver</th><th>Cliente · CEDIS</th><th>Ruta</th><th>Pin</th><th>Validación de ubicación</th><th>Evidencia</th><th>Estatus</th></tr>`+
    (C.map(x=>`<tr><td>${dd(x.capturado_at)} ${hh(x.capturado_at)}</td><td>${esc(x.drivers.nombre)}</td><td><b>${esc(x.cedis.clientes.nombre)}</b><br>${esc(x.cedis.nombre)}</td><td>${esc(x.id_ruta||"—")}</td><td>${x.lat==null?"—":`<a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${esc(x.lat)},${esc(x.lng)}">${x.lat.toFixed(4)}, ${x.lng.toFixed(4)}</a>`}</td><td>${x.ubicacion_validada==="dentro"?`<span class="pill ok">Dentro · ${fd(x.distancia_cedis_m)}</span>`:x.ubicacion_validada==="fuera"?`<span class="pill bad">Fuera · ${fd(x.distancia_cedis_m)}</span>`:x.ubicacion_validada==="sin_ubicacion"?'<span class="pill bad">Sin ubicación del driver</span>':'<span class="pill w">CEDIS sin coordenadas</span>'}</td><td>${photos[x.foto_path]?`<img class="th" src="${photos[x.foto_path]}" data-u="${photos[x.foto_path]}">`:"—"}</td><td>${estCan(x)}</td></tr>`).join("")||`<tr><td colspan="8">Sin cancelaciones en este periodo.</td></tr>`)+`</table>`;
  if(tab==="i"){const rows=R.flatMap(x=>x.ruta_incidencias.map(i=>({x,i})));h=`<table><tr><th>Fecha</th><th>Driver</th><th>Cliente · CEDIS</th><th>Incidencia</th><th>Comentario</th></tr>`+
    (rows.map(({x,i})=>`<tr><td>${dd(x.checkin_at)}</td><td>${esc(x.drivers.nombre)}</td><td>${esc(x.cedis.clientes.nombre)} · ${esc(x.cedis.nombre)}</td><td><span class="pill bad">${esc(i.tipos_incidencia.nombre)}</span></td><td>${esc(i.comentario||"—")}</td></tr>`).join("")||`<tr><td colspan="5">Sin incidencias en este periodo.</td></tr>`)+`</table>`}
  if(tab==="f"){const m={};R.forEach(x=>x.ruta_fallos.forEach(f=>{m[f.causas_fallo.nombre]=(m[f.causas_fallo.nombre]||0)+f.cantidad}));const e=Object.entries(m).sort((a,b)=>b[1]-a[1]);
  h=`<table><tr><th>Causa</th><th>Paquetes</th></tr>`+(e.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")||`<tr><td colspan="2">Sin fallidos en este periodo.</td></tr>`)+`</table>`}
  if(tab==="v")h=vistaPorValidar();if(tab==="l")h=vistaValidadas();if(tab==="p")h=vistaProveedores();if(tab==="e")h=vistaEquipo();if(tab==="a")h=vistaAprobar();if(tab==="b")h=vistaBajas();if(tab==="k")h=vistaCambios();if(tab==="d")h=vistaDescargas();if(tab==="t")h=vistaTarifario();if(tab==="x")h=vistaIndicadores();if(tab==="y")h=vistaFinanzas();if(tab==="z")h=vistaDesempeno();if(tab==="g")h=vistaDocumentosOps();if(tab==="q")h=vistaPnrsOps();
  $("view").innerHTML=h;enlazar();
  document.querySelectorAll("img.th").forEach(i=>i.onclick=()=>{$("lbimg").src=i.dataset.u;$("lb").classList.remove("hide")});
}
// ================= Validación de rutas, pagos y proveedores =================
const fm=n=>{if(n==null)return "—";const v=Number(n);const t=Math.abs(v).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2});return (v<0&&Math.abs(v)>=0.005?"-":"")+"$"+t};
const pc=n=>n==null?"—":(Number(n)*100).toFixed(1)+"%";
const nz=s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").trim();
const cuentaDe=c=>c==="MERCADO LIBRE"?"MELI":(c==="COPPEL"||c==="COPPEL BT")?"COPPEL":c==="LIVERPOOL"?"LIVERPOOL":null;
const sumLiq=k=>Object.values(LIQ).reduce((s,x)=>s+Number(x[k]||0),0);
const porValidar=()=>R.filter(x=>x.estado==="cerrada"&&!LIQ[x.id]&&!PEND.some(q=>q.ruta_id===x.id)&&cuentaDe(x.cedis.clientes.nombre));
function toast(m){const t=$("toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),3200)}
async function cargaExtra(){
  LIQ={};PEND=[];BAJ=[];CAMB=[];if(!cargaFin()){DRV=[];PRV=[];return}const ids=R.map(x=>x.id);
  const [l,d,p,pe,bj,cm]=await Promise.all([
    ids.length&&veFin()?cargarLiquidaciones(ids):Promise.resolve([]),
    sb.from("drivers").select("id,nombre,codigo,rol,estatus,proveedor_id").order("nombre"),
    sb.from("proveedores").select("*").order("nombre"),
    sb.from("validaciones_pendientes").select("*,rutas(id_ruta,entregados,paquetes_asignados,drivers(nombre),cedis(nombre,clientes(nombre)))").eq("estatus","pendiente").order("solicitado_en"),
    sb.from("bajas_solicitudes").select("*").order("solicitado_en",{ascending:false}).limit(50),
    sb.from("cambios_perfil").select("*").order("solicitado_en",{ascending:false}).limit(50)]);
  BAJ=bj.data||[];CAMB=cm.data||[];
  PEND=pe.data||[];
  (l||[]).forEach(x=>LIQ[x.ruta_id]=x);DRV=d.data||[];PRV=p.data||[];
  window.INV=ROL==="master"?((await sb.from("staff_invitados").select("*").order("creado_en",{ascending:false})).data||[]):[];
}
const provDe=driverId=>{const d=DRV.find(y=>y.id===driverId);return d&&PRV.find(y=>y.id===d.proveedor_id)};
async function cargarLiquidaciones(ids){
  const rows=[];
  for(let i=0;i<ids.length;i+=500){
    rows.push(...await fetchPaged(()=>sb.from("liquidaciones").select("*").in("ruta_id",ids.slice(i,i+500))));
  }
  return rows;
}
async function cargarDocumentosOps(){
  DOCOPS=[];DOCOPSERR="";
  try{DOCOPS=await fetchPaged(()=>sb.from("driver_documents").select("*,drivers(nombre,codigo,rol)").order("creado_en",{ascending:false}))}
  catch(error){DOCOPSERR=error.message||String(error);return}
  const paths=DOCOPS.map(x=>x.storage_path).filter(Boolean);
  if(paths.length){
    const {data:urls,error:urlError}=await sb.storage.from("driver-documents").createSignedUrls(paths,3600);
    if(urlError){DOCOPSERR="No se pudieron abrir los archivos: "+urlError.message;return}
    DOCOPS=DOCOPS.map(x=>({...x,url:(urls||[]).find(y=>y.path===x.storage_path)?.signedUrl||null}));
  }
}
const DOC_OPS_TIPOS=[["seguro","Seguro del vehículo"],["licencia","Licencia de conducir"],["tarjeta","Tarjeta de circulación"],["ine","INE"]];
function vistaDocumentosOps(){
  if(!esOps())return '<div class="errbox">Solo Operaciones puede importar o autorizar documentos.</div>';
  const drivers=DRV.filter(d=>d.rol==="driver");
  const all=DOCOPS.map(d=>`<tr><td>${esc(d.drivers?.nombre||d.driver_id)}<br><small>${esc(d.drivers?.codigo||"")}</small></td><td>${esc(DOC_OPS_TIPOS.find(x=>x[0]===d.tipo)?.[1]||d.tipo)}</td><td>${esc(d.origen==="flota"?"Importado de Flota":"Driver")}</td><td>${new Date(`${d.vigencia}T00:00:00`).toLocaleDateString("es-MX")}</td><td><span class="pill ${d.estado==="aprobado"?"ok":d.estado==="pendiente"?"w":d.estado==="rechazado"?"bad":"w"}">${esc(d.estado)}</span>${d.nota?`<br><small>${esc(d.nota)}</small>`:""}</td><td>${d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener">Ver archivo</a>`:"—"}${d.estado==="pendiente"?`<br><button class="btn sm" data-doc-approve="${esc(d.id)}">Aprobar</button> <button class="btn ghost sm" data-doc-reject="${esc(d.id)}">Rechazar</button>`:""}</td></tr>`).join("");
  return `<h3 style="margin:12px 8px 0">Importar documentos existentes de Flota</h3>
    <div class="note">Las carpetas de Drive son privadas y no se leen directamente. Para la carga inicial, selecciona el archivo descargado de la carpeta de la agencia, indica su vigencia y guárdalo en el expediente privado del driver.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;padding:8px">
      <label>Driver<select id="doc-flota-driver"><option value="">Selecciona un driver…</option>${drivers.map(d=>`<option value="${esc(d.id)}">${esc(d.nombre)} · ${esc(d.codigo||"")}</option>`).join("")}</select></label>
      <label>Documento<select id="doc-flota-type">${DOC_OPS_TIPOS.map(([k,n])=>`<option value="${k}">${n}</option>`).join("")}</select></label>
      <label>Vigencia<input id="doc-flota-date" type="date"></label>
      <label>Archivo de Flota<input id="doc-flota-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
    </div><div id="doc-flota-error" style="padding:0 8px"></div><div style="padding:0 8px"><button class="btn" id="doc-flota-save">Importar documento aprobado</button></div>
    <h3 style="margin:16px 8px 0">Solicitudes y documentos (${DOCOPS.length})</h3>${DOCOPSERR?`<div class="errbox">${esc(DOCOPSERR)}</div>`:""}
    <table><tr><th>Driver</th><th>Documento</th><th>Origen</th><th>Vigencia</th><th>Estado</th><th>Archivo / autorización</th></tr>${all||'<tr><td colspan="6">Sin documentos registrados.</td></tr>'}</table>`;
}
async function importarDocumentoFlota(){
  const errorBox=$("doc-flota-error"),button=$("doc-flota-save"),driverId=$("doc-flota-driver").value,tipo=$("doc-flota-type").value,vigencia=$("doc-flota-date").value,file=$("doc-flota-file").files[0];
  errorBox.innerHTML="";
  if(!driverId||!vigencia||!file){errorBox.innerHTML='<div class="errbox">Selecciona driver, vigencia y archivo.</div>';return}
  if(file.size>10*1024*1024||!(file.type==="application/pdf"||["image/jpeg","image/png","image/webp"].includes(file.type))){errorBox.innerHTML='<div class="errbox">Usa un PDF o imagen JPEG, PNG o WebP de máximo 10 MB.</div>';return}
  button.disabled=true;
  const ext=(file.name.split(".").pop()||"bin").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8)||"bin";
  const storagePath=`${driverId}/${tipo}/${crypto.randomUUID()}.${ext}`;
  const {error:uploadError}=await sb.storage.from("driver-documents").upload(storagePath,file,{contentType:file.type,upsert:false});
  if(uploadError){button.disabled=false;errorBox.innerHTML=`<div class="errbox">${esc(uploadError.message)}</div>`;return}
  const {error}=await sb.rpc("registrar_documento_flota",{p_driver_id:driverId,p_tipo:tipo,p_storage_path:storagePath,p_vigencia:vigencia});
  if(error){
    const removed=await sb.storage.from("driver-documents").remove([storagePath]);
    button.disabled=false;errorBox.innerHTML=`<div class="errbox">${esc(error.message)}${removed.error?` · No se pudo limpiar el archivo temporal: ${esc(removed.error.message)}`:""}</div>`;return;
  }
  await cargarDocumentosOps();render();toast("Documento de Flota importado");
}
async function resolverDocumento(id,aprobar){
  let nota=null;
  if(!aprobar){nota=prompt("Motivo del rechazo (opcional):");if(nota===null)return}
  const {error}=await sb.rpc("resolver_documento_driver",{p_id:id,p_aprobar:aprobar,p_nota:nota});
  if(error){toast(error.message);return}
  await cargarDocumentosOps();render();toast(aprobar?"Documento aprobado":"Documento rechazado");
}
function vistaPorValidar(){const l=porValidar();
  return `<table><tr><th>Fecha</th><th>Driver</th><th>Proveedor</th><th>Cliente · CEDIS</th><th>Ruta</th><th>Asig.</th><th>Entreg.</th><th>Efectiv.</th><th></th></tr>`+
  (l.map(x=>{const p=provDe(x.driver_id);return `<tr><td>${dd(x.checkin_at)}</td><td>${esc(x.drivers.nombre)}</td><td>${p?esc(p.nombre)+`<br><small>${esc(p.tipo_registro||"sin registro fiscal")}</small>`:'<span class="pill w">Sin proveedor</span>'}</td><td><b>${esc(x.cedis.clientes.nombre)}</b><br>${esc(x.cedis.nombre)}</td><td>${esc(x.id_ruta)}</td><td>${esc(x.paquetes_asignados)}</td><td>${esc(x.entregados)}</td><td>${pc(x.entregados/x.paquetes_asignados)}</td><td><button class="btn ghost sm" data-det="${esc(x.id)}">Detalle</button> <button class="btn sm" data-val="${esc(x.id)}">Validar</button></td></tr>`}).join("")||`<tr><td colspan="9">No hay rutas por validar en este periodo (solo MELI, Coppel y Liverpool tienen tarifario cargado).</td></tr>`)+`</table>`}
async function verDetalleRuta(id){
  let ru=R.find(x=>String(x.id)===String(id));
  if(!ru){
    const {data,error}=await sb.from("rutas").select("*,drivers(nombre,codigo),cedis(*,clientes(nombre)),ruta_fallos(cantidad,causas_fallo(nombre)),ruta_incidencias(comentario,tipos_incidencia(nombre)),ruta_manifiestos(foto_path)").eq("id",id).maybeSingle();
    if(error){toast("No se pudo cargar el detalle de la ruta: "+error.message);return}
    ru=data;
  }
  if(!ru){toast("No se encontró el detalle de esta ruta");return}
  let liq=LIQ[ru.id];
  if(!liq&&veFin()){
    const {data,error}=await sb.from("liquidaciones").select("*").eq("ruta_id",ru.id).maybeSingle();
    if(error){toast("No se pudo cargar la liquidación de la ruta: "+error.message);return}
    liq=data;
  }
  const proveedor=liq&&PRV.find(x=>x.id===liq.proveedor_id);
  const manifiestos=ru.ruta_manifiestos||[],paths=manifiestos.map(x=>x.foto_path).filter(Boolean);
  let fotos=[];
  if(paths.length){
    const {data,error}=await sb.storage.from("manifiestos").createSignedUrls(paths,3600);
    if(error){toast("No se pudieron cargar las fotos del manifiesto: "+error.message);return}
    fotos=data||[];
    const fotoError=fotos.find(x=>x.error);
    if(fotoError){toast("No se pudo abrir una foto del manifiesto: "+fotoError.error);return}
  }
  const auxPaths=[ru.evidencia_auxiliar_checkin_path,ru.evidencia_auxiliar_checkout_path].filter(Boolean);
  let auxFotos={};
  if(auxPaths.length){
    const {data,error}=await sb.storage.from("ruta-auxiliares").createSignedUrls(auxPaths,3600);
    if(error){toast("No se pudieron cargar las fotos del auxiliar: "+error.message);return}
    auxFotos=Object.fromEntries((data||[]).filter(x=>x.signedUrl).map(x=>[x.path,x.signedUrl]));
  }
  const fecha=x=>x?new Date(x).toLocaleString("es-MX",{dateStyle:"medium",timeStyle:"short"}):"—";
  const fila=(label,value)=>`<div style="display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid var(--line)"><span style="color:var(--mut)">${label}</span><b style="text-align:right">${value==null||value===""?"—":value}</b></div>`;
  const fallos=(ru.ruta_fallos||[]).map(x=>fila(esc(x.causas_fallo?.nombre||"Causa sin nombre"),esc(x.cantidad))).join("")||'<div style="color:var(--mut)">Sin paquetes fallidos registrados.</div>';
  const incidencias=(ru.ruta_incidencias||[]).map(x=>`<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(x.tipos_incidencia?.nombre||"Incidencia")}</b>${x.comentario?`<small style="display:block;margin-top:3px">${esc(x.comentario)}</small>`:""}</div>`).join("")||'<div style="color:var(--mut)">Sin incidencias registradas.</div>';
  const galeria=fotos.map(x=>x.signedUrl?`<a href="${esc(x.signedUrl)}" target="_blank" rel="noopener"><img src="${esc(x.signedUrl)}" alt="Foto del manifiesto" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px"></a>`:"").join("");
  const modal=$("modal");modal.classList.remove("hide");
  modal.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto">
    <h2 style="margin:0 0 4px">Detalle de ruta ${esc(ru.id_ruta)}</h2>
    <div style="color:var(--mut);font-size:13px">${esc(ru.drivers?.nombre||"Driver")} · ${esc(ru.drivers?.codigo||"")}</div>
    <h3>Datos capturados</h3>
    ${fila("Cliente",esc(ru.cedis?.clientes?.nombre))}
    ${fila("CEDIS",esc(ru.cedis?.nombre))}
    ${fila("Fecha y hora de check-in",fecha(ru.checkin_at))}
    ${fila("Hora de llegada al CEDIS",ru.hora_llegada_cedis?hh(ru.hora_llegada_cedis):"—")}
    ${fila("Zonas",esc((ru.zonas||[]).join(", ")))}
    ${fila("Tipo de unidad",esc(ru.tipo_unidad))}
    ${fila("Modalidad de ruta",ru.auxiliar_requerido?(ru.viaja_con_auxiliar?"Con auxiliar":"La hace solo"):"No aplica")}
    ${ru.auxiliar_requerido?`<h3>Evidencia del auxiliar</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">${[
      ["Check-in",ru.evidencia_auxiliar_checkin_path],["Check-out",ru.evidencia_auxiliar_checkout_path]
    ].map(([label,path])=>auxFotos[path]?`<a href="${esc(auxFotos[path])}" target="_blank" rel="noopener"><img src="${esc(auxFotos[path])}" alt="Evidencia auxiliar ${label}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px"><small>${label}</small></a>`:`<div><small>${label}: sin foto disponible</small></div>`).join("")}</div>`:""}
    ${fila("Paquetes asignados",esc(ru.paquetes_asignados))}
    ${fila("Entregados",esc(ru.entregados))}
    ${fila("Fallidos",esc(ru.fallidos))}
    ${fila("Efectividad",ru.paquetes_asignados?pc(ru.entregados/ru.paquetes_asignados):"—")}
    ${fila("Check-out",fecha(ru.checkout_at))}
    ${liq?`<h3>Datos de validación y liquidación</h3>
    ${fila("Flotillero / proveedor",esc(proveedor?.nombre||"—"))}
    ${fila("Registro fiscal",esc(liq.registro_fiscal))}
    ${fila("Cuenta y esquema",esc([liq.cuenta,liq.esquema].filter(Boolean).join(" · ")))}
    ${fila("Costo total",fm(liq.costo_total))}
    ${fila("Retención",fm(liq.retencion))}
    ${fila("IVA",fm(liq.iva))}
    ${fila("Pago al proveedor",fm(liq.pago_driver))}
    ${fila("Venta total",fm(liq.venta_total))}
    ${fila("Utilidad",fm(liq.utilidad))}
    ${fila("Nota de validación",esc(liq.nota))}`:""}
    <h3>Paquetes fallidos por causa</h3>${fallos}
    <h3>Incidencias reportadas</h3>${incidencias}
    <h3>Fotos del manifiesto (${paths.length})</h3>
    ${galeria?`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">${galeria}</div>`:'<div style="color:var(--mut)">Sin fotos de manifiesto registradas.</div>'}
    <div style="margin-top:14px"><button class="btn ghost" id="route-detail-close">Cerrar</button></div>
  </div>`;
  $("route-detail-close").onclick=()=>modal.classList.add("hide");
}
function vistaValidadas(){const l=Object.values(LIQ);
  return `<table><tr><th>Fecha</th><th>Driver</th><th>Proveedor</th><th>Cuenta · esquema</th><th>Efectiv.</th><th>Costo</th><th>Retención</th><th>IVA</th><th>Pago al proveedor</th><th>Venta</th><th>Utilidad</th><th>Registro</th><th></th></tr>`+
  (l.map(x=>{const ru=R.find(y=>y.id===x.ruta_id),p=PRV.find(y=>y.id===x.proveedor_id);return `<tr><td>${ru?dd(ru.checkin_at):""}</td><td>${esc(ru?ru.drivers.nombre:"")}</td><td>${esc(p?p.nombre:"—")}</td><td>${esc(x.cuenta)}<br><small>${esc(x.esquema||"")}</small></td><td>${pc(x.efectividad)}</td><td>${fm(x.costo_total)}</td><td>${fm(x.retencion)}</td><td>${fm(x.iva)}</td><td><b>${fm(x.pago_driver)}</b></td><td>${fm(x.venta_total)}</td><td>${fm(x.utilidad)}<br><small>${pc(x.margen)}</small></td><td>${esc(x.registro_fiscal)}</td><td><button class="btn ghost sm" data-det="${esc(x.ruta_id)}">Detalle</button> <button class="btn ghost sm" data-anu="${esc(x.ruta_id)}">Anular</button></td></tr>`}).join("")||`<tr><td colspan="13">No hay rutas validadas en este periodo.</td></tr>`)+`</table>
  <h3 style="margin:16px 8px 0">Historial de anulaciones</h3>${ANUERR?`<div class="errbox">No se pudo cargar el historial. Verifica que hayas ejecutado el SQL de anulaciones en Supabase. ${esc(ANUERR)}</div>`:
  `<table><tr><th>Fecha</th><th>Ruta</th><th>Motivo</th><th>Usuario</th></tr>${ANU.map(x=>`<tr><td>${dd(x.anulada_en)} ${hh(x.anulada_en)}</td><td>${esc(x.ruta_id)}</td><td>${esc(x.motivo)}</td><td>${esc(x.anulada_por_email||"—")}</td></tr>`).join("")||'<tr><td colspan="4">No hay anulaciones en este periodo.</td></tr>'}</table>`}`}
function filasFinancieras(rows){
  const grupos=new Map();
  for(const row of rows){
    const key=row.key,entry=grupos.get(key)||{key,label:row.label,rutas:0,ventas:0,pagos:0,utilidad:0,penalizaciones:0,asignados:0,entregados:0,fallidos:0};
    entry.rutas++;
    entry.ventas+=Number(row.liq.venta_total)||0;
    entry.pagos+=Number(row.liq.pago_driver)||0;
    entry.utilidad+=Number(row.liq.utilidad)||0;
    entry.penalizaciones+=Math.abs(Number(row.liq.dcto_pago)||0);
    entry.asignados+=Number(row.ruta.paquetes_asignados)||0;
    entry.entregados+=Number(row.ruta.entregados)||0;
    entry.fallidos+=Number(row.ruta.fallidos)||0;
    grupos.set(key,entry);
  }
  return [...grupos.values()];
}
function datosFinancieros(){
  return Object.values(LIQ).map(liq=>({liq,ruta:R.find(x=>String(x.id)===String(liq.ruta_id))}))
    .filter(x=>x.ruta)
    .map(x=>({...x,cliente:x.ruta.cedis?.clientes?.nombre||"Sin cliente",ciudad:x.ruta.cedis?.ciudad||x.ruta.cedis?.ciudad_nombre||x.ruta.cedis?.municipio||"Sin ciudad registrada"}));
}
function periodoFecha(value,grain){
  const d=new Date(value);if(Number.isNaN(d.getTime()))return {key:"sin-fecha",label:"Sin fecha"};
  const iso=x=>`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
  if(grain==="dia")return {key:iso(d),label:d.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})};
  if(grain==="semana"){
    const start=new Date(d);start.setHours(0,0,0,0);start.setDate(start.getDate()-((start.getDay()+6)%7));
    return {key:iso(start),label:`Semana del ${start.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}`};
  }
  if(grain==="mes")return {key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,label:d.toLocaleDateString("es-MX",{month:"long",year:"numeric"})};
  return {key:String(d.getFullYear()),label:String(d.getFullYear())};
}
const selectorPeriodo=(id,value)=>`<label style="display:inline-flex;align-items:center;gap:8px">Agrupar por <select id="${id}"><option value="dia" ${value==="dia"?"selected":""}>Día</option><option value="semana" ${value==="semana"?"selected":""}>Semana</option><option value="mes" ${value==="mes"?"selected":""}>Mes</option><option value="anio" ${value==="anio"?"selected":""}>Año</option></select></label>`;
function tablaResumen(rows,fin=true){
  const cols=fin?`<th>Venta</th><th>Pago proveedor</th><th>Utilidad</th><th>Penalizaciones</th>`:"";
  const body=rows.map(x=>`<tr><td>${esc(x.label)}</td><td>${esc(x.rutas)}</td><td>${esc(x.asignados)}</td><td>${esc(x.entregados)}</td><td>${esc(x.fallidos||0)}</td><td>${x.asignados?pc(x.entregados/x.asignados):"—"}</td>${fin?`<td>${fm(x.ventas)}</td><td>${fm(x.pagos)}</td><td>${fm(x.utilidad)}</td><td>${fm(x.penalizaciones)}</td>`:""}</tr>`).join("");
  return `<table><tr><th>Periodo / grupo</th><th>Rutas</th><th>Paquetes</th><th>Entregados</th><th>Fallidos</th><th>Efectividad</th>${cols}</tr>${body||`<tr><td colspan="${fin?10:6}">Sin datos para los filtros seleccionados.</td></tr>`}</table>`;
}
function vistaIndicadores(){
  const rows=datosFinancieros(),periodos=new Map(),resumen=R.reduce((a,x)=>{a.rutas++;a.asignados+=Number(x.paquetes_asignados)||0;a.entregados+=Number(x.entregados)||0;a.fallidos+=Number(x.fallidos)||0;return a},{rutas:0,asignados:0,entregados:0,fallidos:0});
  for(const ruta of R){
    const p=periodoFecha(ruta.checkin_at,analyticsGrain),entry=periodos.get(p.key)||{key:p.key,label:p.label,rutas:0,asignados:0,entregados:0,fallidos:0,ventas:0,pagos:0,utilidad:0,penalizaciones:0};
    entry.rutas++;entry.asignados+=Number(ruta.paquetes_asignados)||0;entry.entregados+=Number(ruta.entregados)||0;entry.fallidos+=Number(ruta.fallidos)||0;
    const liq=LIQ[ruta.id];if(liq){entry.ventas+=Number(liq.venta_total)||0;entry.pagos+=Number(liq.pago_driver)||0;entry.utilidad+=Number(liq.utilidad)||0;entry.penalizaciones+=Math.abs(Number(liq.dcto_pago)||0)}
    periodos.set(p.key,entry);
  }
  const trends=[...periodos.values()].sort((a,b)=>a.key.localeCompare(b.key));
  const stats=(label,value)=>`<div class="kpi"><small>${label}</small><b>${value}</b></div>`;
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h3>Indicadores del negocio</h3>${selectorPeriodo("analytics-period",analyticsGrain)}</div>
    <div class="kpis">${stats("Rutas",resumen.rutas)}${stats("Paquetes asignados",resumen.asignados)}${stats("Entregados",resumen.entregados)}${stats("Fallidos",resumen.fallidos)}${stats("Efectividad",resumen.asignados?pc(resumen.entregados/resumen.asignados):"—")}${stats("Cancelaciones",C.length)}${veFin()?stats("Venta validada",fm(rows.reduce((s,x)=>s+(Number(x.liq.venta_total)||0),0))):""}${veFin()?stats("Utilidad",fm(rows.reduce((s,x)=>s+(Number(x.liq.utilidad)||0),0))):""}</div>
    <h3>Indicadores por ${analyticsGrain==="dia"?"día":analyticsGrain==="semana"?"semana":analyticsGrain==="mes"?"mes":"año"}</h3>${tablaResumen(trends,veFin())}
    <h3>Incidencias y excepciones</h3><div class="item"><span>Incidencias reportadas</span><b>${R.reduce((s,x)=>s+(x.ruta_incidencias||[]).length,0)}</b></div><div class="item"><span>Cancelaciones que requieren revisión</span><b>${C.filter(x=>x.ubicacion_validada==="fuera"||x.ubicacion_validada==="sin_ubicacion").length}</b></div><div class="item"><span>Rutas pendientes de validar</span><b>${veFin()?porValidar().length:"—"}</b></div>`;
}
function vistaFinanzas(){
  if(!veFin())return '<div class="errbox">No tienes permisos para consultar información financiera.</div>';
  const rows=datosFinancieros(),periodos=filasFinancieras(rows.map(x=>{const p=periodoFecha(x.ruta.checkin_at,financeGrain);return {...x,key:p.key,label:p.label}})).sort((a,b)=>a.key.localeCompare(b.key));
  const clientes=filasFinancieras(rows.map(x=>({...x,key:x.cliente,label:x.cliente}))).sort((a,b)=>b.ventas-a.ventas);
  const ciudades=filasFinancieras(rows.map(x=>({...x,key:x.ciudad,label:x.ciudad}))).sort((a,b)=>b.ventas-a.ventas);
  const auditorias=rows.filter(x=>AUD[String(x.ruta.id)]).map(x=>{const audit=AUD[String(x.ruta.id)],persona=DRV.find(d=>String(d.id)===String(audit.validado_por));return {...x,key:String(audit.validado_por),label:persona?.nombre||audit.validado_por_email||"Usuario sin nombre"}})
  const supervisores=filasFinancieras(auditorias).sort((a,b)=>b.ventas-a.ventas);
  const sinAtribuir=rows.length-auditorias.length;
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h3>Finanzas por cliente</h3>${selectorPeriodo("finance-period",financeGrain)}</div>
    <div class="kpis">${[
      ["Venta al cliente",rows.reduce((s,x)=>s+(Number(x.liq.venta_total)||0),0)],
      ["Pago calculado a proveedores",rows.reduce((s,x)=>s+(Number(x.liq.pago_driver)||0),0)],
      ["Utilidad",rows.reduce((s,x)=>s+(Number(x.liq.utilidad)||0),0)],
      ["Penalizaciones acumuladas",rows.reduce((s,x)=>s+Math.abs(Number(x.liq.dcto_pago)||0),0)]
    ].map(([label,value])=>`<div class="kpi"><small>${label}</small><b>${fm(value)}</b></div>`).join("")}</div>
    <h3>General por ${financeGrain==="dia"?"día":financeGrain==="semana"?"semana":financeGrain==="mes"?"mes":"año"}</h3>${tablaResumen(periodos)}
    <h3>Finanzas por cliente</h3>${tablaResumen(clientes)}
    <h3>Ingreso y operación por ciudad</h3>${tablaResumen(ciudades)}
    <h3>Venta atribuida por supervisor que validó</h3>${AUDERR?`<div class="errbox">No se pudo consultar la atribución. Ejecuta el SQL de auditoría de validaciones en Supabase. ${esc(AUDERR)}</div>`:sinAtribuir?`<div class="note">Hay ${sinAtribuir} rutas validadas sin atribución registrada. La auditoría solo se captura desde que se habilite el SQL y el nuevo flujo.</div>`:""}${tablaResumen(supervisores)}
    <small>Los importes reflejan liquidaciones validadas dentro del rango de operación seleccionado. Penalizaciones acumuladas corresponden al descuento registrado en la liquidación.</small>`;
}
function vistaDesempeno(){
  if(!veFin())return '<div class="errbox">No tienes permisos para consultar pagos o penalizaciones.</div>';
  const rows=datosFinancieros();
  const porProveedor=filasFinancieras(rows.map(x=>{const proveedor=PRV.find(p=>String(p.id)===String(x.liq.proveedor_id));return {...x,key:String(x.liq.proveedor_id||"sin-proveedor"),label:proveedor?.nombre||"Sin proveedor asignado"}})).sort((a,b)=>b.pagos-a.pagos);
  const porDriver=filasFinancieras(rows.map(x=>({...x,key:String(x.ruta.driver_id),label:x.ruta.drivers?.nombre||"Sin nombre"}))).sort((a,b)=>b.pagos-a.pagos);
  return `<h3>Desempeño de flotilla</h3><p>Montos por servicios liquidados en el periodo; el pago calculado no implica que el pago ya se haya realizado.</p>
    <h3>Ingreso calculado por flotillero / proveedor</h3>${tablaResumen(porProveedor)}
    <h3>Ingreso calculado y desempeño por driver</h3>${tablaResumen(porDriver)}
    ${AUDERR?`<div class="errbox">No se pudo consultar la atribución de validaciones. ${esc(AUDERR)}</div>`:""}`;
}
const ESTC={por_validar:["Por validar","w"],en_revision:["En revisión","w"],aprobada:["Aprobada","ok"],rechazada:["Rechazada","bad"],aclaracion:["Aclaración pedida","w"],respondida:["Respondida por el driver","ok"],apelada:["Apelada por el driver","ok"],vencida:["Plazo vencido","bad"]};
let CEV={},EVP={};
const cuentaR=v=>{const ms=new Date(v)-Date.now();if(ms<=0)return null;const m=Math.floor(ms/60000);return Math.floor(m/60)+" h "+String(m%60).padStart(2,"0")+" min"};
const estK=x=>((x.estatus==="aclaracion"||x.estatus==="rechazada")&&x.plazo_vence&&new Date(x.plazo_vence)<Date.now())?"vencida":x.estatus;
function estPill(x){const k=estK(x),e=ESTC[k]||ESTC.por_validar;let h=`<span class="pill ${e[1]}">${e[0]}</span>`;
  if((x.estatus==="aclaracion"||x.estatus==="rechazada")&&k!=="vencida")h+=`<br><small>⏱ Driver: ${cuentaR(x.plazo_vence)}</small>`;
  if(x.estatus==="respondida"||x.estatus==="apelada")h+=`<br><small><b>💬 Nueva respuesta</b></small>`;return h}
function estCan(x){const h=estPill(x);
  if(!["master","ops","coordinador","ih"].includes(ROL)||x.estatus==="aprobada")return h;
  return h+`<br><button class="btn sm" data-rev="${esc(x.id)}">Revisar</button>`}
async function cargaEventos(){CEV={};EVP={};if(!C.length)return;const ids=C.map(x=>x.id);const r=await sb.from("cancelacion_eventos").select("*").in("cancelacion_id",ids).order("creado_en");
  (r.data||[]).forEach(e=>(CEV[e.cancelacion_id]=CEV[e.cancelacion_id]||[]).push(e));
  const ps=(r.data||[]).map(e=>e.foto_path).filter(Boolean);if(ps.length){const s=await sb.storage.from("cancelaciones").createSignedUrls(ps,3600);(s.data||[]).forEach(x=>EVP[x.path]=x.signedUrl)}}
const EVL={rechazo:"Chazki rechazó",aclaracion:"Chazki pidió aclaración",aprobacion:"Chazki aprobó",respuesta:"El driver respondió",apelacion:"El driver apeló"};
function revisarCan(id){const x=C.find(y=>y.id===id);if(!x)return;const m=$("modal");m.classList.remove("hide");
  const hist=(CEV[id]||[]).map(e=>`<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${esc(EVL[e.tipo]||e.tipo)}</b> <small>${dd(e.creado_en)} ${hh(e.creado_en)}</small><br>${esc(e.texto||"")}${e.foto_path&&EVP[e.foto_path]?`<br><a href="${EVP[e.foto_path]}" target="_blank" rel="noopener"><img src="${EVP[e.foto_path]}" style="max-width:160px;border-radius:8px;margin-top:4px"></a>`:""}</div>`).join("")||'<small>Sin movimientos.</small>';
  m.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2 style="margin:0 0 4px">Cancelación · ${esc(x.drivers.nombre)}</h2><div style="color:var(--mut);font-size:13px">${esc(x.cedis.clientes.nombre)} · ${esc(x.cedis.nombre)} · ${dd(x.capturado_at)} ${hh(x.capturado_at)}${esc(x.id_ruta?" · Ruta "+x.id_ruta:"")}</div>
   <div style="margin-top:8px">${estPill(x)}</div>
   ${photos[x.foto_path]?`<img src="${photos[x.foto_path]}" style="max-width:100%;max-height:220px;border-radius:10px;margin-top:8px">`:""}
   <h3 style="margin:12px 0 4px">Historial</h3>${hist}
   <label>Mensaje para el driver (obligatorio al rechazar o pedir aclaración)</label><textarea id="rv-t" rows="3"></textarea>
   <div class="note">Al rechazar o pedir aclaración, el driver recibe un aviso y tiene 12 horas para apelar o responder. Pasado ese plazo la decisión queda firme.</div><div id="rv-e"></div>
   <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn" data-rva="aprobar">Aprobar</button><button class="btn ghost" data-rva="aclarar">Pedir aclaración</button><button class="btn ghost" data-rva="rechazar" style="color:#b42318">Rechazar</button><button class="btn ghost" id="rv-x">Cerrar</button></div></div>`;
  $("rv-x").onclick=()=>m.classList.add("hide");
  m.querySelectorAll("[data-rva]").forEach(b=>b.onclick=async()=>{const a=b.dataset.rva,t=$("rv-t").value.trim();if(a!=="aprobar"&&!t){$("rv-e").innerHTML='<div class="errbox">Escribe el mensaje para el driver</div>';return}
    m.querySelectorAll("[data-rva]").forEach(z=>z.disabled=true);const {error}=await sb.rpc("resolver_cancelacion",{p_id:id,p_accion:a,p_texto:t||null});
    if(error){$("rv-e").innerHTML=`<div class="errbox">${esc(error.message)}</div>`;m.querySelectorAll("[data-rva]").forEach(z=>z.disabled=false);return}
    m.classList.add("hide");toast(a==="aprobar"?"Cancelación aprobada":a==="rechazar"?"Rechazada · el driver tiene 12 h para apelar":"Aclaración solicitada · el driver tiene 12 h");await load()})}
let NOT=[];
async function loadNotifs(){const {data}=await sb.from("notificaciones").select("*").order("creada_en",{ascending:false}).limit(30);NOT=data||[];drawBell()}
function drawBell(){const n=NOT.filter(x=>!x.leida_en).length;$("bellc").textContent=n>9?"9+":n;$("bellc").classList.toggle("hide",!n)}
function abrirAvisos(){const m=$("modal");m.classList.remove("hide");const f=x=>new Date(x).toLocaleString("es-MX",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
  const perm=("Notification" in window&&Notification.permission==="default")?'<button class="btn ghost sm" id="nt-perm">Activar avisos del navegador</button>':"";
  m.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2 style="margin:0 0 8px">🔔 Avisos</h2>${perm}${NOT.length?NOT.map(n=>`<div class="item" data-nt="${esc(n.id)}" style="display:block;padding:10px;border-bottom:1px solid var(--line);cursor:pointer;${n.leida_en?"opacity:.6":"background:#f3f0ff"}"><b>${esc(n.titulo)}</b>${n.cuerpo?`<br><small>${esc(n.cuerpo)}</small>`:""}<br><small style="color:var(--mut)">${f(n.creada_en)}</small></div>`).join(""):"<small>Sin avisos.</small>"}<div style="margin-top:12px"><button class="btn ghost" id="nt-x">Cerrar</button></div></div>`;
  $("nt-x").onclick=()=>m.classList.add("hide");const pr=$("nt-perm");if(pr)pr.onclick=async()=>{await Notification.requestPermission();abrirAvisos()};
  const ir={cancelacion:"c",cambio_perfil:"k",baja:"b",validacion:"a"};
  m.querySelectorAll("[data-nt]").forEach(el=>el.onclick=()=>{const n=NOT.find(x=>x.id==el.dataset.nt);m.classList.add("hide");const t=n&&ir[n.ref_tipo];const b=t&&document.querySelector(`.tabs button[data-t=${esc(t)}]`);if(b)b.click()});
  sb.rpc("marcar_notificaciones_leidas",{p_ids:null}).then(()=>{NOT.forEach(n=>n.leida_en=n.leida_en||new Date().toISOString());drawBell()})}
$("bell").onclick=abrirAvisos;
function suscribirAvisos(uid){loadNotifs();setInterval(loadNotifs,60000);
  sb.channel("avisos-"+uid).on("postgres_changes",{event:"INSERT",schema:"public",table:"notificaciones",filter:"usuario=eq."+uid},p=>{NOT.unshift(p.new);drawBell();toast("🔔 "+p.new.titulo);
    if("Notification" in window&&Notification.permission==="granted")try{new Notification(p.new.titulo,{body:p.new.cuerpo||""})}catch(e){}
    if((p.new.tipo||"").startsWith("cancelacion"))load()}).subscribe()}
setInterval(()=>{if(tab==="c")render()},30000);
const CAMPOS={nombre:"Nombre",placas:"Placas",tipo:"Tipo de vehículo",marca_modelo:"Marca / modelo",licencia_numero:"Número de licencia",licencia_tipo:"Tipo de licencia",licencia_vigencia:"Vigencia de licencia"};
function vistaCambios(){
  const f=CAMB.map(q=>{const d=DRV.find(y=>y.id===q.driver_id);
    const det=Object.entries(q.datos).map(([k,v])=>`${esc(CAMPOS[k]||k)}: <s style="color:#888">${esc((q.anterior&&q.anterior[k])||"—")}</s> → <b>${esc(v)}</b>`).join("<br>");
    return `<tr><td>${esc(d?d.nombre:q.driver_id)}<br><small>${dd(q.solicitado_en)}</small></td><td>${det}</td><td>${q.estatus==="pendiente"?"<span class='pill w'>Pendiente</span>":q.estatus==="aprobada"?"<span class='pill ok'>Aprobada</span>":"<span class='pill bad'>Rechazada</span>"}</td><td>${q.estatus==="pendiente"?`<button class="btn sm" data-cpa="${esc(q.id)}">Aprobar</button> <button class="btn ghost sm" data-cpr="${esc(q.id)}">Rechazar</button>`:""}</td></tr>`}).join("");
  return `<h3 style="margin:12px 8px 0">Cambios de datos solicitados por los drivers</h3><small style="padding:0 8px">Nombre, vehículo y licencia solo cambian cuando Chazki los autoriza.</small><table><tr><th>Driver</th><th>Cambio solicitado</th><th>Estatus</th><th></th></tr>${f||'<tr><td colspan="4">Sin solicitudes.</td></tr>'}</table>`}
async function resolverCambio(id,ok){const {error}=await sb.rpc("resolver_cambio_perfil",{p_id:id,p_aprobar:ok,p_nota:null});
  if(error){toast(error.message);return}await cargaExtra();render();toast(ok?"Cambio aprobado y aplicado":"Cambio rechazado")}
async function verManif(id){const ru=R.find(x=>x.id===id);const paths=ru.ruta_manifiestos.map(x=>x.foto_path);
  const s=await sb.storage.from("manifiestos").createSignedUrls(paths,3600);const m=$("modal");m.classList.remove("hide");
  m.innerHTML=`<div class="box"><h2 style="margin:0 0 8px">Manifiestos · Ruta ${esc(ru.id_ruta)}</h2><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${(s.data||[]).map(x=>`<a href="${esc(x.signedUrl)}" target="_blank" rel="noopener"><img src="${esc(x.signedUrl)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px"></a>`).join("")}</div><div style="margin-top:12px"><button class="btn ghost" id="mf-x">Cerrar</button></div></div>`;$("mf-x").onclick=()=>m.classList.add("hide")}
let TF=null,TFL={cuenta:"",q:"",veh:"",esq:"",act:true};
async function cargaTF(){const [t,g]=await Promise.all([sb.from("tarifas").select("*").order("cuenta").order("ubicacion").order("tipo_unidad").limit(2000),sb.from("reglas_penalizacion").select("*").order("cuenta").order("aplica_a").order("prioridad")]);if(t.error){toast(t.error.message);return}TF=t.data||[];RGL=g.data||[];render()}
let TFV="t",RGL=null,RTD=[];
const TIPO_R={porcentaje_descuento:"Penalización · descuento %",pago_fijo:"Penalización · pago fijo",bono_fijo:"Bono · monto fijo",bono_porcentaje:"Bono · % del pago base",bandera:"Bandera (informativa)"};
const pcs=v=>v==null?"":(Math.round(Number(v)*10000)/100)+"%";
const condR=g=>[g.efectividad_menor_que!=null?"Efectividad < "+pcs(g.efectividad_menor_que):"",g.efectividad_minima!=null?"Efectividad ≥ "+pcs(g.efectividad_minima):"",g.entregados_minimos!=null?"Entregados ≥ "+g.entregados_minimos:""].filter(Boolean).join(" y ")||"Siempre";
const valR=g=>g.valor==null?"—":(["porcentaje_descuento","bono_porcentaje"].includes(g.tipo_regla)?pcs(g.valor):fm(g.valor));
const esBono=t=>String(t).startsWith("bono");
const reglasDe=(c,u,e)=>(RGL||[]).filter(g=>g.cuenta===c&&(!g.tipo_unidad||g.tipo_unidad===u)&&(!g.esquema||g.esquema===e));
const kindDe=g=>g.tipo_regla==="porcentaje_descuento"?"pen_pct":g.tipo_regla==="pago_fijo"?"pen_fijo":g.tipo_regla==="bono_fijo"?"bono_fijo":"bono_pct";
const KIND={pen_pct:["porcentaje_descuento","Penalización: descuento % al pago o cobro"],pen_fijo:["pago_fijo","Penalización: pago fijo $"],bono_fijo:["bono_fijo","Bono por productividad: monto fijo $"],bono_pct:["bono_porcentaje","Bono por productividad: % del pago base"]};
function reglaCampos(p,g,opts){g=g||{};const k=g.tipo_regla?kindDe(g):"pen_pct";const sty='style="width:100%"';
  const dl=(id,key)=>`<datalist id="${id}">${uniq(key).map(v=>`<option value="${v}">`).join("")}</datalist>`;
  return `<label>Tipo de regla</label><select id="${p}-k">${Object.entries(KIND).map(([v,x])=>`<option value="${v}" ${v===k?"selected":""}>${x[1]}</option>`).join("")}</select>
   <div id="${p}-aw"><label>Se aplica a</label><select id="${p}-a"><option value="pago" ${g.aplica_a!=="cobro"?"selected":""}>Pago al driver</option><option value="cobro" ${g.aplica_a==="cobro"?"selected":""}>Cobro al cliente</option></select></div>
   <label id="${p}-vl">Valor</label><input id="${p}-v" type="number" step="0.01" value="${g.valor==null?"":(["porcentaje_descuento","bono_porcentaje"].includes(g.tipo_regla)?Math.round(g.valor*10000)/100:g.valor)}">
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div id="${p}-emw"><label>Efectividad menor que (%)</label><input id="${p}-em" type="number" step="0.1" value="${g.efectividad_menor_que==null?"":g.efectividad_menor_que*100}"></div>
   <div id="${p}-eminw"><label>Efectividad mínima (%)</label><input id="${p}-emin" type="number" step="0.1" value="${g.efectividad_minima==null?"":g.efectividad_minima*100}"></div>
   <div id="${p}-entw"><label>Entregados mínimos</label><input id="${p}-ent" type="number" step="1" value="${esc(g.entregados_minimos??"")}"></div></div>
   ${opts&&opts.alcance?"":`<label>Vehículo (vacío = todos)</label><input id="${p}-u" list="${p}-dlu" value="${esc(g.tipo_unidad||"")}">${dl(p+"-dlu","tipo_unidad")}<label>Esquema (vacío = todos)</label><input id="${p}-e" list="${p}-dle" value="${esc(g.esquema||"")}">${dl(p+"-dle","esquema")}`}
   <label>Descripción (opcional, se genera sola)</label><input id="${p}-d" value="${esc(g.descripcion||"")}">
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label>Prioridad (menor va primero)</label><input id="${p}-p" type="number" step="1" value="${g.prioridad??5}"></div>
   <div id="${p}-xw" style="display:flex;align-items:flex-end"><label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="${p}-x" ${g.excepcion_validacion_supervisor?"checked":""}> Se puede exonerar al validar</label></div></div>`}
function reglaToggle(p){const k=$(p+"-k").value,b=esBono(KIND[k][0]);
  $(p+"-aw").style.display=b?"none":"block";$(p+"-xw").style.display=b?"none":"flex";$(p+"-emw").style.display=b?"none":"block";$(p+"-eminw").style.display=b?"block":"none";$(p+"-entw").style.display=b?"block":"none";
  $(p+"-vl").textContent=k==="pen_pct"||k==="bono_pct"?"Valor (% — ej. 5 = 5%)":"Valor ($)"}
function reglaHook(p){const f=()=>reglaToggle(p);$(p+"-k").onchange=f;f()}
function leerRegla(p,alc){const n=i=>{const v=$(p+"-"+i).value.trim();return v===""?null:+v};const kd=$(p+"-k").value,tipo=KIND[kd][0],b=esBono(tipo);
  const v=n("v");if(v==null||v<=0)throw new Error("Captura el valor de la regla");const pct=["porcentaje_descuento","bono_porcentaje"].includes(tipo);if(pct&&v>100)throw new Error("El porcentaje no puede pasar de 100");
  const em=b?null:n("em"),emin=b?n("emin"):null,ent=b?n("ent"):null;
  if(b&&emin==null&&ent==null)throw new Error("Un bono necesita efectividad mínima o entregados mínimos");
  const row={tipo_regla:tipo,aplica_a:b?"pago":$(p+"-a").value,valor:pct?v/100:v,efectividad_menor_que:em==null?null:em/100,efectividad_minima:emin==null?null:emin/100,entregados_minimos:ent,
    prioridad:n("p")??5,excepcion_validacion_supervisor:b?false:$(p+"-x").checked,tipo_unidad:alc?null:($(p+"-u").value.trim().toUpperCase()||null),esquema:alc?null:($(p+"-e").value.trim().toUpperCase()||null)};
  if(!b&&em==null&&!row.esquema&&!row.tipo_unidad)throw new Error("Define una condición de efectividad, un vehículo o un esquema");
  const d=$(p+"-d").value.trim();row.descripcion=d||null;return row}
function autoDesc(r){return `${r.tipo_regla.startsWith("bono")?"Bono":"Penalización"}${r.tipo_unidad?" "+r.tipo_unidad:""}${r.esquema?" "+r.esquema:""}: ${condR(r).toLowerCase()} → ${valR(r)}${r.aplica_a==="cobro"?" (cobro)":""}`}
async function guardarRegla(row,cuenta,id){const base={...row,cuenta,descripcion:row.descripcion||autoDesc(row),por_confirmar:false};
  if(id)return sb.from("reglas_penalizacion").update(base).eq("id",id);return sb.from("reglas_penalizacion").insert({...base,vigencia_desde:new Date().toLocaleDateString("en-CA"),activo:true})}
function formRegla(id){const g=id?RGL.find(x=>x.id===id):null;const m=$("modal");m.classList.remove("hide");
  m.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2 style="margin:0 0 6px">${id?"Editar regla":"Nueva penalización o bono"}</h2>
   <label>Cliente</label><select id="rg-c" ${id?"disabled":""}><option value="">Elige…</option>${["MELI","COPPEL","LIVERPOOL"].map(c=>`<option ${g&&g.cuenta===c?"selected":""}>${c}</option>`).join("")}</select>
   ${reglaCampos("rg",g)}
   ${id?`<label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="rg-act" ${g.activo?"checked":""}> Regla activa</label>`:""}
   <div class="note">Una penalización o bono aplica a todas las tarifas del cliente que coincidan con el vehículo y el esquema. Si varias penalizaciones coinciden, se usa la de menor prioridad. Los bonos coincidentes se suman.</div>
   <div id="rg-err"></div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="rg-ok">Guardar</button><button class="btn ghost" id="rg-x">Cancelar</button></div></div>`;
  reglaHook("rg");$("rg-x").onclick=()=>m.classList.add("hide");
  $("rg-ok").onclick=async()=>{const bad=t=>{$("rg-err").innerHTML=`<div class="errbox">${esc(t)}</div>`};let row;try{row=leerRegla("rg")}catch(e){return bad(e.message)}
    const cuenta=id?g.cuenta:$("rg-c").value;if(!cuenta)return bad("Elige el cliente");if(id)row.activo=$("rg-act").checked;
    $("rg-ok").disabled=true;const {error}=await guardarRegla(row,cuenta,id);if(error){$("rg-ok").disabled=false;return bad(error.message)}
    m.classList.add("hide");toast(id?"Regla actualizada":"Regla agregada");cargaTF()}}
let RGF={cuenta:"",tipo:""};
function vistaReglas(){
  const ed=esOps(),sty='style="padding:8px;border:1px solid var(--line);border-radius:10px"';
  const L=(RGL||[]).filter(g=>(!RGF.cuenta||g.cuenta===RGF.cuenta)&&(!RGF.tipo||(RGF.tipo==="bono"?esBono(g.tipo_regla):!esBono(g.tipo_regla))));
  const rows=L.map(g=>`<tr><td><b>${esc(g.cuenta)}</b></td><td>${esBono(g.tipo_regla)?'<span class="pill ok">Bono</span>':g.tipo_regla==="bandera"?'<span class="pill w">Bandera</span>':'<span class="pill bad">Penalización</span>'}<br><small>${esc(TIPO_R[g.tipo_regla]||g.tipo_regla)}</small></td><td>${g.aplica_a==="cobro"?"Cobro":"Pago"}</td><td>${esc(g.tipo_unidad||"Todos")}</td><td>${esc(g.esquema||"Todos")}</td><td>${esc(condR(g))}</td><td style="text-align:right"><b>${esc(valR(g))}</b></td><td><small>${esc(g.descripcion)}</small>${g.excepcion_validacion_supervisor?' <span class="pill w">Exonerable</span>':""}${g.por_confirmar?' <span class="pill w">Por confirmar</span>':""}</td><td>${g.activo?"":'<span class="pill bad">Inactiva</span>'}</td>${ed?`<td><button class="btn ghost sm" data-re="${esc(g.id)}">Editar</button></td>`:""}</tr>`).join("");
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px;align-items:center"><select id="rg-fc" ${sty}><option value="">Todos los clientes</option>${["MELI","COPPEL","LIVERPOOL"].map(c=>`<option ${RGF.cuenta===c?"selected":""}>${c}</option>`).join("")}</select><select id="rg-ft" ${sty}><option value="">Penalizaciones y bonos</option><option value="pen" ${RGF.tipo==="pen"?"selected":""}>Solo penalizaciones</option><option value="bono" ${RGF.tipo==="bono"?"selected":""}>Solo bonos</option></select>${ed?'<button class="btn" id="rg-n">+ Nueva regla</button>':""}</div>
   <div style="padding:0 8px 6px"><small>${ed?"Puedes agregar y editar. Los cambios aplican a rutas que se validen de ahora en adelante y quedan en bitácora.":"Solo consulta."}</small></div>
   <table><tr><th>Cliente</th><th>Tipo</th><th>Aplica a</th><th>Vehículo</th><th>Esquema</th><th>Condición</th><th>Valor</th><th>Descripción</th><th></th>${ed?"<th></th>":""}</tr>${rows||'<tr><td colspan="10">Sin reglas.</td></tr>'}</table>`}

const uniq=(k)=>[...new Set((TF||[]).map(x=>x[k]).filter(Boolean))].sort();
const subTF=()=>`<div class="tabs" style="padding:8px 8px 0"><button class="${TFV==="t"?"on":""}" data-tfv="t">Tarifas</button><button class="${TFV==="r"?"on":""}" data-tfv="r">Penalizaciones y bonos</button></div>`;
function vistaTarifario(){
  if(!TF){cargaTF();return '<div style="padding:16px">Cargando tarifario…</div>'}
  if(TFV==="r")return subTF()+vistaReglas();
  const L=TF.filter(x=>(!TFL.cuenta||x.cuenta===TFL.cuenta)&&(!TFL.veh||x.tipo_unidad===TFL.veh)&&(!TFL.esq||x.esquema===TFL.esq)&&(!TFL.act||x.activo)&&(!TFL.q||[x.ubicacion,x.ciudad,x.zona,x.variable,x.conc].join(" ").toUpperCase().includes(TFL.q.toUpperCase())));
  const op=(arr,v)=>`<option value="">Todos</option>`+arr.map(a=>`<option ${a===v?"selected":""}>${esc(a)}</option>`).join("");
  const sty='style="padding:8px;border:1px solid var(--line);border-radius:10px"';
  const ed=esOps();
  const f=`<div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px;align-items:center"><select id="tf-c" ${sty}>${op(["MELI","COPPEL","LIVERPOOL"],TFL.cuenta).replace("Todos","Todos los clientes")}</select><input id="tf-q" placeholder="Buscar ubicación, zona…" value="${esc(TFL.q)}" ${sty}><select id="tf-v" ${sty}>${op(uniq("tipo_unidad"),TFL.veh).replace("Todos","Todos los vehículos")}</select><select id="tf-e" ${sty}>${op(uniq("esquema"),TFL.esq).replace("Todos","Todos los esquemas")}</select><label style="font-size:13px"><input type="checkbox" id="tf-a" ${TFL.act?"checked":""}> Solo activas</label>${ed?'<button class="btn" id="tf-n">+ Nueva tarifa</button>':""}</div>`;
  const rows=L.slice(0,300).map(x=>`<tr><td><b>${esc(x.cuenta)}</b>${x.cliente&&x.cliente!==x.cuenta?`<br><small>${esc(x.cliente)}</small>`:""}</td><td>${esc(x.ubicacion||"—")}${x.ciudad?`<br><small>${esc(x.ciudad)}</small>`:""}</td><td>${esc(x.zona||"—")}${x.variable?` <span class="pill w">${esc(x.variable)}</span>`:""}</td><td>${esc(x.tipo_unidad||"—")}</td><td>${esc(x.esquema||"—")}</td><td style="text-align:right"><b>${x.pago_base==null?"—":fm(x.pago_base)}</b></td><td style="text-align:right"><b>${x.tarifa_cliente==null?"—":fm(x.tarifa_cliente)}</b></td><td><small>${esc(x.vigencia_desde)}${x.vigencia_hasta?" → "+x.vigencia_hasta:" → abierta"}</small>${x.activo?"":' <span class="pill bad">Inactiva</span>'}</td>${ed?`<td><button class="btn ghost sm" data-te="${esc(x.id)}">Editar</button></td>`:""}</tr>`).join("");
  return subTF()+f+`<div style="padding:0 8px 6px"><small>${esc(L.length)} tarifas${L.length>300?" (se muestran 300; afina el filtro)":""} · ${ed?"Puedes agregar y editar. Los cambios no alteran rutas ya validadas y quedan en bitácora.":"Solo consulta. Los cambios los hacen Operaciones y la cuenta maestra."}</small></div><table><tr><th>Cliente</th><th>Ubicación</th><th>Tipo de ruta</th><th>Vehículo</th><th>Esquema</th><th>Pago</th><th>Cobro</th><th>Vigencia</th>${ed?"<th></th>":""}</tr>${rows||'<tr><td colspan="9">Sin tarifas con ese filtro.</td></tr>'}</table>`}
function formTarifa(id){
  const t=id?TF.find(x=>x.id===id):{cuenta:"",ubicacion:"",ciudad:"",tipo_unidad:"",esquema:"",zona:"",variable:"",pago_base:"",tarifa_cliente:"",vigencia_desde:new Date().toLocaleDateString("en-CA"),vigencia_hasta:"",activo:true};
  const m=$("modal");m.classList.remove("hide");const dl=(i,k)=>`<datalist id="${i}">${uniq(k).map(v=>`<option value="${v}">`).join("")}</datalist>`;
  m.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2 style="margin:0 0 6px">${id?"Editar tarifa":"Nueva tarifa"}</h2>
   <label>Cliente</label><select id="tf-fc" ${id?"disabled":""}><option value="">Elige…</option>${["MELI","COPPEL","LIVERPOOL"].map(c=>`<option ${t.cuenta===c?"selected":""}>${c}</option>`).join("")}</select>
   <label>Ubicación / CEDIS</label><input id="tf-fu" value="${esc(t.ubicacion||"")}"><label>Ciudad (opcional)</label><input id="tf-fci" value="${esc(t.ciudad||"")}">
   <label>Tipo de ruta (zona)</label><input id="tf-fz" list="dl-z" value="${esc(t.zona||"")}" placeholder="LOCAL, FORANEA 1…">${dl("dl-z","zona")}
   <label>Vehículo</label><input id="tf-fv" list="dl-v" value="${esc(t.tipo_unidad||"")}" placeholder="3.5T, LARGE VAN…">${dl("dl-v","tipo_unidad")}
   <label>Esquema</label><input id="tf-fe" list="dl-e" value="${esc(t.esquema||"")}" placeholder="RUTA, PAQUETE…">${dl("dl-e","esquema")}
   <label>Variable (opcional, ej. PEAK)</label><input id="tf-fva" value="${esc(t.variable||"")}">
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label>Pago al driver</label><input id="tf-fp" type="number" step="0.01" value="${esc(t.pago_base??"")}"></div><div><label>Cobro al cliente</label><input id="tf-fco" type="number" step="0.01" value="${esc(t.tarifa_cliente??"")}"></div>
   <div><label>Vigencia desde</label><input id="tf-fd" type="date" value="${esc(t.vigencia_desde||"")}"></div><div><label>Vigencia hasta</label><input id="tf-fh" type="date" value="${esc(t.vigencia_hasta||"")}"></div></div>
   <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="tf-fa" ${t.activo?"checked":""}> Tarifa activa</label>
   <h3 style="margin:16px 0 4px">Penalizaciones y bonos</h3><div id="rt-box"></div><div id="rt-form" class="hide"></div>
   <div id="tf-err"></div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="tf-ok">Guardar</button><button class="btn ghost" id="tf-x">Cancelar</button></div></div>`;
  RTD=[];const ctx=()=>({c:id?t.cuenta:$("tf-fc").value,u:$("tf-fv").value.trim().toUpperCase(),e:$("tf-fe").value.trim().toUpperCase()});
  const drawRT=()=>{const c=ctx();const ex=c.c?reglasDe(c.c,c.u,c.e):[];
    $("rt-box").innerHTML=(ex.length?ex.map(g=>`<div class="item" style="padding:6px 0;border-bottom:1px solid var(--line)"><div><span class="pill ${esBono(g.tipo_regla)?"ok":"bad"}">${esBono(g.tipo_regla)?"Bono":g.tipo_regla==="bandera"?"Bandera":"Penalización"}</span> <b>${valR(g)}</b> · ${condR(g)}<br><small>${esc(g.descripcion)}${g.activo?"":" (inactiva)"}</small></div></div>`).join(""):'<div class="note" style="margin:0">Sin penalizaciones ni bonos para este cliente, vehículo y esquema.</div>')
      +RTD.map((r,i)=>`<div class="item" style="padding:6px 0"><div><span class="pill w">Por crear</span> <b>${valR(r)}</b> · ${condR(r)}<br><small>${r.descripcion||autoDesc(r)}</small></div><button class="btn ghost sm" data-rtx="${i}">Quitar</button></div>`).join("")
      +'<button class="btn ghost sm" id="rt-add" style="margin-top:8px">+ Agregar penalización o bono</button><div class="note">Aplican a todas las tarifas del cliente con ese vehículo y esquema. Para editar o desactivar las existentes, usa la pestaña Penalizaciones y bonos.</div>';
    $("rt-box").querySelectorAll("[data-rtx]").forEach(b=>b.onclick=()=>{RTD.splice(+b.dataset.rtx,1);drawRT()});
    $("rt-add").onclick=()=>{$("rt-form").classList.remove("hide");$("rt-form").innerHTML=reglaCampos("rt",null,{alcance:true})+'<label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="rt-lu" checked> Limitar a este vehículo</label><label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="rt-le" checked> Limitar a este esquema</label><div id="rt-err"></div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm" id="rt-ok">Agregar regla</button><button class="btn ghost sm" id="rt-no">Cancelar</button></div>';
      reglaHook("rt");$("rt-no").onclick=()=>{$("rt-form").classList.add("hide");$("rt-form").innerHTML=""};
      $("rt-ok").onclick=async()=>{let r;try{r=leerRegla("rt",true)}catch(e){$("rt-err").innerHTML=`<div class="errbox">${esc(e.message)}</div>`;return}
        const cx=ctx();if(!cx.c){$("rt-err").innerHTML='<div class="errbox">Primero elige el cliente de la tarifa</div>';return}
        r.tipo_unidad=$("rt-lu").checked?(cx.u||null):null;r.esquema=$("rt-le").checked?(cx.e||null):null;
        if(id){const {error}=await guardarRegla(r,cx.c,null);if(error){$("rt-err").innerHTML=`<div class="errbox">${esc(error.message)}</div>`;return}const g=await sb.from("reglas_penalizacion").select("*");RGL=g.data||RGL;toast("Regla agregada")}
        else{r._lu=$("rt-lu").checked;r._le=$("rt-le").checked;RTD.push(r)}
        $("rt-form").classList.add("hide");$("rt-form").innerHTML="";drawRT()}}};
  drawRT();["tf-fv","tf-fe","tf-fc"].forEach(i=>{const e=$(i);if(e)e.addEventListener("change",drawRT)});
  $("tf-x").onclick=()=>m.classList.add("hide");
  $("tf-ok").onclick=async()=>{const v=i=>$(i).value.trim();const row={ubicacion:v("tf-fu")||null,ciudad:v("tf-fci")||null,zona:v("tf-fz").toUpperCase()||null,tipo_unidad:v("tf-fv").toUpperCase()||null,esquema:v("tf-fe").toUpperCase()||null,variable:v("tf-fva").toUpperCase()||null,
     pago_base:v("tf-fp")===""?null:+v("tf-fp"),tarifa_cliente:v("tf-fco")===""?null:+v("tf-fco"),vigencia_desde:v("tf-fd"),vigencia_hasta:v("tf-fh")||null,activo:$("tf-fa").checked};
    const cuenta=id?t.cuenta:v("tf-fc");const bad=m=>{$("tf-err").innerHTML=`<div class="errbox">${esc(m)}</div>`};
    if(!cuenta)return bad("Elige el cliente");if(!row.esquema)return bad("Indica el esquema");if(!row.tipo_unidad)return bad("Indica el vehículo");if(!row.zona)return bad("Indica el tipo de ruta");
    if(row.pago_base==null||row.tarifa_cliente==null||row.pago_base<0||row.tarifa_cliente<0)return bad("Captura pago y cobro (no negativos)");if(!row.vigencia_desde)return bad("Indica la vigencia");
    if(row.vigencia_hasta&&row.vigencia_hasta<row.vigencia_desde)return bad("La vigencia final es anterior a la inicial");
    row.conc=[row.ubicacion,row.tipo_unidad,row.esquema,row.zona,row.variable].filter(Boolean).join("");
    const q=id?sb.from("tarifas").update(row).eq("id",id):sb.from("tarifas").insert({...row,cuenta,cliente:cuenta,fuente:"Panel"});
    $("tf-ok").disabled=true;const {error}=await q;if(error){$("tf-ok").disabled=false;return bad(error.message)}
    if(!id&&RTD.length){for(const r of RTD){const x={...r};x.tipo_unidad=r._lu?row.tipo_unidad:null;x.esquema=r._le?row.esquema:null;delete x._lu;delete x._le;const g=await guardarRegla(x,cuenta,null);if(g.error){toast("Tarifa creada, pero una regla falló: "+g.error.message)}}}
    m.classList.add("hide");TF=null;TAR=null;toast(id?"Tarifa actualizada":"Tarifa agregada");cargaTF()}}
const NIVEL={master:"Cuenta maestra · acceso completo",ops:"Operaciones · acceso completo",coordinador:"Coordinador · operación y pagos, sin cobro ni utilidad",finanzas:"Finanzas · pagos, liquidaciones y utilidad",ih:"Supervisor · datos operativos, sin importes"};
const CATALOGO={rutas:["Rutas","Cada ruta con driver, flotillero, cliente, CEDIS, paquetes, efectividad, estatus de validación, manifiestos y extras (maniobras, estadía, otros)."],
 cancelaciones:["Cancelaciones","Cancelaciones con ubicación, distancia al CEDIS, validación y estatus."],incidencias:["Incidencias","Incidencias reportadas por ruta, con comentario."],fallidos:["Fallidos por causa","Paquetes fallidos por causa y ruta."],
 drivers:["Drivers y flotilleros","Base de drivers con flotillero y registro fiscal."],liquidaciones_pago:["Liquidaciones (pago)","Pago al proveedor por ruta validada, sin cobro al cliente ni utilidad."],
 liquidaciones:["Liquidaciones completas","Pago, cobro al cliente, venta, utilidad y margen por ruta validada."],pagos:["Pagos","Pagos generados por driver y flotillero con su estatus."],auditoria:["Bajas y cambios de datos","Solicitudes de baja y de cambio de datos con su estatus."]};
function vistaDescargas(){
  const l=(DSET||[]).map(k=>{const [label,description]=CATALOGO[k]||[k,""];return `<div class="item" style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 8px;border-bottom:1px solid var(--line)"><div><b>${esc(label)}</b><br><small>${esc(description)}</small></div><button class="btn sm" data-dl="${esc(k)}">Descargar CSV</button></div>`}).join("");
  const lg=DLOG.map(x=>`<tr><td>${dd(x.en)} ${hh(x.en)}</td><td>${esc(x.rol)}</td><td>${(CATALOGO[x.dataset]||[x.dataset])[0]}</td><td>${esc(x.filas)}</td><td>${esc(x.desde)} → ${esc(x.hasta)}</td></tr>`).join("");
  return `<h3 style="margin:12px 8px 0">Descarga de datos</h3><div style="padding:0 8px"><span class="pill ok">${esc(NIVEL[ROL]||ROL)}</span><br><small>Usa el rango de fechas y el cliente de la barra de arriba. Cada descarga queda registrada.</small></div>${l||'<div style="padding:12px">Tu nivel no tiene descargas.</div>'}
   ${DLOG.length?`<h3 style="margin:16px 8px 0">Últimas descargas</h3><table><tr><th>Cuándo</th><th>Rol</th><th>Descarga</th><th>Filas</th><th>Periodo</th></tr>${lg}</table>`:""}`}
const csvCell=v=>{if(v==null)return"";const s=String(v).replace(/"/g,'""');return /[",\n\r]/.test(s)?`"${s}"`:s};
async function descargar(k,btn){btn.disabled=true;const t=btn.textContent;btn.textContent="Generando…";
  const {data,error}=await sb.rpc("exportar_dataset",{p_dataset:k,p_desde:$("d1").value,p_hasta:$("d2").value,p_cliente:$("fcli").value?+$("fcli").value:null});
  btn.disabled=false;btn.textContent=t;if(error){toast(error.message);return}
  if(!data||!data.length){toast("No hay datos en ese periodo");return}
  const cols=Object.keys(data[0]);const csv="\ufeff"+[cols.map(csvCell).join(",")].concat(data.map(r=>cols.map(c=>csvCell(r[c])).join(","))).join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=`chazki_${k}_${$("d1").value}_${$("d2").value}.csv`;document.body.appendChild(a);a.click();a.remove();
  toast(`Descargadas ${esc(data.length)} filas`);cargaLog()}
async function cargaLog(){if(!esOps())return;const r=await sb.from("descargas_log").select("*").order("en",{ascending:false}).limit(15);DLOG=r.data||[];if(tab==="d")render()}
function vistaBajas(){
  const ck=x=>x?"✅":"⏳",puedeS=ROL==="ih",puedeC=["master","ops","coordinador"].includes(ROL);
  const f=BAJ.map(q=>{const d=DRV.find(y=>y.id===q.driver_id),p=PRV.find(y=>y.id===q.proveedor_id);
    const mia=q.estatus==="pendiente"&&((puedeS&&!q.aprob_supervisor)||(puedeC&&!q.aprob_coord));
    return `<tr><td>${esc(d?d.nombre:q.driver_id)}</td><td>${esc(p?p.nombre:"—")}</td><td>${esc(q.motivo)}<br><small>${dd(q.solicitado_en)}</small></td><td>Supervisor ${ck(q.aprob_supervisor)}<br>Coordinador ${ck(q.aprob_coord)}</td><td>${q.estatus==="pendiente"?"<span class='pill w'>Pendiente</span>":q.estatus==="aprobada"?"<span class='pill ok'>Desactivado</span>":"<span class='pill bad'>Rechazada</span>"}</td><td>${mia?`<button class="btn sm" data-bja="${esc(q.id)}">Autorizar desactivación</button> <button class="btn ghost sm" data-bjr="${esc(q.id)}">Rechazar</button>`:""}</td></tr>`}).join("");
  return `<h3 style="margin:12px 8px 0">Solicitudes de desactivación de drivers</h3><small style="padding:0 8px">Al completar las autorizaciones, el driver se desactiva sin eliminar su perfil, historial ni relación con el flotillero.</small><table><tr><th>Driver</th><th>Flotillero</th><th>Motivo</th><th>Autorizaciones</th><th>Estatus</th><th></th></tr>${f||'<tr><td colspan="6">Sin solicitudes.</td></tr>'}</table>`}
async function resolverBaja(id,ok){const {data,error}=await sb.rpc("resolver_desactivacion_driver",{p_id:id,p_aprobar:ok,p_nota:null});
  if(error){toast(error.message);return}await cargaExtra();render();toast(ok?"Autorización registrada ("+data+")":"Solicitud rechazada")}
function vistaAprobar(){
  const f=PEND.map(q=>{const r=q.rutas||{};return `<tr><td>${esc(r.id_ruta||q.ruta_id)}</td><td>${esc(r.drivers?r.drivers.nombre:"")}</td><td>${esc(r.cedis?r.cedis.clientes.nombre+" · "+r.cedis.nombre:"")}</td><td>${esc(r.entregados)}/${esc(r.paquetes_asignados)}</td><td>No aplicar penalización al pago<br><small>${esc(q.motivo)}</small></td><td><button class="btn ghost sm" data-det="${esc(q.ruta_id)}">Detalle</button> ${esCoord()?`<button class="btn sm" data-ap="${esc(q.id)}">Aprobar</button> <button class="btn ghost sm" data-rc="${esc(q.id)}">Rechazar</button>`:'<span class="pill w">En espera</span>'}</td></tr>`}).join("");
  return `<h3 style="margin:12px 8px 0">Excepciones por aprobar</h3><table><tr><th>Ruta</th><th>Driver</th><th>Cliente · CEDIS</th><th>Entreg.</th><th>Solicitud</th><th></th></tr>${f||'<tr><td colspan="6">Nada pendiente.</td></tr>'}</table>`}
async function registrarAuditoriaValidacion(rutaId){
  return sb.rpc("registrar_validacion_liquidacion",{p_ruta_id:Number(rutaId)});
}
async function resolverVal(id,ok){
  const solicitud=PEND.find(x=>String(x.id)===String(id));
  const {error}=await sb.rpc("resolver_validacion",{p_id:id,p_aprobar:ok,p_nota:null});
  if(error){toast(error.message);return}
  let auditError=null;
  if(ok&&solicitud?.ruta_id){const audit=await registrarAuditoriaValidacion(solicitud.ruta_id);auditError=audit.error}
  await cargaExtra();render();
  toast(auditError?"Aprobada, pero no se registró el supervisor que validó: "+auditError.message:ok?"Aprobada: ruta validada y pago generado":"Solicitud rechazada");
}
function vistaEquipo(){
  const st='style="padding:9px;border:1px solid var(--line);border-radius:10px"';
  const eq=DRV.filter(d=>["master","ops","coordinador","ih","finanzas"].includes(d.rol)).map(d=>`<tr><td>${esc(d.nombre)}</td><td>${ROLES_TXT[d.rol]}</td><td>${esc(d.estatus)}</td></tr>`).join("");
  const inv=(window.INV||[]).map(i=>`<tr><td>${esc(i.email)}</td><td>${ROLES_TXT[i.rol]}</td></tr>`).join("");
  return `<h3 style="margin:12px 8px 0">Dar acceso al personal</h3><div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px">
   <input id="eq-m" type="email" placeholder="correo@chazki.com" ${st}>
   <select id="eq-r" ${st}>${["coordinador","ih","finanzas","ops","master"].map(r=>`<option value="${r}">${ROLES_TXT[r]}</option>`).join("")}</select>
   <button class="btn" id="eq-ok">Asignar</button></div>
   <small style="padding:0 8px">Entra con Google; el rol se activa en su primer ingreso (o al instante si ya entró).</small>
   <h3 style="margin:12px 8px 0">Equipo con acceso</h3><table><tr><th>Nombre</th><th>Rol</th><th>Estatus</th></tr>${eq}</table>
   <h3 style="margin:12px 8px 0">Invitaciones</h3><table><tr><th>Correo</th><th>Rol</th></tr>${inv||'<tr><td colspan="2">Sin invitaciones.</td></tr>'}</table>`}
async function asignarRol(){const m=$("eq-m").value.trim().toLowerCase();
  if(!/^[^@\s]+@chazki\.com$/.test(m)){toast("Solo correos @chazki.com");return}
  const {data,error}=await sb.rpc("asignar_rol",{p_email:m,p_rol:$("eq-r").value});
  if(error){toast(error.message);return}toast(data);await cargaExtra();render()}
function vistaProveedores(){
  const opts=sel=>`<option value="">Sin proveedor</option>`+PRV.map(p=>`<option value="${esc(p.id)}" ${sel==p.id?"selected":""}>${esc(p.nombre)}</option>`).join("");
  const dr=DRV.map(d=>`<tr><td>${esc(d.nombre)}<br><small>${esc(d.codigo||"")}</small></td><td><select data-rol="${esc(d.id)}">${["driver","flotillero","ops","coordinador","ih","finanzas","master"].map(r=>`<option ${d.rol===r?"selected":""}>${r}</option>`).join("")}</select></td><td><select data-prov="${esc(d.id)}">${opts(d.proveedor_id)}</select></td><td><button class="btn sm" data-gd="${esc(d.id)}">Guardar</button></td></tr>`).join("");
  const pv=PRV.map(p=>{const t=DRV.find(d=>d.id===p.titular_id);return `<tr><td>${esc(p.nombre)}</td><td>${esc(p.tipo)}</td><td>${p.tipo_registro?esc(p.tipo_registro):'<span class="pill w">Sin definir</span>'}</td><td>${esc(t?t.nombre:"—")}</td></tr>`}).join("");
  const st='style="padding:9px;border:1px solid var(--line);border-radius:10px"';
  if(!esOps())return `<h3 style="margin:12px 8px 0">Proveedores</h3><table><tr><th>Proveedor</th><th>Tipo</th><th>Registro fiscal</th><th>Titular</th></tr>${pv}</table>`;
  return `<h3 style="margin:12px 8px 0">Alta de proveedor</h3><div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px">
    <input id="np-n" placeholder="Nombre del proveedor" ${st} style="flex:2;min-width:180px;padding:9px;border:1px solid var(--line);border-radius:10px">
    <select id="np-t" ${st}><option value="independiente">Independiente</option><option value="flotillero">Flotillero</option></select>
    <select id="np-r" ${st}><option value="">Registro fiscal…</option><option>FACTURA</option><option>SIN FACTURA</option></select>
    <select id="np-u" ${st}><option value="">Quién ve sus pagos…</option>${DRV.map(d=>`<option value="${esc(d.id)}">${esc(d.nombre)}</option>`).join("")}</select>
    <button class="btn" id="np-ok">Crear</button></div>
    <h3 style="margin:12px 8px 0">Proveedores</h3><table><tr><th>Proveedor</th><th>Tipo</th><th>Registro fiscal</th><th>Titular (ve los pagos)</th></tr>${pv||'<tr><td colspan="4">Aún no hay proveedores.</td></tr>'}</table>
    <h3 style="margin:16px 8px 0">Drivers</h3><table><tr><th>Driver</th><th>Rol</th><th>Proveedor</th><th></th></tr>${dr}</table>`}
function enlazar(){
  const ap=$("analytics-period");if(ap)ap.onchange=()=>{analyticsGrain=ap.value;render()};
  const fp=$("finance-period");if(fp)fp.onchange=()=>{financeGrain=fp.value;render()};
  const importDoc=$("doc-flota-save");if(importDoc)importDoc.onclick=importarDocumentoFlota;
  const pnrSave=$("pnr-new-save");if(pnrSave)pnrSave.onclick=crearPnROps;
  document.querySelectorAll("[data-pnr-action]").forEach(b=>b.onclick=()=>resolverPnROps(b.dataset.pnrId,b.dataset.pnrAction));
  document.querySelectorAll("[data-doc-approve]").forEach(b=>b.onclick=()=>resolverDocumento(b.dataset.docApprove,true));
  document.querySelectorAll("[data-doc-reject]").forEach(b=>b.onclick=()=>resolverDocumento(b.dataset.docReject,false));
  document.querySelectorAll("[data-det]").forEach(b=>b.onclick=()=>verDetalleRuta(b.dataset.det));
  document.querySelectorAll("[data-val]").forEach(b=>b.onclick=()=>abrirValidar(+b.dataset.val));
  document.querySelectorAll("[data-anu]").forEach(b=>b.onclick=()=>anular(+b.dataset.anu));
  document.querySelectorAll("[data-gd]").forEach(b=>b.onclick=()=>guardarDriver(b.dataset.gd));
  const ok=$("np-ok");if(ok)ok.onclick=crearProveedor;document.querySelectorAll("[data-cpa]").forEach(b=>b.onclick=()=>resolverCambio(+b.dataset.cpa,true));document.querySelectorAll("[data-cpr]").forEach(b=>b.onclick=()=>resolverCambio(+b.dataset.cpr,false));document.querySelectorAll("[data-bja]").forEach(b=>b.onclick=()=>resolverBaja(+b.dataset.bja,true));document.querySelectorAll("[data-bjr]").forEach(b=>b.onclick=()=>resolverBaja(+b.dataset.bjr,false));document.querySelectorAll("[data-ap]").forEach(b=>b.onclick=()=>resolverVal(+b.dataset.ap,true));document.querySelectorAll("[data-rc]").forEach(b=>b.onclick=()=>resolverVal(+b.dataset.rc,false));document.querySelectorAll("[data-rev]").forEach(b=>b.onclick=()=>revisarCan(+b.dataset.rev));
  document.querySelectorAll("[data-tfv]").forEach(b=>b.onclick=()=>{TFV=b.dataset.tfv;render()});
  document.querySelectorAll("[data-re]").forEach(b=>b.onclick=()=>formRegla(+b.dataset.re));
  const rgn=$("rg-n");if(rgn)rgn.onclick=()=>formRegla(null);const rfc=$("rg-fc");if(rfc){rfc.onchange=()=>{RGF.cuenta=rfc.value;render()};$("rg-ft").onchange=e=>{RGF.tipo=e.target.value;render()}}
  const tfc=$("tf-c");if(tfc){tfc.onchange=()=>{TFL.cuenta=tfc.value;render()};$("tf-v").onchange=e=>{TFL.veh=e.target.value;render()};$("tf-e").onchange=e=>{TFL.esq=e.target.value;render()};$("tf-a").onchange=e=>{TFL.act=e.target.checked;render()};
   $("tf-q").onchange=e=>{TFL.q=e.target.value;render()};const n=$("tf-n");if(n)n.onclick=()=>formTarifa(null)}
  document.querySelectorAll("[data-te]").forEach(b=>b.onclick=()=>formTarifa(+b.dataset.te));
  document.querySelectorAll("[data-dl]").forEach(b=>b.onclick=()=>descargar(b.dataset.dl,b));document.querySelectorAll("[data-mf]").forEach(b=>b.onclick=()=>verManif(+b.dataset.mf));const eo=$("eq-ok");if(eo)eo.onclick=asignarRol;
}
async function crearPnROps(){
  const button=$("pnr-new-save"),errorBox=$("pnr-new-error");
  const pnr=$("pnr-new-ref").value.trim(),driverId=$("pnr-new-driver").value,cliente=$("pnr-new-client").value.trim();
  const ruta=$("pnr-new-route").value.trim(),detalle=$("pnr-new-detail").value.trim(),monto=Number($("pnr-new-amount").value);
  const files=[...$("pnr-new-files").files];
  errorBox.innerHTML="";
  if(!pnr||!driverId||!cliente||!detalle||!Number.isFinite(monto)||monto<=0){errorBox.innerHTML='<div class="errbox">Completa PNR, driver, cliente, detalle e importe válido.</div>';return}
  if(files.length>5||files.some(file=>file.size>10*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type))){errorBox.innerHTML='<div class="errbox">Adjunta hasta 5 imágenes JPEG, PNG o WebP de máximo 10 MB cada una.</div>';return}
  button.disabled=true;const paths=[];let created=false;
  try{
    const {data:{user},error:userError}=await sb.auth.getUser();if(userError)throw userError;
    if(!user)throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    for(const file of files){
      const ext=file.type==="image/jpeg"?"jpg":file.type==="image/png"?"png":"webp";
      const path=`${user.id}/${crypto.randomUUID()}.${ext}`;
      const {error}=await sb.storage.from("pnr-evidence").upload(path,file,{contentType:file.type,upsert:false});
      if(error)throw error;paths.push(path);
    }
    const {error}=await sb.rpc("crear_reclamo_pnr",{p_pnr:pnr,p_driver_id:driverId,p_cliente:cliente,p_ruta_id:ruta||null,p_detalle:detalle,p_monto:monto,p_adjuntos:paths});
    if(error)throw error;
    created=true;
    await load();toast("PNR creado; el plazo de 24 horas comenzó");
  }catch(error){
    let cleanupError=null;
    if(!created&&paths.length){const result=await sb.storage.from("pnr-evidence").remove(paths);cleanupError=result.error}
    errorBox.innerHTML=`<div class="errbox">${created?"El PNR quedó creado, pero no se pudo actualizar la vista: ":""}${esc(error.message||error)}${cleanupError?` · No se pudieron limpiar archivos temporales: ${esc(cleanupError.message)}`:""}</div>`;
    button.disabled=false;
  }
}
async function resolverPnROps(id,accion){
  const promptText=accion==="solicitar_soporte"?"Indica qué evidencia adicional necesita el driver:":accion==="rechazar"?"Describe por qué la segunda evidencia es insuficiente:":"Nota de resolución (opcional):";
  const mensaje=prompt(promptText);
  if(mensaje===null)return;
  if(accion!=="aceptar"&&!mensaje.trim()){toast("Escribe una nota para continuar");return}
  const {error}=await sb.rpc("resolver_reclamo_pnr",{p_reclamo_id:id,p_accion:accion,p_mensaje:mensaje.trim()||null});
  if(error){toast(error.message);return}
  await load();
  toast(accion==="aceptar"?"Evidencia aceptada; reclamo cerrado":accion==="solicitar_soporte"?"Solicitud de soporte enviada; nuevo plazo de 24 horas":"Reclamo cerrado y descuento programado para las próximas liquidaciones");
}
async function guardarDriver(id){const rol=document.querySelector(`[data-rol="${id}"]`).value,pv=document.querySelector(`[data-prov="${id}"]`).value;
  const {error}=await sb.from("drivers").update({rol,proveedor_id:pv?+pv:null}).eq("id",id);
  if(error){toast(error.message);return}await cargaExtra();render();toast("Driver actualizado")}
async function crearProveedor(){const n=$("np-n").value.trim();if(!n){toast("Escribe el nombre del proveedor");return}
  const {error}=await sb.from("proveedores").insert({nombre:n,tipo:$("np-t").value,tipo_registro:$("np-r").value||null,titular_id:$("np-u").value||null});
  if(error){toast(error.message);return}await cargaExtra();render();toast("Proveedor creado")}
async function anular(rutaId){
  const pg=await sb.from("pagos").select("estatus").eq("ruta_id",rutaId).eq("concepto","servicio");
  if(pg.error){toast(pg.error.message);return}
  if((pg.data||[]).some(x=>x.estatus==="pagado")){toast("Este pago ya está marcado como pagado; no se puede anular");return}
  const modal=$("modal");modal.classList.remove("hide");
  modal.innerHTML=`<div class="box"><h2 style="margin:0 0 8px">Anular validación</h2>
    <p>Indica el motivo. El registro quedará guardado en el historial de anulaciones.</p>
    <label for="anulacion-motivo">Motivo de anulación</label>
    <textarea id="anulacion-motivo" rows="4" maxlength="2000" placeholder="Escribe el motivo"></textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button class="btn ghost" id="anulacion-cancelar">Cancelar</button>
      <button class="btn" id="anulacion-confirmar">Confirmar anulación</button>
    </div></div>`;
  $("anulacion-cancelar").onclick=()=>modal.classList.add("hide");
  $("anulacion-confirmar").onclick=async()=>{
    const motivo=$("anulacion-motivo").value.trim();
    if(!motivo){toast("Escribe el motivo de la anulación");$("anulacion-motivo").focus();return}
    const boton=$("anulacion-confirmar");boton.disabled=true;
    const {error}=await sb.rpc("anular_liquidacion",{p_ruta_id:String(rutaId),p_motivo:motivo});
    if(error){toast(error.message);boton.disabled=false;return}
    modal.classList.add("hide");await load();toast("Validación anulada y motivo guardado");
  }}
async function cargarTarifas(){if(TAR)return;const {data}=await sb.from("tarifas").select("id,cuenta,conc,ubicacion,ciudad,tipo_unidad,esquema,zona,variable,pago_base,tarifa_cliente,vigencia_desde,vigencia_hasta").order("ubicacion").order("tipo_unidad").order("esquema").order("zona");TAR=data||[]}
function sugeridas(ru,todas){
  const cuenta=cuentaDe(ru.cedis.clientes.nombre),fecha=new Date(ru.checkin_at).toLocaleDateString("en-CA");
  let l=TAR.filter(t=>t.cuenta===cuenta),nota="";
  const vig=l.filter(t=>t.vigencia_desde<=fecha&&(!t.vigencia_hasta||t.vigencia_hasta>=fecha));
  if(vig.length)l=vig;else nota="No hay tarifas vigentes en la fecha de la ruta; se muestran todas las de la cuenta. ";
  if(!todas){let f;
    if(cuenta==="MELI"){const code=ru.cedis.nombre.split(" - ")[0].toUpperCase();f=l.filter(t=>(t.ubicacion||"").toUpperCase()===code||(!t.ubicacion&&(t.conc||"").toUpperCase().includes(code)))}
    else{const stop=new Set(["express","hibrida","coppel","paqueteria","paquete","circuitos","para","los","las"]);const tk=nz(ru.cedis.nombre).split(" ").filter(w=>w.length>=3&&!stop.has(w));
      f=l.filter(t=>{const u=nz((t.ubicacion||"")+" "+(t.ciudad||""));return tk.some(w=>u.includes(w))})}
    if(f.length)l=f;else nota+="No encontré tarifas para este CEDIS; se muestran todas las de la cuenta.";}
  return {l,nota};
}
const filaRes=(a,b,cls="")=>`<tr class="${cls}"><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
function tablaRes(j){
  return `<table class="res">`+filaRes("Efectividad",pc(j.efectividad)+" ("+j.entregados+" de "+j.asignados+")")+
   filaRes("Al proveedor","","h")+filaRes("Pago base",fm(j.pago_base))+(j.regla_pago?filaRes("Regla aplicada: "+j.regla_pago,fm(j.dcto_pago)):"")+(Number(j.bono_pago)?filaRes("Bono: "+j.regla_bono,fm(j.bono_pago)):"")+(Number(j.ajuste_pago)?filaRes("Ajuste",fm(j.ajuste_pago)):"")+filaRes("Costo total",fm(j.costo_total),"t")+
   (j.registro_fiscal==="SIN FACTURA"?filaRes("Retención 5%",fm(-j.retencion))+filaRes("Neto a pagar",fm(j.neto))+filaRes("Comisión 2% (costo de Chazki)",fm(j.comision)):filaRes("IVA 16%",fm(j.iva)))+
   filaRes("Pago al proveedor ("+j.registro_fiscal.toLowerCase()+")",fm(j.pago_driver),"t")+
   filaRes("Cobro al cliente","","h")+filaRes("Cobro base",fm(j.cobro_base))+(j.regla_cobro?filaRes("Regla aplicada: "+j.regla_cobro,fm(j.dcto_cobro)):"")+(Number(j.ajuste_cobro)?filaRes("Ajuste",fm(j.ajuste_cobro)):"")+filaRes("Venta total",fm(j.venta_total),"t")+
   filaRes("Utilidad (venta menos costo total)",fm(j.utilidad)+" · "+pc(j.margen),"t")+`</table>`+((j.avisos||[]).length?`<div class="errbox">${esc(j.avisos.join(". "))}</div>`:"");
}
async function abrirValidar(id){
  const ru=R.find(x=>x.id===id);await cargarTarifas();
  const p=provDe(ru.driver_id),cuenta=cuentaDe(ru.cedis.clientes.nombre),m=$("modal");m.classList.remove("hide");
  const pintar=()=>{let {l,nota}=sugeridas(ru,$("m-todas").checked);
    const z=$("m-zona").value;if(z)l=l.filter(t=>{const u=(t.zona||"").toUpperCase();return z==="LOCAL"?u.startsWith("LOCAL"):new RegExp("FORANE[AO] "+z+"( |$)").test(u)});
    if(z&&!l.length)nota=(nota?nota+" · ":"")+"No hay tarifa cargada para ese tipo de ruta";
    $("m-tar").innerHTML=l.map(t=>`<option value="${esc(t.id)}">${esc([t.ubicacion,t.tipo_unidad,t.esquema,t.zona,t.variable==="PEAK"?"PEAK":""].filter(Boolean).join(" · "))} — pago ${fm(t.pago_base)} / cobro ${fm(t.tarifa_cliente)}</option>`).join("");
    $("m-nota-t").textContent=nota;reset()};
  const reset=()=>{$("m-prev").innerHTML="";$("m-ok").disabled=true};
  m.innerHTML=`<div class="box"><h2 style="margin:0 0 4px">Validar ruta ${esc(ru.id_ruta)}</h2>
    <div style="color:var(--mut);font-size:13px">${esc(ru.drivers.nombre)} · ${esc(ru.cedis.clientes.nombre)} · ${esc(ru.cedis.nombre)} · ${esc(ru.entregados)} entregados de ${esc(ru.paquetes_asignados)}</div>
    <label>Tipo de ruta</label><select id="m-zona"><option value="">Todas</option><option value="LOCAL">Local</option><option value="1">Foránea 1</option><option value="2">Foránea 2</option><option value="3">Foránea 3</option><option value="4">Foránea 4</option></select>
    <label>Tarifa aplicable</label><select id="m-tar"></select>
    <div style="font-size:12px;color:var(--mut);margin-top:4px"><label style="display:inline;margin:0"><input type="checkbox" id="m-todas"> Ver todas las tarifas de la cuenta</label> <span id="m-nota-t" style="color:#946200"></span></div>
    <label style="display:flex;gap:8px;align-items:flex-start;color:var(--ink)"><input type="checkbox" id="m-ex" style="margin-top:2px"> No aplicar la penalización al pago del driver${esCoord()?"":" (requiere aprobación del coordinador; escribe el motivo en la nota)"}</label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label>Ajuste al pago (+ o −)</label><input type="number" id="m-ap" value="0" step="0.01"></div><div><label>Ajuste al cobro (+ o −)</label><input type="number" id="m-ac" value="0" step="0.01"></div></div>
    <label>Nota (opcional)</label><textarea id="m-nota" rows="2"></textarea>
    <div id="m-prev" style="margin-top:12px"></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn ghost" id="m-calc">Calcular</button><button class="btn" id="m-ok" disabled>Validar y generar pago</button><button class="btn ghost" id="m-x">Cancelar</button></div></div>`;
  pintar();
  $("m-todas").onchange=pintar;
  $("m-zona").onchange=pintar;
  ["m-tar","m-ex","m-ap","m-ac"].forEach(i=>$(i).addEventListener("input",reset));
  $("m-x").onclick=()=>m.classList.add("hide");
  const args=()=>({p_ruta_id:id,p_tarifa_id:+$("m-tar").value,p_registro:p?.tipo_registro||"",p_excepcion:$("m-ex").checked,p_ajuste_pago:+$("m-ap").value||0,p_ajuste_cobro:+$("m-ac").value||0});
  const extra=()=>({p_proveedor_id:p?.id||null,p_actualizar_driver:false});
  $("m-calc").onclick=async()=>{
    if(!p||!p.tipo_registro){$("m-prev").innerHTML='<div class="errbox">Falta asignar flotillero y registro fiscal en la base de flota. No se puede validar hasta corregir esos datos.</div>';return}
    if(!$("m-tar").value){$("m-prev").innerHTML='<div class="errbox">Elige una tarifa.</div>';return}
    const r=await sb.rpc("calcular_liquidacion",args());
    if(r.error){$("m-prev").innerHTML=`<div class="errbox">${esc(r.error.message)}</div>`;$("m-ok").disabled=true;return}
    $("m-prev").innerHTML=tablaRes(r.data);$("m-ok").disabled=false};
  $("m-ok").onclick=async()=>{
    if(!p||!p.tipo_registro){$("m-prev").innerHTML='<div class="errbox">Falta asignar flotillero y registro fiscal en la base de flota. No se puede validar hasta corregir esos datos.</div>';return}
    $("m-ok").disabled=true;
    const r=await sb.rpc("validar_ruta",{...args(),...extra(),p_nota:$("m-nota").value.trim()||null});
    if(r.error){$("m-prev").innerHTML+=`<div class="errbox">${esc(r.error.message)}</div>`;return}
    let auditError=null;
    if(r.data!==0){const audit=await registrarAuditoriaValidacion(id);auditError=audit.error}
    m.classList.add("hide");await cargaExtra();render();
    toast(r.data===0?"Enviada al coordinador para aprobación":auditError?"Ruta validada, pero no se registró el supervisor que la validó: "+auditError.message:"Ruta validada y pago generado")};
}
boot();
