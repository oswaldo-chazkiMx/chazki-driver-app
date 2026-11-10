const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sb=supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_KEY);const $=id=>document.getElementById(id);
let R=[],C=[],tab="r",photos={},LIQ={},DRV=[],PRV=[],TAR=null,ANU=[],ANUERR="",AUD={},AUDERR="",DOCOPS=[],DOCOPSERR="",DOCDRIVERS=[],DOCDRIVERSERR="",PNR_OPS=[],PNR_OPS_ERR="",NO_SHOW_OPS=[],NO_SHOW_EVENTS=[],NO_SHOW_CLIENTS=[],NO_SHOW_ERR="",CLIENTES_NOMBRE={},analyticsGrain="dia",financeGrain="dia";
let WM_NO_SHOW_REVIEW=null;
const fd=m=>m==null?"—":(m<1000?m+" m":(m/1000).toFixed(1)+" km");
const hh=s=>s?new Date(s).toTimeString().slice(0,5):"—";
const dd=s=>new Date(s).toLocaleDateString("es-MX",{day:"2-digit",month:"short"});
const dominioOk=e=>/^[^@\s]+@chazki\.com$/i.test((e||"").trim());
let ROL=null,PEND=[],BAJ=[],CAMB=[],DSET=[],DLOG=[],NOTIF_UID=null,RECHAZOS_RUTA=[],RECHAZOS_RUTA_ERR="";
let COPPEL_REVISIONES=[],COPPEL_REVISIONES_ERR="";
let COPPEL_AJUSTES=[],COPPEL_AJUSTES_ERR="",COPPEL_DESTINOS=[],COPPEL_DESTINOS_ERR="";
let CAMBIOS_TARIFARIO=[],CAMBIOS_TARIFARIO_ERR="",CSV_ASIGNACIONES_RESULT=null;
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
const TABS={master:"rvalbkcifpedtnxyzgqnhwj",ops:"rvalbkcifpdtnxyzgqnwj",coordinador:"rvalbkcifpdtxyzqnwj",finanzas:"rlcapdxyzqg",ih:"rvabkcifpdxnwj"};
const puede=t=>(TABS[ROL]||"").includes(t)&&!(ROL==="finanzas"&&t==="a");
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
  n:["NO SHOW","⏱","Registra servicios no atendidos y resuelve las apelaciones de Drivers."],
  x:["Indicadores del negocio","▥","Consulta indicadores operativos del periodo."],
  y:["Finanzas por cliente","$","Consulta ventas, pagos, utilidad y penalizaciones."],
  z:["Desempeño de flotilla","♙","Compara resultados de flotilleros y drivers."],
  b:["Desactivaciones","−","Gestiona solicitudes de desactivación de drivers."],
  k:["Cambios de datos","✎","Revisa solicitudes de actualización de perfiles."],
  t:["Tarifario","$","Consulta y administra tarifas operativas."],
  h:["Cambios tarifarios","✓","Aprueba o rechaza los cambios de tarifas y penalizaciones propuestos."],
  d:["Reportes","⇩","Genera reportes y exportaciones."],
  p:["Proveedores y drivers","♙","Administra proveedores y sus conductores."],
  j:["Padrón de flota","♙","Consulta el padrón de Flota y las cuentas de la app por separado."],
  w:["Invitaciones","✉","Invita flotilleros y drivers independientes, y aprueba los drivers que piden los flotilleros."],
  e:["Equipo","♧","Gestiona el acceso del equipo administrativo."]
};
function seleccionarTab(b,actualizar=true){
  document.querySelectorAll(".role-nav button").forEach(x=>x.classList.toggle("on",x===b));
  const prevTab=tab;tab=b.dataset.t;
  document.querySelectorAll(".nav-sub").forEach(sub=>{
    const parent=sub.dataset.parent;
    if(tab===parent&&document.querySelector(`.role-nav button[data-t="${parent}"]`))sub.classList.toggle("open",prevTab===tab?!sub.classList.contains("open"):true);
    else if(sub.contains(b))sub.classList.add("open");
  });
  document.querySelector(".bar").classList.toggle("hide",["n","p","j","g"].includes(tab));
  document.querySelector(".page-heading").classList.toggle("hide",["p","j","g"].includes(tab));
  const [title,,description]=NAV_INFO[tab]||["Operación","",""];
  $("page-title").textContent=title;
  $("page-description").textContent=description;
  const navGroup=b.closest?.(".nav-group"),sectionLabel=navGroup?.previousElementSibling?.textContent.trim()||"Administración";
  const eyebrow=$("section-eyebrow");if(eyebrow)eyebrow.textContent=sectionLabel;
  const view=$("view");
  if(view.dataset)view.dataset.section=navGroup?.dataset.navGroup||"administracion";
  view.classList.add("executive-view");
  $("view").parentElement?.classList.add("executive-layout");
  $("kpis").classList.toggle("executive-kpis",tab==="r");
  if(actualizar)return load();
}
function aplicarRol(){
  document.querySelectorAll(".role-nav button").forEach(b=>{
    if(!puede(b.dataset.t)){b.remove();return}
    const [label,icon]=NAV_INFO[b.dataset.t]||[b.textContent,"•"];
    b.innerHTML=`<span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
  });
  document.querySelectorAll(".nav-sub").forEach(sub=>{
    if(!sub.querySelector("button"))sub.remove();
    else if(!document.querySelector(`.role-nav button[data-t="${sub.dataset.parent}"]`))sub.classList.add("open");
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
  const f=document.querySelector(".role-nav button");if(f)seleccionarTab(f,false);
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
  try{await iniciarPanel()}
  catch(error){
    const mensaje="No se pudo iniciar el panel: "+(error.message||error);
    if($("panel").classList.contains("hide")){$("auth").classList.remove("hide");$("amsg").innerHTML=`<div class="errbox">${esc(mensaje)}</div>`}
    else toast(mensaje);
  }finally{$("loading").classList.add("hide")}
}
async function iniciarPanel(){
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
  const {data:cl,error:clientError}=await sb.from("clientes").select("id,nombre").order("nombre");
  if(clientError){toast("No se pudieron cargar los clientes: "+clientError.message);return}
  CLIENTES_NOMBRE=Object.fromEntries((cl||[]).map(c=>[String(c.id),c.nombre]));
  $("fcli").innerHTML='<option value="">Todos los clientes</option>'+(cl||[]).map(c=>`<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("");
  await load();
}
let PANEL_LOAD=Promise.resolve(),PANEL_REQUEST=0;
const FRASES_CARGA=[
  "Los datos vienen en camino. Y estos sí traen ubicación.",
  "Acomodando paquetes… de información.",
  "Esta camioneta funciona con datos, no con gasolina.",
  "Buscando el dato. No estaba en la guantera.",
  "Un segundo: el Excel pidió aventón.",
  "Si lees esto, ya eres del equipo de cargas rápidas.",
  "Tu café sigue caliente. Nosotros seguimos consultando.",
  "Los números se están poniendo el cinturón.",
  "Recalculando… pero sin dar la vuelta a la manzana.",
  "Cargando datos. Las excusas vienen en otro camión.",
  "No es magia. Es logística con buena conexión.",
  "Tu siguiente decisión está a una curva de aquí."
];
let fraseCargaIndice=Math.floor(Math.random()*FRASES_CARGA.length);
function siguienteFraseCarga(){
  const frase=FRASES_CARGA[fraseCargaIndice];
  fraseCargaIndice=(fraseCargaIndice+1)%FRASES_CARGA.length;
  return frase;
}
function cargaPanelHtml(pestana){
  const seccion=NAV_INFO[pestana]?.[0]||"tu panel";
  return `<div class="dispatch-loader" role="status" aria-live="polite">
    <span class="dispatch-tag">Operación en movimiento</span>
    <h2>${esc(siguienteFraseCarga())}</h2>
    <p>Consultando lo más reciente de ${esc(seccion)}.</p>
    <div class="dispatch-map" aria-hidden="true">
      <span class="dispatch-stop"></span>
      <div class="dispatch-van"><span class="dispatch-cab"></span><span class="dispatch-parcel"></span><span class="dispatch-wheel rear"></span><span class="dispatch-wheel front"></span></div>
      <span class="dispatch-stop"></span>
    </div>
    <div class="dispatch-caption" aria-hidden="true"><span>Datos de origen</span><span>Tu siguiente decisión</span></div>
    <div class="dispatch-status"><span class="dispatch-pulse" aria-hidden="true"><i></i><i></i><i></i></span>Actualizando datos…</div>
  </div>`;
}
function load(){
  const solicitud=++PANEL_REQUEST,pestana=tab;
  const filtros={desde:$("d1").value,hasta:$("d2").value,cliente:$("fcli").value};
  $("view").setAttribute("aria-busy","true");
  $("view").innerHTML=cargaPanelHtml(pestana);
  $("kpis").classList.add("hide");
  const ejecutar=async()=>{
    if(solicitud!==PANEL_REQUEST)return;
    try{
      await cargarDatosPanel(pestana,filtros);
      if(solicitud===PANEL_REQUEST)render();
    }catch(error){
      if(solicitud===PANEL_REQUEST){
        const mensaje="No se pudo actualizar la sección: "+(error.message||error);
        $("view").innerHTML=`<div class="errbox" role="alert">${esc(mensaje)}. Vuelve a seleccionar la opción para reintentar.</div>`;
        toast(mensaje);
      }
    }finally{if(solicitud===PANEL_REQUEST)$("view").setAttribute("aria-busy","false")}
  };
  PANEL_LOAD=PANEL_LOAD.then(ejecutar);
  return PANEL_LOAD;
}
async function cargarDatosPanel(tab,filtros){
  if(tab==="h"){await cargarCambiosTarifario(false);return}
  if(tab==="t"){TAR=null;await cargaTF(false);return}
  if(tab==="p"&&ROL!=="finanzas"){AFILIADOS_LOADING=true;await cargarAfiliados();return}
  if(tab==="w"){INVR_LOADING=true;await cargarInvitaciones();return}
  if(tab==="j"){PADRON_LOADING=true;try{await cargarPadron()}finally{PADRON_LOADING=false}return}
  if(tab==="e"){await cargaExtra();await cargarAsignacionesEquipo();return}
  if(tab==="g"&&ROL==="finanzas"){
    await cargarDocumentosFinanzas();return;
  }
  if(tab==="n"){
    await cargaExtra();
    await cargarNoShowsOps();
    return;
  }
  if(!filtros.desde||!filtros.hasta||filtros.desde>filtros.hasta)throw new Error("Selecciona un periodo de fechas válido");
  const a=new Date(filtros.desde+"T00:00:00").toISOString(),b=new Date(filtros.hasta+"T23:59:59").toISOString();
  let routeRows,cancelRows;
  try{
    [routeRows,cancelRows]=await Promise.all([
      fetchPaged(()=>sb.from("rutas").select("*,drivers(nombre,codigo,cliente_default_id),cedis(*),ruta_fallos(cantidad,causas_fallo(nombre)),ruta_incidencias(comentario,tipos_incidencia(nombre)),ruta_manifiestos(foto_path)").gte("checkin_at",a).lte("checkin_at",b).order("checkin_at",{ascending:false})),
      fetchPaged(()=>sb.from("cancelaciones").select("*,drivers(nombre,codigo),cedis(*)").gte("capturado_at",a).lte("capturado_at",b).order("capturado_at",{ascending:false}))
    ]);
  }catch(error){throw new Error("No se pudieron cargar las rutas y cancelaciones: "+(error.message||error))}
  for(const row of routeRows.concat(cancelRows)){
    if(row.cedis)row.cedis.clientes={nombre:CLIENTES_NOMBRE[String(row.cedis.cliente_id)]||""}
  }
  const f=filtros.cliente;const keep=x=>!f||String(x.cedis.cliente_id)===f;
  R=routeRows.filter(keep);C=cancelRows.filter(keep);
  const paths=C.flatMap(x=>[x.foto_path,x.foto_bitacora_path]).filter(Boolean);photos={};
  if(paths.length){const s=await sb.storage.from("cancelaciones").createSignedUrls(paths,3600);if(s.error)toast("No se pudieron cargar las fotos de cancelación: "+s.error.message);(s.data||[]).forEach(x=>{photos[x.path]=x.signedUrl})}
  await cargaEventos();await cargaExtra();
  if(tab==="a"&&COPPEL_PEAK_ENABLED&&esCoord())await cargarRevisionesCoppel();
  if(tab==="l")await cargarAnulaciones();
  if(veFin()&&["x","y","z"].includes(tab))await cargarAuditorias();
  if(esOps()&&tab==="g")await cargarDocumentosOps();
  if(tab==="q")await cargarPnrsOps();
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
async function cargarNoShowsOps(){
      NO_SHOW_OPS=[];NO_SHOW_EVENTS=[];NO_SHOW_CLIENTS=[];NO_SHOW_ERR="";
      try{
        const [cases,clients]=await Promise.all([
          fetchPaged(()=>sb.from("no_show_casos").select("*").order("creado_en",{ascending:false}).limit(1000)),
          (async()=>{
            const [clientResult,cedisResult]=await Promise.all([
              fetchPaged(()=>sb.from("clientes").select("id,nombre").order("nombre")),
              fetchPaged(()=>sb.from("cedis").select("id,nombre,cliente_id").order("nombre"))
            ]);
            if(clientResult.length&&!Object.keys(CLIENTES_NOMBRE).length){
              CLIENTES_NOMBRE=Object.fromEntries(clientResult.map(client=>[String(client.id),client.nombre]))
            }
            const cedisPorCliente={};
            cedisResult.forEach(cedis=>{
              if(!cedisPorCliente[cedis.cliente_id])cedisPorCliente[cedis.cliente_id]=[];
              cedisPorCliente[cedis.cliente_id].push(cedis)
            });
            return clientResult.map(client=>({...client,cedis:cedisPorCliente[client.id]||[]}))
          })()
        ]);
        NO_SHOW_OPS=cases;
        NO_SHOW_CLIENTS=clients;
        const ids=cases.map(x=>x.id);
        if(ids.length)NO_SHOW_EVENTS=await fetchPaged(()=>sb.from("no_show_eventos").select("*").in("caso_id",ids).order("creado_en"));
      }catch(error){NO_SHOW_ERR=error.message||String(error)}
    }
    const noShowFmtDate=value=>value?new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}):"—";
    const noShowFmtDateTime=value=>value?new Date(value).toLocaleString("es-MX",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
    const noShowStatus={
      reportado:["Reportado · apelación disponible","w"],
      apelado:["Apelación pendiente","bad"],
      apelacion_aceptada:["Apelación aceptada · descuento revertido","ok"],
      apelacion_rechazada:["Apelación rechazada · descuento vigente","bad"]
    };
    function vistaNoShowsOps(){
      const puedeReportar=ROL==="ih";
      const puedeResolver=["master","ops","coordinador"].includes(ROL);
      const drivers=DRV.filter(d=>d.rol==="driver");
      const form=puedeReportar?`<section class="pnr-panel">
        <div class="pnr-form-head"><div><h3>Reportar servicio NO SHOW</h3><p>El reporte no crea una ruta operativa. Se usa el tarifario vigente para la fecha del servicio; si no hay regla/tarifa NO SHOW, el monto manual no puede exceder el valor contratado.</p></div></div>
        <div class="pnr-form-grid">
          <label class="pnr-field pnr-span-3">Driver<select id="ns-driver"><option value="">Selecciona un Driver…</option>${drivers.map(d=>`<option value="${esc(d.id)}">${esc(d.nombre)} · ${esc(d.codigo||"")}</option>`).join("")}</select></label>
          <div class="pnr-field pnr-span-3"><span>Flotillero aplicable</span><div id="ns-provider" class="note" style="margin:0">Se determina desde el perfil del Driver.</div></div>
          <label class="pnr-field pnr-span-3">Cliente<select id="ns-client"><option value="">Selecciona un cliente…</option>${NO_SHOW_CLIENTS.map(c=>`<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("")}</select></label>
          <label class="pnr-field pnr-span-3">CEDIS<select id="ns-cedis" disabled><option value="">Selecciona primero un cliente…</option></select></label>
          <label class="pnr-field pnr-span-3">Fecha del servicio<input id="ns-date" type="date" max="${new Date().toLocaleDateString("en-CA")}"></label>
          ${WALMART_VALIDACION_ENABLED?`<div id="ns-wm-fields" class="pnr-span-6 hide">
            <label>Proveedor confirmado<select id="ns-wm-provider"><option value="">Selecciona un proveedor…</option>${PRV.filter(p=>p.activo).map(p=>`<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join("")}</select></label>
            <label>Unidad confirmada<select id="ns-wm-unit"><option value="">Selecciona unidad…</option><option value="3.5T">3.5T</option><option value="Large">Large</option></select></label>
            <label>Modelo del servicio<select id="ns-wm-option"><option value="">Selecciona modelo…</option><option value="1">Opción 1</option><option value="2">Opción 2</option></select></label>
            <div class="note">Confirma los datos del servicio; el NO SHOW se calcula al 60 % y no genera un ajuste inmediato.</div>
          </div>`:""}
          <label class="pnr-field pnr-span-3">Entregas contratadas (solo tarifas por paquete)<input id="ns-packages" type="number" min="1" max="10000" step="1" inputmode="numeric" placeholder="Ej. 40"><small>El límite se calcula como pago base × entregas contratadas.</small></label>
          <label class="pnr-field pnr-span-3">Importe manual (solo si no hay regla/tarifa NO SHOW)<input id="ns-amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="$0.00"></label>
          <label class="pnr-field pnr-span-6">Observaciones del Supervisor <span style="font-weight:400">Máximo 200 caracteres; no se permiten groserías.</span><textarea id="ns-observations" rows="3" maxlength="200" placeholder="Describe brevemente el servicio al que no se presentó"></textarea></label>
        </div>
        <div id="ns-form-error"></div>
        <div class="pnr-form-footer"><span style="color:var(--mut);font-size:12px">El Driver podrá apelar una vez dentro de 6 horas.</span><button class="btn" id="ns-report-save">Registrar NO SHOW</button></div>
      </section>`:'<div class="note">La captura corresponde al Supervisor. Coordinación puede revisar y resolver las apelaciones.</div>';
      const rows=NO_SHOW_OPS.map(c=>{
        const appealExpired=c.estado==="reportado"&&new Date(c.vence_apelacion_en)<=Date.now();
        const [label,style]=appealExpired?["Reportado · plazo vencido","w"]:c.metodo_calculo==="walmart_60_saldo"&&c.estado==="apelacion_aceptada"?["Apelación aceptada · sin descuento","ok"]:noShowStatus[c.estado]||["Estatus desconocido","w"];
        const events=NO_SHOW_EVENTS.filter(e=>e.caso_id===c.id);
        const driver=DRV.find(d=>d.id===c.driver_id);
        const provider=PRV.find(p=>String(p.id)===String(c.proveedor_id));
        const canResolve=puedeResolver&&c.estado==="apelado";
        return `<article class="pnr-claim">
          <div class="pnr-claim-top"><div class="pnr-claim-title"><b>${esc(c.driver_nombre||driver?.nombre||c.driver_id)}</b><span style="color:var(--mut)"> · ${esc(c.cuenta)}</span></div><span class="pill ${style}">${esc(label)}</span></div>
          <div class="pnr-claim-meta"><span>Flotillero: <b>${esc(provider?.nombre||"Sin proveedor")}</b></span><span>Servicio: <b>${esc(noShowFmtDate(c.fecha_servicio))}</b></span><span>Cliente: <b>${esc(c.cliente_nombre)}</b></span><span>CEDIS: <b>${esc(c.cedis_nombre)}</b></span><span>Unidad: <b>${esc(c.tipo_unidad)}</b></span></div>
          <div class="pnr-claim-meta"><span>Penalización: <b>${esc(fm(c.monto_penalizacion))}</b></span><span>Valor contratado: <b>${esc(fm(c.valor_servicio_contratado))}</b></span><span>Cálculo: <b>${esc(c.metodo_calculo)}</b></span><span>Reportado: <b>${esc(noShowFmtDateTime(c.creado_en))}</b></span></div>
          <div class="pnr-claim-detail"><b>Observaciones del Supervisor</b><br>${esc(c.observaciones_supervisor)}</div>
          ${c.apelacion?`<div class="pnr-claim-detail"><b>Contestación del Driver</b><br>${esc(c.apelacion)}<small style="display:block;color:var(--mut);margin-top:5px">${esc(noShowFmtDateTime(c.apelacion_en))}</small></div>`:""}
          ${c.resolucion?`<div class="pnr-claim-detail"><b>Resolución</b><br>${esc(c.resolucion)}</div>`:""}
          ${events.length?`<details><summary>Historial (${events.length} movimientos)</summary><div class="pnr-timeline">${events.map(e=>`<div class="pnr-event"><b>${esc(({reportado:"Reporte creado",apelacion_driver:"Apelación del Driver",apelacion_aceptada:"Apelación aceptada",apelacion_rechazada:"Apelación rechazada"})[e.tipo]||e.tipo)}</b><small>${esc(noShowFmtDateTime(e.creado_en))}</small><div style="white-space:pre-wrap">${esc(e.mensaje)}</div></div>`).join("")}</div></details>`:""}
          ${WALMART_VALIDACION_ENABLED&&ROL==="ih"&&String(c.cuenta||"").trim().toUpperCase()==="WALMART"?`<div class="pnr-actions"><button class="btn ghost sm" data-wm-ns-precierre="${esc(c.driver_id)}">Revisar NO SHOW en precierre</button></div>`:""}
          ${canResolve?`<div class="pnr-actions"><button class="btn sm" data-ns-resolve="aceptar" data-ns-id="${esc(c.id)}">Aceptar apelación y revertir</button><button class="btn bad sm" data-ns-resolve="rechazar" data-ns-id="${esc(c.id)}">Rechazar apelación</button></div>`:""}
        </article>`;
      }).join("");
      return `<div class="pnr-layout">${NO_SHOW_ERR?`<div class="errbox">No se pudo cargar NO SHOW. Ejecuta no-show-workflow.sql en Supabase y verifica el acceso. ${esc(NO_SHOW_ERR)}</div>`:""}${form}
        <section class="pnr-list"><div class="pnr-list-head"><h3>Reportes NO SHOW</h3><span class="pnr-count">${NO_SHOW_OPS.length} ${NO_SHOW_OPS.length===1?"caso":"casos"}</span></div>${rows?`<div class="pnr-list">${rows}</div>`:'<div class="pnr-empty">Todavía no hay reportes NO SHOW.</div>'}</section></div>`;
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
function prepararVistaEjecutiva(){
  const view=$("view"),label=NAV_INFO[tab]?.[0]||"Sección";
  let index=0;
  view.querySelectorAll("table").forEach(table=>{
    if(table.closest(".doc-table-wrap,.exec-table-wrap,.executive-table-wrap"))return;
    const wrapper=document.createElement("div"),columns=[...table.querySelectorAll("th")].map(th=>th.textContent.trim()).filter(Boolean).slice(0,4);
    wrapper.className="executive-table-wrap";wrapper.tabIndex=0;wrapper.setAttribute("role","region");
    wrapper.setAttribute("aria-label",`${label}${columns.length?": "+columns.join(", "):" · detalle"}${index?" · continuación":""}`);
    table.before(wrapper);wrapper.appendChild(table);index++;
  });
}
function render(){
  const cer=R.filter(x=>x.estado==="cerrada"),asg=R.reduce((s,x)=>s+x.paquetes_asignados,0),ent=cer.reduce((s,x)=>s+x.entregados,0),fal=cer.reduce((s,x)=>s+x.fallidos,0);
  const incs=R.reduce((s,x)=>s+x.ruta_incidencias.length,0);
  $("kpis").classList.toggle("hide",tab!=="r");
  $("kpis").innerHTML=tab==="r"?[["Rutas",R.length],["En ruta",R.filter(x=>x.estado==="en_ruta").length],["Paquetes asignados",asg],["Entregados",ent],["Fallidos",fal],["Efectividad",(ent+fal)?Math.round(ent/(ent+fal)*100)+"%":"—"],["Cancelaciones",C.length],["Canc. a revisar",C.filter(x=>x.ubicacion_validada==="fuera"||x.ubicacion_validada==="sin_ubicacion").length],["Incidencias",incs]].concat(veFin()?[["Por validar",porValidar().length],["Pago validado",fm(sumLiq("pago_driver"))]]:[]).map(([k,v])=>`<div class="kpi"><small>${k}</small><b>${v}</b></div>`).join(""):"";
  let h="";
  if(tab==="r")h=`<table><tr><th>Fecha</th><th>Driver</th><th>Cliente · CEDIS</th><th>Ruta</th><th>Zonas</th><th>Llegada</th><th>Auxiliar</th><th>Asig.</th><th>Entreg.</th><th>Fall.</th><th>Manif.</th><th>Estado</th></tr>`+
    (R.map(x=>`<tr><td>${dd(x.checkin_at)}</td><td>${esc(x.drivers.nombre)}<br><small>${esc(x.drivers.codigo||"")}</small></td><td><b>${esc(x.cedis.clientes.nombre)}</b>${x.drivers.cliente_default_id&&x.drivers.cliente_default_id!==x.cedis.cliente_id?` <span class="pill w">Otra cuenta</span>`:""}<br>${esc(x.cedis.nombre)}</td><td>${esc(x.id_ruta)}</td><td>${esc(x.zonas.join(", "))}</td><td>${hh(x.hora_llegada_cedis)}</td><td>${x.auxiliar_requerido?`<span class="pill ${x.viaja_con_auxiliar?"ok":"w"}">${x.viaja_con_auxiliar?"Con auxiliar":"Solo"}</span>`:"No aplica"}</td><td>${esc(x.paquetes_asignados)}</td><td>${esc(x.entregados??"—")}</td><td>${esc(x.fallidos??"—")}</td><td>${x.ruta_manifiestos&&x.ruta_manifiestos.length?`<button class="btn ghost sm" data-mf="${esc(x.id)}">📎 ${esc(x.ruta_manifiestos.length)}</button>`:(x.tipo_unidad==="3.5T"?'<span class="pill bad">Sin fotos</span>':"—")}</td><td><span class="pill ${x.estado==="cerrada"?"ok":"w"}">${x.estado==="cerrada"?"Cerrada "+hh(x.checkout_at):"En ruta"}</span></td></tr>`).join("")||`<tr><td colspan="12">Sin rutas en este periodo.</td></tr>`)+`</table>`;
  if(tab==="c")h=`<table><tr><th>Fecha y hora</th><th>Driver</th><th>Cliente · CEDIS</th><th>Ruta</th><th>Pin</th><th>Validación de ubicación</th><th>Evidencia</th><th>Estatus</th></tr>`+
    (C.map(x=>`<tr><td>${dd(x.capturado_at)} ${hh(x.capturado_at)}</td><td>${esc(x.drivers.nombre)}</td><td><b>${esc(x.cedis.clientes.nombre)}</b><br>${esc(x.cedis.nombre)}</td><td>${esc(x.id_ruta||"—")}</td><td>${x.lat==null?"—":`<a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${esc(x.lat)},${esc(x.lng)}">${x.lat.toFixed(4)}, ${x.lng.toFixed(4)}</a>`}</td><td>${x.ubicacion_validada==="dentro"?`<span class="pill ok">Dentro · ${fd(x.distancia_cedis_m)}</span>`:x.ubicacion_validada==="fuera"?`<span class="pill bad">Fuera · ${fd(x.distancia_cedis_m)}</span>`:x.ubicacion_validada==="sin_ubicacion"?'<span class="pill bad">Sin ubicación del driver</span>':'<span class="pill w">CEDIS sin coordenadas</span>'}</td><td>${photos[x.foto_path]?`<img class="th" src="${photos[x.foto_path]}" data-u="${photos[x.foto_path]}">`:"—"}</td><td>${estCan(x)}${COPPEL_PEAK_ENABLED&&x.estatus==="aprobada"&&cuentaDe(x.cedis.clientes.nombre)==="COPPEL"&&["ih","coordinador","ops","master"].includes(ROL)?`<br><button class="btn ghost sm" data-coppel-cancelacion="${esc(x.id)}">Revisar semana COPPEL</button>`:""}</td></tr>`).join("")||`<tr><td colspan="8">Sin cancelaciones en este periodo.</td></tr>`)+`</table>`;
  if(tab==="i"){const rows=R.flatMap(x=>x.ruta_incidencias.map(i=>({x,i})));h=`<table><tr><th>Fecha</th><th>Driver</th><th>Cliente · CEDIS</th><th>Incidencia</th><th>Comentario</th></tr>`+
    (rows.map(({x,i})=>`<tr><td>${dd(x.checkin_at)}</td><td>${esc(x.drivers.nombre)}</td><td>${esc(x.cedis.clientes.nombre)} · ${esc(x.cedis.nombre)}</td><td><span class="pill bad">${esc(i.tipos_incidencia.nombre)}</span></td><td>${esc(i.comentario||"—")}</td></tr>`).join("")||`<tr><td colspan="5">Sin incidencias en este periodo.</td></tr>`)+`</table>`}
  if(tab==="f"){const m={};R.forEach(x=>x.ruta_fallos.forEach(f=>{m[f.causas_fallo.nombre]=(m[f.causas_fallo.nombre]||0)+f.cantidad}));const e=Object.entries(m).sort((a,b)=>b[1]-a[1]);
  h=`<table><tr><th>Causa</th><th>Paquetes</th></tr>`+(e.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")||`<tr><td colspan="2">Sin fallidos en este periodo.</td></tr>`)+`</table>`}
  if(tab==="v")h=vistaPorValidar();if(tab==="l")h=vistaValidadas();if(tab==="p")h=vistaProveedores();if(tab==="e")h=vistaEquipo();if(tab==="a")h=vistaAprobar();if(tab==="b")h=vistaBajas();if(tab==="k")h=vistaCambios();if(tab==="d")h=vistaDescargas();if(tab==="t")h=vistaTarifario();if(tab==="h")h=vistaCambiosTarifario();if(tab==="x")h=vistaIndicadores();if(tab==="y")h=vistaFinanzas();if(tab==="z")h=vistaDesempeno();if(tab==="g")h=vistaDocumentosOps();if(tab==="q")h=vistaPnrsOps();if(tab==="n")h=vistaNoShowsOps();if(tab==="w")h=vistaInvitaciones();if(tab==="j")h=vistaPadron();
  $("view").innerHTML=h;prepararVistaEjecutiva();enlazar();
  document.querySelectorAll("img.th").forEach(i=>i.onclick=()=>{$("lbimg").src=i.dataset.u;$("lb").classList.remove("hide")});
}
// ================= Validación de rutas, pagos y proveedores =================
const fm=n=>{if(n==null)return "—";const v=Number(n);const t=Math.abs(v).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2});return (v<0&&Math.abs(v)>=0.005?"-":"")+"$"+t};
const pc=n=>n==null?"—":(Number(n)*100).toFixed(1)+"%";
const nz=s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").trim();
const cuentaDe=c=>c==="MERCADO LIBRE"?"MELI":(c==="COPPEL"||c==="COPPEL BT")?"COPPEL":c==="LIVERPOOL"?"LIVERPOOL":(c==="CUBBO"||c==="NESPRESSO"||c==="ESTAFETA"||c==="AMPM")?c:null;
const COPPEL_PEAK_ENABLED=false; // Activar solo con la migración Peak validada.
const COPPEL_POSTVAL_ENABLED=false; // Activar solo al conectar y validar pagos.
const WALMART_VALIDACION_ENABLED=false; // Activar solo con el flujo financiero Walmart completo y probado.
const CUENTAS_TARIFARIO=["MELI","COPPEL","LIVERPOOL","CUBBO","NESPRESSO","ESTAFETA","AMPM"];
const sumLiq=k=>Object.values(LIQ).reduce((s,x)=>s+Number(x[k]||0),0);
const porValidar=()=>R.filter(x=>x.estado==="cerrada"&&!LIQ[x.id]&&!PEND.some(q=>q.ruta_id===x.id)
  &&!RECHAZOS_RUTA.some(q=>String(q.ruta_id)===String(x.id))
  &&(cuentaDe(x.cedis.clientes.nombre)||(WALMART_VALIDACION_ENABLED&&ROL==="ih"&&String(x.cedis.clientes.nombre||"").trim().toUpperCase()==="WALMART")));
function toast(m){const t=$("toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),3200)}
async function rechazarValidacionRuta(id,modal,button){
  const motivo=prompt("Motivo del rechazo (obligatorio):");
  if(motivo===null)return;
  const nota=motivo.trim();
  if(!nota||nota.length>2000){toast("Escribe un motivo de rechazo de hasta 2000 caracteres.");return}
  button.disabled=true;
  try{
    const {data,error}=await sb.rpc("rechazar_validacion_ruta",{p_ruta_id:id,p_motivo:nota});
    if(error)throw error;
    if(data!==true)throw new Error("La operación devolvió una respuesta inválida");
  }catch(error){toast("No se pudo rechazar la ruta: "+(error.message||error));button.disabled=false;return}
  modal.classList.add("hide");
  try{
    await cargaExtra();render();
    toast("Ruta rechazada y motivo registrado");
  }catch(error){toast("Ruta rechazada, pero no se pudo actualizar la lista: "+(error.message||error))}
}
async function restaurarValidacionRuta(id,button){
  if(!confirm("¿Quitar el rechazo y devolver esta ruta a Por validar?"))return;
  button.disabled=true;
  try{
    const {data,error}=await sb.rpc("restaurar_validacion_ruta",{p_ruta_id:id});
    if(error)throw error;
    if(data!==true)throw new Error("La operación devolvió una respuesta inválida");
  }catch(error){toast("No se pudo restaurar la ruta: "+(error.message||error));button.disabled=false;return}
  try{
    await cargaExtra();render();
    toast("Ruta devuelta a Por validar");
  }catch(error){toast("Ruta restaurada, pero no se pudo actualizar la lista: "+(error.message||error))}
}
async function cargaExtra(){
  LIQ={};PEND=[];BAJ=[];CAMB=[];RECHAZOS_RUTA=[];RECHAZOS_RUTA_ERR="";
  if(!cargaFin()){DRV=[];PRV=[];return}const ids=R.map(x=>x.id);
  const [l,d,p,pe,bj,cm,re]=await Promise.all([
    ids.length&&veFin()?cargarLiquidaciones(ids):Promise.resolve([]),
    sb.from("drivers").select("id,nombre,codigo,rol,estatus,proveedor_id").order("nombre"),
    sb.from("proveedores").select("*").order("nombre"),
    sb.from("validaciones_pendientes").select("*,rutas(id_ruta,entregados,paquetes_asignados,drivers(nombre),cedis(nombre,cliente_id))").eq("estatus","pendiente").order("solicitado_en"),
    sb.from("bajas_solicitudes").select("*").order("solicitado_en",{ascending:false}).limit(50),
    sb.from("cambios_perfil").select("*").order("solicitado_en",{ascending:false}).limit(50),
    tab==="v"&&ids.length?sb.from("ruta_validacion_rechazos").select("ruta_id,motivo,rechazada_por_email,rechazada_en").is("restaurada_en",null).in("ruta_id",ids).order("rechazada_en",{ascending:false}):Promise.resolve({data:[],error:null})]);
  BAJ=bj.data||[];CAMB=cm.data||[];
  RECHAZOS_RUTA=re.data||[];RECHAZOS_RUTA_ERR=re.error?.message||"";
  PEND=(pe.data||[]).map(request=>{
    const route=request.rutas;
    if(route?.cedis)route.cedis.clientes={nombre:CLIENTES_NOMBRE[String(route.cedis.cliente_id)]||""};
    return request
  });
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
  DOCOPS=[];DOCOPSERR="";DOCDRIVERS=[];DOCDRIVERSERR="";
  try{DOCDRIVERS=await fetchPaged(()=>sb.from("drivers").select("id,nombre,codigo,rol,estatus,proveedor_id,proveedores!drivers_proveedor_id_fkey(nombre,tipo)").in("rol",["driver","flotillero"]).order("nombre").order("id"))}
  catch(error){DOCDRIVERSERR=error.message||String(error)}
  try{DOCOPS=await fetchPaged(()=>sb.from("driver_documents").select("*,drivers(nombre,codigo,rol)").order("creado_en",{ascending:false}))}
  catch(error){DOCOPSERR=error.message||String(error);return}
  const paths=DOCOPS.map(x=>x.storage_path).filter(Boolean);
  if(paths.length){
    const {data:urls,error:urlError}=await sb.storage.from("driver-documents").createSignedUrls(paths,3600);
    if(urlError){DOCOPSERR="No se pudieron abrir los archivos: "+urlError.message;return}
    DOCOPS=DOCOPS.map(x=>({...x,url:(urls||[]).find(y=>y.path===x.storage_path)?.signedUrl||null}));
  }
}
const DOC_OPS_TIPOS=[["seguro","Seguro del vehículo"],["licencia","Licencia de conducir"],["tarjeta","Tarjeta de circulación"],["ine","INE"],["domicilio","Comprobante de domicilio"],["constancia_fiscal","Constancia de situación fiscal"],["estado_cuenta","Estado de cuenta a su nombre"]];
const DOC_SIN_VIGENCIA=["domicilio","constancia_fiscal","estado_cuenta"];
const DOC_FLOTILLERO=["constancia_fiscal","estado_cuenta"];
const tiposExpediente=d=>DOC_OPS_TIPOS.filter(([k])=>d.rol==="flotillero"||!DOC_FLOTILLERO.includes(k));
function estadoDocumentoOps(estado){
  const clase=({aprobado:"approved",pendiente:"pending","en revisión":"pending",vencido:"expired",rechazado:"rejected"})[estado]||"missing";
  return `<span class="doc-status doc-status-${clase}">${esc(estado)}</span>`;
}
async function cargarDocumentosFinanzas(){
  DOCOPS=[];DOCOPSERR="";
  try{DOCOPS=await fetchPaged(()=>sb.rpc("listar_documentos_finanzas"))}
  catch(error){DOCOPSERR=error.message||String(error);return}
  const paths=DOCOPS.map(d=>d.storage_path).filter(Boolean);
  if(paths.length){
    const {data:urls,error}=await sb.storage.from("driver-documents").createSignedUrls(paths,3600);
    if(error){DOCOPSERR="No se pudieron abrir los archivos: "+error.message;return}
    DOCOPS=DOCOPS.map(d=>({...d,url:(urls||[]).find(x=>x.path===d.storage_path)?.signedUrl||null}));
    if(DOCOPS.some(d=>d.storage_path&&!d.url))DOCOPSERR="No se pudieron abrir uno o más archivos. Vuelve a intentarlo.";
  }
}
function vistaDocumentosOps(){
  if(ROL==="finanzas"){
    const rows=DOCOPS.map(d=>`<tr><td>${esc(d.nombre)}<br><small>${esc(d.codigo||"")}</small></td><td>${esc(DOC_OPS_TIPOS.find(x=>x[0]===d.tipo)?.[1]||d.tipo)}</td><td>${estadoDocumentoOps(d.estado)}</td><td>${d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener">Ver archivo</a>`:"—"}</td></tr>`).join("");
    return `<div class="doc-page"><div class="doc-intro"><div><span class="doc-eyebrow">Consulta documental</span><h3>Documentos fiscales y bancarios</h3><p>Expedientes de flotilleros · Consulta únicamente. Operaciones autoriza los cambios.</p></div></div>${DOCOPSERR?`<div class="errbox">No se pudieron cargar los documentos: ${esc(DOCOPSERR)}</div>`:""}<section class="doc-section"><div class="doc-section-title"><div><h3>Documentos disponibles</h3><p>Consulta los archivos autorizados para tu perfil.</p></div><span class="doc-count">${DOCOPSERR?"Consulta con incidencias":`${DOCOPS.length} ${DOCOPS.length===1?"documento":"documentos"}`}</span></div><div class="doc-table-wrap" tabindex="0" role="region" aria-label="Documentos fiscales y bancarios"><table><thead><tr><th>Flotillero</th><th>Documento</th><th>Estado</th><th>Archivo</th></tr></thead><tbody>${rows||`<tr><td colspan="4">${DOCOPSERR?"Datos no disponibles por error de carga.":"Sin documentos visibles."}</td></tr>`}</tbody></table></div><p class="doc-scroll-hint">Desliza horizontalmente para ver toda la tabla.</p></section></div>`;
  }
  if(!esOps())return '<div class="errbox">Solo Operaciones puede importar o autorizar documentos.</div>';
  const all=DOCOPS.map(d=>`<tr><td>${esc(d.drivers?.nombre||d.driver_id)}<br><small>${esc(d.drivers?.codigo||"")}</small></td><td>${esc(DOC_OPS_TIPOS.find(x=>x[0]===d.tipo)?.[1]||d.tipo)}</td><td>${esc(d.origen==="flota"?"Importado de Flota":"Driver")}</td><td>${d.vigencia?esc(new Date(`${d.vigencia}T00:00:00`).toLocaleDateString("es-MX")):"Sin vencimiento"}</td><td>${estadoDocumentoOps(d.estado)}${d.nota?`<br><small>${esc(d.nota)}</small>`:""}</td><td><div class="doc-actions">${d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener">Ver archivo</a>`:"—"}${d.estado==="pendiente"?`<button class="btn sm" data-doc-approve="${esc(d.id)}">Aprobar</button><button class="btn ghost sm" data-doc-reject="${esc(d.id)}">Rechazar</button>`:""}</div></td></tr>`).join("");
  const expedientes=DOCDRIVERS.map(d=>{
    const docs=DOCOPS.filter(x=>x.driver_id===d.id),tipos=tiposExpediente(d);
    const estados=tipos.map(([k,n])=>{const pendiente=docs.some(x=>x.tipo===k&&x.estado==="pendiente"),aprobado=docs.find(x=>x.tipo===k&&x.estado==="aprobado"),estado=pendiente?"en revisión":aprobado?(aprobado.vigencia&&aprobado.vigencia<new Date().toLocaleDateString("en-CA")?"vencido":"aprobado"):"sin registrar";return `<div class="doc-document-line"><dt>${esc(n)}</dt><dd>${estadoDocumentoOps(estado)}</dd></div>`}).join("");
    const categoria=d.rol==="flotillero"?"Flotillero":d.proveedores?.tipo==="flotillero"?"Driver de flotillero":d.proveedores?.tipo==="independiente"?"Driver independiente":"Driver · categoría sin definir";
    return `<tr><td>${esc(d.nombre)}<br><small>${esc(d.codigo||"")}</small></td><td>${esc(categoria)}</td><td>${esc(d.proveedores?.nombre||"Sin proveedor")}</td><td>${esc(d.estatus||"—")}</td><td>${DOCOPSERR?"No disponible: error al cargar documentos":`<dl class="doc-status-list">${estados}</dl>`}</td></tr>`;
  }).join("");
  const missingTable=/Could not find the table ['"]public\.driver_documents['"] in the schema cache/i.test(DOCOPSERR);
  const loadError=DOCOPSERR?(missingTable
    ?'<div class="doc-error"><b>Aún no está configurado el expediente de documentos.</b>En Supabase, ejecuta el archivo <code>driver-documents-workflow.sql</code> completo y vuelve a cargar esta sección. Esto crea la tabla y sus permisos.</div>'
    :`<div class="errbox">No se pudieron cargar los documentos: ${esc(DOCOPSERR)}</div>`):"";
  return `<div class="doc-page">
  <div class="doc-intro"><div><span class="doc-eyebrow">Gestión documental</span><h3>Expedientes de drivers</h3><p>Consulta el estado de los documentos y administra las solicitudes de los afiliados.</p></div></div>
  <div class="doc-summary" aria-label="Resumen documental">
    <div class="doc-metric"><span>Afiliados</span><strong>${DOCDRIVERSERR?"—":DOCDRIVERS.length}</strong><small>Expedientes disponibles</small></div>
    <div class="doc-metric"><span>Documentos</span><strong>${DOCOPSERR?"—":DOCOPS.length}</strong><small>Registros en historial</small></div>
    <div class="doc-metric"><span>En revisión</span><strong>${DOCOPSERR?"—":DOCOPS.filter(d=>d.estado==="pendiente").length}</strong><small>Solicitudes pendientes</small></div>
  </div>
  <section class="doc-import">
    <div class="doc-import-head"><div><span class="doc-eyebrow">Carga administrativa</span><h3>Importar documentos de Flota</h3><p>Incorpora el archivo al expediente del afiliado. El documento se guarda aprobado en el almacenamiento privado.</p></div></div>
    <div class="doc-import-grid">
      <label class="doc-import-field">Afiliado<select id="doc-flota-driver"><option value="">Selecciona un afiliado…</option>${DOCDRIVERS.map(d=>`<option value="${esc(d.id)}">${esc(d.nombre)} · ${esc(d.codigo||"")}</option>`).join("")}</select></label>
      <label class="doc-import-field">Documento<select id="doc-flota-type">${DOC_OPS_TIPOS.map(([k,n])=>`<option value="${k}">${n}</option>`).join("")}</select></label>
      <label class="doc-import-field" id="doc-flota-date-label">Fecha de vencimiento<input id="doc-flota-date" type="date"></label>
      <label class="doc-import-field">Archivo de Flota<input id="doc-flota-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
    </div><div id="doc-flota-error"></div>
    <div class="doc-import-footer"><span class="note">PDF o imagen (JPEG, PNG, WebP), máximo 10 MB. Algunos documentos no requieren vencimiento.</span><button class="btn" id="doc-flota-save">Guardar documento aprobado</button></div>
  </section>
  <section class="doc-section"><div class="doc-section-title"><div><h3>Expedientes de afiliados</h3><p>Estado documental por persona y proveedor.</p></div><span class="doc-count">${DOCDRIVERSERR?"Consulta con incidencias":`${DOCDRIVERS.length} afiliados`}</span></div>${DOCDRIVERSERR?`<div class="errbox">No se pudieron cargar los afiliados: ${esc(DOCDRIVERSERR)}</div>`:""}
  <div class="doc-table-wrap" tabindex="0" role="region" aria-label="Expedientes de afiliados"><table><thead><tr><th>Afiliado</th><th>Categoría</th><th>Proveedor</th><th>Cuenta</th><th>Documentos</th></tr></thead><tbody>${expedientes||`<tr><td colspan="5">${DOCDRIVERSERR?"Datos no disponibles por error de carga.":"Sin afiliados disponibles."}</td></tr>`}</tbody></table></div><p class="doc-scroll-hint">Desliza horizontalmente para ver toda la tabla.</p></section>
  <section class="doc-section"><div class="doc-section-title"><div><h3>Solicitudes y documentos</h3><p>Historial de archivos y autorizaciones.</p></div><span class="doc-count">${DOCOPSERR?"Consulta con incidencias":`${DOCOPS.length} ${DOCOPS.length===1?"documento":"documentos"}`}</span></div>${loadError}
  <div class="doc-table-wrap" tabindex="0" role="region" aria-label="Solicitudes y documentos"><table><thead><tr><th>Driver</th><th>Documento</th><th>Origen</th><th>Vigencia</th><th>Estado</th><th>Archivo / autorización</th></tr></thead><tbody>${all||`<tr><td colspan="6">${DOCOPSERR?"Datos no disponibles por error de carga.":"Sin documentos registrados."}</td></tr>`}</tbody></table></div><p class="doc-scroll-hint">Desliza horizontalmente para ver toda la tabla.</p></section></div>`;
}
async function importarDocumentoFlota(){
  const errorBox=$("doc-flota-error"),button=$("doc-flota-save"),driverId=$("doc-flota-driver").value,tipo=$("doc-flota-type").value,vigencia=DOC_SIN_VIGENCIA.includes(tipo)?null:$("doc-flota-date").value,file=$("doc-flota-file").files[0];
  errorBox.innerHTML="";
  const driver=DOCDRIVERS.find(d=>d.id===driverId);
  if(!driver||!tiposExpediente(driver).some(([k])=>k===tipo)||(!DOC_SIN_VIGENCIA.includes(tipo)&&!vigencia)||!file){errorBox.innerHTML='<div class="errbox">Selecciona un afiliado, documento válido, archivo y fecha cuando corresponda.</div>';return}
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
  const rechazadas=RECHAZOS_RUTA.map(q=>{const x=R.find(r=>String(r.id)===String(q.ruta_id));if(!x)return "";return `<tr><td>${dd(x.checkin_at)}</td><td>${esc(x.drivers.nombre)}</td><td><b>${esc(x.cedis.clientes.nombre)}</b><br>${esc(x.cedis.nombre)}</td><td>${esc(x.id_ruta)}</td><td>${esc(q.motivo)}</td><td>${dd(q.rechazada_en)} · ${esc(q.rechazada_por_email||"—")}</td><td><button class="btn ghost sm" data-rechazo-restaurar="${esc(q.ruta_id)}">Restaurar</button></td></tr>`}).join("");
  return `${RECHAZOS_RUTA_ERR?`<div class="errbox">No se pudo consultar el historial de rechazos. Ejecuta <code>route-validation-rejection.sql</code> en Supabase y vuelve a cargar la sección. ${esc(RECHAZOS_RUTA_ERR)}</div>`:""}<table><tr><th>Fecha</th><th>Driver</th><th>Proveedor</th><th>Cliente · CEDIS</th><th>Ruta</th><th>Asig.</th><th>Entreg.</th><th>Efectiv.</th><th></th></tr>`+
  (l.map(x=>{const p=provDe(x.driver_id);return `<tr><td>${dd(x.checkin_at)}</td><td>${esc(x.drivers.nombre)}</td><td>${p?esc(p.nombre)+`<br><small>${esc(p.tipo_registro||"sin registro fiscal")}</small>`:'<span class="pill w">Sin proveedor</span>'}</td><td><b>${esc(x.cedis.clientes.nombre)}</b><br>${esc(x.cedis.nombre)}</td><td>${esc(x.id_ruta)}</td><td>${esc(x.paquetes_asignados)}</td><td>${esc(x.entregados)}</td><td>${pc(x.entregados/x.paquetes_asignados)}</td><td><button class="btn ghost sm" data-det="${esc(x.id)}">Detalle</button> <button class="btn sm" data-val="${esc(x.id)}">Validar</button></td></tr>`}).join("")||`<tr><td colspan="9">No hay rutas por validar en este periodo con clientes que tengan tarifas cargadas.</td></tr>`)+`</table>${rechazadas?`<h3 style="margin:16px 8px 0">Rutas rechazadas</h3><table><tr><th>Fecha</th><th>Driver</th><th>Cliente · CEDIS</th><th>Ruta</th><th>Motivo</th><th>Rechazada por</th><th></th></tr>${rechazadas}</table>`:""}`;
}
function abrirRetencionWalmart(){
  if(!WALMART_VALIDACION_ENABLED||ROL!=="ih"){toast("La consulta requiere un supervisor autorizado.");return}
  const m=$("modal");let revision=0;
  m.classList.remove("hide");
  m.innerHTML=`<div class="box"><h2>Retención Walmart por proveedor</h2>
    <label>Proveedor <select id="wm-ret-proveedor"><option value="">Selecciona proveedor</option>${PRV.map(p=>`<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join("")}</select></label>
    <div id="wm-ret-aviso"></div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="wm-ret-consultar">Consultar</button><button class="btn ghost" id="wm-ret-cerrar">Cerrar</button></div></div>`;
  const aviso=$("wm-ret-aviso"),selector=$("wm-ret-proveedor"),boton=$("wm-ret-consultar");
  selector.addEventListener("change",()=>{revision++;aviso.innerHTML=""});
  $("wm-ret-cerrar").onclick=()=>{revision++;m.classList.add("hide")};
  boton.onclick=async()=>{
    const proveedor=selector.value,version=++revision;
    aviso.innerHTML="";
    if(!proveedor){aviso.innerHTML='<div class="errbox">Selecciona un proveedor.</div>';return}
    boton.disabled=true;
    let result;
    try{result=await sb.rpc("walmart_consultar_retencion_proveedor",{p_proveedor_id:proveedor})}
    catch(error){boton.disabled=false;if(version===revision)aviso.innerHTML=`<div class="errbox">No se pudo consultar: ${esc(error.message||error)}</div>`;return}
    boton.disabled=false;
    if(version!==revision)return;
    if(result.error){aviso.innerHTML=`<div class="errbox">No se pudo consultar: ${esc(result.error.message)}</div>`;return}
    const data=result.data,plazo=data?.plazo,saldo=data?.saldo,bloqueos=data?.bloqueos;
    const camposBloqueos=["pnr_abiertos","pnr_saldo_pendiente","no_show_requiere_revision","ajustes_negativos_pendientes"];
    if(!plazo||!saldo||!bloqueos||bloqueos.cobertura_completa!==false
      ||camposBloqueos.some(k=>typeof bloqueos[k]!=="boolean")
      ||!["calculado","requiere_revision","sin_ruta_confirmada"].includes(plazo.estado)
      ||typeof plazo.plazo_cumplido!=="boolean"||saldo.saldo_total==null
      ||(plazo.plazo_cumplido&&(plazo.estado!=="calculado"||!plazo.disponible_desde))
      ||!Number.isFinite(Number(saldo.saldo_total))||Number(saldo.saldo_total)<0
      ||data.liberacion_validada!==false||data.reclamaciones_verificadas!==false){
      aviso.innerHTML='<div class="errbox">La consulta devolvió una respuesta inválida.</div>';return
    }
    const estado=plazo.estado==="requiere_revision"?"Requiere revisión de rutas":
      plazo.estado==="sin_ruta_confirmada"?"Sin ruta confirmada":plazo.plazo_cumplido?"Plazo cumplido":"Plazo aún no cumplido";
    const fecha=plazo.disponible_desde?new Date(plazo.disponible_desde):null;
    if(fecha&&Number.isNaN(fecha.getTime())){aviso.innerHTML='<div class="errbox">La fecha de retención no es válida.</div>';return}
    const hayBloqueos=camposBloqueos.some(k=>bloqueos[k]);
    const fechaPlazo=fecha&&plazo.estado==="calculado"
      ?`${plazo.plazo_cumplido?"Plazo cumplido":"El plazo vence"} ${esc(fecha.toLocaleString("es-MX",{timeZone:"America/Mexico_City"}))}`
      :"";
    aviso.innerHTML=`<div class="note"><b>${esc(estado)}</b> · saldo sin liberar: ${esc(fm(Number(saldo.saldo_total)))}${fechaPlazo?` · ${fechaPlazo}`:""}.
      ${hayBloqueos?"Hay reclamaciones o descuentos que requieren revisión.":"No se detectaron bloqueos en las fuentes revisadas."}
      Los PNR de drivers vinculados históricamente se revisan de forma conservadora, incluso si corresponden a otra cuenta.
      La revisión es parcial y no autoriza la liberación. Revisa también rutas pendientes de sincronización.</div>`;
  };
}
async function verDetalleRuta(id){
  let ru=R.find(x=>String(x.id)===String(id));
  if(!ru){
    const {data,error}=await sb.from("rutas").select("*,drivers(nombre,codigo),cedis(*),ruta_fallos(cantidad,causas_fallo(nombre)),ruta_incidencias(comentario,tipos_incidencia(nombre)),ruta_manifiestos(foto_path)").eq("id",id).maybeSingle();
    if(error){toast("No se pudo cargar el detalle de la ruta: "+error.message);return}
    ru=data;
    if(ru?.cedis)ru.cedis.clientes={nombre:CLIENTES_NOMBRE[String(ru.cedis.cliente_id)]||""}
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
    ${COPPEL_PEAK_ENABLED&&cuentaDe(ru.cedis?.clientes?.nombre)==="COPPEL"&&["ih","coordinador","ops","master"].includes(ROL)?'<div style="margin-top:14px"><button class="btn ghost" id="route-peak-week">Consultar semana COPPEL</button><div id="route-peak-result"></div></div>':""}
    <div style="margin-top:14px"><button class="btn ghost" id="route-detail-close">Cerrar</button></div>
  </div>`;
  if($("route-peak-week"))$("route-peak-week").onclick=()=>consultarSemanaCoppel(ru);
  $("route-detail-close").onclick=()=>modal.classList.add("hide");
}
function lunesCoppel(fecha){
  const partes=new Intl.DateTimeFormat("en-US",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(fecha));
  const valor=tipo=>Number(partes.find(p=>p.type===tipo).value);
  const dia=new Date(Date.UTC(valor("year"),valor("month")-1,valor("day")));
  dia.setUTCDate(dia.getUTCDate()-((dia.getUTCDay()+6)%7));
  return dia.toISOString().slice(0,10);
}
async function abrirSemanaCancelacionCoppel(id){
  const c=C.find(x=>String(x.id)===String(id));
  if(!c){toast("La cancelación ya no está disponible");return}
  const modal=$("modal");modal.classList.remove("hide");
  modal.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2>Semana COPPEL · cancelación</h2>
    <div>${esc(c.drivers?.nombre||"Driver")} · ${esc(c.cedis?.nombre||"CEDIS")}</div>
    <button class="btn ghost" id="route-peak-week">Consultar semana</button><div id="route-peak-result"></div>
    <button class="btn ghost" id="coppel-cancel-close">Cerrar</button></div>`;
  $("route-peak-week").onclick=()=>consultarSemanaCoppel({driver_id:c.driver_id,checkin_at:c.capturado_at});
  $("coppel-cancel-close").onclick=()=>modal.classList.add("hide");
  await consultarSemanaCoppel({driver_id:c.driver_id,checkin_at:c.capturado_at});
}
async function consultarSemanaCoppel(ru){
  const boton=$("route-peak-week"),resultado=$("route-peak-result");
  if(!ru.driver_id||!ru.checkin_at||Number.isNaN(new Date(ru.checkin_at).getTime())){
    resultado.innerHTML='<div class="errbox">La ruta no tiene driver o fecha válidos para consultar la semana.</div>';return;
  }
  boton.disabled=true;
  const {data,error}=await sb.rpc("coppel_peak_consultar_precierre",{p_driver_id:ru.driver_id,p_lunes:lunesCoppel(ru.checkin_at)});
  boton.disabled=false;
  if(error){resultado.innerHTML=`<div class="errbox">No se pudo consultar la semana: ${esc(error.message)}</div>`;return}
  if(data?.estado==="requiere_revision"){
    resultado.innerHTML=`<div class="errbox">${esc(data.mensaje)}. Revisa tus rutas en el módulo de rutas.</div>${ROL==="ih"?'<button class="btn" id="route-peak-request">Solicitar revisión</button><div id="route-peak-request-result"></div>':""}`;
    if(ROL==="ih")$("route-peak-request").onclick=async()=>{
      const solicitud=$("route-peak-request"),aviso=$("route-peak-request-result");
      solicitud.disabled=true;
      const r=await sb.rpc("coppel_peak_solicitar_revision",{p_driver_id:ru.driver_id,p_lunes:lunesCoppel(ru.checkin_at)});
      if(r.error){solicitud.disabled=false;aviso.innerHTML=`<div class="errbox">No se pudo solicitar la revisión: ${esc(r.error.message)}</div>`;return}
      aviso.textContent="Solicitud registrada. Se avisó a coordinación autorizada o a Operaciones.";
    };
    return;
  }
  mostrarPrecierreCoppel(resultado,ru.driver_id,lunesCoppel(ru.checkin_at),data);
}
function resumenSemanaCoppel(r,cerrada=false){
  return `<h3>Revisión semanal COPPEL · ${esc(r.lunes)}</h3>
    <div class="note">${cerrada?"Esta semana ya fue cerrada. Los bonos potenciales muestran lo revisado al cierre.":"Revisa todas las cifras; cerrar la semana confirma la decisión de asistencia y registra los bonos correspondientes como pagos pendientes."}</div>
    <div>Días registrados: ${esc((r.dias_asistencia||[]).join(", ")||"Ninguno")}</div>
    <div>Días faltantes de lunes a sábado: ${esc((r.dias_faltantes||[]).join(", ")||"Ninguno")}</div>
    <div>NO SHOW activo: ${r.hubo_no_show?"Sí":"No"}</div>
    <div>Rutas locales Peak validadas: ${esc((r.rutas_validadas||[]).length)}</div>
    <div>Bono de asistencia potencial: ${esc(fm(r.bono_asistencia_potencial))}${r.asistencia_requiere_revision?" · requiere revisar proveedor o registro fiscal":""}</div>
    <div>Bono dominical potencial: ${esc(fm(r.bono_domingo_base))}${r.domingo_requiere_revision?" · requiere revisar proveedor o registro fiscal":""}</div>`;
}
async function cargarPostvalCoppel(destino,driverId,lunes,detalle,cerrada){
  destino.innerHTML='<div class="note">Cargando post valorizaciones…</div>';
  let respuesta;
  try{respuesta=await sb.rpc("coppel_postval_listar",{p_driver_id:driverId,p_lunes:lunes})}
  catch(error){destino.innerHTML=`<div class="errbox">No se pudieron consultar las post valorizaciones: ${esc(error.message||error)}</div>`;return}
  if(destino.isConnected===false)return;
  if(respuesta.error||!Array.isArray(respuesta.data)){
    destino.innerHTML=`<div class="errbox">No se pudieron consultar las post valorizaciones: ${esc(respuesta.error?.message||"respuesta inválida")}</div>`;return;
  }
  const conceptos=respuesta.data,ids=[...new Set(detalle.rutas.concat(detalle.cancelaciones)
    .map(x=>x.proveedor_id).filter(x=>x!=null).map(String))];
  destino.innerHTML=`<h3>Post valorizaciones</h3>
    <div class="note">Los conceptos requieren aprobación de coordinación y aún no se aplican a pagos.</div>
    <ul>${conceptos.map((c,i)=>`<li>${esc(c.tipo)} · ${esc(fm(c.monto_base))} base · ${esc(c.descripcion)} · ${esc(c.estado)}${c.motivo_rechazo?` · Motivo: ${esc(c.motivo_rechazo)}`:""}
      ${!cerrada&&ROL==="coordinador"&&c.estado==="pendiente"?`<button class="btn ghost sm" id="coppel-postval-aprobar-${i}">Aprobar</button> <button class="btn ghost sm" id="coppel-postval-rechazar-${i}">Rechazar</button>`:""}
      <button class="btn ghost sm" id="coppel-postval-pnr-${i}">Revisar PNR</button><div id="coppel-postval-pnr-aviso-${i}"></div></li>`).join("")||"<li>Sin conceptos.</li>"}</ul>
    ${!cerrada&&ROL==="ih"?`<label>Proveedor <select id="coppel-postval-proveedor"><option value="">Selecciona proveedor</option>${ids.map(id=>`<option value="${esc(id)}">${esc(PRV.find(p=>String(p.id)===id)?.nombre||"Proveedor "+id)}</option>`).join("")}</select></label>
      <label>Tipo <select id="coppel-postval-tipo"><option value="">Selecciona tipo</option><option value="abono">Abono</option><option value="descuento">Descuento</option></select></label>
      <label>Importe antes de impuestos <input id="coppel-postval-base" type="number" min="0.01" step="0.01"></label>
      <label>Descripción <input id="coppel-postval-descripcion" maxlength="1000"></label>
      <button class="btn" id="coppel-postval-enviar">Enviar a coordinación</button>`:""}
    <div id="coppel-postval-aviso"></div>`;
  conceptos.forEach((c,i)=>{
    $(`coppel-postval-pnr-${i}`).onclick=async()=>{
      const boton=$(`coppel-postval-pnr-${i}`),aviso=$(`coppel-postval-pnr-aviso-${i}`);
      boton.disabled=true;
      let r;
      try{r=await sb.rpc("coppel_postval_resumen_pnr",{p_id:c.id})}
      catch(error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">No se pudieron consultar los PNR: ${esc(error.message||error)}</div>`;return}
      boton.disabled=false;
      if(r.error){aviso.innerHTML=`<div class="errbox">No se pudieron consultar los PNR: ${esc(r.error.message)}</div>`;return}
      if(!r.data||r.data.alcance!=="actividad_confirmada"||r.data.requiere_revision_fuentes!==true
        ||r.data.saldo_pendiente==null||!Number.isFinite(Number(r.data.saldo_pendiente))||Number(r.data.saldo_pendiente)<0
        ||r.data.reclamos_pendientes==null||!Number.isInteger(Number(r.data.reclamos_pendientes))||Number(r.data.reclamos_pendientes)<0){
        aviso.innerHTML='<div class="errbox">La consulta de PNR devolvió una respuesta inválida.</div>';return;
      }
      aviso.innerHTML=`<div class="note">PNR pendientes de actividad confirmada: ${esc(r.data.reclamos_pendientes)} · saldo ${esc(fm(r.data.saldo_pendiente))}. Es un dato parcial: falta revisar todas las fuentes de actividad. No se ha aplicado ningún descuento.</div>`;
    };
  });
  if(!cerrada&&ROL==="coordinador")conceptos.forEach((c,i)=>{
    if(c.estado!=="pendiente")return;
    $(`coppel-postval-aprobar-${i}`).onclick=async()=>{
      const boton=$(`coppel-postval-aprobar-${i}`),aviso=$("coppel-postval-aviso");
      boton.disabled=true;
      let r;
      try{r=await sb.rpc("coppel_postval_aprobar",{p_id:c.id})}
      catch(error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">${esc(error.message||error)}</div>`;return}
      if(r.error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">${esc(r.error.message)}</div>`;return}
      await cargarPostvalCoppel(destino,driverId,lunes,detalle,cerrada);
    };
    $(`coppel-postval-rechazar-${i}`).onclick=async()=>{
      const motivo=prompt("Motivo del rechazo (mínimo 5 caracteres)");
      if(motivo===null)return;
      const boton=$(`coppel-postval-rechazar-${i}`),aviso=$("coppel-postval-aviso");
      if(motivo.trim().length<5||motivo.trim().length>1000){
        aviso.innerHTML='<div class="errbox">Indica un motivo de entre 5 y 1000 caracteres.</div>';return;
      }
      boton.disabled=true;
      let r;
      try{r=await sb.rpc("coppel_postval_rechazar",{p_id:c.id,p_motivo:motivo.trim()})}
      catch(error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">${esc(error.message||error)}</div>`;return}
      if(r.error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">${esc(r.error.message)}</div>`;return}
      await cargarPostvalCoppel(destino,driverId,lunes,detalle,cerrada);
    };
  });
  if(!cerrada&&ROL==="ih"){
    let solicitudId=null;
    $("coppel-postval-enviar").onclick=async()=>{
      const proveedor=$("coppel-postval-proveedor").value,tipo=$("coppel-postval-tipo").value;
      const base=$("coppel-postval-base").value.trim(),descripcion=$("coppel-postval-descripcion").value.trim();
      const boton=$("coppel-postval-enviar"),aviso=$("coppel-postval-aviso");
      if(!proveedor||!["abono","descuento"].includes(tipo)||!/^\d{1,10}(\.\d{1,2})?$/.test(base)
        ||Number(base)<=0||descripcion.length<5){
        aviso.innerHTML='<div class="errbox">Indica proveedor, tipo, importe y descripción válidos.</div>';return;
      }
      if(!globalThis.crypto?.randomUUID){aviso.innerHTML='<div class="errbox">Este dispositivo no puede generar una solicitud segura.</div>';return}
      solicitudId||=globalThis.crypto.randomUUID();boton.disabled=true;
      let r;
      try{r=await sb.rpc("coppel_postval_proponer",{p_id:solicitudId,p_driver_id:driverId,p_lunes:lunes,
        p_proveedor_id:proveedor,p_tipo:tipo,p_monto_base:base,p_descripcion:descripcion})}
      catch(error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">${esc(error.message||error)}</div>`;return}
      if(r.error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">${esc(r.error.message)}</div>`;return}
      await cargarPostvalCoppel(destino,driverId,lunes,detalle,cerrada);
    };
  }
}
function mostrarPrecierreCoppel(resultado,driverId,lunes,data){
  const cerrada=data?.estado==="cerrada",detalle=cerrada?data.precierre:data;
  if((data?.estado!=="completo"&&!cerrada)||!detalle?.resumen
    ||!Array.isArray(detalle.rutas)||!Array.isArray(detalle.cancelaciones)||!Array.isArray(detalle.no_shows)){
    resultado.innerHTML='<div class="errbox">La consulta devolvió una respuesta de precierre inválida.</div>';return;
  }
  const rutas=detalle.rutas.map(r=>`<tr><td>${esc(r.fecha)}</td><td>${esc(r.ruta_id)}</td><td>${esc(r.cedis_id)}</td><td>${esc(fm(r.pago_base))}</td><td>${esc(fm(r.descuento))}</td><td>${esc(fm(r.bono_efectividad))}</td><td>${esc(fm(r.pago))}</td><td>${esc(r.pago_estatus||"Sin pago")}</td></tr>`).join("");
  const proveedores=PRV.map(p=>`<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join("");
  const cancelaciones=detalle.cancelaciones.map((c,i)=>`<li>Cancelación ${esc(c.cancelacion_id)} · ${esc(c.fecha)} · CEDIS ${esc(c.cedis_id)} · base ${esc(fm(c.base))}${c.pnr_aplicado!=null?` · PNR aplicado ${esc(fm(c.pnr_aplicado))}`:""} · pago ${esc(fm(c.pago))}
    ${!cerrada&&c.base==null?`<div><label>Importe base <input id="coppel-cancel-base-${i}" type="number" min="0" step="0.01"></label>
      <label>Confirma el proveedor <select id="coppel-cancel-proveedor-${i}"><option value="">Selecciona proveedor</option>${proveedores}</select></label>
      <button class="btn sm" id="coppel-cancel-guardar-${i}">Registrar cancelación</button><div id="coppel-cancel-aviso-${i}"></div></div>`:""}</li>`).join("");
  const noShows=detalle.no_shows.map(n=>`<li>NO SHOW ${esc(n.caso_id)} · ${esc(n.fecha)} · ${esc(n.estado)} · penalización ${esc(fm(n.penalizacion))} · reversión ${esc(fm(n.reversion))}</li>`).join("");
  resultado.innerHTML=`${resumenSemanaCoppel(detalle.resumen,cerrada)}
    <h3>Rutas de la semana</h3><table><tr><th>Fecha</th><th>Ruta</th><th>CEDIS</th><th>Base</th><th>Descuento</th><th>Bono</th><th>Pago</th><th>Estado</th></tr>${rutas||'<tr><td colspan="8">Sin rutas.</td></tr>'}</table>
    <h3>Cancelaciones aprobadas</h3><ul>${cancelaciones||"<li>Sin cancelaciones.</li>"}</ul>
    <h3>NO SHOW</h3><ul>${noShows||"<li>Sin NO SHOW.</li>"}</ul>
    ${typeof COPPEL_POSTVAL_ENABLED!=="undefined"&&COPPEL_POSTVAL_ENABLED&&["ih","coordinador"].includes(ROL)?'<div id="coppel-postval"></div>':""}
    ${cerrada?'<div class="note">Semana cerrada. Estos importes son el registro histórico revisado.</div>':
      `<label>Decisión del bono de asistencia <select id="coppel-asistencia"><option value="">Selecciona una decisión</option><option value="si">Aplicar bono</option><option value="no">No aplicar bono</option></select></label>
      <button class="btn" id="coppel-cerrar">Cerrar semana revisada</button><div id="coppel-cierre-result"></div>`}`;
  if(typeof COPPEL_POSTVAL_ENABLED!=="undefined"&&COPPEL_POSTVAL_ENABLED&&["ih","coordinador"].includes(ROL))
    void cargarPostvalCoppel($("coppel-postval"),driverId,lunes,detalle,cerrada);
  if(cerrada){
    const ids=[...new Set(detalle.rutas.concat(detalle.cancelaciones).map(x=>x.proveedor_id).filter(x=>x!=null).map(String))];
    if(!ids.length||ROL!=="ih")return;
    resultado.innerHTML+=`<h3>Retroactivo manual</h3>
      <div class="note">Revisa la actividad posterior al cierre en tus CEDIS. El importe final se suma o resta en la semana elegida; no modifica la semana cerrada ni confirma una transferencia.</div>
      <div id="coppel-retro-posibles">Buscando actividad posterior al cierre...</div>
      <div id="coppel-retro-registrados">Cargando retroactivos registrados...</div>
      <label>Proveedor de la semana <select id="coppel-ajuste-proveedor"><option value="">Selecciona proveedor</option>${ids.map(id=>`<option value="${esc(id)}">${esc(PRV.find(p=>String(p.id)===id)?.nombre||"Proveedor "+id)}</option>`).join("")}</select></label>
      <label>Tipo <select id="coppel-ajuste-tipo"><option value="">Selecciona tipo</option><option value="descuento">Descuento</option><option value="abono">Abono</option></select></label>
      <label>Importe final <input id="coppel-ajuste-base" type="number" min="0.01" step="0.01"></label>
      <label>Semana destino (lunes) <input id="coppel-ajuste-semana" type="date"></label>
      <label>Motivo <input id="coppel-ajuste-motivo" maxlength="1000"></label>
      <button class="btn" id="coppel-ajuste-proponer">Registrar retroactivo</button><div id="coppel-ajuste-aviso"></div>`;
    void (async()=>{
      const box=$("coppel-retro-posibles");
      try{
        const r=await sb.rpc("coppel_peak_posibles_retroactivos",{p_driver_id:driverId,p_lunes:lunes});
        if(r.error)throw r.error;
        if(!Array.isArray(r.data))throw new Error("Respuesta inválida");
        box.innerHTML=r.data.length?`<ul>${r.data.map(x=>`<li>${esc(x.tipo)} ${esc(x.id)} · CEDIS ${esc(x.cedis_id)}</li>`).join("")}</ul>`:
          '<div class="note">Sin actividad posterior detectada en tus CEDIS. También puedes registrar un importe revisado manualmente.</div>';
      }catch(error){box.innerHTML=`<div class="errbox">No se pudo revisar la actividad posterior: ${esc(error.message||error)}</div>`}
    })();
    void (async()=>{
      const box=$("coppel-retro-registrados");
      try{
        const r=await sb.rpc("coppel_peak_listar_ajustes_manuales",{p_driver_id:driverId,p_lunes:lunes});
        if(r.error)throw r.error;
        if(!Array.isArray(r.data))throw new Error("Respuesta inválida");
        box.innerHTML=r.data.length?`<h4>Retroactivos registrados</h4><ul>${r.data.map(x=>`<li>Semana ${esc(x.lunes_destino)} · ${esc(fm(x.monto))} · ${esc(x.motivo)}</li>`).join("")}</ul>`:
          '<div class="note">Sin retroactivos registrados para esta semana de origen.</div>';
      }catch(error){box.innerHTML=`<div class="errbox">No se pudieron consultar los retroactivos registrados: ${esc(error.message||error)}</div>`}
    })();
    let solicitudId=null;
    $("coppel-ajuste-proponer").onclick=async()=>{
      const proveedor=$("coppel-ajuste-proveedor").value,tipo=$("coppel-ajuste-tipo").value;
      const base=$("coppel-ajuste-base").value.trim(),motivo=$("coppel-ajuste-motivo").value.trim(),semana=$("coppel-ajuste-semana").value;
      const aviso=$("coppel-ajuste-aviso"),boton=$("coppel-ajuste-proponer");
      if(!proveedor||!["descuento","abono"].includes(tipo)||!/^\d{1,10}(\.\d{1,2})?$/.test(base)||Number(base)<=0||motivo.length<5||!/^\d{4}-\d{2}-\d{2}$/.test(semana)){
        aviso.innerHTML='<div class="errbox">Selecciona proveedor, tipo y semana, e indica importe y motivo válidos.</div>';return}
      if(!globalThis.crypto?.randomUUID){aviso.innerHTML='<div class="errbox">Este dispositivo no puede generar una solicitud segura.</div>';return}
      if(!confirm("¿Registrar este importe final en la semana seleccionada? No confirma una transferencia de dinero."))return;
      solicitudId||=globalThis.crypto.randomUUID();boton.disabled=true;
      let registro;
      try{registro=await sb.rpc("coppel_peak_registrar_ajuste_manual",{p_id:solicitudId,p_driver_id:driverId,p_lunes_origen:lunes,
        p_proveedor_id:proveedor,p_lunes_destino:semana,p_monto:tipo==="descuento"?"-"+base:base,p_motivo:motivo})}
      catch(error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">No se pudo registrar: ${esc(error.message||error)}. Puedes reintentar.</div>`;return}
      if(registro.error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">No se pudo registrar: ${esc(registro.error.message)}</div>`;return}
      aviso.textContent="Retroactivo registrado en la semana seleccionada. No confirma una transferencia.";
    };
    return;
  }
  detalle.cancelaciones.forEach((c,i)=>{
    if(c.base!=null)return;
    $(`coppel-cancel-guardar-${i}`).onclick=async()=>{
      const base=$(`coppel-cancel-base-${i}`).value.trim(),proveedor=$(`coppel-cancel-proveedor-${i}`).value;
      const aviso=$(`coppel-cancel-aviso-${i}`),boton=$(`coppel-cancel-guardar-${i}`);
      if(!/^\d{1,10}(\.\d{1,2})?$/.test(base)||!proveedor){
        aviso.innerHTML='<div class="errbox">Indica un importe base válido y confirma el proveedor.</div>';return}
      if(!confirm("¿Registrar esta cancelación con el importe y proveedor seleccionados? Se aplicarán los PNR pendientes del driver antes de crear el pago."))return;
      boton.disabled=true;
      const registro=await sb.rpc("coppel_peak_registrar_cancelacion",{p_cancelacion_id:c.cancelacion_id,p_base:base,p_proveedor_confirmado:proveedor});
      if(registro.error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">No se pudo registrar: ${esc(registro.error.message)}</div>`;return}
      const actual=await sb.rpc("coppel_peak_consultar_precierre",{p_driver_id:driverId,p_lunes:lunes});
      if(actual.error){aviso.innerHTML=`<div class="errbox">Cancelación registrada, pero no se pudo actualizar el precierre: ${esc(actual.error.message)}</div>`;return}
      mostrarPrecierreCoppel(resultado,driverId,lunes,actual.data);
    };
  });
  $("coppel-cerrar").onclick=async()=>{
    const seleccion=$("coppel-asistencia").value,aviso=$("coppel-cierre-result"),boton=$("coppel-cerrar");
    if(!["si","no"].includes(seleccion)){aviso.innerHTML='<div class="errbox">Selecciona la decisión de asistencia antes de cerrar.</div>';return}
    if(!confirm("¿Cerrar esta semana COPPEL con la decisión seleccionada? El cierre conservará los importes revisados."))return;
    boton.disabled=true;
    const cerrado=await sb.rpc("coppel_peak_cerrar_semana",{p_driver_id:driverId,p_lunes:lunes,p_aplicar_asistencia:seleccion==="si",p_precierre_esperado:detalle});
    if(cerrado.error){boton.disabled=false;aviso.innerHTML=`<div class="errbox">No se pudo cerrar la semana: ${esc(cerrado.error.message)}</div>`;return}
    const actual=await sb.rpc("coppel_peak_consultar_precierre",{p_driver_id:driverId,p_lunes:lunes});
    if(actual.error){aviso.innerHTML=`<div class="errbox">Semana cerrada, pero no se pudo volver a consultar: ${esc(actual.error.message)}</div>`;return}
    mostrarPrecierreCoppel(resultado,driverId,lunes,actual.data);
  };
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
  const pendientes=Math.max(0,resumen.asignados-resumen.entregados-resumen.fallidos);
  const efectividad=resumen.asignados?resumen.entregados/resumen.asignados:0;
  const ventas=rows.reduce((s,x)=>s+(Number(x.liq.venta_total)||0),0);
  const utilidad=rows.reduce((s,x)=>s+(Number(x.liq.utilidad)||0),0);
  const pagos=rows.reduce((s,x)=>s+(Number(x.liq.pago_driver)||0),0);
  const chartPeriods=trends.slice(-8);
  const chartBar=(label,value,max,color)=>`<div class="exec-bar-row"><span class="exec-bar-label">${label}</span><div class="exec-track"><div class="exec-fill" style="--chart-color:${color};width:${Number(value)>0?Math.max(1,Math.min(100,Number(value)/max*100)):0}%"></div></div><b class="exec-bar-value">${esc(Number(value).toLocaleString("es-MX"))}</b></div>`;
  const chartCard=(title,description,series,commonScale=false)=>{
    const sharedMax=Math.max(1,...chartPeriods.flatMap(period=>series.map(item=>Number(period[item.key])||0)));
    return `<section class="exec-chart"><h4>${title}</h4><p>${description}</p><div class="exec-legend">${series.map(x=>`<span><i style="--chart-color:${x.color}"></i>${x.label}</span>`).join("")}</div><div class="exec-bars">${chartPeriods.length?chartPeriods.map(period=>`<div class="exec-period"><div class="exec-period-title">${esc(period.label)}</div>${series.map(item=>chartBar(item.label,period[item.key],commonScale?sharedMax:Math.max(1,...chartPeriods.map(row=>Number(row[item.key])||0)),item.color)).join("")}</div>`).join(""):'<div class="exec-empty">No hay datos para graficar en el periodo seleccionado.</div>'}</div></section>`;
  };
  const volumeChart=chartCard("Volumen operativo",`Rutas y paquetes asignados por ${analyticsGrain==="dia"?"día":analyticsGrain==="semana"?"semana":analyticsGrain==="mes"?"mes":"año"}. Se muestran los últimos ${Math.min(8,trends.length)} periodos.`,[
    {key:"rutas",label:"Rutas",color:"#6b4df5"},{key:"asignados",label:"Paquetes",color:"#27a879"}
  ]);
  const deliveryChart=`<section class="exec-chart"><h4>Resultado de entregas</h4><p>Distribución de los paquetes asignados en el rango consultado.</p>
    ${resumen.asignados?`<div class="exec-stack" role="img" aria-label="${resumen.entregados} entregados, ${resumen.fallidos} fallidos, ${pendientes} pendientes">
      <span style="width:${resumen.entregados/resumen.asignados*100}%;background:#20a779"></span><span style="width:${resumen.fallidos/resumen.asignados*100}%;background:#e15b62"></span><span style="width:${pendientes/resumen.asignados*100}%;background:#dce2ec"></span>
    </div><div class="exec-mix">
      <div class="exec-mix-row"><span><i style="color:#20a779">●</i> Entregados</span><b>${resumen.entregados.toLocaleString("es-MX")} · ${pc(efectividad)}</b></div>
      <div class="exec-mix-row"><span><i style="color:#e15b62">●</i> Fallidos</span><b>${resumen.fallidos.toLocaleString("es-MX")} · ${pc(resumen.fallidos/resumen.asignados)}</b></div>
      <div class="exec-mix-row"><span><i style="color:#9aa6b8">●</i> Pendientes / diferencia</span><b>${pendientes.toLocaleString("es-MX")} · ${pc(pendientes/resumen.asignados)}</b></div>
    </div>`:'<div class="exec-empty">No hay paquetes asignados en el periodo.</div>'}
  </section>`;
  const financeChart=veFin()?chartCard("Resumen financiero",`Importes validados por ${analyticsGrain==="dia"?"día":analyticsGrain==="semana"?"semana":analyticsGrain==="mes"?"mes":"año"} · últimos ${Math.min(8,trends.length)} periodos.`,[
    {key:"ventas",label:"Venta",color:"#6b4df5"},{key:"pagos",label:"Pago",color:"#27a879"},{key:"utilidad",label:"Utilidad",color:"#f0a52b"}
  ],true):"";
  const stats=(label,value,detail="")=>`<div class="exec-stat"><small>${label}</small><b>${value}</b>${detail?`<span>${detail}</span>`:""}</div>`;
  const numericSummary=`<section class="exec-summary">${stats("Rutas",resumen.rutas,"en el periodo")}${stats("Efectividad",pc(efectividad),"entregados sobre asignados")}${stats("Incidencias",R.reduce((s,x)=>s+(x.ruta_incidencias||[]).length,0),"reportadas en ruta")}${stats("Cancelaciones por revisar",C.filter(x=>x.ubicacion_validada==="fuera"||x.ubicacion_validada==="sin_ubicacion").length,"requieren atención")}${veFin()?stats("Venta validada",fm(ventas),"liquidaciones del periodo")+stats("Utilidad",fm(utilidad),"liquidaciones del periodo"):""}</section>`;
  const tableTitle=`Indicadores por ${analyticsGrain==="dia"?"día":analyticsGrain==="semana"?"semana":analyticsGrain==="mes"?"mes":"año"}`;
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h3>Indicadores del negocio</h3>${selectorPeriodo("analytics-period",analyticsGrain)}</div>
    ${numericSummary}<div class="exec-charts">${volumeChart}${deliveryChart}${financeChart}</div>
    <div class="exec-table-title"><h3>${tableTitle}</h3><span class="note">Detalle numérico completo</span></div><div class="exec-table-wrap">${tablaResumen(trends,veFin())}</div>`;
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
  if(x.estatus==="aprobada")return h+(WALMART_VALIDACION_ENABLED&&ROL==="ih"&&String(x.cedis?.clientes?.nombre||"").trim().toUpperCase()==="WALMART"
    ?`<br><button class="btn ghost sm" data-wm-cancelacion="${esc(x.id)}">Revisar pago Walmart</button>`:"");
  if(!["master","ops","coordinador","ih"].includes(ROL))return h;
  const approvals=x.ubicacion_validada==="dentro"?`<br><small>Supervisor ${x.aprob_supervisor?"✓":"pendiente"} · Coordinador ${x.aprob_coord?"✓":"pendiente"}</small>`:"";
  return h+approvals+`<br><button class="btn sm" data-rev="${esc(x.id)}">Revisar</button>`}
async function cargaEventos(){CEV={};EVP={};if(!C.length)return;const ids=C.map(x=>x.id);const r=await sb.from("cancelacion_eventos").select("*").in("cancelacion_id",ids).order("creado_en");
  (r.data||[]).forEach(e=>(CEV[e.cancelacion_id]=CEV[e.cancelacion_id]||[]).push(e));
  const ps=(r.data||[]).map(e=>e.foto_path).filter(Boolean);if(ps.length){const s=await sb.storage.from("cancelaciones").createSignedUrls(ps,3600);(s.data||[]).forEach(x=>EVP[x.path]=x.signedUrl)}}
const EVL={rechazo:"Chazki rechazó",aclaracion:"Chazki pidió aclaración",aprobacion:"Chazki aprobó",respuesta:"El driver respondió",apelacion:"El driver apeló"};
function revisarCan(id){const x=C.find(y=>y.id===id);if(!x)return;const m=$("modal");m.classList.remove("hide");
  const aprobacionDoble=x.ubicacion_validada==="dentro";
  const puedeAprobar=!aprobacionDoble||["ih","coordinador"].includes(ROL);
  const walmart=String(x.cedis.clientes.nombre||"").trim().toUpperCase()==="WALMART";
  const estadoAprobacion=aprobacionDoble?`<div class="note">Aprobación dentro del CEDIS: Supervisor ${x.aprob_supervisor?"✓ autorizó":"pendiente"} · Coordinador ${x.aprob_coord?"✓ autorizó":"pendiente"}. Se requieren ambos.</div>`:"";
  const hist=(CEV[id]||[]).map(e=>`<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${esc(EVL[e.tipo]||e.tipo)}</b> <small>${dd(e.creado_en)} ${hh(e.creado_en)}</small><br>${esc(e.texto||"")}${e.foto_path&&EVP[e.foto_path]?`<br><a href="${EVP[e.foto_path]}" target="_blank" rel="noopener"><img src="${EVP[e.foto_path]}" style="max-width:160px;border-radius:8px;margin-top:4px"></a>`:""}</div>`).join("")||'<small>Sin movimientos.</small>';
  m.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2 style="margin:0 0 4px">Cancelación · ${esc(x.drivers.nombre)}</h2><div style="color:var(--mut);font-size:13px">${esc(x.cedis.clientes.nombre)} · ${esc(x.cedis.nombre)} · ${dd(x.capturado_at)} ${hh(x.capturado_at)}${esc(x.id_ruta?" · Ruta "+x.id_ruta:"")}</div>
   <div style="margin-top:8px">${estPill(x)}</div>${estadoAprobacion}
   ${photos[x.foto_path]?`<img src="${photos[x.foto_path]}" style="max-width:100%;max-height:220px;border-radius:10px;margin-top:8px">`:""}
   ${walmart?(x.foto_bitacora_path?(photos[x.foto_bitacora_path]?`<h3>Bitácora de cancelación</h3><img src="${esc(photos[x.foto_bitacora_path])}" alt="Bitácora de cancelación Walmart" style="max-width:100%;max-height:220px;border-radius:10px;margin-top:8px">`:'<div class="errbox">No se pudo cargar la foto de la bitácora.</div>'):'<div class="errbox">Falta la foto de la bitácora; requiere revisión antes de generar el pago Walmart.</div>'):""}
   <h3 style="margin:12px 0 4px">Historial</h3>${hist}
   <label>Mensaje para el driver (obligatorio al rechazar o pedir aclaración)</label><textarea id="rv-t" rows="3"></textarea>
   <div class="note">Al rechazar o pedir aclaración, el driver recibe un aviso y tiene 12 horas para apelar o responder. Pasado ese plazo la decisión queda firme.</div><div id="rv-e"></div>
   <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${puedeAprobar?'<button class="btn" data-rva="aprobar">Aprobar</button>':""}<button class="btn ghost" data-rva="aclarar">Pedir aclaración</button><button class="btn ghost" data-rva="rechazar" style="color:#b42318">Rechazar</button><button class="btn ghost" id="rv-x">Cerrar</button></div></div>`;
  $("rv-x").onclick=()=>m.classList.add("hide");
  m.querySelectorAll("[data-rva]").forEach(b=>b.onclick=async()=>{const a=b.dataset.rva,t=$("rv-t").value.trim();if(a!=="aprobar"&&!t){$("rv-e").innerHTML='<div class="errbox">Escribe el mensaje para el driver</div>';return}
    m.querySelectorAll("[data-rva]").forEach(z=>z.disabled=true);const {data,error}=await sb.rpc("resolver_cancelacion_asignada",{p_id:id,p_accion:a,p_texto:t||null});
    if(error){$("rv-e").innerHTML=`<div class="errbox">${esc(error.message)}</div>`;m.querySelectorAll("[data-rva]").forEach(z=>z.disabled=false);return}
    m.classList.add("hide");await load();
    toast(data==="pendiente_coordinador"?"Aprobación registrada; falta el coordinador asignado":data==="pendiente_supervisor"?"Aprobación registrada; falta el supervisor asignado":a==="aprobar"?"Cancelación aprobada":a==="rechazar"?"Rechazada · el driver tiene 12 h para apelar":"Aclaración solicitada · el driver tiene 12 h")})}
async function abrirPagoCancelacionWalmart(id){
  const c=C.find(x=>String(x.id)===String(id));
  if(!c||ROL!=="ih"){toast("Cancelación Walmart asignada requerida.");return}
  const m=$("modal"),salida=photos[c.foto_path],bitacora=photos[c.foto_bitacora_path];
  let calculo=null,revision=0;
  m.classList.remove("hide");
  m.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2>Pago de cancelación Walmart</h2>
    <div>${esc(c.drivers.nombre)} · ${esc(c.cedis.nombre)} · ${esc(dd(c.capturado_at))}</div>
    ${salida?`<h3>Foto de salida</h3><img src="${esc(salida)}" alt="Foto de salida" style="max-width:100%;max-height:200px">`:'<div class="errbox">No se pudo revisar la foto de salida.</div>'}
    ${bitacora?`<h3>Bitácora</h3><img src="${esc(bitacora)}" alt="Bitácora de cancelación" style="max-width:100%;max-height:200px">`:'<div class="errbox">No se pudo revisar la foto de bitácora.</div>'}
    <label>Confirma el proveedor</label><select id="wm-can-proveedor"><option value="">Selecciona proveedor</option>${PRV.filter(p=>p.activo!==false).map(p=>`<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join("")}</select>
    <label>Confirma la unidad</label><select id="wm-can-unidad"><option value="">Selecciona unidad</option><option value="3.5T">3.5T</option><option value="Large">Large / 1.5 TN</option></select>
    <fieldset><legend>Retención Walmart (selecciona una)</legend>
      ${[0,10,15,25].map(n=>`<label><input id="wm-can-ret-${n}" type="radio" name="wm-can-ret" ${n===0?"checked":""}> ${n===0?"Sin retención":n+"%"}</label>`).join("")}</fieldset>
    <div id="wm-can-pago-aviso"></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn ghost" id="wm-can-calcular">Calcular 40%</button><button class="btn" id="wm-can-confirmar" disabled>Generar pago</button><button class="btn ghost" id="wm-can-cerrar">Cerrar</button></div></div>`;
  const inputs=()=>({p_cancelacion_id:c.id,p_proveedor_id:$("wm-can-proveedor").value,
    p_unidad:$("wm-can-unidad").value,p_porcentaje_retencion:[0,10,15,25].find(n=>$(`wm-can-ret-${n}`).checked)??null});
  const invalidar=()=>{revision++;calculo=null;$("wm-can-confirmar").disabled=true;$("wm-can-pago-aviso").innerHTML=""};
  ["wm-can-proveedor","wm-can-unidad",...[0,10,15,25].map(n=>`wm-can-ret-${n}`)].forEach(x=>$(x).addEventListener("change",invalidar));
  $("wm-can-cerrar").onclick=()=>{invalidar();m.classList.add("hide")};
  $("wm-can-calcular").onclick=async()=>{
    invalidar();
    const args=inputs(),version=revision,boton=$("wm-can-calcular"),aviso=$("wm-can-pago-aviso");
    if(!salida||!bitacora){aviso.innerHTML='<div class="errbox">Revisa ambas fotos antes de calcular el pago.</div>';return}
    if(!args.p_proveedor_id||!args.p_unidad||args.p_porcentaje_retencion==null){aviso.innerHTML='<div class="errbox">Confirma proveedor, unidad y retención.</div>';return}
    boton.disabled=true;
    let r;
    try{r=await sb.rpc("walmart_previsualizar_cancelacion_porcentaje",args)}
    catch(error){boton.disabled=false;if(version===revision)aviso.innerHTML=`<div class="errbox">No se pudo calcular: ${esc(error.message||error)}</div>`;return}
    boton.disabled=false;
    if(version!==revision)return;
    if(r.error){aviso.innerHTML=`<div class="errbox">No se pudo calcular: ${esc(r.error.message)}</div>`;return}
    if(!r.data||Number(r.data.porcentaje_retencion)!==args.p_porcentaje_retencion
      ||["base_servicio","pago_base","total","pago_semanal","saldo_retenido"].some(k=>r.data[k]==null||!Number.isFinite(Number(r.data[k])))){
      aviso.innerHTML='<div class="errbox">El cálculo devolvió una respuesta inválida.</div>';return;
    }
    calculo=r.data;
    aviso.innerHTML=`<div class="note">Base de servicio ${esc(fm(calculo.base_servicio))} · cancelación 40% ${esc(fm(calculo.pago_base))} · total fiscalizado ${esc(fm(calculo.total))} · semanal antes de PNR y NO SHOW ${esc(fm(calculo.pago_semanal))} · retenido ${esc(fm(calculo.saldo_retenido))}.</div>`;
    $("wm-can-confirmar").disabled=false;
  };
  $("wm-can-confirmar").onclick=async()=>{
    if(!calculo)return;
    const args=inputs(),boton=$("wm-can-confirmar"),aviso=$("wm-can-pago-aviso");
    const controls=["wm-can-proveedor","wm-can-unidad",...[0,10,15,25].map(n=>`wm-can-ret-${n}`),"wm-can-calcular","wm-can-cerrar"].map($);
    boton.disabled=true;controls.forEach(control=>control.disabled=true);
    let r;
    try{r=await sb.rpc("walmart_validar_cancelacion",{p_cancelacion_id:args.p_cancelacion_id,
      p_proveedor_id:args.p_proveedor_id,p_unidad:args.p_unidad,
      p_aplicar_retencion:args.p_porcentaje_retencion>0,p_calculo_esperado:calculo})}
    catch(error){boton.disabled=false;controls.forEach(control=>control.disabled=false);aviso.innerHTML=`<div class="errbox">No se pudo confirmar el pago: ${esc(error.message||error)}. Puedes reintentar.</div>`;return}
    if(r.error){boton.disabled=false;controls.forEach(control=>control.disabled=false);aviso.innerHTML=`<div class="errbox">No se pudo generar el pago: ${esc(r.error.message)}</div>`;return}
    m.classList.add("hide");await cargaExtra();render();toast("Pago de cancelación Walmart registrado");
  };
}
let NOT=[];
async function loadNotifs(){
  if(!NOTIF_UID)return;
  const {data,error}=await sb.from("notificaciones").select("*").eq("usuario",NOTIF_UID).order("creada_en",{ascending:false}).limit(30);
  if(error){toast("No se pudieron cargar los avisos: "+error.message);return}
  NOT=data||[];drawBell()
}
function drawBell(){const n=NOT.filter(x=>!x.leida_en).length;$("bellc").textContent=n>9?"9+":n;$("bellc").classList.toggle("hide",!n)}
function abrirAvisos(){const m=$("modal");m.classList.remove("hide");const f=x=>new Date(x).toLocaleString("es-MX",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
  const perm=("Notification" in window&&Notification.permission==="default")?'<button class="btn ghost sm" id="nt-perm">Activar avisos del navegador</button>':"";
  m.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2 style="margin:0 0 8px">🔔 Avisos</h2>${perm}${NOT.length?NOT.map(n=>`<div class="item" data-nt="${esc(n.id)}" style="display:block;padding:10px;border-bottom:1px solid var(--line);cursor:pointer;${n.leida_en?"opacity:.6":"background:#f3f0ff"}"><b>${esc(n.titulo)}</b>${n.cuerpo?`<br><small>${esc(n.cuerpo)}</small>`:""}<br><small style="color:var(--mut)">${f(n.creada_en)}</small></div>`).join(""):"<small>Sin avisos.</small>"}<div style="margin-top:12px"><button class="btn ghost" id="nt-x">Cerrar</button></div></div>`;
  $("nt-x").onclick=()=>m.classList.add("hide");const pr=$("nt-perm");if(pr)pr.onclick=async()=>{await Notification.requestPermission();abrirAvisos()};
  const ir={cancelacion:"c",cancelacion_nueva:"c",cambio_perfil:"k",baja:"b",validacion:"a",ruta_registrada:"r",configuracion_operativa:"h",coppel_peak_revision:"a"};
  m.querySelectorAll("[data-nt]").forEach(el=>el.onclick=()=>{const n=NOT.find(x=>x.id==el.dataset.nt);m.classList.add("hide");const t=n&&ir[n.tipo]||n&&ir[n.ref_tipo];const b=t&&document.querySelector(`.role-nav button[data-t="${t}"]`);if(b)b.click()});
  sb.rpc("marcar_notificaciones_leidas",{p_ids:null}).then(()=>{NOT.forEach(n=>n.leida_en=n.leida_en||new Date().toISOString());drawBell()})}
$("bell").onclick=abrirAvisos;
function suscribirAvisos(uid){NOTIF_UID=uid;loadNotifs();setInterval(loadNotifs,60000);
  sb.channel("avisos-"+uid).on("postgres_changes",{event:"INSERT",schema:"public",table:"notificaciones",filter:"usuario=eq."+uid},p=>{NOT.unshift(p.new);drawBell();toast("🔔 "+p.new.titulo);
    if("Notification" in window&&Notification.permission==="granted")try{new Notification(p.new.titulo,{body:p.new.cuerpo||""})}catch(e){}
    if((p.new.tipo||"").startsWith("cancelacion"))load()}).subscribe()}
setInterval(()=>{if(tab==="c")render()},30000);
const CAMPOS={nombre:"Nombre",telefono:"Teléfono",correo_contacto:"Correo de contacto",emergencia_nombre:"Contacto de emergencia",emergencia_telefono:"Teléfono de emergencia",emergencia_parentesco:"Parentesco",placas:"Placas",tipo:"Categoría tarifaria",tipo_detalle:"Tipo de vehículo",marca_modelo:"Marca / modelo",licencia_numero:"Número de licencia",licencia_tipo:"Tipo de licencia",licencia_vigencia:"Vigencia de licencia"};
function vistaCambios(){
  const f=CAMB.map(q=>{const d=DRV.find(y=>y.id===q.driver_id);
    const det=Object.entries(q.datos).map(([k,v])=>`${esc(CAMPOS[k]||k)}: <s style="color:#888">${esc((q.anterior&&q.anterior[k])||"—")}</s> → <b>${esc(v)}</b>`).join("<br>");
    return `<tr><td>${esc(d?d.nombre:q.driver_id)}<br><small>${dd(q.solicitado_en)}</small></td><td>${det}</td><td>${q.estatus==="pendiente"?"<span class='pill w'>Pendiente</span>":q.estatus==="aprobada"?"<span class='pill ok'>Aprobada</span>":"<span class='pill bad'>Rechazada</span>"}</td><td>${q.estatus==="pendiente"&&esOps()?`<button class="btn sm" data-cpa="${esc(q.id)}">Aprobar</button> <button class="btn ghost sm" data-cpr="${esc(q.id)}">Rechazar</button>`:""}</td></tr>`}).join("");
  return `<h3 style="margin:12px 8px 0">Cambios de perfil solicitados</h3><small style="padding:0 8px">Los cambios a datos existentes requieren aprobación de Operaciones o master.</small><table><tr><th>Driver</th><th>Cambio solicitado</th><th>Estatus</th><th></th></tr>${f||'<tr><td colspan="4">Sin solicitudes.</td></tr>'}</table>`}
async function resolverCambio(id,ok){const {error}=await sb.rpc("resolver_cambio_perfil",{p_id:id,p_aprobar:ok,p_nota:null});
  if(error){toast(error.message);return}await cargaExtra();render();toast(ok?"Cambio aprobado y aplicado":"Cambio rechazado")}
async function verManif(id){const ru=R.find(x=>x.id===id);const paths=ru.ruta_manifiestos.map(x=>x.foto_path);
  const s=await sb.storage.from("manifiestos").createSignedUrls(paths,3600);const m=$("modal");m.classList.remove("hide");
  m.innerHTML=`<div class="box"><h2 style="margin:0 0 8px">Manifiestos · Ruta ${esc(ru.id_ruta)}</h2><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${(s.data||[]).map(x=>`<a href="${esc(x.signedUrl)}" target="_blank" rel="noopener"><img src="${esc(x.signedUrl)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px"></a>`).join("")}</div><div style="margin-top:12px"><button class="btn ghost" id="mf-x">Cerrar</button></div></div>`;$("mf-x").onclick=()=>m.classList.add("hide")}
let TF=null,TFERR="",TFL={cuenta:"",q:"",veh:"",esq:"",act:true};
async function cargaTF(renderizar=true){
  TFERR="";
  const [t,g]=await Promise.all([
    sb.from("tarifas").select("*").order("cuenta").order("ubicacion").order("tipo_unidad").limit(2000),
    sb.from("reglas_penalizacion").select("*").order("cuenta").order("aplica_a").order("prioridad")
  ]);
  if(t.error||g.error){TFERR=(t.error||g.error).message;toast("No se pudo cargar el tarifario: "+TFERR);return}
  TFERR="";TF=t.data||[];RGL=g.data||[];if(renderizar)render()
}
async function cargarCambiosTarifario(renderizar=true){
  CAMBIOS_TARIFARIO=[];CAMBIOS_TARIFARIO_ERR="";
  if(ROL!=="master"){CAMBIOS_TARIFARIO_ERR="Solo la cuenta maestra puede consultar esta sección.";if(renderizar)render();return}
  const [pending,recent]=await Promise.all([
    sb.from("cambios_tarifario_solicitudes").select("*").eq("estado","pendiente").order("solicitada_en",{ascending:true}),
    sb.from("cambios_tarifario_solicitudes").select("*").neq("estado","pendiente").order("solicitada_en",{ascending:false}).limit(50)
  ]);
  if(pending.error||recent.error)CAMBIOS_TARIFARIO_ERR=(pending.error||recent.error).message;
  else CAMBIOS_TARIFARIO=[...(pending.data||[]),...(recent.data||[])];
  if(renderizar)render()
}
function parseCsvTable(text){
  const sample=text.slice(0,8192);let quoted=false,commas=0,semicolons=0;
  for(let i=0;i<sample.length;i++){
    const c=sample[i];
    if(c==='"'&&quoted&&sample[i+1]==='"'){i++;continue}
    if(c==='"'){quoted=!quoted;continue}
    if(!quoted){if(c===",")commas++;if(c===";")semicolons++;if(c==="\n")break}
  }
  const delimiter=semicolons>commas?";":",",rows=[];let row=[],cell="",inside=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'&&inside&&text[i+1]==='"'){cell+='"';i++;continue}
    if(c==='"'){inside=!inside;continue}
    if(!inside&&c===delimiter){row.push(cell);cell="";continue}
    if(!inside&&(c==="\n"||c==="\r")){
      if(c==="\r"&&text[i+1]==="\n")i++;
      row.push(cell);if(row.some(value=>value.trim()))rows.push(row);
      row=[];cell="";continue
    }
    cell+=c
  }
  row.push(cell);if(row.some(value=>value.trim()))rows.push(row);
  if(inside)throw new Error("El CSV contiene una comilla sin cerrar.");
  if(rows.length<2)throw new Error("El archivo no contiene filas de datos.");
  const headers=rows[0].map(value=>value.trim().replace(/^\uFEFF/,"").toUpperCase());
  const column=(startsWith)=>headers.findIndex(value=>value.startsWith(startsWith)&&!/(CORREO|EMAIL|MAIL|CONTACTO)/.test(value));
  const emailColumn=(role)=>headers.findIndex(value=>/(CORREO|EMAIL|MAIL)/.test(value)&&value.includes(role)&&!(value.includes("SUPERVISOR")&&value.includes("COORDINADOR")));
  const indexes={CLIENTE:column("CLIENTE"),CEDIS:column("CEDIS"),"CORREO SUPERVISOR":emailColumn("SUPERVISOR"),"CORREO COORDINADOR":emailColumn("COORDINADOR")};
  const missing=Object.entries(indexes).filter(([,index])=>index<0).map(([name])=>name);
  if(missing.length)throw new Error("Faltan columnas requeridas: "+missing.join(", ")+". Agrega una columna con el correo de cada supervisor y otra con el de cada coordinador.");
  const data=rows.slice(1).map(row=>Object.fromEntries(Object.entries(indexes).map(([key,index])=>[key,(row[index]||"").trim()])))
    .filter(row=>Object.values(row).some(Boolean));
  if(!data.length)throw new Error("El archivo no contiene asignaciones.");
  return data
}
const normTxt=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
let ASG_FORM=null,ASG_FILTRO="";
const buscarPorNombre=(lista,texto)=>{const n=normTxt(texto);if(!n)return null;return lista.find(x=>normTxt(x.nombre)===n)||lista.find(x=>normTxt(x.nombre).includes(n)||n.includes(normTxt(x.nombre)))||null};
function abrirFormAsignacion(row){
  const clientes=Object.entries(CLIENTES_NOMBRE).map(([id,nombre])=>({id,nombre}));
  const cliente=buscarPorNombre(clientes,row.cliente);
  const cedisCliente=Object.values(EQ_CEDIS).filter(c=>cliente&&String(c.cliente_id)===cliente.id);
  const cedis=buscarPorNombre(cedisCliente,row.cedis);
  ASG_FORM={
    cliente_id:cliente?.id||(row.cliente_id!=null?String(row.cliente_id):""),
    cedis_id:cedis?String(cedis.id):(row.cedis_id!=null?String(row.cedis_id):""),
    supervisor_id:row.supervisor_id||EQ_PERSONAS.find(p=>p.rol==="ih"&&p.email===normTxt(row.supervisor))?.id||"",
    coordinador_id:row.coordinador_id||EQ_PERSONAS.find(p=>p.rol==="coordinador"&&p.email===normTxt(row.coordinador))?.id||"",
    origen:row.cliente?`Fila del CSV: ${row.cliente} · ${row.cedis} · ${row.supervisor} · ${row.coordinador}`:""
  };
  render()
}
function leerFormAsignacion(){
  if(!ASG_FORM)return;
  ASG_FORM.cliente_id=$("asg-cli")?.value||"";
  ASG_FORM.cedis_id=$("asg-ced")?.value||"";
  ASG_FORM.supervisor_id=$("asg-sup")?.value||"";
  ASG_FORM.coordinador_id=$("asg-coo")?.value||""
}
function formAsignacion(){
  if(!ASG_FORM)return "";
  const f=ASG_FORM,sel=(a,b)=>String(a)===String(b)?"selected":"";
  const clientes=Object.entries(CLIENTES_NOMBRE).sort((a,b)=>a[1].localeCompare(b[1]));
  const cedis=Object.values(EQ_CEDIS).filter(c=>String(c.cliente_id)===String(f.cliente_id)).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const personas=rol=>EQ_PERSONAS.filter(d=>d.rol===rol).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const field=(label,id,options)=>`<label class="doc-import-field">${label}<select id="${id}">${options}</select></label>`;
  return `<div class="team-manual-assignment"><div class="doc-section-title"><div><h3>Ajuste manual de responsables</h3><p>${f.origen?esc(f.origen):"Define la pareja de responsables para un cliente y CEDIS."}</p></div></div>
   <div class="team-manual-grid">
    ${field("Cliente","asg-cli",`<option value="">Selecciona un cliente…</option>${clientes.map(([id,n])=>`<option value="${esc(id)}" ${sel(f.cliente_id,id)}>${esc(n)}</option>`).join("")}`)}
    ${field("CEDIS","asg-ced",`<option value="">Selecciona un CEDIS…</option>${cedis.map(c=>`<option value="${esc(c.id)}" ${sel(f.cedis_id,c.id)}>${esc(c.nombre)}</option>`).join("")}`)}
    ${field("Supervisor","asg-sup",`<option value="">Selecciona un supervisor…</option>${personas("ih").map(d=>`<option value="${esc(d.id)}" ${sel(f.supervisor_id,d.id)}>${esc(d.nombre)} — ${esc(d.email)}</option>`).join("")}`)}
    ${field("Coordinador","asg-coo",`<option value="">Selecciona un coordinador…</option>${personas("coordinador").map(d=>`<option value="${esc(d.id)}" ${sel(f.coordinador_id,d.id)}>${esc(d.nombre)} — ${esc(d.email)}</option>`).join("")}`)}
   </div><div class="team-detail-actions"><button class="btn" id="asg-save">Guardar asignación</button><button class="btn ghost" id="asg-cancel">Cancelar</button></div><div id="asg-msg"></div></div>`
}
function tablaAsignaciones(){
  const q=normTxt(ASG_FILTRO),nombre=id=>personaTxt(id);
  const filas=EQ_ASIG.map(a=>({...a,cliente:CLIENTES_NOMBRE[String(a.cliente_id)]||"Sin cliente",cedis:EQ_CEDIS[String(a.cedis_id)]?.nombre||"CEDIS "+a.cedis_id,sup:nombre(a.supervisor_id),coo:nombre(a.coordinador_id)}))
    .filter(a=>!q||normTxt([a.cliente,a.cedis,a.sup,a.coo].join(" ")).includes(q))
    .sort((a,b)=>a.cliente.localeCompare(b.cliente)||a.cedis.localeCompare(b.cedis));
  const rows=filas.slice(0,200).map(a=>`<tr><td>${esc(a.cliente)}</td><td>${esc(a.cedis)}</td><td>${esc(a.sup)}</td><td>${esc(a.coo)}</td><td><button class="btn ghost sm" data-asg-edit="${esc(a.cliente_id)}|${esc(a.cedis_id)}">Editar</button> <button class="btn ghost sm" data-asg-del="${esc(a.cliente_id)}|${esc(a.cedis_id)}">Quitar</button></td></tr>`).join("");
  return `<section class="doc-section team-assignments"><div class="doc-section-title"><div><h3>Asignaciones actuales</h3><p>Responsables por cliente y CEDIS.</p></div><span class="doc-count">${EQ_ASIG.length} ${EQ_ASIG.length===1?"asignación":"asignaciones"}</span></div>
   ${EQ_ERR?`<div class="errbox" role="alert">No se pudieron cargar las asignaciones operativas: ${esc(EQ_ERR)}</div>`:""}
   <div class="team-assignment-actions"><label class="doc-import-field team-search">Buscar asignación<input id="asg-q" placeholder="Cliente, CEDIS o responsable" value="${esc(ASG_FILTRO)}"></label><button class="btn" id="asg-new">Agregar asignación</button></div>
   <div class="doc-table-wrap team-table-wrap team-assign-table" tabindex="0" role="region" aria-label="Asignaciones de responsables"><table><thead><tr><th>Cliente</th><th>CEDIS</th><th>Supervisor</th><th>Coordinador</th><th>Acciones</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Sin asignaciones.</td></tr>'}</tbody></table></div>${filas.length>200?`<p class="note">Se muestran 200 de ${filas.length}. Usa el buscador para acotar.</p>`:""}</section>`
}
async function guardarAsignacionManual(){
  leerFormAsignacion();const f=ASG_FORM,box=$("asg-msg");
  if(!f.cliente_id||!f.cedis_id||!f.supervisor_id||!f.coordinador_id){box.innerHTML='<div class="errbox">Completa cliente, CEDIS, supervisor y coordinador.</div>';return}
  $("asg-save").disabled=true;
  const {error}=await sb.rpc("guardar_asignacion_operativa",{p_cliente_id:Number(f.cliente_id),p_cedis_id:Number(f.cedis_id),p_supervisor_id:f.supervisor_id,p_coordinador_id:f.coordinador_id});
  if(error){$("asg-save").disabled=false;box.innerHTML=`<div class="errbox">${esc(error.message)}${/function|schema cache/i.test(error.message)?" — ejecuta operational-assignments-manual-adjustments.sql en Supabase.":""}</div>`;return}
  const pendiente=f.origen;ASG_FORM=null;
  if(pendiente&&CSV_ASIGNACIONES_RESULT?.errores){CSV_ASIGNACIONES_RESULT={...CSV_ASIGNACIONES_RESULT,errores:CSV_ASIGNACIONES_RESULT.errores.filter(e=>`Fila del CSV: ${e.cliente} · ${e.cedis} · ${e.supervisor} · ${e.coordinador}`!==pendiente)}}
  await cargarAsignacionesEquipo();render();toast("Asignación guardada")
}
async function quitarAsignacion(clave){
  const [cli,ced]=clave.split("|");
  if(!confirm("¿Quitar esta asignación? Las notificaciones de ese CEDIS irán a la cuenta maestra hasta asignar nuevos responsables."))return;
  const {error}=await sb.rpc("eliminar_asignacion_operativa",{p_cliente_id:Number(cli),p_cedis_id:Number(ced)});
  if(error){toast(error.message);return}
  await cargarAsignacionesEquipo();render();toast("Asignación eliminada")
}
function vistaImportarResponsables(){
  const result=CSV_ASIGNACIONES_RESULT;
  const errorRows=result?.errores||[];
  const errorTable=errorRows.length?`<div class="doc-table-wrap team-table-wrap team-error-table" tabindex="0" role="region" aria-label="Filas de importación que requieren corrección"><table><thead><tr><th>Fila CSV</th><th>Cliente</th><th>CEDIS</th><th>Correo supervisor</th><th>Correo coordinador</th><th>Resolución</th><th>Acción</th></tr></thead><tbody>${errorRows.slice(0,100).map((row,i)=>`<tr><td>${esc(row.fila??"—")}</td><td>${esc(row.cliente)}</td><td>${esc(row.cedis)}</td><td>${esc(row.supervisor)}</td><td>${esc(row.coordinador)}</td><td>Cliente ${row.cliente_resuelto?"✓":"×"} · CEDIS ${row.cedis_resuelto?"✓":"×"} · Supervisor ${row.supervisor_resuelto?"✓":"×"} · Coordinador ${row.coordinador_resuelto?"✓":"×"}${row.motivo?`<br><small>${esc(row.motivo)}</small>`:""}</td><td><button class="btn sm" data-asg-fix="${i}">Corregir</button></td></tr>`).join("")}</tbody></table></div>${errorRows.length>100?`<p class="note">Se muestran 100 de ${errorRows.length} filas con problemas.</p>`:""}`:"";
  const resultHtml=result?`<div class="team-import-result"><p class="note">Asignaciones aplicadas: <b>${esc(result.importadas||0)}</b> · Filas para corregir: <b>${esc(errorRows.length)}</b></p>${errorTable}</div>`:"";
  return `<section class="doc-import team-import">
    <div class="doc-import-head"><span class="doc-eyebrow">Carga masiva</span><h3>Importar responsables por cliente y CEDIS</h3><p>El CSV usa Cliente, CEDIS, <b>CORREO SUPERVISOR</b> y <b>CORREO COORDINADOR</b> (un correo @chazki.com por columna). Cada fila se procesa por separado; los errores se muestran para corregirlos sin bloquear las demás asignaciones.</p></div>
    <div class="team-import-controls"><label class="doc-import-field">Archivo CSV<input id="asignaciones-csv" type="file" accept=".csv,text/csv"></label><button class="btn" id="asignaciones-import">Importar CSV</button></div>
    <div id="asignaciones-error"></div>${resultHtml}
    ${formAsignacion()}${tablaAsignaciones()}
  </section>`
}
function vistaCambiosTarifario(){
  if(ROL!=="master")return '<div class="errbox">Solo la cuenta maestra puede acceder.</div>';
  const rows=CAMBIOS_TARIFARIO.map(request=>`<tr><td>${dd(request.solicitada_en)}<br><small>${esc(String(request.solicitada_por).slice(0,8))}</small></td><td>${request.entidad==="tarifas"?"Tarifa":"Penalización / bono"}<br><small>${request.entidad_id==null?"Nueva solicitud":"Registro "+esc(request.entidad_id)}</small></td><td>${esc(request.estado)}</td><td><details><summary>Ver propuesta</summary><pre style="white-space:pre-wrap;max-width:520px;overflow:auto">${esc(JSON.stringify({anterior:request.datos_anteriores,nuevo:request.datos_nuevos},null,2))}</pre></details>${request.nota_resolucion?`<small>${esc(request.nota_resolucion)}</small>`:""}</td><td>${request.estado==="pendiente"?`<button class="btn sm" data-tar-ok="${esc(request.id)}">Aprobar</button> <button class="btn ghost sm" data-tar-no="${esc(request.id)}">Rechazar</button>`:""}</td></tr>`).join("");
  return `<section style="padding:12px"><h3>Cambios tarifarios pendientes y resueltos</h3>${CAMBIOS_TARIFARIO_ERR?`<div class="errbox">No se pudieron cargar las solicitudes: ${esc(CAMBIOS_TARIFARIO_ERR)}</div>`:""}<table><tr><th>Fecha / solicitante</th><th>Tipo</th><th>Estado</th><th>Detalle</th><th></th></tr>${rows||'<tr><td colspan="5">Sin solicitudes tarifarias.</td></tr>'}</table></section>`
}
async function importarAsignaciones(){
  const input=$("asignaciones-csv"),box=$("asignaciones-error"),button=$("asignaciones-import"),file=input.files&&input.files[0];
  box.innerHTML="";
  if(!file){box.innerHTML='<div class="errbox">Selecciona un archivo CSV.</div>';return}
  if(file.size>5*1024*1024){box.innerHTML='<div class="errbox">El archivo supera el límite de 5 MB.</div>';return}
  button.disabled=true;
  try{
    const filas=parseCsvTable(await file.text());
    if(filas.length>5000)throw new Error("El archivo supera el límite de 5,000 filas.");
    const {data,error}=await sb.rpc("importar_asignaciones_por_correo",{p_filas:filas});
    if(error)throw new Error(error.message+(/PGRST202|42883/.test(error.code||"")?" — Ejecuta operational-assignments-by-email.sql en Supabase para activar la importación independiente por correo.":""));
    if(!data||!Number.isInteger(data.importadas)||!Array.isArray(data.errores))throw new Error("La importación devolvió una respuesta inválida.");
    CSV_ASIGNACIONES_RESULT=data;await cargarAsignacionesEquipo();render();toast("Importación terminada. Revisa las filas que no tuvieron coincidencia única.")
  }catch(error){box.innerHTML=`<div class="errbox">${esc(error.message||"No se pudo importar el archivo.")}</div>`}
  finally{button.disabled=false}
}
async function resolverCambioTarifario(id,aprobar){
  const nota=aprobar?null:(prompt("Motivo del rechazo (opcional):")??null);
  if(nota===null&&!aprobar)return;
  const {error}=await sb.rpc("resolver_cambio_tarifario",{p_id:id,p_aprobar:aprobar,p_nota:nota});
  if(error){toast("No se pudo resolver el cambio: "+error.message);return}
  if(aprobar){TF=null;TAR=null}
  await cargarCambiosTarifario();toast(aprobar?"Cambio tarifario aprobado":"Cambio tarifario rechazado")
}
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
async function guardarRegla(row,cuenta,id){
  const anterior=id?RGL.find(rule=>String(rule.id)===String(id)):null;
  const base={...row,cuenta,descripcion:row.descripcion||autoDesc(row),por_confirmar:false,
    activo:row.activo??true};
  if(row.vigencia_desde||anterior?.vigencia_desde||!id)base.vigencia_desde=row.vigencia_desde||anterior?.vigencia_desde||new Date().toLocaleDateString("en-CA");
  if(ROL==="coordinador")return sb.rpc("solicitar_cambio_tarifario",{p_entidad:"reglas_penalizacion",p_entidad_id:id,p_datos:base});
  if(id)return sb.from("reglas_penalizacion").update(base).eq("id",id);
  return sb.from("reglas_penalizacion").insert(base)
}
function formRegla(id){const g=id?RGL.find(x=>x.id===id):null;const m=$("modal");m.classList.remove("hide");
  m.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2 style="margin:0 0 6px">${id?"Editar regla":"Nueva penalización o bono"}</h2>
   <label>Cliente</label><select id="rg-c" ${id?"disabled":""}><option value="">Elige…</option>${CUENTAS_TARIFARIO.map(c=>`<option ${g&&g.cuenta===c?"selected":""}>${c}</option>`).join("")}</select>
   ${reglaCampos("rg",g)}
   ${id?`<label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="rg-act" ${g.activo?"checked":""}> Regla activa</label>`:""}
   <div class="note">Una penalización o bono aplica a todas las tarifas del cliente que coincidan con el vehículo y el esquema. Si varias penalizaciones coinciden, se usa la de menor prioridad. Los bonos coincidentes se suman.</div>
   <div id="rg-err"></div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="rg-ok">Guardar</button><button class="btn ghost" id="rg-x">Cancelar</button></div></div>`;
  reglaHook("rg");$("rg-x").onclick=()=>m.classList.add("hide");
  $("rg-ok").onclick=async()=>{const bad=t=>{$("rg-err").innerHTML=`<div class="errbox">${esc(t)}</div>`};let row;try{row=leerRegla("rg")}catch(e){return bad(e.message)}
    const cuenta=id?g.cuenta:$("rg-c").value;if(!cuenta)return bad("Elige el cliente");if(id)row.activo=$("rg-act").checked;
    $("rg-ok").disabled=true;const {error}=await guardarRegla(row,cuenta,id);if(error){$("rg-ok").disabled=false;return bad(error.message)}
    m.classList.add("hide");toast(ROL==="coordinador"?"Solicitud de cambio enviada a la cuenta maestra":id?"Regla actualizada":"Regla agregada");if(ROL!=="coordinador")cargaTF()}}
let RGF={cuenta:"",tipo:""};
function vistaReglas(){
  const ed=esCoord(),sty='style="padding:8px;border:1px solid var(--line);border-radius:10px"';
  const L=(RGL||[]).filter(g=>(!RGF.cuenta||g.cuenta===RGF.cuenta)&&(!RGF.tipo||(RGF.tipo==="bono"?esBono(g.tipo_regla):!esBono(g.tipo_regla))));
  const rows=L.map(g=>`<tr><td><b>${esc(g.cuenta)}</b></td><td>${esBono(g.tipo_regla)?'<span class="pill ok">Bono</span>':g.tipo_regla==="bandera"?'<span class="pill w">Bandera</span>':'<span class="pill bad">Penalización</span>'}<br><small>${esc(TIPO_R[g.tipo_regla]||g.tipo_regla)}</small></td><td>${g.aplica_a==="cobro"?"Cobro":"Pago"}</td><td>${esc(g.tipo_unidad||"Todos")}</td><td>${esc(g.esquema||"Todos")}</td><td>${esc(condR(g))}</td><td style="text-align:right"><b>${esc(valR(g))}</b></td><td><small>${esc(g.descripcion)}</small>${g.excepcion_validacion_supervisor?' <span class="pill w">Exonerable</span>':""}${g.por_confirmar?' <span class="pill w">Por confirmar</span>':""}</td><td>${g.activo?"":'<span class="pill bad">Inactiva</span>'}</td>${ed?`<td><button class="btn ghost sm" data-re="${esc(g.id)}">Editar</button></td>`:""}</tr>`).join("");
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px;align-items:center"><select id="rg-fc" ${sty}><option value="">Todos los clientes</option>${CUENTAS_TARIFARIO.map(c=>`<option ${RGF.cuenta===c?"selected":""}>${c}</option>`).join("")}</select><select id="rg-ft" ${sty}><option value="">Penalizaciones y bonos</option><option value="pen" ${RGF.tipo==="pen"?"selected":""}>Solo penalizaciones</option><option value="bono" ${RGF.tipo==="bono"?"selected":""}>Solo bonos</option></select>${ed?'<button class="btn" id="rg-n">+ Nueva regla</button>':""}</div>
   <div style="padding:0 8px 6px"><small>${ROL==="coordinador"?"Puedes proponer cambios; la cuenta maestra debe aprobarlos.":ed?"Puedes agregar y editar. Los cambios aplican a rutas que se validen de ahora en adelante y quedan en bitácora.":"Solo consulta."}</small></div>
   <table><tr><th>Cliente</th><th>Tipo</th><th>Aplica a</th><th>Vehículo</th><th>Esquema</th><th>Condición</th><th>Valor</th><th>Descripción</th><th></th>${ed?"<th></th>":""}</tr>${rows||'<tr><td colspan="10">Sin reglas.</td></tr>'}</table>`}

const uniq=(k)=>[...new Set((TF||[]).map(x=>x[k]).filter(Boolean))].sort();
const subTF=()=>`<div class="tabs" style="padding:8px 8px 0"><button class="${TFV==="t"?"on":""}" data-tfv="t">Tarifas</button><button class="${TFV==="r"?"on":""}" data-tfv="r">Penalizaciones y bonos</button></div>`;
function vistaTarifario(){
  if(TFERR)return `<div class="errbox">No se pudo cargar el tarifario. ${esc(TFERR)}</div>`;
  if(!TF){cargaTF();return '<div style="padding:16px">Cargando tarifario…</div>'}
  if(TFV==="r")return subTF()+vistaReglas();
  const L=TF.filter(x=>(!TFL.cuenta||x.cuenta===TFL.cuenta)&&(!TFL.veh||x.tipo_unidad===TFL.veh)&&(!TFL.esq||x.esquema===TFL.esq)&&(!TFL.act||x.activo)&&(!TFL.q||[x.ubicacion,x.ciudad,x.zona,x.variable,x.conc].join(" ").toUpperCase().includes(TFL.q.toUpperCase())));
  const op=(arr,v)=>`<option value="">Todos</option>`+arr.map(a=>`<option ${a===v?"selected":""}>${esc(a)}</option>`).join("");
  const sty='style="padding:8px;border:1px solid var(--line);border-radius:10px"';
  const ed=esCoord();
  const f=`<div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px;align-items:center"><select id="tf-c" ${sty}>${op(CUENTAS_TARIFARIO,TFL.cuenta).replace("Todos","Todos los clientes")}</select><input id="tf-q" placeholder="Buscar ubicación, zona…" value="${esc(TFL.q)}" ${sty}><select id="tf-v" ${sty}>${op(uniq("tipo_unidad"),TFL.veh).replace("Todos","Todos los vehículos")}</select><select id="tf-e" ${sty}>${op(uniq("esquema"),TFL.esq).replace("Todos","Todos los esquemas")}</select><label style="font-size:13px"><input type="checkbox" id="tf-a" ${TFL.act?"checked":""}> Solo activas</label>${ed?'<button class="btn" id="tf-n">+ Nueva tarifa</button>':""}</div>`;
  const rows=L.slice(0,300).map(x=>`<tr><td><b>${esc(x.cuenta)}</b>${x.cliente&&x.cliente!==x.cuenta?`<br><small>${esc(x.cliente)}</small>`:""}</td><td>${esc(x.ubicacion||"—")}${x.ciudad?`<br><small>${esc(x.ciudad)}</small>`:""}</td><td>${esc(x.zona||"—")}${x.variable?` <span class="pill w">${esc(x.variable)}</span>`:""}</td><td>${esc(x.tipo_unidad||"—")}</td><td>${esc(x.esquema||"—")}</td><td style="text-align:right"><b>${x.pago_base==null?"—":fm(x.pago_base)}</b></td><td style="text-align:right"><b>${x.tarifa_cliente==null?"—":fm(x.tarifa_cliente)}</b></td><td><small>${esc(x.vigencia_desde)}${x.vigencia_hasta?" → "+x.vigencia_hasta:" → abierta"}</small>${x.activo?"":' <span class="pill bad">Inactiva</span>'}</td>${ed?`<td><button class="btn ghost sm" data-te="${esc(x.id)}">Editar</button></td>`:""}</tr>`).join("");
  return subTF()+f+`<div style="padding:0 8px 6px"><small>${esc(L.length)} tarifas${L.length>300?" (se muestran 300; afina el filtro)":""} · ${ROL==="coordinador"?"Puedes proponer cambios; requieren aprobación de la cuenta maestra.":ed?"Puedes agregar y editar. Los cambios no alteran rutas ya validadas y quedan en bitácora.":"Solo consulta. Los cambios los hacen Operaciones y la cuenta maestra."}</small></div><table><tr><th>Cliente</th><th>Ubicación</th><th>Tipo de ruta</th><th>Vehículo</th><th>Esquema</th><th>Pago</th><th>Cobro</th><th>Vigencia</th>${ed?"<th></th>":""}</tr>${rows||'<tr><td colspan="9">Sin tarifas con ese filtro.</td></tr>'}</table>`}
function formTarifa(id){
  const t=id?TF.find(x=>x.id===id):{cuenta:"",ubicacion:"",ciudad:"",tipo_unidad:"",esquema:"",zona:"",variable:"",pago_base:"",tarifa_cliente:"",vigencia_desde:new Date().toLocaleDateString("en-CA"),vigencia_hasta:"",activo:true};
  const m=$("modal");m.classList.remove("hide");const dl=(i,k)=>`<datalist id="${i}">${uniq(k).map(v=>`<option value="${v}">`).join("")}</datalist>`;
  m.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2 style="margin:0 0 6px">${id?"Editar tarifa":"Nueva tarifa"}</h2>
   <label>Cliente</label><select id="tf-fc" ${id?"disabled":""}><option value="">Elige…</option>${CUENTAS_TARIFARIO.map(c=>`<option ${t.cuenta===c?"selected":""}>${c}</option>`).join("")}</select>
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
        if(id){const {error}=await guardarRegla(r,cx.c,null);if(error){$("rt-err").innerHTML=`<div class="errbox">${esc(error.message)}</div>`;return}if(ROL!=="coordinador"){const g=await sb.from("reglas_penalizacion").select("*");if(g.error){$("rt-err").innerHTML=`<div class="errbox">${esc(g.error.message)}</div>`;return}RGL=g.data||RGL}toast(ROL==="coordinador"?"Solicitud de regla enviada a la cuenta maestra":"Regla agregada")}
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
    const anterior=id?TF.find(tarifa=>String(tarifa.id)===String(id)):null;
    const payload={...row,cuenta,cliente:anterior?.cliente||cuenta,fuente:anterior?.fuente||"Panel"};
    $("tf-ok").disabled=true;
    const result=ROL==="coordinador"
      ?await sb.rpc("solicitar_cambio_tarifario",{p_entidad:"tarifas",p_entidad_id:id,p_datos:payload})
      :id?await sb.from("tarifas").update(row).eq("id",id):await sb.from("tarifas").insert(payload);
    if(result.error){$("tf-ok").disabled=false;return bad(result.error.message)}
    const ruleErrors=[];
    if(!id&&RTD.length){for(const r of RTD){const x={...r};x.tipo_unidad=r._lu?row.tipo_unidad:null;x.esquema=r._le?row.esquema:null;delete x._lu;delete x._le;const g=await guardarRegla(x,cuenta,null);if(g.error)ruleErrors.push(g.error.message)}}
    m.classList.add("hide");TF=null;TAR=null;
    if(ROL==="coordinador")toast(ruleErrors.length?`Tarifa propuesta; ${ruleErrors.length} regla(s) no pudieron enviarse: ${ruleErrors[0]}`:"Propuesta de tarifa enviada a la cuenta maestra");
    else toast(id?"Tarifa actualizada":"Tarifa agregada");
    if(ROL!=="coordinador")cargaTF()
  }}
const NIVEL={master:"Cuenta maestra · acceso completo",ops:"Operaciones · acceso completo",coordinador:"Coordinador · operación y pagos, sin cobro ni utilidad",finanzas:"Finanzas · pagos, liquidaciones y utilidad",ih:"Supervisor · datos operativos, sin importes"};
const CATALOGO={rutas:["Rutas","Cada ruta con driver, flotillero, cliente, CEDIS, paquetes, efectividad, estatus de validación, manifiestos y extras (maniobras, estadía, otros)."],
 cancelaciones:["Cancelaciones","Cancelaciones con ubicación, distancia al CEDIS, validación y estatus."],incidencias:["Incidencias","Incidencias reportadas por ruta, con comentario."],fallidos:["Fallidos por causa","Paquetes fallidos por causa y ruta."],
 drivers:["Drivers y flotilleros","Base de drivers con flotillero y registro fiscal."],liquidaciones_pago:["Liquidaciones (pago)","Pago al proveedor por ruta validada, sin cobro al cliente ni utilidad."],
 liquidaciones:["Liquidaciones completas","Pago, cobro al cliente, venta, utilidad y margen por ruta validada."],pagos:["Pagos","Pagos generados por driver y flotillero con su estatus."],auditoria:["Bajas y cambios de datos","Solicitudes de baja y de cambio de datos con su estatus."]};
function vistaDescargas(){
  const l=(DSET||[]).map(k=>{const [label,description]=CATALOGO[k]||[k,""];return `<div class="item" style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 8px;border-bottom:1px solid var(--line)"><div><b>${esc(label)}</b><br><small>${esc(description)}</small></div><button class="btn sm" data-dl="${esc(k)}">Descargar CSV</button></div>`}).join("");
  const lg=DLOG.map(x=>`<tr><td>${dd(x.en)} ${hh(x.en)}</td><td>${esc(x.rol)}</td><td>${(CATALOGO[x.dataset]||[x.dataset])[0]}</td><td>${esc(x.filas)}</td><td>${esc(x.desde)} → ${esc(x.hasta)}</td></tr>`).join("");
  return `<h3 style="margin:12px 8px 0">Reportes</h3><div style="padding:0 8px"><span class="pill ok">${esc(NIVEL[ROL]||ROL)}</span><br><small>Usa el rango de fechas y el cliente de la barra de arriba. Cada descarga queda registrada.</small></div>${l||'<div style="padding:12px">Tu nivel no tiene descargas.</div>'}
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
async function resolverBaja(id,ok){const {data,error}=await sb.rpc("resolver_desactivacion_asignada",{p_id:id,p_aprobar:ok,p_nota:null});
  if(error){toast(error.message);return}await cargaExtra();render();toast(ok?"Autorización registrada ("+data+")":"Solicitud rechazada")}
async function cargarRevisionesCoppel(){
  COPPEL_REVISIONES=[];COPPEL_REVISIONES_ERR="";
  const {data,error}=await sb.rpc("coppel_peak_listar_solicitudes");
  if(error){COPPEL_REVISIONES_ERR=error.message;return}
  if(!Array.isArray(data)){COPPEL_REVISIONES_ERR="La respuesta de solicitudes no es válida";return}
  COPPEL_REVISIONES=data;
}
async function cargarAjustesCoppel(){
  COPPEL_AJUSTES=[];COPPEL_AJUSTES_ERR="";COPPEL_DESTINOS=[];COPPEL_DESTINOS_ERR="";
  const {data,error}=await sb.rpc("coppel_peak_listar_ajustes");
  if(error)COPPEL_AJUSTES_ERR=error.message;
  else if(!Array.isArray(data))COPPEL_AJUSTES_ERR="La respuesta de ajustes no es válida";
  else COPPEL_AJUSTES=data;
  try{
    COPPEL_DESTINOS=await fetchPaged(()=>sb.from("cedis").select("id,nombre,cliente_id,activo").eq("activo",true).order("nombre"));
  }catch(error){COPPEL_DESTINOS_ERR=error.message||"No se pudieron cargar los CEDIS de destino"}
}
async function autorizarAjusteCoppel(id,boton){
  const ajuste=COPPEL_AJUSTES.find(x=>String(x.id)===String(id)),selector=$(`coppel-otras-${id}`);
  if(!ajuste||!selector||!["si","no"].includes(selector.value)){toast("Selecciona si se permiten otras cuentas");return}
  if(!confirm("¿Autorizar este ajuste? La autorización no aplica todavía el descuento o abono."))return;
  boton.disabled=true;
  const {error}=await sb.rpc("coppel_peak_autorizar_ajuste",{p_id:id,p_permitir_otras_cuentas:selector.value==="si"});
  if(error){boton.disabled=false;toast("No se pudo autorizar: "+error.message);return}
  await cargarAjustesCoppel();if(tab==="a")render();toast("Autorización registrada; el ajuste aún no se ha aplicado.");
}
async function autorizarDestinoCoppel(id,boton){
  const ajuste=COPPEL_AJUSTES.find(x=>String(x.id)===String(id)),selector=$(`coppel-destino-${id}`);
  if(!ajuste||!selector?.value){toast("Selecciona un CEDIS de destino");return}
  if(!confirm("¿Autorizar este CEDIS como destino del ajuste? Esto no realiza ningún pago."))return;
  boton.disabled=true;
  const {error}=await sb.rpc("coppel_peak_autorizar_destino_ajuste",{p_ajuste_id:id,p_cedis_id:selector.value});
  if(error){boton.disabled=false;toast("No se pudo autorizar el destino: "+error.message);return}
  await cargarAjustesCoppel();if(tab==="a")render();toast("Destino autorizado; el ajuste aún no se ha aplicado.");
}
function vistaAjustesCoppel(){
  if(COPPEL_AJUSTES_ERR)return `<div class="errbox">No se pudieron cargar los ajustes: ${esc(COPPEL_AJUSTES_ERR)}</div>`;
  const destinos=COPPEL_DESTINOS.filter(c=>cuentaDe(CLIENTES_NOMBRE[String(c.cliente_id)])!=="COPPEL")
    .map(c=>`<option value="${esc(c.id)}">${esc(CLIENTES_NOMBRE[String(c.cliente_id)]||"Cliente "+c.cliente_id)} · ${esc(c.nombre)}</option>`).join("");
  const filas=COPPEL_AJUSTES.map(a=>{
    const driver=DRV.find(d=>d.id===a.driver_id),proveedor=PRV.find(p=>String(p.id)===String(a.proveedor_id));
    const autorizados=(a.destinos||[]).map(d=>COPPEL_DESTINOS.find(c=>String(c.id)===String(d.cedis_id))?.nombre||"CEDIS "+d.cedis_id).join(", ");
    const decision=a.estado==="pendiente_revision"&&ROL==="coordinador"?`<select id="coppel-otras-${esc(a.id)}"><option value="">¿Permitir otras cuentas?</option><option value="no">Solo COPPEL</option><option value="si">Permitir otras cuentas</option></select> <button class="btn sm" data-coppel-autorizar="${esc(a.id)}">Autorizar ajuste</button>`:"";
    const destino=a.estado==="autorizado"&&a.permitir_otras_cuentas?`${COPPEL_DESTINOS_ERR?`<div class="errbox">${esc(COPPEL_DESTINOS_ERR)}</div>`:`<select id="coppel-destino-${esc(a.id)}"><option value="">Selecciona CEDIS de otra cuenta</option>${destinos}</select> <button class="btn ghost sm" data-coppel-destino="${esc(a.id)}">Autorizar destino</button>`}`:"";
    return `<tr><td>${esc(driver?.nombre||a.driver_id)}</td><td>${esc(proveedor?.nombre||"Proveedor "+a.proveedor_id)}</td><td>${esc(a.lunes_origen)}</td><td>${esc(a.tipo)} · ${esc(fm(a.monto_base))}<br><small>${esc(a.motivo)}</small></td><td>${a.estado==="autorizado"?"Autorizado; sin aplicar":"Pendiente de autorización"}${autorizados?`<br><small>Destinos: ${esc(autorizados)}</small>`:""}</td><td>${decision}${destino}</td></tr>`;
  }).join("");
  return `<div class="note">Las autorizaciones son de revisión: el descuento o abono todavía no se aplica automáticamente.</div><table><tr><th>Driver</th><th>Proveedor original</th><th>Semana</th><th>Ajuste base</th><th>Estado</th><th>Acción</th></tr>${filas||'<tr><td colspan="6">Sin ajustes accesibles.</td></tr>'}</table>`;
}
async function abrirRevisionCoppel(id){
  const solicitud=COPPEL_REVISIONES.find(x=>String(x.id)===String(id));
  if(!solicitud){toast("La solicitud ya no está disponible");return}
  const m=$("modal");m.classList.remove("hide");
  m.innerHTML=`<div class="box"><h2>Solicitud de precierre COPPEL</h2><div>${esc(solicitud.driver_nombre)} · semana ${esc(solicitud.lunes)}</div><div id="coppel-revision-result">Cargando...</div><div style="margin-top:14px"><button class="btn ghost" id="coppel-revision-close">Cerrar</button></div></div>`;
  $("coppel-revision-close").onclick=()=>m.classList.add("hide");
  const {data,error}=await sb.rpc("coppel_peak_consultar_precierre",{p_driver_id:solicitud.driver_id,p_lunes:solicitud.lunes});
  const resultado=$("coppel-revision-result");if(!resultado)return;
  if(error){resultado.innerHTML=`<div class="errbox">No se pudo consultar la semana: ${esc(error.message)}</div>`;return}
  if(!["completo","cerrada"].includes(data?.estado)){
    resultado.innerHTML='<div class="errbox">La semana cambió o ya no está dentro de tu alcance. Solicita revisión a Operaciones.</div>';return;
  }
  mostrarPrecierreCoppel(resultado,solicitud.driver_id,solicitud.lunes,data);
}
function vistaAprobar(){
  if(ROL==="finanzas")return "";
  const f=PEND.map(q=>{const r=q.rutas||{};return `<tr><td>${esc(r.id_ruta||q.ruta_id)}</td><td>${esc(r.drivers?r.drivers.nombre:"")}</td><td>${esc(r.cedis?r.cedis.clientes.nombre+" · "+r.cedis.nombre:"")}</td><td>${esc(r.entregados)}/${esc(r.paquetes_asignados)}</td><td>No aplicar penalización al pago<br><small>${esc(q.motivo)}</small></td><td><button class="btn ghost sm" data-det="${esc(q.ruta_id)}">Detalle</button> ${esCoord()?`<button class="btn sm" data-ap="${esc(q.id)}">Aprobar</button> <button class="btn ghost sm" data-rc="${esc(q.id)}">Rechazar</button>`:'<span class="pill w">En espera</span>'}</td></tr>`}).join("");
  const revisiones=COPPEL_PEAK_ENABLED&&esCoord()?`<h3 style="margin:16px 8px 0">Revisiones de precierre COPPEL</h3>${COPPEL_REVISIONES_ERR?`<div class="errbox">No se pudieron cargar las solicitudes: ${esc(COPPEL_REVISIONES_ERR)}</div>`:`<table><tr><th>Driver</th><th>Semana</th><th>Solicitada</th><th></th></tr>${COPPEL_REVISIONES.map(s=>`<tr><td>${esc(s.driver_nombre)}</td><td>${esc(s.lunes)}</td><td>${esc(dd(s.solicitado_en))}</td><td><button class="btn ghost sm" data-coppel-revision="${esc(s.id)}">Consultar</button></td></tr>`).join("")||'<tr><td colspan="4">No hay solicitudes accesibles pendientes.</td></tr>'}</table>`}`:"";
  return `<h3 style="margin:12px 8px 0">Excepciones por aprobar</h3><table><tr><th>Ruta</th><th>Driver</th><th>Cliente · CEDIS</th><th>Entreg.</th><th>Solicitud</th><th></th></tr>${f||'<tr><td colspan="6">Nada pendiente.</td></tr>'}</table>${revisiones}`}
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
let EQ_ASIG=[],EQ_CEDIS={},EQ_PERSONAS=[],EQ_ABIERTO=null,EQ_ERR="";
async function cargarAsignacionesEquipo(){
  EQ_ERR="";
  try{
    const [asig,cedis,clientes,personas]=await Promise.all([
      fetchPaged(()=>sb.from("asignaciones_operativas").select("cliente_id,cedis_id,supervisor_id,coordinador_id").order("cedis_id")),
      fetchPaged(()=>sb.from("cedis").select("id,nombre,cliente_id").order("nombre")),
      fetchPaged(()=>sb.from("clientes").select("id,nombre").order("nombre")),
      ROL==="master"?sb.rpc("listar_responsables_operativos"):Promise.resolve({data:[]})
    ]);
    if(personas.error)throw new Error(personas.error.message+" — ejecuta operational-assignments-by-email.sql en Supabase.");
    EQ_PERSONAS=personas.data||[];
    CLIENTES_NOMBRE=Object.fromEntries(clientes.map(c=>[String(c.id),c.nombre]));
    EQ_CEDIS=Object.fromEntries(cedis.map(c=>[String(c.id),c]));
    EQ_ASIG=asig
  }catch(e){EQ_ASIG=[];EQ_ERR=e.message||"No se pudieron cargar las asignaciones. Verifica que operational-responsibility-approvals.sql esté ejecutado."}
}
const personaTxt=id=>{const p=EQ_PERSONAS.find(x=>x.id===id);return p?`${p.nombre} (${p.email})`:(DRV.find(x=>x.id===id)?.nombre||"—")};
function detalleEquipo(d){
  if(EQ_ERR)return `<div class="errbox">${esc(EQ_ERR)}</div>`;
  const nombreCliente=id=>CLIENTES_NOMBRE[String(id)]||"Sin cliente";
  const nombreCedis=id=>EQ_CEDIS[String(id)]?.nombre||"CEDIS "+id;
  if(d.rol==="ih"){
    const mias=EQ_ASIG.filter(a=>a.supervisor_id===d.id);
    if(!mias.length)return "<small>Sin CEDIS asignados.</small>";
    const coord=a=>personaTxt(a.coordinador_id);
    return `<b>CEDIS a su cargo (${mias.length})</b><div class="doc-table-wrap team-nested-table" tabindex="0" role="region" aria-label="CEDIS y coordinadores asignados"><table><tr><th>Cliente</th><th>CEDIS</th><th>Coordinador</th></tr>${mias.map(a=>`<tr><td>${esc(nombreCliente(a.cliente_id))}</td><td>${esc(nombreCedis(a.cedis_id))}</td><td>${esc(coord(a))}</td></tr>`).join("")}</table></div>`
  }
  if(d.rol==="coordinador"){
    const mias=EQ_ASIG.filter(a=>a.coordinador_id===d.id);
    if(!mias.length)return "<small>Sin cuentas asignadas.</small>";
    const cuentas=new Map();
    mias.forEach(a=>{
      const k=String(a.cliente_id);
      if(!cuentas.has(k))cuentas.set(k,{cedis:[],supervisores:new Set()});
      const c=cuentas.get(k);c.cedis.push(nombreCedis(a.cedis_id));c.supervisores.add(a.supervisor_id)
    });
    const sup=new Set(mias.map(a=>a.supervisor_id));
    const supNombre=personaTxt;
    const filas=[...cuentas].map(([k,c])=>`<tr><td>${esc(nombreCliente(k))}</td><td>${c.cedis.map(esc).join(", ")}</td><td>${[...c.supervisores].map(id=>esc(supNombre(id))).join(", ")}</td></tr>`).join("");
    return `<b>Cuentas a su cargo (${cuentas.size})</b><div class="doc-table-wrap team-nested-table" tabindex="0" role="region" aria-label="Cuentas y supervisores asignados"><table><tr><th>Cliente</th><th>CEDIS</th><th>Supervisores</th></tr>${filas}</table></div><p><b>Supervisores que le responden (${sup.size}):</b> ${[...sup].map(id=>esc(supNombre(id))).join(", ")}</p>`
  }
  return "<small>Este rol no tiene cuentas ni CEDIS asignados.</small>"
}
function vistaEquipo(){
  const accesos=DRV.filter(d=>["master","ops","coordinador","ih","finanzas"].includes(d.rol));
  const invitaciones=window.INV||[];
  const st='class="doc-import-field"';
  const eq=accesos.map(d=>{
    const expandible=["ih","coordinador"].includes(d.rol),abierto=EQ_ABIERTO===d.id;
    return `<tr><td>${expandible?`<button class="btn ghost sm" data-eq-d="${esc(d.id)}" aria-expanded="${abierto}">${abierto?"▾":"▸"} ${esc(d.nombre)}</button>`:esc(d.nombre)}</td><td>${esc(ROLES_TXT[d.rol]||d.rol)}</td><td>${esc(d.estatus||"—")}</td></tr>${abierto?`<tr><td class="team-details-cell" colspan="3">${detalleEquipo(d)}</td></tr>`:""}`}).join("");
  const inv=invitaciones.map(i=>`<tr><td>${esc(i.email)}</td><td>${esc(ROLES_TXT[i.rol]||i.rol||"—")}</td></tr>`).join("");
  return `<div class="doc-page team-page">
    <div class="doc-intro"><span class="doc-eyebrow">Administración de accesos</span><h3>Equipo administrativo</h3><p>Asigna roles, consulta el acceso del personal y organiza las responsabilidades por cliente y CEDIS.</p></div>
    <div class="doc-summary" aria-label="Resumen del equipo administrativo">
      <div class="doc-metric"><span>Personal con acceso</span><strong>${accesos.length}</strong><small>Roles administrativos activos o asignados</small></div>
      <div class="doc-metric"><span>Invitaciones registradas</span><strong>${invitaciones.length}</strong><small>Correos en la lista de invitaciones</small></div>
      <div class="doc-metric"><span>Asignaciones operativas</span><strong>${EQ_ERR?"—":EQ_ASIG.length}</strong><small>Relaciones de cliente y CEDIS</small></div>
    </div>
    <section class="doc-import">
      <div class="doc-import-head"><span class="doc-eyebrow">Nuevo acceso</span><h3>Dar acceso al personal</h3><p>El personal inicia sesión con Google Workspace. El rol se activa en su primer ingreso o al instante si ya tiene cuenta.</p></div>
      <div class="doc-import-grid team-form-grid">
        <label ${st}>Correo de Chazki<input id="eq-m" type="email" placeholder="nombre@chazki.com" autocomplete="email"></label>
        <label ${st}>Rol administrativo<select id="eq-r">${["coordinador","ih","finanzas","ops","master"].map(r=>`<option value="${r}">${ROLES_TXT[r]}</option>`).join("")}</select></label>
      </div>
      <div class="doc-import-footer team-form-footer"><p class="note">Verifica el correo y el nivel de acceso antes de asignar el rol.</p><button class="btn" id="eq-ok">Asignar acceso</button></div>
    </section>
    <section class="doc-section">
      <div class="doc-section-title"><div><h3>Equipo con acceso</h3><p>Personal administrativo y estado de su cuenta.</p></div><span class="doc-count">${accesos.length} ${accesos.length===1?"persona":"personas"}</span></div>
      <div class="doc-table-wrap team-table-wrap" tabindex="0" role="region" aria-label="Personal administrativo con acceso"><table><thead><tr><th>Nombre</th><th>Rol</th><th>Estatus</th></tr></thead><tbody>${eq||'<tr><td colspan="3">No hay personal administrativo registrado.</td></tr>'}</tbody></table></div><p class="doc-scroll-hint">Desliza horizontalmente para consultar todas las columnas.</p>
    </section>
    <section class="doc-section team-invites">
      <div class="doc-section-title"><div><h3>Invitaciones al equipo</h3><p>Correos con un rol asignado para acceder al panel.</p></div><span class="doc-count">${invitaciones.length} ${invitaciones.length===1?"invitación":"invitaciones"}</span></div>
      <div class="doc-table-wrap team-table-wrap" tabindex="0" role="region" aria-label="Invitaciones de acceso administrativo"><table><thead><tr><th>Correo</th><th>Rol asignado</th></tr></thead><tbody>${inv||'<tr><td colspan="2">Sin invitaciones.</td></tr>'}</tbody></table></div><p class="doc-scroll-hint">Desliza horizontalmente para consultar todas las columnas.</p>
    </section>
    ${vistaImportarResponsables()}
  </div>`}
async function asignarRol(){const m=$("eq-m").value.trim().toLowerCase();
  if(!/^[^@\s]+@chazki\.com$/.test(m)){toast("Solo correos @chazki.com");return}
  const {data,error}=await sb.rpc("asignar_rol",{p_email:m,p_rol:$("eq-r").value});
  if(error){toast(error.message);return}toast(data);await cargaExtra();render()}
let AFILIADOS=[],AFILIADOS_ERR="",AFILIADOS_LOADING=false,AFILIADO_ABIERTO=null,AFILIADO_EDITAR=null,AFILIADO_PROVEEDOR_EDITAR=null,CEDIS_EDICION=[],CEDIS_EDICION_ERR="",INV_PRESELECCION=null,SOL_VINCULACION=[],SOL_VINCULACION_ERR="";
async function cargarAfiliados(){
  AFILIADOS_LOADING=true;AFILIADOS_ERR="";CEDIS_EDICION_ERR="";SOL_VINCULACION_ERR="";
  try{AFILIADOS=await fetchPaged(()=>sb.rpc("listar_afiliados_edicion_flota"))}
  catch(error){AFILIADOS=[];AFILIADOS_ERR="No se pudieron cargar los afiliados. Verifica editar-afiliados-flota.sql en Supabase: "+error.message}
  try{CEDIS_EDICION=await fetchPaged(()=>sb.rpc("listar_cedis_edicion_flota"))}
  catch(error){CEDIS_EDICION=[];CEDIS_EDICION_ERR="No se pudieron cargar los CEDIS disponibles para edición: "+error.message}
  try{SOL_VINCULACION=await fetchPaged(()=>sb.rpc("listar_solicitudes_vinculacion_flota"))}
  catch(error){SOL_VINCULACION=[];SOL_VINCULACION_ERR="No se pudieron cargar las solicitudes de vinculación. Verifica solicitudes-vinculacion-flotilla.sql en Supabase: "+error.message}
  finally{AFILIADOS_LOADING=false}
}
function categoriaAfiliado(d){
  if(d.rol==="flotillero")return "Flotillero";
  if(d.proveedor_tipo==="flotillero")return "Driver de flotillero";
  if(d.proveedor_tipo==="independiente")return "Driver independiente";
  return "Driver · categoría sin definir";
}
function opcionesCedisAfiliado(d){
  const actual=d.cedis_default_id==null?"":String(d.cedis_default_id);
  const options=CEDIS_EDICION.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===actual?"selected":""}>${esc(c.nombre)}</option>`).join("");
  const conservaActual=actual&&!CEDIS_EDICION.some(c=>String(c.id)===actual)
    ?`<option value="${esc(actual)}" selected>${esc(d.cedis_default_nombre||"CEDIS actual")} (no asignado)</option>`:"";
  return `<option value="" ${actual?"":"selected"}>Sin CEDIS predeterminado</option>${conservaActual}${options}`;
}
function formularioDriverAfiliado(d,editarAttr,guardarAttr,colspan=5){
  return `<tr><td colspan="${colspan}"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
    <label>Nombre <input id="af-nombre" maxlength="200" value="${esc(d.nombre)}"></label>
    <label>Teléfono <input id="af-telefono" maxlength="50" value="${esc(d.telefono||"")}"></label>
    <label>Correo de contacto <input id="af-correo" type="email" maxlength="254" value="${esc(d.correo_contacto||"")}"></label>
    <label>CEDIS predeterminado<select id="af-cedis">${opcionesCedisAfiliado(d)}</select></label>
    <button class="btn sm" ${guardarAttr}="${esc(d.id)}">Guardar driver</button>
    <button class="btn ghost sm" ${editarAttr}>Cancelar</button></div>
    <small>El correo de contacto no cambia el correo de acceso. El driver podrá elegir otro CEDIS al iniciar una ruta.</small>
  </td></tr>`;
}
function formularioProveedorAfiliado(d){
  return `<tr><td colspan="5"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
    <label>Nombre o razón social <input id="af-prov-nombre" maxlength="200" value="${esc(d.proveedor_nombre||"")}"></label>
    <label>Categoría <select id="af-prov-tipo"><option value="flotillero" ${d.proveedor_tipo==="flotillero"?"selected":""}>Flotillero</option><option value="independiente" ${d.proveedor_tipo==="independiente"?"selected":""}>Independiente</option></select></label>
    <label>Esquema <select id="af-prov-esquema"><option value="">Sin definir</option><option value="FACTURA" ${d.proveedor_tipo_registro==="FACTURA"?"selected":""}>Con factura</option><option value="SIN FACTURA" ${d.proveedor_tipo_registro==="SIN FACTURA"?"selected":""}>Sin factura</option></select></label>
    <button class="btn sm" data-af-prov-guardar="${esc(d.proveedor_id)}">Guardar proveedor</button>
    <button class="btn ghost sm" data-af-prov-cancelar>Cancelar</button></div></td></tr>`;
}
function vistaProveedores(){
  const pv=PRV.map(p=>{const t=DRV.find(d=>d.id===p.titular_id);return `<tr><td>${esc(p.nombre)}</td><td>${esc(p.tipo)}</td><td>${p.tipo_registro?esc(p.tipo_registro):'<span class="pill w">Sin definir</span>'}</td><td>${esc(t?t.nombre:"—")}</td></tr>`}).join("");
  if(ROL==="finanzas")return `<h3 style="margin:12px 8px 0">Proveedores</h3><table><tr><th>Proveedor</th><th>Tipo</th><th>Registro fiscal</th><th>Titular</th></tr>${pv}</table>`;
  const flotillasVisibles=new Set(AFILIADOS.filter(d=>d.rol==="flotillero"&&d.proveedor_id&&d.proveedor_tipo==="flotillero"&&d.titular_id===d.id).map(d=>String(d.proveedor_id)));
  const dr=AFILIADOS.filter(d=>d.rol!=="driver"||!d.proveedor_id||!flotillasVisibles.has(String(d.proveedor_id))).map(d=>{
    const titular=d.rol==="flotillero",valido=titular&&d.proveedor_id&&d.proveedor_tipo==="flotillero"&&d.titular_id===d.id;
    const abierto=valido&&AFILIADO_ABIERTO===d.id;
    const hijos=AFILIADOS.filter(x=>x.rol==="driver"&&valido&&String(x.proveedor_id)===String(d.proveedor_id));
    const lista=hijos.map(x=>`<tr><td>${esc(x.nombre)}<br><small>${esc(x.codigo||"")}</small></td><td>${esc(x.estatus||"—")}</td><td><button class="btn ghost sm" data-af-editar="${esc(x.id)}">Editar driver</button></td></tr>${AFILIADO_EDITAR===x.id?formularioDriverAfiliado(x,"data-af-cancelar","data-af-guardar",3):""}`).join("");
    const detalle=abierto?`<tr><td colspan="5"><strong>Drivers de ${esc(d.nombre)}</strong> <button class="btn sm" data-af-vincular="${esc(d.proveedor_id)}" ${d.proveedor_activo?"":"disabled"}>Añadir driver</button> <button class="btn ghost sm" data-af-invitar="${esc(d.proveedor_id)}" ${d.proveedor_activo?"":"disabled"}>Invitar driver nuevo</button>${d.proveedor_activo?"":" <small>La flotilla está inactiva.</small>"}<table><tr><th>Driver</th><th>Estatus</th><th></th></tr>${lista||'<tr><td colspan="3">Esta flotilla no tiene drivers registrados.</td></tr>'}</table></td></tr>`:"";
    const esTitular=d.proveedor_id&&String(d.titular_id)===String(d.id);
    const editarDatosProveedor=esTitular||(
      d.proveedor_id&&d.proveedor_tipo==="independiente"&&!d.titular_id
    );
    const editarDriver=AFILIADO_EDITAR===d.id;
    const editarProveedor=AFILIADO_PROVEEDOR_EDITAR!=null&&String(AFILIADO_PROVEEDOR_EDITAR)===String(d.proveedor_id);
    return `<tr><td>${valido?`<button class="btn ghost sm" data-af-ver="${esc(d.id)}" aria-expanded="${abierto}">${abierto?"▾":"▸"} ${esc(d.nombre)}</button>`:esc(d.nombre)}<br><small>${esc(d.codigo||"")}</small></td><td>${esc(categoriaAfiliado(d))}</td><td>${esc(d.proveedor_nombre||"Sin proveedor")}</td><td>${titular&&!valido?"Sin flotilla vinculada":esc(d.estatus||"—")}</td><td><button class="btn ghost sm" data-af-editar-driver="${esc(d.id)}">Editar driver</button> ${editarDatosProveedor?`<button class="btn ghost sm" data-af-editar-prov="${esc(d.proveedor_id)}">Editar proveedor</button>`:"—"}</td></tr>${editarDriver?formularioDriverAfiliado(d,"data-af-cancelar-driver","data-af-guardar-driver"):""}${editarProveedor?formularioProveedorAfiliado(d):""}${detalle}`;
  }).join("");
  return `<h3 style="margin:16px 8px 0">Drivers y flotilleros</h3><small style="padding:0 8px">Abre un flotillero para ver, editar, invitar o solicitar vincular drivers. El personal administrativo se consulta en Equipo. La aprobación y el traslado seguro aún no están habilitados.</small>${AFILIADOS_ERR?`<div class="errbox">${esc(AFILIADOS_ERR)}</div>`:""}${CEDIS_EDICION_ERR?`<div class="errbox">${esc(CEDIS_EDICION_ERR)}</div>`:""}${AFILIADOS_LOADING?"<p>Cargando afiliados…</p>":`<table><tr><th>Driver</th><th>Categoría</th><th>Proveedor</th><th>Estatus</th><th></th></tr>${dr||'<tr><td colspan="5">No hay drivers ni flotilleros registrados.</td></tr>'}</table>`}
    <h3 style="margin:16px 8px 0">Solicitudes de vinculación pendientes</h3><small>La solicitud no cambia la flotilla. La aprobación segura está pendiente de implementación.</small>${SOL_VINCULACION_ERR?`<div class="errbox">${esc(SOL_VINCULACION_ERR)}</div>`:""}<table><tr><th>Driver</th><th>Flotillero solicitado</th><th>Fecha</th><th></th></tr>${SOL_VINCULACION.map(s=>`<tr><td>${esc(s.driver_nombre)}</td><td>${esc(s.flotillero_nombre)}</td><td>${esc(new Date(s.solicitada_en).toLocaleString("es-MX"))}</td><td><button class="btn ghost sm" data-af-cancelar-solicitud="${esc(s.id)}">Cancelar solicitud</button></td></tr>`).join("")||'<tr><td colspan="4">Sin solicitudes visibles.</td></tr>'}</table>`}
let PADRON=[],PADRON_ERR="",PADRON_Q="",PADRON_OFFSET=0,PADRON_MAS=false,PADRON_LOADING=false;
async function cargarPadron(){
  PADRON_LOADING=true;PADRON_ERR="";
  const {data,error}=await sb.rpc("listar_padron_acceso",{p_busqueda:PADRON_Q,p_offset:PADRON_OFFSET});
  PADRON_LOADING=false;
  if(error){PADRON=[];PADRON_MAS=false;PADRON_ERR="No se pudo cargar el padrón. Verifica que network-invitations.sql esté instalado en Supabase: "+error.message;return}
  PADRON_MAS=data.length>50;PADRON=data.slice(0,50);
}
function correoAcceso(email,nombre){
  const mensaje=`Hola${nombre?" "+nombre:""}, abre la app de Driver (${location.origin}/) y utiliza este correo: ${email}. Si aún no tienes cuenta, solicita a tu supervisor una invitación aprobada antes de registrarte.`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Acceso a Chazki Driver")}&body=${encodeURIComponent(mensaje)}`;
}
function vistaPadron(){
  const filas=PADRON.map(x=>{
    const padron=x.estatus_padron||"Fuera del padrón";
    const cuenta=!x.driver_id?"Sin cuenta":`${x.estatus_cuenta||"Sin estatus"} · ${x.correo_confirmado?"correo confirmado":"correo sin confirmar"}`;
    const puedeContactar=String(x.estatus_padron||"").toUpperCase()==="ACTIVO"||String(x.estatus_cuenta||"").toLowerCase()==="activo";
    return `<tr><td>${esc(x.nombre||"—")}<br><small>${esc(x.email||"—")}</small></td><td>${esc(x.proveedor||"—")}</td><td>${esc(x.cliente||"—")}</td><td>${esc(padron)}</td><td>${esc(cuenta)}</td><td>${x.email&&puedeContactar?`<a class="btn ghost sm" href="${esc(correoAcceso(x.email,x.nombre))}">Preparar correo</a>`:"—"}</td></tr>`;
  }).join("");
  return `<h3 style="margin:12px 8px 0">Padrón de flota y cuentas de driver</h3>
    <p style="padding:0 8px">El padrón de Flota se muestra por separado y no autoriza el registro; los drivers necesitan una invitación aprobada. El correo se abre en tu aplicación de correo y debes enviarlo.</p>
    <div style="display:flex;gap:8px;padding:8px"><input id="padron-q" placeholder="Nombre, correo o proveedor" value="${esc(PADRON_Q)}"><button class="btn" id="padron-buscar">Buscar</button></div>
    ${PADRON_ERR?`<div class="errbox">${esc(PADRON_ERR)}</div>`:""}
    ${PADRON_LOADING?"<p>Cargando padrón…</p>":`<table><tr><th>Driver</th><th>Proveedor</th><th>Cliente</th><th>Padrón</th><th>Cuenta</th><th></th></tr>${filas||'<tr><td colspan="6">Sin resultados.</td></tr>'}</table>`}
    <div style="display:flex;gap:8px;padding:8px"><button class="btn ghost sm" id="padron-prev" ${PADRON_OFFSET===0||PADRON_LOADING?"disabled":""}>Anterior</button><span>Registros ${PADRON.length?PADRON_OFFSET+1:0}–${PADRON_OFFSET+PADRON.length}</span><button class="btn ghost sm" id="padron-next" ${!PADRON_MAS||PADRON_LOADING?"disabled":""}>Siguiente</button></div>`;
}
function enlazarPadron(){
  const cargar=async()=>{PADRON_LOADING=true;render();await cargarPadron();if(tab==="j")render()};
  $("padron-buscar").onclick=()=>{PADRON_Q=$("padron-q").value.trim();PADRON_OFFSET=0;cargar()};
  $("padron-q").onkeydown=e=>{if(e.key==="Enter")$("padron-buscar").click()};
  $("padron-prev").onclick=()=>{PADRON_OFFSET=Math.max(0,PADRON_OFFSET-50);cargar()};
  $("padron-next").onclick=()=>{PADRON_OFFSET+=50;cargar()};
}
let INVR=[],INVR_CEDIS=[],INVR_FLOTAS=[],INVR_AUD=[],INVR_ERR="",INVR_LOADING=false;
const INV_TIPO={flotillero:"Flotillero",independiente:"Driver independiente",driver:"Driver de flotillero"};
const INV_EST={pendiente_aprobacion:["Por aprobar","w"],enviada:["Registrada · espera cuenta","w"],aceptada:["Aplicada a la cuenta","ok"],rechazada:["Rechazada","bad"],cancelada:["Cancelada","bad"]};
async function cargarInvitaciones(){
  INVR_ERR="";
  try{
  const [i,c,p]=await Promise.all([listarInvitacionesRed(sb).then(data=>({data,error:null}),error=>({data:null,error})),sb.from("cedis").select("id,nombre,cliente_id").order("nombre"),fetchPaged(()=>sb.rpc("listar_flotilleros_invitacion")).then(data=>({data,error:null}),error=>({data:null,error}))]);
  if(i.error)INVR_ERR="No se pudieron cargar las invitaciones. Un administrador debe ejecutar network-invitations.sql en el editor SQL de Supabase y verificar los permisos: "+i.error.message;
  if(c.error)INVR_ERR+=(INVR_ERR?" ":"")+"No se pudieron cargar los CEDIS: "+c.error.message;
  if(p.error)INVR_ERR+=(INVR_ERR?" ":"")+"No se pudieron cargar los flotilleros. Verifica invitaciones-flotillero-pendiente.sql en Supabase: "+p.error.message;
  INVR=i.data||[];INVR_CEDIS=c.data||[];INVR_FLOTAS=p.data||[];
  if(INV_PRESELECCION&&!INVR_FLOTAS.some(x=>`${x.tipo}:${x.id}`===INV_PRESELECCION)){
    INVR_ERR+=(INVR_ERR?" ":"")+"El flotillero seleccionado ya no está disponible; selecciona otro.";
    INV_PRESELECCION=null;
  }
  INVR_AUD=[];
  if(INVR.length){
    for(let desde=0;desde<INVR.length;desde+=100){
      try{
        const data=await fetchPaged(()=>sb.from("invitaciones_red_auditoria").select("invitacion_id,evento,actor_id,registrado_en,estado").in("invitacion_id",INVR.slice(desde,desde+100).map(x=>x.id)).order("registrado_en",{ascending:false}).order("id",{ascending:false}));
        INVR_AUD.push(...data);
      }catch(error){INVR_ERR+=(INVR_ERR?" ":"")+"No se pudo cargar el registro de avisos. Verifica invitation-status-audit.sql en Supabase: "+error.message;break}
    }
  }
  }catch(error){INVR=[];INVR_CEDIS=[];INVR_FLOTAS=[];INVR_AUD=[];INVR_ERR="No se pudieron cargar las invitaciones y flotilleros: "+(error.message||error)}
  finally{INVR_LOADING=false}
}
function avisosEstadoInvitacion(estado,fecha=new Date()){
  const avisos=[];
  if(estado.en_padron)avisos.push(estado.padron_activo?"Este correo ya tiene alta en el padrón.":"Este correo existe en el padrón, pero su alta no está activa.");
  if(estado.cuenta_bloqueada)avisos.push("Usuario bloqueado. Solicita a tu administrador la reactivación; esta invitación no desbloquea la cuenta.");
  if(estado.cuenta_inactiva){
    const inicio=estado.inactivo_desde?new Date(estado.inactivo_desde):null;
    const dias=inicio&&Number.isFinite(inicio.getTime())&&inicio<=fecha?Math.floor((fecha-inicio)/86400000):null;
    avisos.push(`Cuenta inactiva. ${dias===null?"No se conoce la fecha de inicio.":`Tiempo inactiva: ${dias} día${dias===1?"":"s"}.`} Solicita a tu administrador la reactivación; esta invitación no reactiva la cuenta.`);
  }
  return avisos;
}
async function confirmarEstadoInvitacion(email){
  const {data,error}=await sb.rpc("consultar_estado_invitacion",{p_email:email});
  if(error)throw new Error("No se pudo comprobar el estado de la cuenta: "+error.message);
  if(!data||typeof data.en_padron!=="boolean"||typeof data.padron_activo!=="boolean"||typeof data.cuenta_bloqueada!=="boolean"||typeof data.cuenta_inactiva!=="boolean")
    throw new Error("La consulta del estado devolvió una respuesta inválida.");
  const avisos=avisosEstadoInvitacion(data);
  return !avisos.length||confirm(avisos.join("\n\n")+"\n\n¿Deseas continuar con la invitación?");
}
function mensajeInvitacion(x){
  const url=location.origin+"/";
  const espera=x.tipo==="driver"&&x.invitacion_flotillero_id&&!x.proveedor_id?" Primero debe registrarse tu flotillero; después podrás registrarte.":"";
  return `Hola${x.nombre?" "+x.nombre:""}, Chazki te invita como ${INV_TIPO[x.tipo]||"driver"}.${espera} Abre la app de Driver (${url}) y ${x.estatus==="aceptada"?"entra":"regístrate o entra"} con este correo: ${x.email}`;
}
function gmailInvitacion(x){
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(x.email)}&su=${encodeURIComponent("Invitación a Chazki")}&body=${encodeURIComponent(mensajeInvitacion(x))}`;
}
function vistaInvitaciones(){
  const cedisTxt=id=>{const c=INVR_CEDIS.find(y=>y.id===id);return c?`${CLIENTES_NOMBRE[String(c.cliente_id)]||""} · ${c.nombre}`:"—"};
  const pend=INVR.filter(x=>x.estatus==="pendiente_aprobacion"&&x.invitado_por_rol==="flotillero");
  const fila=x=>{const e=INV_EST[x.estatus]||[x.estatus,"w"];
    const acc=x.estatus==="pendiente_aprobacion"&&x.invitado_por_rol==="flotillero"?`<button class="btn sm" data-inv-ok="${esc(x.id)}">Aprobar</button> <button class="btn ghost sm" data-inv-no="${esc(x.id)}">Rechazar</button>`
      :["enviada","aceptada"].includes(x.estatus)?`<a class="btn ghost sm" data-inv-compartir="${esc(x.id)}" data-canal="whatsapp" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(mensajeInvitacion(x))}">WhatsApp</a> <a class="btn ghost sm" data-inv-compartir="${esc(x.id)}" data-canal="correo" target="_blank" rel="noopener" href="${esc(gmailInvitacion(x))}">Preparar / reenviar correo</a>${x.estatus==="enviada"?` <button class="btn ghost sm" data-inv-editar="${esc(x.id)}">Editar invitación</button> <button class="btn ghost sm" data-inv-x="${esc(x.id)}">Cancelar</button>`:""}`
      :x.estatus==="pendiente_aprobacion"?`<button class="btn ghost sm" data-inv-x="${esc(x.id)}">Cancelar</button>`
      :x.estatus==="cancelada"?`<button class="btn ghost sm" data-inv-eliminar="${esc(x.id)}">Eliminar de la lista</button>`:"";
    const prov=x.proveedor_id?(PRV.find(p=>p.id===x.proveedor_id)||INVR_FLOTAS.find(p=>p.tipo==="proveedor"&&String(p.id)===String(x.proveedor_id))):INVR_FLOTAS.find(p=>p.tipo==="invitacion"&&String(p.id)===String(x.invitacion_flotillero_id));
    const auditoria=INVR_AUD.filter(a=>a.invitacion_id===x.id).map(a=>{
      const avisos=avisosEstadoInvitacion(a.estado,new Date(a.registrado_en));
      const evento={solicitud:"Solicitud registrada",invitacion:"Invitación registrada",correo:"Correo preparado",whatsapp:"WhatsApp preparado"}[a.evento]||"Actividad registrada";
      return avisos.length||["correo","whatsapp"].includes(a.evento)?`<br><small>${esc(evento)} ${esc(new Date(a.registrado_en).toLocaleString("es-MX"))} por ${esc(a.actor_id)}${avisos.length?": "+esc(avisos.join(" ")):" (no confirma envío)"}</small>`:"";
    }).join("");
    const clase=x.estatus==="cancelada"?"missing":e[1]==="ok"?"approved":e[1]==="bad"?"rejected":"pending";
    return `<tr><td>${esc(x.nombre||"—")}<br><small>${esc(x.email)}</small></td><td>${esc(INV_TIPO[x.tipo]||x.tipo)}${x.esquema?`<br><small>${esc(x.esquema)}</small>`:""}${prov?`<br><small>Flotilla: ${esc(prov.nombre)}</small>`:""}</td><td>${x.cedis_id?esc(cedisTxt(x.cedis_id)):"—"}</td><td>${x.invitado_por_rol==="flotillero"?"Flotillero":"Chazki"}</td><td><span class="doc-status doc-status-${clase}">${esc(e[0])}</span>${x.tipo==="driver"&&x.invitacion_flotillero_id&&!x.proveedor_id&&x.estatus==="enviada"?`<br><small>Espera el registro del flotillero. Si ya se registró, contacta al administrador.</small>`:""}${x.motivo?`<br><small>${esc(x.motivo)}</small>`:""}${auditoria}</td><td>${correoInvitacionHtml(x)}</td><td><div class="inv-actions">${acc}</div></td></tr>`};
  const tabla=(filas,nombre)=>`<div class="doc-table-wrap" tabindex="0" role="region" aria-label="${nombre}"><table><thead><tr><th>Invitado</th><th>Categoría</th><th>CEDIS</th><th>Origen</th><th>Estatus</th><th>Correo de validación</th><th>Acciones</th></tr></thead><tbody>${filas.map(fila).join("")||`<tr><td colspan="7">${INVR_ERR?"Consulta con incidencias; no se puede confirmar la lista.":"Sin invitaciones."}</td></tr>`}</tbody></table></div><p class="doc-scroll-hint">Desliza horizontalmente para ver toda la tabla.</p>`;
  const vigentes=INVR.filter(x=>x.estatus!=="cancelada"),canceladas=INVR.filter(x=>x.estatus==="cancelada");
  const cedOpts=`<option value="">CEDIS (opcional)…</option>`+INVR_CEDIS.map(c=>`<option value="${esc(c.id)}">${esc((CLIENTES_NOMBRE[String(c.cliente_id)]||"")+" · "+c.nombre)}</option>`).join("");
  const flotOpts=`<option value="">${INVR_LOADING?"Cargando flotilleros…":INVR_FLOTAS.length?"Selecciona un flotillero…":"No hay flotilleros activos o invitados disponibles"}</option>`+INVR_FLOTAS.map(p=>`<option value="${esc(p.tipo)}:${esc(p.id)}">${esc(p.nombre)} · ${p.tipo==="invitacion"?"invitado, pendiente de registro":"activo"}</option>`).join("");
  const sinResumen=INVR_LOADING||INVR_ERR;
  return `<div class="doc-page inv-page">
    <div class="doc-intro"><span class="doc-eyebrow">Gestión de incorporaciones</span><h3>Invitaciones y seguimiento</h3><p>Administra el acceso de flotilleros y drivers, las aprobaciones y la validación del correo.</p></div>
    ${INVR_ERR?`<div class="errbox" role="alert">${esc(INVR_ERR)}</div>`:""}
    <div class="doc-summary" aria-label="Resumen de invitaciones">
      <div class="doc-metric"><span>No canceladas</span><strong>${sinResumen?"—":vigentes.length}</strong><small>Invitaciones y solicitudes</small></div>
      <div class="doc-metric"><span>Por aprobar</span><strong>${sinResumen?"—":pend.length}</strong><small>Solicitudes de flotilleros</small></div>
      <div class="doc-metric"><span>Correo validado</span><strong>${sinResumen?"—":vigentes.filter(x=>x.correo_validado_en).length}</strong><small>Entre las no canceladas</small></div>
    </div>
    <section class="doc-import">
    <div class="doc-import-head"><span class="doc-eyebrow">Nueva incorporación</span><h3>Invitar flotillero o driver</h3><p>Define la categoría y la relación operativa del invitado.</p></div>
    ${INVR_LOADING?'<p role="status">Cargando invitaciones y flotilleros…</p>':""}
    <fieldset ${INVR_LOADING?"disabled":""} class="inv-form">
      <legend class="inv-sr-only">Datos de la invitación</legend>
      <div class="doc-import-grid">
      <label class="doc-import-field">Nombre o razón social<input id="iv-n" placeholder="Nombre del invitado"></label>
      <label class="doc-import-field">Correo electrónico<input id="iv-m" type="email" placeholder="correo@ejemplo.com"></label>
      <label class="doc-import-field">Categoría<select id="iv-t"><option value="flotillero">Flotillero</option><option value="independiente">Driver independiente</option><option value="driver"${INV_PRESELECCION?" selected":""}>Driver de flotillero</option></select></label>
      <label class="doc-import-field">Esquema<select id="iv-r"><option value="">Selecciona un esquema…</option><option value="FACTURA">Con factura</option><option value="SIN FACTURA">Libre (sin factura)</option></select></label>
      <label class="doc-import-field">CEDIS<select id="iv-c">${cedOpts}</select></label>
      <label class="doc-import-field">Flotillero<select id="iv-p" class="hide" disabled>${flotOpts}</select></label>
      </div>
      <div class="doc-import-footer"><p class="inv-note">Para vincular desde el inicio, elige «Driver de flotillero» y su flotillero activo o invitado. Si aún no se registra, el driver deberá esperar. Para flotilleros e independientes, supervisores y coordinadores deben elegir un CEDIS asignado.</p><button class="btn" id="iv-ok">Invitar</button></div>
    </fieldset></section>
    <section class="doc-section"><div class="doc-section-title"><div><h3>Invitaciones y solicitudes</h3><p>Seguimiento de incorporaciones y solicitudes por aprobar.</p></div><button class="btn ghost sm" id="iv-actualizar" ${INVR_LOADING?"disabled":""}>Actualizar estados</button></div>
    <div class="inv-notice"><b>Regla de validación de correo</b><p>Si una cuenta de driver o flotillero sigue sin validar 48 horas después del alta, el sistema reenvía una vez el correo desde Supabase Auth. Si el reenvío falla, el supervisor asignado recibe una alerta para enviarlo manualmente desde Supabase Auth. El proceso corre cada 30 minutos y está sujeto a los límites del proveedor; la fecha de envío no garantiza entrega.</p></div>
    ${tabla(vigentes,"Invitaciones y solicitudes")}</section>
    <section class="doc-section inv-cancelled"><div class="doc-section-title"><div><h3>Canceladas (${esc(canceladas.length)})</h3><p>Eliminar de la lista conserva el historial y no elimina cuentas.</p></div></div>${tabla(canceladas,"Invitaciones canceladas")}</section></div>`}
function enlazarInvitaciones(){
  const run=async(b,fn)=>{b.disabled=true;try{const {data,error}=await fn();if(error)throw error;toast(data||"Listo");await cargarInvitaciones();render()}catch(error){toast(error.message);b.disabled=false}};
  const confirmarYEnviar=async(b,email,fn)=>{
    b.disabled=true;
    try{if(!await confirmarEstadoInvitacion(email)){b.disabled=false;return}await run(b,fn)}
    catch(error){toast(error.message);b.disabled=false}
  };
  const tipo=$("iv-t"),esquema=$("iv-r"),cedis=$("iv-c"),flotilla=$("iv-p");
  if(tipo){
    if(INV_PRESELECCION&&INVR_FLOTAS.length){
      flotilla.value=INV_PRESELECCION;
      if(!flotilla.value)toast("El flotillero ya no está disponible; selecciona otro.");
      INV_PRESELECCION=null;
    }
    const actualizar=()=>{const esDriver=tipo.value==="driver";esquema.disabled=esDriver;cedis.disabled=esDriver;cedis.classList.toggle("hide",esDriver);flotilla.disabled=!esDriver;flotilla.classList.toggle("hide",!esDriver)};
    tipo.onchange=actualizar;actualizar();
  }
  const ok=$("iv-ok");if(ok)ok.onclick=()=>{
    const params={p_email:$("iv-m").value,p_nombre:$("iv-n").value,p_tipo:$("iv-t").value,p_esquema:$("iv-r").value||null,p_cedis_id:$("iv-c").value?+$("iv-c").value:null};
    if(params.p_tipo==="driver"){
      const seleccion=$("iv-p").value;
      const flotillero=INVR_FLOTAS.find(p=>`${p.tipo}:${p.id}`===seleccion);
      if(!flotillero){toast("Selecciona un flotillero activo o invitado.");return}
      const base={p_email:params.p_email,p_nombre:params.p_nombre};
      confirmarYEnviar(ok,params.p_email,()=>flotillero.tipo==="invitacion"
        ?sb.rpc("invitar_driver_flotillero_pendiente",{...base,p_invitacion_flotillero_id:flotillero.id})
        :sb.rpc("invitar_driver_flotilla_sin_traslado",{...base,p_proveedor_id:flotillero.id}));
    }else confirmarYEnviar(ok,params.p_email,()=>sb.rpc("invitar_a_red",params));
  };
  document.querySelectorAll("[data-inv-editar]").forEach(b=>b.onclick=()=>editarInvitacion(+b.dataset.invEditar));
  document.querySelectorAll("[data-inv-ok]").forEach(b=>b.onclick=()=>{
    const id=+b.dataset.invOk,inv=INVR.find(x=>x.id===id);
    if(!inv){toast("No se encontró la solicitud; actualiza la lista.");return}
    confirmarYEnviar(b,inv.email,()=>sb.rpc("resolver_invitacion_red",{p_id:id,p_aprobar:true}));
  });
  document.querySelectorAll("[data-inv-compartir]").forEach(a=>a.onclick=async e=>{
    e.preventDefault();
    const id=+a.dataset.invCompartir,inv=INVR.find(x=>x.id===id),canal=a.dataset.canal;
    if(!inv){toast("No se encontró la invitación; actualiza la lista.");return}
    if(a.dataset.ocupado==="1")return;
    a.dataset.ocupado="1";
    const ventana=window.open("","_blank");
    if(!ventana){a.dataset.ocupado="";toast(`Permite las ventanas emergentes para abrir ${canal==="correo"?"Gmail":"WhatsApp"}.`);return}
    ventana.opener=null;
    try{
      if(!await confirmarEstadoInvitacion(inv.email)){ventana.close();return}
      const {error}=await sb.rpc("registrar_preparacion_invitacion_red",{p_id:id,p_canal:canal});
      if(error)throw new Error("No se pudo registrar la preparación: "+error.message);
      ventana.location.href=a.href;
      await cargarInvitaciones();if(tab==="w")render();
    }catch(error){ventana.close();toast(error.message)}
    finally{a.dataset.ocupado=""}
  });
  document.querySelectorAll("[data-inv-no]").forEach(b=>b.onclick=()=>{const m=prompt("Motivo del rechazo");if(m===null)return;run(b,()=>sb.rpc("resolver_invitacion_red",{p_id:+b.dataset.invNo,p_aprobar:false,p_motivo:m}))});
  document.querySelectorAll("[data-inv-x]").forEach(b=>b.onclick=()=>run(b,()=>sb.rpc("cancelar_invitacion_red",{p_id:+b.dataset.invX})));
  document.querySelectorAll("[data-inv-eliminar]").forEach(b=>b.onclick=()=>{
    if(confirm("¿Eliminar esta invitación cancelada de la lista? Se conservará su historial; no se eliminará ninguna cuenta."))return run(b,()=>sb.rpc("eliminar_invitacion_red",{p_id:+b.dataset.invEliminar}));
  });
  const actualizar=$("iv-actualizar");if(actualizar)actualizar.onclick=async()=>{actualizar.disabled=true;await cargarInvitaciones();render()};
}
function editarInvitacion(id){
  const inv=INVR.find(x=>x.id===id&&x.estatus==="enviada");
  if(!inv){toast("La invitación ya no está disponible; actualiza la lista.");return}
  const modal=$("modal");
  const seleccion=inv.proveedor_id?`proveedor:${inv.proveedor_id}`:inv.invitacion_flotillero_id?`invitacion:${inv.invitacion_flotillero_id}`:"";
  const flotillas=INVR_FLOTAS.map(p=>`<option value="${esc(p.tipo)}:${esc(p.id)}" ${seleccion===`${p.tipo}:${p.id}`?"selected":""}>${esc(p.nombre)} · ${p.tipo==="invitacion"?"invitado":"activo"}</option>`).join("");
  const cedis=INVR_CEDIS.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(inv.cedis_id)?"selected":""}>${esc((CLIENTES_NOMBRE[String(c.cliente_id)]||"")+" · "+c.nombre)}</option>`).join("");
  modal.innerHTML=`<div class="box"><h2>Editar invitación</h2>
    <p>Solo para invitaciones sin cuenta. Los cambios no envían correo automáticamente.</p>
    <label>Nombre</label><input id="ie-nombre" type="text" maxlength="200" value="${esc(inv.nombre||"")}">
    <label>Correo de invitación</label><input id="ie-email" type="text" maxlength="254" value="${esc(inv.email)}">
    <label>Categoría</label><select id="ie-tipo">${Object.entries(INV_TIPO).map(([v,n])=>`<option value="${v}" ${inv.tipo===v?"selected":""}>${esc(n)}</option>`).join("")}</select>
    <div id="ie-independiente"><label>Esquema</label><select id="ie-esquema"><option value="">Sin definir</option><option value="FACTURA" ${inv.esquema==="FACTURA"?"selected":""}>Con factura</option><option value="SIN FACTURA" ${inv.esquema==="SIN FACTURA"?"selected":""}>Sin factura</option></select>
    <label>CEDIS</label><select id="ie-cedis"><option value="">Selecciona un CEDIS…</option>${cedis}</select></div>
    <div id="ie-driver"><label>Flotillero</label><select id="ie-flotilla"><option value="">Selecciona un flotillero…</option>${flotillas}</select></div>
    <div id="ie-error"></div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn ghost" id="ie-cancelar">Cancelar</button><button class="btn" id="ie-guardar">Guardar cambios</button></div></div>`;
  modal.classList.remove("hide");
  const actualizar=()=>{const driver=$("ie-tipo").value==="driver";$("ie-driver").classList.toggle("hide",!driver);$("ie-independiente").classList.toggle("hide",driver)};
  $("ie-tipo").onchange=actualizar;actualizar();
  $("ie-cancelar").onclick=()=>modal.classList.add("hide");
  $("ie-guardar").onclick=async()=>{
    const b=$("ie-guardar"),errorBox=$("ie-error"),tipo=$("ie-tipo").value,email=$("ie-email").value.trim();
    const original={email:inv.email,nombre:inv.nombre??null,tipo:inv.tipo,esquema:inv.esquema??null,cedis_id:inv.cedis_id??null,proveedor_id:inv.proveedor_id??null,invitacion_flotillero_id:inv.invitacion_flotillero_id??null};
    const fleet=tipo==="driver"?INVR_FLOTAS.find(p=>`${p.tipo}:${p.id}`===$("ie-flotilla").value):null;
    if(tipo==="driver"&&!fleet){errorBox.innerHTML='<div class="errbox">Selecciona un flotillero disponible.</div>';return}
    b.disabled=true;errorBox.innerHTML="";
    try{
      if(!await confirmarEstadoInvitacion(email)){b.disabled=false;return}
      const {data,error}=await sb.rpc("editar_invitacion_red",{p_id:id,p_original:original,p_email:email,p_nombre:$("ie-nombre").value,p_tipo:tipo,p_esquema:tipo==="driver"?null:$("ie-esquema").value||null,p_cedis_id:tipo==="driver"?null:($("ie-cedis").value?+$("ie-cedis").value:null),p_proveedor_id:fleet?.tipo==="proveedor"?fleet.id:null,p_invitacion_flotillero_id:fleet?.tipo==="invitacion"?fleet.id:null});
      if(error)throw error;
      modal.classList.add("hide");await cargarInvitaciones();if(tab==="w")render();toast(data);
    }catch(error){errorBox.innerHTML=`<div class="errbox">${esc(error.message||error)}</div>`;b.disabled=false}
  };
}
function enlazar(){
  if(tab==="w")enlazarInvitaciones();
  if(tab==="j")enlazarPadron();
  const ap=$("analytics-period");if(ap)ap.onchange=()=>{analyticsGrain=ap.value;render()};
  const fp=$("finance-period");if(fp)fp.onchange=()=>{financeGrain=fp.value;render()};
  const importDoc=$("doc-flota-save");if(importDoc)importDoc.onclick=importarDocumentoFlota;
  const docDriver=$("doc-flota-driver"),docTipo=$("doc-flota-type");
  if(docDriver&&docTipo){
    const actualizarTipos=()=>{const d=DOCDRIVERS.find(x=>x.id===docDriver.value),actual=docTipo.value;
      docTipo.innerHTML=(d?tiposExpediente(d):DOC_OPS_TIPOS.filter(([k])=>!DOC_FLOTILLERO.includes(k))).map(([k,n])=>`<option value="${esc(k)}">${esc(n)}</option>`).join("");
      if([...docTipo.options].some(o=>o.value===actual))docTipo.value=actual;
      actualizarFecha()};
    const actualizarFecha=()=>{const sin=DOC_SIN_VIGENCIA.includes(docTipo.value);$("doc-flota-date-label").classList.toggle("hide",sin);$("doc-flota-date").disabled=sin;if(sin)$("doc-flota-date").value=""};
    docDriver.onchange=actualizarTipos;docTipo.onchange=actualizarFecha;actualizarTipos();
  }
  document.querySelectorAll("[data-eq-d]").forEach(b=>b.onclick=()=>{EQ_ABIERTO=EQ_ABIERTO===b.dataset.eqD?null:b.dataset.eqD;render()});
  document.querySelectorAll("[data-asg-fix]").forEach(b=>b.onclick=()=>abrirFormAsignacion(CSV_ASIGNACIONES_RESULT.errores[+b.dataset.asgFix]));
  document.querySelectorAll("[data-asg-edit]").forEach(b=>b.onclick=()=>{const [cli,ced]=b.dataset.asgEdit.split("|"),a=EQ_ASIG.find(x=>String(x.cliente_id)===cli&&String(x.cedis_id)===ced);if(a)abrirFormAsignacion({cliente_id:a.cliente_id,cedis_id:a.cedis_id,supervisor_id:a.supervisor_id,coordinador_id:a.coordinador_id})});
  document.querySelectorAll("[data-asg-del]").forEach(b=>b.onclick=()=>quitarAsignacion(b.dataset.asgDel));
  const asgNew=$("asg-new");if(asgNew)asgNew.onclick=()=>{ASG_FORM={cliente_id:"",cedis_id:"",supervisor_id:"",coordinador_id:"",origen:""};render()};
  const asgQ=$("asg-q");if(asgQ)asgQ.onchange=()=>{ASG_FILTRO=asgQ.value;render()};
  const asgCli=$("asg-cli");if(asgCli)asgCli.onchange=()=>{leerFormAsignacion();ASG_FORM.cedis_id="";render()};
  const asgSave=$("asg-save");if(asgSave)asgSave.onclick=guardarAsignacionManual;
  const asgCancel=$("asg-cancel");if(asgCancel)asgCancel.onclick=()=>{ASG_FORM=null;render()};
  const importAssignments=$("asignaciones-import");if(importAssignments)importAssignments.onclick=importarAsignaciones;
  document.querySelectorAll("[data-tar-ok]").forEach(b=>b.onclick=()=>resolverCambioTarifario(+b.dataset.tarOk,true));
  document.querySelectorAll("[data-tar-no]").forEach(b=>b.onclick=()=>resolverCambioTarifario(+b.dataset.tarNo,false));
  const pnrSave=$("pnr-new-save");if(pnrSave)pnrSave.onclick=crearPnROps;
  document.querySelectorAll("[data-pnr-action]").forEach(b=>b.onclick=()=>resolverPnROps(b.dataset.pnrId,b.dataset.pnrAction));
  const nsClient=$("ns-client");if(nsClient)nsClient.onchange=()=>{actualizarCedisNoShow(nsClient.value);actualizarCamposWalmartNoShow()};
  const nsDriver=$("ns-driver");if(nsDriver)nsDriver.onchange=()=>actualizarProveedorNoShow(nsDriver.value);
  const nsSave=$("ns-report-save");if(nsSave)nsSave.onclick=crearReporteNoShow;
  const wmRet=$("wm-retencion-abrir");if(wmRet)wmRet.onclick=abrirRetencionWalmart;
  document.querySelectorAll("[data-wm-ns-precierre]").forEach(b=>b.onclick=()=>abrirPrecierreNoShowWalmart(b.dataset.wmNsPrecierre));
  document.querySelectorAll("[data-ns-resolve]").forEach(b=>b.onclick=()=>resolverApelacionNoShowOps(b.dataset.nsId,b.dataset.nsResolve));
  document.querySelectorAll("[data-doc-approve]").forEach(b=>b.onclick=()=>resolverDocumento(b.dataset.docApprove,true));
  document.querySelectorAll("[data-doc-reject]").forEach(b=>b.onclick=()=>resolverDocumento(b.dataset.docReject,false));
  document.querySelectorAll("[data-det]").forEach(b=>b.onclick=()=>verDetalleRuta(b.dataset.det));
  document.querySelectorAll("[data-coppel-revision]").forEach(b=>b.onclick=()=>abrirRevisionCoppel(b.dataset.coppelRevision));
  document.querySelectorAll("[data-coppel-cancelacion]").forEach(b=>b.onclick=()=>abrirSemanaCancelacionCoppel(b.dataset.coppelCancelacion));
  document.querySelectorAll("[data-coppel-autorizar]").forEach(b=>b.onclick=()=>autorizarAjusteCoppel(b.dataset.coppelAutorizar,b));
  document.querySelectorAll("[data-coppel-destino]").forEach(b=>b.onclick=()=>autorizarDestinoCoppel(b.dataset.coppelDestino,b));
  document.querySelectorAll("[data-val]").forEach(b=>b.onclick=()=>abrirValidar(+b.dataset.val));
  document.querySelectorAll("[data-rechazo-restaurar]").forEach(b=>b.onclick=()=>restaurarValidacionRuta(+b.dataset.rechazoRestaurar,b));
  document.querySelectorAll("[data-anu]").forEach(b=>b.onclick=()=>anular(+b.dataset.anu));
  document.querySelectorAll("[data-af-ver]").forEach(b=>b.onclick=()=>{AFILIADO_ABIERTO=AFILIADO_ABIERTO===b.dataset.afVer?null:b.dataset.afVer;AFILIADO_EDITAR=null;AFILIADO_PROVEEDOR_EDITAR=null;render()});
  document.querySelectorAll("[data-af-editar]").forEach(b=>b.onclick=()=>{AFILIADO_EDITAR=b.dataset.afEditar;AFILIADO_PROVEEDOR_EDITAR=null;render()});
  document.querySelectorAll("[data-af-cancelar],[data-af-cancelar-driver]").forEach(b=>b.onclick=()=>{AFILIADO_EDITAR=null;render()});
  document.querySelectorAll("[data-af-guardar],[data-af-guardar-driver]").forEach(b=>b.onclick=()=>guardarContactoFlota(b));
  document.querySelectorAll("[data-af-editar-driver]").forEach(b=>b.onclick=()=>{AFILIADO_EDITAR=AFILIADO_EDITAR===b.dataset.afEditarDriver?null:b.dataset.afEditarDriver;AFILIADO_PROVEEDOR_EDITAR=null;render()});
  document.querySelectorAll("[data-af-editar-prov]").forEach(b=>b.onclick=()=>{AFILIADO_PROVEEDOR_EDITAR=AFILIADO_PROVEEDOR_EDITAR===b.dataset.afEditarProv?null:b.dataset.afEditarProv;AFILIADO_EDITAR=null;render()});
  document.querySelectorAll("[data-af-prov-cancelar]").forEach(b=>b.onclick=()=>{AFILIADO_PROVEEDOR_EDITAR=null;render()});
  document.querySelectorAll("[data-af-prov-guardar]").forEach(b=>b.onclick=()=>guardarProveedorFlota(b));
  document.querySelectorAll("[data-af-vincular]").forEach(b=>b.onclick=()=>abrirSolicitudVinculacion(b.dataset.afVincular));
  document.querySelectorAll("[data-af-cancelar-solicitud]").forEach(b=>b.onclick=async()=>{if(!confirm("¿Cancelar esta solicitud de vinculación?"))return;b.disabled=true;const {error}=await sb.rpc("cancelar_solicitud_vinculacion_flota",{p_id:+b.dataset.afCancelarSolicitud});if(error){toast(error.message);b.disabled=false;return}await cargarAfiliados();render();toast("Solicitud cancelada")});
  document.querySelectorAll("[data-af-invitar]").forEach(b=>b.onclick=()=>{INV_PRESELECCION=`proveedor:${b.dataset.afInvitar}`;INVR_FLOTAS=[];document.querySelector('.role-nav button[data-t="w"]').click()});
  document.querySelectorAll("[data-cpa]").forEach(b=>b.onclick=()=>resolverCambio(+b.dataset.cpa,true));document.querySelectorAll("[data-cpr]").forEach(b=>b.onclick=()=>resolverCambio(+b.dataset.cpr,false));document.querySelectorAll("[data-bja]").forEach(b=>b.onclick=()=>resolverBaja(+b.dataset.bja,true));document.querySelectorAll("[data-bjr]").forEach(b=>b.onclick=()=>resolverBaja(+b.dataset.bjr,false));document.querySelectorAll("[data-ap]").forEach(b=>b.onclick=()=>resolverVal(+b.dataset.ap,true));document.querySelectorAll("[data-rc]").forEach(b=>b.onclick=()=>resolverVal(+b.dataset.rc,false));document.querySelectorAll("[data-rev]").forEach(b=>b.onclick=()=>revisarCan(+b.dataset.rev));
  document.querySelectorAll("[data-wm-cancelacion]").forEach(b=>b.onclick=()=>abrirPagoCancelacionWalmart(+b.dataset.wmCancelacion));
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
function actualizarCedisNoShow(clientId){
  const select=$("ns-cedis");if(!select)return;
  const client=NO_SHOW_CLIENTS.find(c=>String(c.id)===String(clientId));
  const cedis=(client?.cedis||[]).slice().sort((a,b)=>a.nombre.localeCompare(b.nombre));
  select.innerHTML='<option value="">Selecciona un CEDIS…</option>'+cedis.map(c=>`<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("");
  select.disabled=!cedis.length;
}
function actualizarCamposWalmartNoShow(){
  WM_NO_SHOW_REVIEW=null;
  const fields=$("ns-wm-fields");if(!fields)return;
  const client=NO_SHOW_CLIENTS.find(c=>String(c.id)===String($("ns-client").value));
  fields.classList.toggle("hide",String(client?.nombre||"").trim().toUpperCase()!=="WALMART");
}
function actualizarProveedorNoShow(driverId){
  const element=$("ns-provider");if(!element)return;
  const provider=provDe(driverId);
  element.textContent=provider?.nombre||"Sin flotillero asignado";
}
function textoInapropiadoNoShow(value){
  const normalized=String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ");
  return /(^| )(puta|puto|putas|putos|mierda|chingar|chingado|chingada|chingados|chingadas|chingue|chingues|verga|vergas|pendejo|pendeja|pendejos|pendejas|culero|culera|culeros|culeras|cabron|cabrona|cabrones|cabronas|pinche|pinches|jodido|jodida|joder|maricon|maricona|maricones|fuck|fucking|shit|bitch|asshole|bastard)( |$)/.test(normalized);
}
function abrirPrecierreNoShowWalmart(driverId){
  if(!WALMART_VALIDACION_ENABLED||ROL!=="ih"){toast("El precierre requiere un supervisor autorizado.");return}
  const m=$("modal"),driver=DRV.find(d=>String(d.id)===String(driverId));
  let casos=[],revision=0,solicitud=null;
  m.classList.remove("hide");
  m.innerHTML=`<div class="box" style="max-height:90vh;overflow:auto"><h2>NO SHOW Walmart · precierre</h2>
    <div>${esc(driver?.nombre||"Driver")}</div>
    <label>Semana de pago (lunes) <input id="wm-ns-semana" type="date" value="${esc(lunesCoppel(new Date()))}"></label>
    <div class="note">Se muestran los registros de sábado a viernes. Los reportados desde el viernes a las 12:00 p. m. y los casos con apelación pendiente pasan al siguiente periodo. Selecciona solo los descuentos que deseas aplicar.</div>
    <div id="wm-ns-resultado"></div><div id="wm-ns-error"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="wm-ns-consultar">Consultar</button>
    <button class="btn" id="wm-ns-aplicar" disabled>Aplicar seleccionados</button><button class="btn ghost" id="wm-ns-cerrar">Cerrar</button></div></div>`;
  const semana=$("wm-ns-semana"),resultado=$("wm-ns-resultado"),error=$("wm-ns-error"),consultar=$("wm-ns-consultar"),aplicar=$("wm-ns-aplicar"),cerrar=$("wm-ns-cerrar");
  const invalidar=()=>{revision++;casos=[];solicitud=null;resultado.innerHTML="";error.innerHTML="";aplicar.disabled=true};
  semana.onchange=invalidar;
  cerrar.onclick=()=>{invalidar();m.classList.add("hide")};
  consultar.onclick=async()=>{
    invalidar();
    const fecha=semana.value,version=revision;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)||new Date(`${fecha}T00:00:00Z`).getUTCDay()!==1){
      error.innerHTML='<div class="errbox">Selecciona el lunes de la semana.</div>';return;
    }
    consultar.disabled=true;semana.disabled=true;
    let response;
    try{response=await sb.rpc("walmart_consultar_no_show_precierre",{p_driver_id:driverId,p_lunes:fecha})}
    catch(e){if(version===revision)error.innerHTML=`<div class="errbox">No se pudo consultar: ${esc(e.message||e)}</div>`;consultar.disabled=false;semana.disabled=false;return}
    consultar.disabled=false;semana.disabled=false;
    if(version!==revision)return;
    if(response.error){error.innerHTML=`<div class="errbox">No se pudo consultar: ${esc(response.error.message)}</div>`;return}
    const data=response.data;
    if(!data||data.driver_id!==driverId||data.lunes!==fecha||!Array.isArray(data.casos)||data.cantidad!==data.casos.length
      ||data.casos.some(c=>!c.caso_id||typeof c.seleccionable!=="boolean"||typeof c.aplicado!=="boolean"
        ||c.monto==null||!Number.isFinite(Number(c.monto)))){
      error.innerHTML='<div class="errbox">El precierre devolvió una respuesta inválida.</div>';return;
    }
    casos=data.casos;
    resultado.innerHTML=`<h3>${esc(data.cantidad)} NO SHOW para revisión</h3>${casos.map(c=>`<div class="item"><label>
      <input type="checkbox" data-wm-ns-caso="${esc(c.caso_id)}" ${c.seleccionable?"":"disabled"}>
      ${esc(noShowFmtDate(c.fecha_servicio))} · ${esc(c.cedis||"CEDIS")} · 60 %: ${esc(fm(c.monto))}</label>
      <small>${esc(c.aplicado?"Aplicado en esta semana":c.seleccionable?"Disponible para seleccionar":c.estado==="apelacion_aceptada"?"Apelación aceptada":c.estado==="apelado"?"Apelación pendiente; revisar en otra semana":"No disponible; revisar estado y plazo")}</small></div>`).join("")||'<div class="note">Sin registros para esta semana.</div>'}`;
    m.querySelectorAll("[data-wm-ns-caso]").forEach(box=>box.onchange=()=>{solicitud=null;aplicar.disabled=!m.querySelector("[data-wm-ns-caso]:checked")});
  };
  aplicar.onclick=async()=>{
    const seleccion=[...m.querySelectorAll("[data-wm-ns-caso]:checked")].map(box=>casos.find(c=>c.caso_id===box.dataset.wmNsCaso));
    if(!seleccion.length||seleccion.some(c=>!c?.seleccionable)){error.innerHTML='<div class="errbox">Selecciona los descuentos disponibles.</div>';return}
    if(!globalThis.crypto?.randomUUID){error.innerHTML='<div class="errbox">Este dispositivo no permite identificar la solicitud de forma segura.</div>';return}
    solicitud||=seleccion.map(c=>({caso_id:c.caso_id,solicitud_id:globalThis.crypto.randomUUID(),monto:c.monto}));
    aplicar.disabled=true;consultar.disabled=true;semana.disabled=true;cerrar.disabled=true;
    m.querySelectorAll("[data-wm-ns-caso]").forEach(box=>box.disabled=true);
    let response;
    try{response=await sb.rpc("walmart_aplicar_no_shows_precierre",{p_driver_id:driverId,p_lunes:semana.value,p_seleccion:solicitud})}
    catch(e){error.innerHTML=`<div class="errbox">No se confirmó la operación: ${esc(e.message||e)}. Puedes reintentar sin cambiar la selección.</div>`;response=null}
    if(response?.error)error.innerHTML=`<div class="errbox">No se pudieron aplicar: ${esc(response.error.message)}</div>`;
    if(response&&!response.error){
      if(!Array.isArray(response.data)||response.data.length!==solicitud.length){
        error.innerHTML='<div class="errbox">Respuesta inválida. Consulta de nuevo antes de continuar.</div>';
      }else{
        solicitud=null;consultar.disabled=false;semana.disabled=false;cerrar.disabled=false;
        await consultar.onclick();toast("Descuentos NO SHOW registrados en la semana seleccionada");return;
      }
    }
    consultar.disabled=false;semana.disabled=false;aplicar.disabled=false;cerrar.disabled=false;
    m.querySelectorAll("[data-wm-ns-caso]").forEach(box=>{const c=casos.find(x=>x.caso_id===box.dataset.wmNsCaso);box.disabled=!c?.seleccionable});
  };
  void consultar.onclick();
}
async function crearReporteNoShow(){
  const button=$("ns-report-save"),errorBox=$("ns-form-error");
  const driverId=$("ns-driver").value,cedisId=$("ns-cedis").value,fecha=$("ns-date").value;
  const observaciones=$("ns-observations").value.trim();
  const packagesText=$("ns-packages").value.trim(),amountText=$("ns-amount").value.trim();
  const packages=packagesText?Number(packagesText):null,amount=amountText?Number(amountText):null;
  const client=NO_SHOW_CLIENTS.find(c=>String(c.id)===String($("ns-client").value));
  const isWalmart=String(client?.nombre||"").trim().toUpperCase()==="WALMART";
  errorBox.innerHTML="";
  if(!driverId||!cedisId||!fecha||!observaciones){errorBox.innerHTML='<div class="errbox">Completa Driver, cliente, CEDIS, fecha y observaciones.</div>';return}
  if(observaciones.length>200||textoInapropiadoNoShow(observaciones)){errorBox.innerHTML='<div class="errbox">Las observaciones deben tener hasta 200 caracteres y no incluir groserías.</div>';return}
  if(packages!==null&&(!Number.isInteger(packages)||packages<1||packages>10000)){errorBox.innerHTML='<div class="errbox">La cantidad contratada debe ser un entero entre 1 y 10,000.</div>';return}
  if(amount!==null&&(!Number.isFinite(amount)||amount<=0)){errorBox.innerHTML='<div class="errbox">El importe manual debe ser mayor que cero.</div>';return}
  if(isWalmart&&WALMART_VALIDACION_ENABLED){
    if(packages!==null||amount!==null){errorBox.innerHTML='<div class="errbox">Walmart usa la tarifa y el 60 % configurados; deja vacíos los importes manuales y entregas contratadas.</div>';return}
    const proveedor=$("ns-wm-provider").value,unidad=$("ns-wm-unit").value,opcion=$("ns-wm-option").value;
    if(!proveedor||!unidad||!opcion){errorBox.innerHTML='<div class="errbox">Confirma el proveedor, la unidad y el modelo Walmart.</div>';return}
    const inputs={driverId,cedisId,fecha,observaciones,proveedor,unidad,opcion},fingerprint=JSON.stringify(inputs);
    button.disabled=true;
    let creado=false;
    try{
      if(!WM_NO_SHOW_REVIEW||WM_NO_SHOW_REVIEW.fingerprint!==fingerprint){
        const result=await sb.rpc("walmart_previsualizar_no_show",{
          p_cedis_id:Number(cedisId),p_fecha:fecha,p_unidad:unidad,p_proveedor_id:Number(proveedor),p_opcion:Number(opcion)
        });
        if(result.error)throw result.error;
        if(!result.data||result.data.base_servicio==null||result.data.monto_penalizacion==null
          ||!Number.isFinite(Number(result.data.base_servicio))||!Number.isFinite(Number(result.data.monto_penalizacion)))
          throw new Error("El cálculo Walmart devolvió una respuesta inválida");
        if(!globalThis.crypto?.randomUUID)throw new Error("Este dispositivo no permite identificar de forma segura la solicitud");
        WM_NO_SHOW_REVIEW={fingerprint,calculo:result.data,solicitud:globalThis.crypto.randomUUID()};
        errorBox.innerHTML=`<div class="note">Base ${esc(fm(result.data.base_servicio))} · NO SHOW 60 %: ${esc(fm(result.data.monto_penalizacion))}. Revisa y pulsa nuevamente para confirmar.</div>`;
        button.textContent="Confirmar NO SHOW Walmart";button.disabled=false;return;
      }
      const {error}=await sb.rpc("walmart_crear_no_show",{
        p_solicitud_id:WM_NO_SHOW_REVIEW.solicitud,p_driver_id:driverId,p_cedis_id:Number(cedisId),
        p_fecha:fecha,p_unidad:unidad,p_proveedor_id:Number(proveedor),p_opcion:Number(opcion),
        p_observaciones:observaciones,p_calculo_esperado:WM_NO_SHOW_REVIEW.calculo
      });
      if(error)throw error;
      creado=true;
      WM_NO_SHOW_REVIEW=null;
      await cargarNoShowsOps();render();
      if(NO_SHOW_ERR){toast("Reporte creado, pero no se pudo actualizar la lista: "+NO_SHOW_ERR);return}
      toast("NO SHOW Walmart registrado; el driver puede apelar durante 6 horas");
    }catch(error){errorBox.innerHTML=`<div class="errbox">${creado?"El reporte quedó creado, pero no se pudo actualizar la vista: ":""}${esc(error.message||error)}</div>`;button.disabled=creado}
    return;
  }
  button.disabled=true;
  try{
    const {error}=await sb.rpc("crear_reporte_no_show",{
      p_driver_id:driverId,p_cedis_id:Number(cedisId),p_fecha_servicio:fecha,
      p_observaciones:observaciones,p_entregas_contratadas:packages,p_monto_manual:amount
    });
    if(error)throw error;
    await cargarNoShowsOps();render();
    if(NO_SHOW_ERR){toast("Reporte creado, pero no se pudo actualizar la lista: "+NO_SHOW_ERR);return}
    toast("Reporte NO SHOW guardado y vinculado a las ganancias del Driver");
  }catch(error){
    errorBox.innerHTML=`<div class="errbox">${esc(error.message||error)}</div>`;
    button.disabled=false;
  }
}
async function resolverApelacionNoShowOps(id,accion){
  const caso=NO_SHOW_OPS.find(c=>String(c.id)===String(id));
  const walmart=caso?.metodo_calculo==="walmart_60_saldo";
  if(walmart&&!WALMART_VALIDACION_ENABLED){toast("La resolución Walmart todavía no está habilitada");return}
  const promptText=accion==="aceptar"?(walmart?"Nota de resolución (opcional). Al aceptar, no se aplicará el descuento:":"Nota de resolución (opcional). Al aceptar, se revertirá el descuento:"):"Motivo de rechazo (opcional):";
  const mensaje=prompt(promptText);
  if(mensaje===null)return;
  const texto=mensaje.trim();
  if(texto.length>500||textoInapropiadoNoShow(texto)){toast("La nota debe tener hasta 500 caracteres y no incluir groserías");return}
  const {error}=await sb.rpc(walmart?"walmart_resolver_apelacion_no_show":"resolver_apelacion_no_show",{p_caso_id:id,p_accion:accion,p_mensaje:texto||null});
  if(error){toast(error.message);return}
  await load();
  toast(accion==="aceptar"?(walmart?"Apelación aceptada; no se aplicará el descuento":"Apelación aceptada; penalización revertida"):"Apelación rechazada; penalización vigente");
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
async function abrirSolicitudVinculacion(proveedorId){
  const titular=AFILIADOS.find(d=>d.rol==="flotillero"&&String(d.proveedor_id)===String(proveedorId)&&d.titular_id===d.id);
  if(!titular){toast("No se encontró el flotillero; actualiza la lista.");return}
  const modal=$("modal");modal.classList.remove("hide");
  modal.innerHTML=`<div class="box"><h2>Añadir driver a ${esc(titular.nombre)}</h2><p>Selecciona un driver independiente activo. Se registrará una solicitud; la aprobación y el traslado seguro aún no están disponibles. El driver no cambia de flotilla al solicitarlo.</p><div id="af-sol-contenido">Cargando drivers…</div><div id="af-sol-error"></div><button class="btn ghost" id="af-sol-cerrar">Cerrar</button></div>`;
  $("af-sol-cerrar").onclick=()=>modal.classList.add("hide");
  try{
    const drivers=await fetchPaged(()=>sb.rpc("listar_independientes_vinculacion"));
    if(modal.classList.contains("hide"))return;
    $("af-sol-contenido").innerHTML=drivers.length?`<label for="af-sol-driver">Driver independiente activo</label><select id="af-sol-driver"><option value="">Selecciona un driver…</option>${drivers.map(d=>`<option value="${esc(d.id)}">${esc(d.nombre)} · ${esc(d.codigo||"Sin código")}</option>`).join("")}</select><button class="btn" id="af-sol-guardar" style="margin:12px 8px">Solicitar vinculación</button>`:"<p>No hay drivers independientes activos disponibles.</p>";
    const guardar=$("af-sol-guardar");if(guardar)guardar.onclick=async()=>{
      const id=$("af-sol-driver").value;if(!drivers.some(d=>d.id===id)){ $("af-sol-error").innerHTML='<div class="errbox">Selecciona un driver de la lista.</div>';return}
      guardar.disabled=true;
      const {data,error}=await sb.rpc("solicitar_vinculacion_flota",{p_driver_id:id,p_proveedor_id:+proveedorId});
      if(error){$("af-sol-error").innerHTML=`<div class="errbox">${esc(error.message)}</div>`;guardar.disabled=false;return}
      modal.classList.add("hide");await cargarAfiliados();if(tab==="p")render();toast(data);
    };
  }catch(error){$("af-sol-contenido").innerHTML="";$("af-sol-error").innerHTML=`<div class="errbox">No se pudieron cargar los drivers: ${esc(error.message||error)}</div>`}
}
async function guardarContactoFlota(button){
  const d=AFILIADOS.find(x=>x.id===(button.dataset.afGuardar||button.dataset.afGuardarDriver));
  if(!d){toast("No se encontró el driver; actualiza la lista.");return}
  button.disabled=true;
  const {error}=await sb.rpc("editar_datos_driver_flota",{
    p_driver_id:d.id,p_proveedor_id:d.proveedor_id,p_nombre:$("af-nombre").value,
    p_telefono:$("af-telefono").value,p_correo_contacto:$("af-correo").value,
    p_cedis_default_id:$("af-cedis").value?Number($("af-cedis").value):null
  });
  if(error){toast(error.message);button.disabled=false;return}
  AFILIADO_EDITAR=null;await cargarAfiliados();render();toast(AFILIADOS_ERR?"Driver guardado, pero no se pudo actualizar la lista.":"Datos del driver actualizados");
}
async function guardarProveedorFlota(button){
  const proveedor=AFILIADOS.find(x=>String(x.proveedor_id)===button.dataset.afProvGuardar
    &&(String(x.titular_id)===String(x.id)||x.proveedor_tipo==="independiente"));
  if(!proveedor){toast("No se encontró el proveedor; actualiza la lista.");return}
  button.disabled=true;
  const {error}=await sb.rpc("editar_proveedor_flota",{
    p_proveedor_id:Number(proveedor.proveedor_id),
    p_nombre:$("af-prov-nombre").value,
    p_tipo:$("af-prov-tipo").value,
    p_tipo_registro:$("af-prov-esquema").value||null
  });
  if(error){toast(error.message);button.disabled=false;return}
  AFILIADO_PROVEEDOR_EDITAR=null;await cargarAfiliados();render();
  toast(AFILIADOS_ERR?"Proveedor guardado, pero no se pudo actualizar la lista.":"Datos del proveedor actualizados");
}
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
async function cargarTarifas(){if(TAR)return;const {data,error}=await sb.from("tarifas").select("id,cuenta,conc,ubicacion,ciudad,tipo_unidad,esquema,zona,variable,pago_base,tarifa_cliente,vigencia_desde,vigencia_hasta,activo").order("ubicacion").order("tipo_unidad").order("esquema").order("zona");if(error)throw error;TAR=data||[]}
const tiposSinEquivalencia=["4.5T","5T","RABÓN","TORTON SECO","TORTON REFRIGERADO","TRAILER 53 SECO","TRAILER 53 REFRIGERADO"];
const tipoTarifario=s=>String(s||"").trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
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
  if(tiposSinEquivalencia.includes(ru.tipo_unidad)){
    l=l.filter(t=>t.activo===true&&tipoTarifario(t.tipo_unidad)===tipoTarifario(ru.tipo_unidad)&&t.vigencia_desde<=fecha&&(!t.vigencia_hasta||t.vigencia_hasta>=fecha));
    if(!l.length)nota+=(nota?" ":"")+`No hay tarifa vigente para ${ru.tipo_unidad}; no se asignará una tarifa equivalente.`;
  }
  return {l,nota};
}
function sugeridasConPeak(ru,todas,peakTarifaId){
  if(peakTarifaId==null||todas)return sugeridas(ru,todas);
  const tarifa=TAR.find(t=>String(t.id)===String(peakTarifaId)&&t.cuenta==="COPPEL"&&t.activo===true);
  return tarifa?{l:[tarifa],nota:"Tarifa Peak asignada al CEDIS. La base y el bono se calculan al validar."}:
    {l:[],nota:"No se encontró la tarifa Peak activa del CEDIS. Actualiza el panel y contacta a Operaciones."};
}
const filaRes=(a,b,cls="")=>`<tr class="${cls}"><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
function tablaRes(j){
  return `<table class="res">`+filaRes("Efectividad",pc(j.efectividad)+" ("+j.entregados+" de "+j.asignados+")")+
   filaRes("Al proveedor","","h")+filaRes("Pago base",fm(j.pago_base))+(Number(j.entregas_extra)?filaRes("Extra por "+j.entregas_extra+" entregas adicionales",fm(j.pago_entrega_extra)):"")+(j.regla_pago?filaRes("Regla aplicada: "+j.regla_pago,fm(j.dcto_pago)):"")+(Number(j.bono_pago)?filaRes("Bono: "+j.regla_bono,fm(j.bono_pago)):"")+(Number(j.ajuste_pago)?filaRes("Ajuste",fm(j.ajuste_pago)):"")+filaRes("Costo total",fm(j.costo_total),"t")+
   (j.registro_fiscal==="SIN FACTURA"?filaRes("Retención 5%",fm(-j.retencion))+filaRes("Neto a pagar",fm(j.neto))+filaRes("Comisión 2% (costo de Chazki)",fm(j.comision)):filaRes("IVA 16%",fm(j.iva)))+
   filaRes("Pago al proveedor ("+j.registro_fiscal.toLowerCase()+")",fm(j.pago_driver),"t")+
   filaRes("Cobro al cliente","","h")+filaRes("Cobro base",fm(j.cobro_base))+(Number(j.entregas_extra)?filaRes("Cobro extra por "+j.entregas_extra+" entregas adicionales",fm(j.cobro_entrega_extra)):"")+(j.regla_cobro?filaRes("Regla aplicada: "+j.regla_cobro,fm(j.dcto_cobro)):"")+(Number(j.ajuste_cobro)?filaRes("Ajuste",fm(j.ajuste_cobro)):"")+filaRes("Venta total",fm(j.venta_total),"t")+
   filaRes("Utilidad (venta menos costo total)",fm(j.utilidad)+" · "+pc(j.margen),"t")+`</table>`+((j.avisos||[]).length?`<div class="errbox">${esc(j.avisos.join(". "))}</div>`:"");
}
async function abrirValidarWalmart(id,ru){
  if(ROL!=="ih"){toast("La validación Walmart requiere al supervisor asignado.");return}
  const m=$("modal");
  let calculo=null,revision=0;
  m.classList.remove("hide");
  m.innerHTML=`<div class="box"><h2>Validar ruta Walmart ${esc(ru.id_ruta)}</h2>
    <div>${esc(ru.drivers.nombre)} · ${esc(ru.cedis.nombre)}</div>
    <label>Confirma el proveedor de esta ruta</label><select id="wm-val-proveedor"><option value="">Selecciona proveedor</option>${PRV.filter(p=>p.activo!==false).map(p=>`<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join("")}</select>
    <fieldset><legend>Retención Walmart (selecciona una)</legend>
      ${[0,10,15,25].map(n=>`<label><input id="wm-val-ret-${n}" type="radio" name="wm-val-ret" ${n===0?"checked":""}> ${n===0?"Sin retención":n+"%"}</label>`).join("")}</fieldset>
    <div id="wm-val-aviso"></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn ghost" id="wm-val-calcular">Calcular</button><button class="btn" id="wm-val-confirmar" disabled>Validar y generar pago</button><button class="btn ghost" id="wm-val-rechazar">Rechazar</button><button class="btn ghost" id="wm-val-cerrar">Cancelar</button></div></div>`;
  const inputs=()=>({p_ruta_id:id,p_proveedor_id:$("wm-val-proveedor").value,
    p_porcentaje_retencion:[0,10,15,25].find(n=>$(`wm-val-ret-${n}`).checked)??null,
    p_aplicar_visitas:false,p_aplicar_fallida:false});
  const invalidar=()=>{revision++;calculo=null;$("wm-val-confirmar").disabled=true;$("wm-val-aviso").innerHTML=""};
  ["wm-val-proveedor",...[0,10,15,25].map(n=>`wm-val-ret-${n}`)].forEach(x=>$(x).addEventListener("change",invalidar));
  $("wm-val-rechazar").onclick=()=>rechazarValidacionRuta(id,m,$("wm-val-rechazar"));
  $("wm-val-cerrar").onclick=()=>{invalidar();m.classList.add("hide")};
  $("wm-val-calcular").onclick=async()=>{
    invalidar();
    const args=inputs(),version=revision,boton=$("wm-val-calcular"),aviso=$("wm-val-aviso");
    if(!args.p_proveedor_id||args.p_porcentaje_retencion==null){aviso.innerHTML='<div class="errbox">Confirma el proveedor y la retención de la ruta.</div>';return}
    boton.disabled=true;
    let r;
    try{r=await sb.rpc("walmart_previsualizar_ruta_porcentaje",args)}
    catch(error){boton.disabled=false;if(version===revision)aviso.innerHTML=`<div class="errbox">No se pudo calcular: ${esc(error.message||error)}</div>`;return}
    boton.disabled=false;
    if(version!==revision)return;
    if(r.error){aviso.innerHTML=`<div class="errbox">No se pudo calcular: ${esc(r.error.message)}</div>`;return}
    if(!r.data||Number(r.data.porcentaje_retencion)!==args.p_porcentaje_retencion
      ||["pago_base","total","pago_semanal","saldo_retenido"].some(k=>r.data[k]==null||!Number.isFinite(Number(r.data[k])))){
      aviso.innerHTML='<div class="errbox">El cálculo Walmart devolvió una respuesta inválida.</div>';return;
    }
    calculo=r.data;
    aviso.innerHTML=`<div class="note">Base ${esc(fm(calculo.pago_base))} · total fiscalizado ${esc(fm(calculo.total))} · semanal antes de PNR ${esc(fm(calculo.pago_semanal))} · saldo retenido ${esc(fm(calculo.saldo_retenido))}.</div>`;
    $("wm-val-confirmar").disabled=false;
  };
  $("wm-val-confirmar").onclick=async()=>{
    if(!calculo)return;
    const args=inputs(),boton=$("wm-val-confirmar"),aviso=$("wm-val-aviso");
    const controls=["wm-val-proveedor",...[0,10,15,25].map(n=>`wm-val-ret-${n}`),"wm-val-calcular","wm-val-cerrar"].map($);
    boton.disabled=true;
    controls.forEach(control=>control.disabled=true);
    let r;
    try{r=await sb.rpc("walmart_validar_ruta",{p_ruta_id:id,p_aplicar_visitas:args.p_aplicar_visitas,
      p_aplicar_fallida:args.p_aplicar_fallida,p_calculo_esperado:calculo})}
    catch(error){boton.disabled=false;controls.forEach(control=>control.disabled=false);aviso.innerHTML=`<div class="errbox">No se pudo confirmar la validación: ${esc(error.message||error)}. Puedes reintentar.</div>`;return}
    if(r.error){boton.disabled=false;controls.forEach(control=>control.disabled=false);aviso.innerHTML=`<div class="errbox">No se pudo validar: ${esc(r.error.message)}</div>`;return}
    let auditError=null;
    try{const audit=await registrarAuditoriaValidacion(id);auditError=audit.error}
    catch(error){auditError=error}
    m.classList.add("hide");await cargaExtra();render();
    toast(auditError?"Ruta validada, pero no se registró la auditoría: "+(auditError.message||auditError):"Ruta Walmart validada y pago semanal generado");
  };
}
async function abrirValidar(id){
  const ru=R.find(x=>x.id===id);
  if(WALMART_VALIDACION_ENABLED&&String(ru.cedis.clientes.nombre||"").trim().toUpperCase()==="WALMART")
    return abrirValidarWalmart(id,ru);
  try{await cargarTarifas()}catch(error){toast("No se pudieron cargar las tarifas: "+error.message);return}
  const p=provDe(ru.driver_id),cuenta=cuentaDe(ru.cedis.clientes.nombre),m=$("modal");
  let peakTarifaId=null,peakDescuento=false;
  if(COPPEL_PEAK_ENABLED&&cuenta==="COPPEL"){
    const result=await sb.rpc("coppel_peak_tarifa_para_ruta",{p_ruta_id:id});
    if(result.error){toast("No se pudo identificar la tarifa COPPEL: "+result.error.message);return}
    peakTarifaId=result.data;
    if(peakTarifaId!=null&&ROL==="ih"){
      const decision=await sb.rpc("coppel_peak_consultar_descuento",{p_ruta_id:id});
      if(decision.error){toast("No se pudo consultar el descuento COPPEL: "+decision.error.message);return}
      peakDescuento=decision.data;
    }
  }
  m.classList.remove("hide");
  const pintar=()=>{let {l,nota}=sugeridasConPeak(ru,$("m-todas").checked,peakTarifaId);
    const z=$("m-zona").value;if(z)l=l.filter(t=>{const u=(t.zona||"").toUpperCase();return z==="LOCAL"?u.startsWith("LOCAL"):new RegExp("FORANE[AO] "+z+"( |$)").test(u)});
    if(z&&!l.length)nota=(nota?nota+" · ":"")+"No hay tarifa cargada para ese tipo de ruta";
    $("m-tar").innerHTML=(tiposSinEquivalencia.includes(ru.tipo_unidad)?'<option value="">Selecciona una tarifa</option>':"")+l.map(t=>`<option value="${esc(t.id)}">${esc([t.ubicacion,t.tipo_unidad,t.esquema,t.zona,t.variable].filter(Boolean).join(" · "))} — ${peakTarifaId!=null&&String(t.id)===String(peakTarifaId)?"pago Peak calculado":`pago ${fm(t.pago_base)}`} / cobro ${fm(t.tarifa_cliente)}</option>`).join("");
    $("m-nota-t").textContent=nota;syncPeak();reset()};
  const reset=()=>{$("m-prev").innerHTML="";$("m-ok").disabled=true};
  const esPeakSeleccionada=()=>peakTarifaId!=null&&String($("m-tar").value)===String(peakTarifaId);
  const syncPeak=()=>{
    const peak=esPeakSeleccionada();
    $("m-peak-desc-wrap").classList.toggle("hide",!(peak&&ROL==="ih"));
    $("m-ex-wrap").classList.toggle("hide",peak);
    if(peak)$("m-ex").checked=false;
  };
  m.innerHTML=`<div class="box"><h2 style="margin:0 0 4px">Validar ruta ${esc(ru.id_ruta)}</h2>
    <div style="color:var(--mut);font-size:13px">${esc(ru.drivers.nombre)} · ${esc(ru.cedis.clientes.nombre)} · ${esc(ru.cedis.nombre)} · ${esc(ru.entregados)} entregados de ${esc(ru.paquetes_asignados)}</div>
    <label>Tipo de ruta</label><select id="m-zona"><option value="">Todas</option><option value="LOCAL">Local</option><option value="1">Foránea 1</option><option value="2">Foránea 2</option><option value="3">Foránea 3</option><option value="4">Foránea 4</option></select>
    <label>Tarifa aplicable</label><select id="m-tar"></select>
    <div style="font-size:12px;color:var(--mut);margin-top:4px"><label style="display:inline;margin:0"><input type="checkbox" id="m-todas"> Ver todas las tarifas de la cuenta</label> <span id="m-nota-t" style="color:#946200"></span></div>
    <label id="m-peak-desc-wrap" class="hide" style="gap:8px;align-items:flex-start;color:var(--ink)"><input type="checkbox" id="m-peak-desc" ${peakDescuento?"checked":""}> Aplicar descuento del 5% sobre el pago base COPPEL</label>
    <label id="m-ex-wrap" style="display:flex;gap:8px;align-items:flex-start;color:var(--ink)"><input type="checkbox" id="m-ex" style="margin-top:2px"> No aplicar la penalización al pago del driver${esCoord()?"":" (requiere aprobación del coordinador; escribe el motivo en la nota)"}</label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label>Ajuste al pago (+ o −)</label><input type="number" id="m-ap" value="0" step="0.01"></div><div><label>Ajuste al cobro (+ o −)</label><input type="number" id="m-ac" value="0" step="0.01"></div></div>
    <label>Nota (opcional)</label><textarea id="m-nota" rows="2"></textarea>
    <div id="m-prev" style="margin-top:12px"></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn ghost" id="m-calc">Calcular</button><button class="btn" id="m-ok" disabled>Validar y generar pago</button><button class="btn ghost" id="m-rechazar">Rechazar</button><button class="btn ghost" id="m-x">Cancelar</button></div></div>`;
  pintar();
  $("m-todas").onchange=pintar;
  $("m-zona").onchange=pintar;
  ["m-tar","m-ex","m-ap","m-ac","m-peak-desc"].forEach(i=>$(i).addEventListener("input",()=>{syncPeak();reset()}));
  $("m-x").onclick=()=>m.classList.add("hide");
  $("m-rechazar").onclick=()=>rechazarValidacionRuta(id,m,$("m-rechazar"));
  const args=()=>({p_ruta_id:id,p_tarifa_id:+$("m-tar").value,p_registro:p?.tipo_registro||"",p_excepcion:$("m-ex").checked,p_ajuste_pago:+$("m-ap").value||0,p_ajuste_cobro:+$("m-ac").value||0});
  const extra=()=>({p_proveedor_id:p?.id||null,p_actualizar_driver:false});
  $("m-calc").onclick=async()=>{
    if(!p||!p.tipo_registro){$("m-prev").innerHTML='<div class="errbox">Falta asignar flotillero y registro fiscal en la base de flota. No se puede validar hasta corregir esos datos.</div>';return}
    if(!$("m-tar").value){$("m-prev").innerHTML='<div class="errbox">Elige una tarifa.</div>';return}
    if(esPeakSeleccionada()&&ROL==="ih"){
      const decision=await sb.rpc("coppel_peak_elegir_descuento",{p_ruta_id:id,p_aplicar:$("m-peak-desc").checked});
      if(decision.error){$("m-prev").innerHTML=`<div class="errbox">${esc(decision.error.message)}</div>`;return}
    }
    const r=await sb.rpc("calcular_liquidacion",args());
    if(r.error){$("m-prev").innerHTML=`<div class="errbox">${esc(r.error.message)}</div>`;$("m-ok").disabled=true;return}
    $("m-prev").innerHTML=tablaRes(r.data);$("m-ok").disabled=false};
  $("m-ok").onclick=async()=>{
    if(!p||!p.tipo_registro){$("m-prev").innerHTML='<div class="errbox">Falta asignar flotillero y registro fiscal en la base de flota. No se puede validar hasta corregir esos datos.</div>';return}
    $("m-ok").disabled=true;
    const peakIH=esPeakSeleccionada()&&ROL==="ih";
    const r=await sb.rpc(peakIH?"coppel_peak_validar_ruta":"validar_ruta",{
      ...args(),...extra(),p_nota:$("m-nota").value.trim()||null,
      ...(peakIH?{p_aplicar:$("m-peak-desc").checked}:{})
    });
    if(r.error){$("m-prev").innerHTML+=`<div class="errbox">${esc(r.error.message)}</div>`;return}
    let auditError=null;
    if(r.data!==0){const audit=await registrarAuditoriaValidacion(id);auditError=audit.error}
    m.classList.add("hide");await cargaExtra();render();
    toast(r.data===0?"Enviada al coordinador para aprobación":auditError?"Ruta validada, pero no se registró el supervisor que la validó: "+auditError.message:"Ruta validada y pago generado")};
}
$("loading-phrase").textContent=siguienteFraseCarga();
boot();
