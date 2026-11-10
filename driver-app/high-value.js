// La llegada se conserva aparte: todavia no existe una ruta iniciada.
let HV_DRAFT=null,HV_PHOTOS={load:[],returns:[]},HV_URLS=[],HV_BUSY=false;
const HV_CAMERA={stage:null,item:null};
const EVIDENCE_MAX_SIDE=2560,EVIDENCE_MAX_BYTES=2*1024*1024;
function evidencePhotoSize(width,height){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
    throw new Error("La fotografía no tiene dimensiones válidas.");
  const scale=Math.min(1,EVIDENCE_MAX_SIDE/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
async function evidencePhotoCanvas(file){
  if(!file?.size||!file.type.startsWith("image/"))throw new Error("Selecciona una fotografía válida desde la cámara.");
  const image=await createImageBitmap(file,{imageOrientation:"from-image"});
  try{
    const canvas=document.createElement("canvas"),size=evidencePhotoSize(image.width,image.height);
    canvas.width=size.width;canvas.height=size.height;
    const ctx=canvas.getContext("2d");if(!ctx)throw new Error("No se pudo procesar la fotografía.");
    ctx.drawImage(image,0,0,canvas.width,canvas.height);return canvas;
  }finally{image.close()}
}
async function encodeEvidencePhoto(canvas){
  if(Math.max(canvas.width,canvas.height)>EVIDENCE_MAX_SIDE)throw new Error("La foto excede la resolución permitida.");
  for(const quality of [.82,.7,.6]){
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
    if(!blob)throw new Error("No se pudo comprimir la fotografía.");
    if(blob.size<=EVIDENCE_MAX_BYTES)return blob;
  }
  throw new Error("La fotografía sigue superando 2 MB. Repite la toma con menos detalle de fondo.");
}
const HV_FIELD_SLOTS={};
const HV_RENDER={load:null,returns:null};
const highValueKey=()=>`high-value:${ME.id}`;
function isHighValueRoute(client,unit){
  const c=textoAux(client).trim(),u=textoAux(unit).replace(/[\s.,]/g,"");
  return /^(LIVERPOOL|COPPEL)(?:\s+BT)?$/.test(c)
    ? /\bBT\b/.test(c)||u==="35T"
    : /^WALMART(?:\s+3[.,]5\s*T)?$/.test(c)&&(u==="35T"||/3[.,]5\s*T/.test(c));
}
const highValueSelected=()=>isHighValueRoute(cliName($("cli").value),HV_DRAFT?.unit||tipoUnidadRuta())&&$("hv-mode").value==="bt";
const highValueActive=()=>S.route?.altoValor===true;
const highValueCountValid=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
function highValuePhotosComplete(photos,count){
  return Number.isSafeInteger(count)&&count>=0&&photos.length===count*2&&
    Array.from({length:count},(_,i)=>photos.filter(p=>p.item===i+1).length===2).every(Boolean);
}
function highValuePhotoPanel(stage){
  return `<h3>${stage==="load"?"Sube las fotos de tus artículos":"Fotografías de los artículos devueltos"}</h3>
    <div class="note">${stage==="load"?"Recuerda que esto es para usarse en posibles aclaraciones.":"Recuerda que esto nos ayuda ante posibles aclaraciones."}</div>
    <div class="note">Dos fotografías por artículo. Se abrirá la cámara del celular; usa sus controles para cambiar de cámara y encuadrar. Al aceptar, regresarás a Chazki. Guardamos JPEG de hasta 2560 px y 2 MB por foto.</div>
    <label for="hv-${stage}-item">Número de artículo</label><input id="hv-${stage}-item" type="number" inputmode="numeric" min="1" step="1" value="1">
    <div id="hv-${stage}-progress" role="status" aria-live="polite"></div>
    <div id="hv-${stage}-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px"></div>
    <button class="btn ghost" type="button" id="hv-${stage}-open">Abrir cámara</button>
    <input id="hv-${stage}-file" type="file" accept="image/*" capture="environment" class="hide">
    <div id="hv-${stage}-error"></div>`;
}
function initHighValue(){
  ["route-fields","route-zones"].forEach(id=>{
    const slot=document.createComment(id);$(id).before(slot);HV_FIELD_SLOTS[id]=slot;
  });
  [["load","hv-load-photos"],["returns","hv-return-photos"]].forEach(([stage,id])=>{
    $(id).innerHTML=highValuePhotoPanel(stage);
    $(`hv-${stage}-open`).onclick=()=>openHighValueCamera(stage);
    $(`hv-${stage}-file`).onchange=e=>{
      const file=e.target.files[0];e.target.value="";
      if(file)captureHighValuePhoto(stage,file);
    };
    $(`hv-${stage}-item`).onchange=()=>{stopHighValueCamera();drawHighValuePhotos(stage)};
    $(`hv-${stage}-grid`).onclick=e=>{
      const button=e.target.closest("[data-hv-remove]");
      if(button)removeHighValuePhoto(stage,button.dataset.hvRemove);
    };
  });
  $("hv-arrive").onclick=recordHighValueArrival;
  $("hv-register").onclick=registerHighValueLoad;
  $("hv-mode").onchange=()=>{clearAuxCapture("in");checkIn()};
}
function syncHighValueUI(){
  const eligible=isHighValueRoute(cliName($("cli").value),HV_DRAFT?.unit||tipoUnidadRuta());
  $("hv-mode-wrap").classList.toggle("hide",!eligible);
  if(!eligible)$("hv-mode").value="";
  const on=highValueSelected(),arrived=on&&!!HV_DRAFT,registered=arrived&&!!HV_DRAFT.registration;
  ["route-fields","route-zones"].forEach(id=>{
    if(on)$("hv-register").before($(id));else HV_FIELD_SLOTS[id].after($(id));
  });
  $("aux-in-label").textContent=on?($("aux-mode").value==="auxiliar"?"Foto de llegada donde aparezcas con tu auxiliar":"Foto de llegada al CEDIS donde aparezcas tú"):"Foto donde aparezcas con tu auxiliar antes de salir";
  $("aux-in-preview").alt=on?"Fotografía de llegada al CEDIS":"Foto capturada del driver con auxiliar";
  $("aux-in-rotate").classList.toggle("hide",on);
  $("aux-in-capture").classList.toggle("hide",on);
  $("aux-in-note").textContent=on?"Se abrirá la cámara del celular. Usa sus controles para cambiar de cámara y acepta la foto para volver a Chazki. Se guardará con marca de agua, hasta 2560 px y 2 MB.":"Toma la foto desde la cámara. Se guardará con marca de agua de fecha, hora, driver, cliente, CEDIS y ruta.";
  $("in-title").textContent=on?"1 · Check-in · Llegué al CEDIS":"1 · Check-in · ¿Dónde cargas hoy?";
  $("pk-label").textContent=on?"Cantidad de ID / artículos":"Paquetes asignados";
  $("arrival-time").classList.toggle("hide",on);
  $("route-fields").classList.toggle("hide",on&&!arrived);
  $("route-zones").classList.toggle("hide",on&&!arrived);
  $("hv-arrival").classList.toggle("hide",!on);
  $("hv-loading").classList.toggle("hide",!arrived);
  $("hv-load-photos").classList.toggle("hide",!registered);
  $("bin").classList.toggle("hide",on&&!registered);
  $("bin").textContent=on?"Inicio de ruta":"Check IN · Inicia tu ruta";
  ["cli","cedis","unidad","aux-mode","det1","aux-in-open","hv-mode","aux-in-rotate"].forEach(id=>$(id).disabled=arrived);
  ["pk","rid","zinp"].forEach(id=>$(id).disabled=registered);
  $("zchips").style.pointerEvents=registered?"none":"";
  $("hv-arrive").classList.toggle("hide",arrived);
  $("hv-arrive").disabled=HV_BUSY||!$("cli").value||!$("cedis").value||
    !["solo","auxiliar"].includes($("aux-mode").value)||!AUX_CAMERA.in.blob;
  $("hv-register").disabled=HV_BUSY||registered||!highValueCountValid(Number($("pk").value))||
    !$("rid").value.trim()||!S.zonas.length;
  if(on){
    $("aux-checkin").classList.remove("hide");
    $("aux-checkin-proof").classList.toggle("hide",arrived);
    $("bin").disabled=HV_BUSY||!registered||!highValuePhotosComplete(HV_PHOTOS.load,HV_DRAFT.registration.pk);
    $("inhint").textContent=!arrived?"Elige modalidad y toma una foto de llegada (solo o con tu auxiliar).":
      !registered?"Llegada guardada. Registra los datos de tu carga.":"Completa las dos fotos de cada artículo para habilitar Inicio de ruta.";
  }
  $("hv-arrival-summary").innerHTML=arrived?`<div class="okbox"><b>Llegada registrada</b><br>
    ${esc(new Date(HV_DRAFT.arrival.llegada_at).toLocaleString("es-MX"))}<br>
    Distancia al CEDIS: <b>${esc(fmtDist(HV_DRAFT.arrival.distancia_m))}</b><br>
    Precisión GPS: ±${esc(Math.round(HV_DRAFT.arrival.precision_m))} m</div>`:"";
  if(arrived){$("hstate").className="pill w";$("hstate").textContent=registered?"En CEDIS · Cargando":"Llegada registrada"}
  if(registered)drawHighValuePhotos("load");
  return on;
}
async function recordHighValueArrival(){
  if(HV_BUSY||HV_DRAFT)return;
  HV_BUSY=true;syncHighValueUI();err("inerr",null);
  const markedAt=new Date().toISOString();
  try{
    const cedis=cedObj($("cli").value,$("cedis").value);
    if(!cedis||cedis.lat==null||cedis.lng==null||!Number.isFinite(+cedis.lat)||!Number.isFinite(+cedis.lng))
      throw new Error("Este CEDIS no tiene coordenadas válidas. Solicita a Operaciones que las registre antes del check-in.");
    if(!AUX_CAMERA.in.blob)throw new Error("Toma la foto de llegada antes de registrar.");
    const loc=await new Promise((resolve,reject)=>{
      if(!navigator.geolocation){reject(new Error("Tu dispositivo no permite obtener ubicación."));return}
      navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),
        e=>reject(new Error(`No se pudo registrar la ubicación: ${e.message}. Activa el GPS y concede permiso.`)),
        {enableHighAccuracy:true,timeout:20000,maximumAge:0});
    });
    const arrival={id:crypto.randomUUID(),driver_id:ME.id,cedis_id:+$("cedis").value,llegada_at:markedAt,
      lat:loc.lat,lng:loc.lng,precision_m:loc.accuracy,distancia_m:distM(loc.lat,loc.lng,+cedis.lat,+cedis.lng),
      viaja_con_auxiliar:$("aux-mode").value==="auxiliar",foto_path:null};
    arrival.tipo_unidad=tipoUnidadRuta();
    const draft={key:highValueKey(),arrival,cliId:$("cli").value,unit:tipoUnidadRuta(),
      arrivalBlob:AUX_CAMERA.in.blob,registration:null,photos:[]};
    await localPut("cache",draft);HV_DRAFT=draft;clearAuxCapture("in");
    if(navigator.onLine)await syncHighValueDraft();
    else setNetStatus("Llegada y foto guardadas en este dispositivo, pendientes de envío.",true);
  }catch(e){err("inerr",e)}
  finally{HV_BUSY=false;syncHighValueUI()}
}
async function syncHighValueArrival(draft){
  if(draft.arrivalSynced)return;
  const path=draft.arrival.foto_path||`${ME.id}/${draft.arrival.id}/arrival.jpg`;
  if(draft.arrivalBlob){
    const {error}=await sb.storage.from("ruta-articulos").upload(path,draft.arrivalBlob,{contentType:"image/jpeg",upsert:true});
    if(error)throw error;
  }
  if(!draft.arrival.foto_path&&!draft.arrivalBlob)throw new Error("Falta la fotografía de llegada.");
  draft.arrival.foto_path=path;
  const {error}=await sb.from("ruta_llegadas").upsert(draft.arrival,{onConflict:"id",ignoreDuplicates:true});
  if(error)throw error;
}
async function syncHighValueDraft(){
  if(!HV_DRAFT||!navigator.onLine)return;
  if(HV_DRAFT.arrivalSynced)return;
  await syncHighValueArrival(HV_DRAFT);
  HV_DRAFT.arrivalSynced=true;
  await localPut("cache",HV_DRAFT);
}
async function resumeHighValueDraft(){
  HV_DRAFT=await localGet("cache",highValueKey());
  if(!HV_DRAFT&&navigator.onLine){
    const {data,error}=await sb.from("ruta_llegadas").select("*").eq("driver_id",ME.id).is("inicio_ruta_at",null)
      .order("llegada_at",{ascending:false}).limit(1);
    if(error)throw error;
    if(data?.length){
      const arrival=data[0],cedis=cedObjById(arrival.cedis_id);
      if(!cedis)throw new Error("El CEDIS de tu llegada ya no está disponible. Contacta a Operaciones.");
      HV_DRAFT={key:highValueKey(),arrival,cliId:String(cedis.cliente_id),unit:arrival.tipo_unidad,
        registration:null,photos:[]};
      await localPut("cache",HV_DRAFT);
    }
  }
  if(!HV_DRAFT)return;
  $("cli").value=HV_DRAFT.cliId;fillCedis($("cedis"),HV_DRAFT.cliId);
  $("cedis").value=String(HV_DRAFT.arrival.cedis_id);$("unidad").value=HV_DRAFT.unit;
  $("hv-mode").value="bt";
  $("aux-mode").value=HV_DRAFT.arrival.viaja_con_auxiliar?"auxiliar":"solo";
  if(HV_DRAFT.registration){
    const r=HV_DRAFT.registration;$("pk").value=r.pk;$("rid").value=r.rid;S.zonas=[...r.zonas];addZona();
  }
  HV_PHOTOS.load=HV_DRAFT.photos||[];checkIn();
}
async function registerHighValueLoad(){
  if(HV_BUSY||!HV_DRAFT||HV_DRAFT.registration)return;
  HV_BUSY=true;err("inerr",null);
  try{
    const pk=Number($("pk").value),rid=$("rid").value.trim();
    if(!highValueCountValid(pk)||!rid||!S.zonas.length)throw new Error("Indica una cantidad entera de artículos, ruta y zona.");
    const draft={...HV_DRAFT,registration:{pk,rid,zonas:[...S.zonas],registeredAt:new Date().toISOString()}};
    await localPut("cache",draft);HV_DRAFT=draft;
  }catch(e){err("inerr",e)}
  finally{HV_BUSY=false;syncHighValueUI()}
}
function highValuePhotoCount(stage){return stage==="load"?HV_DRAFT?.registration?.pk||0:S.result?.fal||0}
function drawHighValuePhotos(stage){
  const photos=HV_PHOTOS[stage],count=highValuePhotoCount(stage),select=$(`hv-${stage}-item`);
  select.max=count;
  $(`hv-${stage}-progress`).textContent=`${photos.length} de ${count*2} fotos · ${count} artículos · Artículo ${select.value}: ${photos.filter(p=>p.item===Number(select.value)).length}/2`;
  const item=Number(select.value);
  $(`hv-${stage}-open`).disabled=HV_BUSY||!Number.isInteger(item)||item<1||item>count||photos.filter(p=>p.item===item).length>=2;
  const signature=JSON.stringify([item,photos.map(p=>[p.id,p.item,!!p.blob,p.path])]);
  if(HV_RENDER[stage]===signature)return;
  HV_RENDER[stage]=signature;
  HV_URLS.filter(x=>x.stage===stage).forEach(x=>URL.revokeObjectURL(x.url));HV_URLS=HV_URLS.filter(x=>x.stage!==stage);
  $(`hv-${stage}-grid`).innerHTML=photos.filter(p=>p.item===item).map(p=>{
    const url=p.blob?URL.createObjectURL(p.blob):"";if(url)HV_URLS.push({stage,url});
    return `<div>${url?`<img src="${esc(url)}" alt="Artículo ${p.item}" style="width:100%;border-radius:8px">`:"Foto guardada en servidor"}
      <button class="btn ghost sm" type="button" data-hv-remove="${esc(p.id)}">Repetir foto</button></div>`;
  }).join("");
}
function stopHighValueCamera(){
  HV_CAMERA.stage=null;HV_CAMERA.item=null;
}
function openHighValueCamera(stage){
  stopHighValueCamera();err(`hv-${stage}-error`,null);
  try{
    if(HV_BUSY)throw new Error("Espera a que termine de guardarse la fotografía.");
    const item=Number($(`hv-${stage}-item`).value),count=highValuePhotoCount(stage);
    if(!Number.isInteger(item)||item<1||item>count||HV_PHOTOS[stage].filter(p=>p.item===item).length>=2)
      throw new Error("Selecciona un artículo al que le falten fotografías.");
    HV_CAMERA.stage=stage;HV_CAMERA.item=item;
    $(`hv-${stage}-file`).click();
  }catch(e){stopHighValueCamera();err(`hv-${stage}-error`,e)}
}
async function saveHighValuePhotos(stage,photos){
  if(stage==="load"){
    const draft={...HV_DRAFT,photos};await localPut("cache",draft);HV_DRAFT=draft;
  }else{
    if(syncBusy)throw new Error("Espera a que termine la sincronización e inténtalo de nuevo.");
    const record=await localGet("routes",routeLocalKey());
    if(!record)throw new Error("No se encontró la ruta local para guardar la evidencia.");
    record.articleReturns=photos;await localPut("routes",record);
  }
  HV_PHOTOS[stage]=photos;
}
async function captureHighValuePhoto(stage,file){
  if(HV_BUSY){err(`hv-${stage}-error`,new Error("Espera a que termine de guardarse la fotografía."));return}
  HV_BUSY=true;if(stage==="load")syncHighValueUI();else enableOut();
  try{
    const item=HV_CAMERA.item;
    if(HV_CAMERA.stage!==stage||!Number.isInteger(item)||item<1||item>highValuePhotoCount(stage))
      throw new Error("Selecciona el artículo y abre su cámara antes de tomar la fotografía.");
    if(HV_PHOTOS[stage].filter(p=>p.item===item).length>=2)throw new Error("Este artículo ya tiene sus dos fotografías.");
    const canvas=await evidencePhotoCanvas(file),ctx=canvas.getContext("2d");
    const at=new Date().toISOString(),font=Math.max(14,Math.round(canvas.width/50));
    ctx.font=`${font}px sans-serif`;
    const lines=[`CHAZKI | ${stage==="load"?"CARGA":"DEVOLUCION"} | Articulo ${item}`,
      `${DRIVER.nombre} | ${stage==="load"?HV_DRAFT.registration.rid:S.route.rid}`,at];
    ctx.fillStyle="rgba(0,0,0,.7)";ctx.fillRect(0,canvas.height-font*5,canvas.width,font*5);
    ctx.fillStyle="#fff";lines.forEach((s,i)=>ctx.fillText(s,10,canvas.height-font*(3.5-i*1.3)));
    const blob=await encodeEvidencePhoto(canvas);
    await saveHighValuePhotos(stage,[...HV_PHOTOS[stage],{id:crypto.randomUUID(),item,blob,createdAt:at}]);
    stopHighValueCamera();
  }catch(e){err(`hv-${stage}-error`,e)}
  finally{HV_BUSY=false;if(stage==="load")syncHighValueUI();else enableOut()}
}
async function removeHighValuePhoto(stage,id){
  if(HV_BUSY)return;HV_BUSY=true;
  try{stopHighValueCamera();await saveHighValuePhotos(stage,HV_PHOTOS[stage].filter(p=>p.id!==id))}
  catch(e){err(`hv-${stage}-error`,e)}
  finally{HV_BUSY=false;if(stage==="load")syncHighValueUI();else enableOut()}
}
async function startHighValueRoute(){
  if(HV_BUSY||!HV_DRAFT)return;
  HV_BUSY=true;err("inerr",null);
  try{
    const d=HV_DRAFT,r=d.registration,a=d.arrival;
    if(!r||!highValuePhotosComplete(HV_PHOTOS.load,r.pk))throw new Error("Faltan las dos fotografías de algún artículo.");
    if(syncBusy)throw new Error("Espera a que termine la sincronización antes de iniciar.");
    const checkin=new Date(),routeInfo={cli:cliName(d.cliId),cliId:d.cliId,cedis:cedName(d.cliId,a.cedis_id),cedisId:a.cedis_id,
      pk:r.pk,rid:r.rid,zonas:r.zonas,hora:new Date(a.llegada_at).toTimeString().slice(0,5),checkin:checkin.toISOString(),
      unidad:d.unit,auxiliarRequerido:true,viajaConAuxiliar:a.viaja_con_auxiliar,altoValor:true,modalidadOperacion:"bt",arrivalAt:a.llegada_at,arrivalDistance:a.distancia_m};
    const record={key:routeLocalKey(),driverId:ME.id,status:"checkin_pending",serverRouteId:null,routeInfo,
      routePayload:{driver_id:ME.id,cedis_id:a.cedis_id,id_ruta:r.rid,paquetes_asignados:r.pk,zonas:r.zonas,
        hora_llegada_cedis:a.llegada_at,tipo_unidad:d.unit,auxiliar_requerido:true,viaja_con_auxiliar:a.viaja_con_auxiliar,
        checkin_at:checkin.toISOString(),alto_valor:true,modalidad_operacion:"bt",llegada_id:a.id},
      highValueArrival:d,articleLoad:HV_PHOTOS.load,articleReturns:[],auxiliary:{checkinBlob:d.arrivalBlob,checkinPath:null},
      checkout:null,manifests:[]};
    await localPut("routes",record);
    await localDelete("cache",highValueKey());HV_DRAFT=null;
    S.route={...routeInfo,localKey:record.key,dbId:null,checkin};prefillCan();setStage(1);updFin();
    HV_BUSY=false;
    if(navigator.onLine)await syncPendingRoute();
    else setNetStatus("Inicio de ruta y fotografías guardados en este dispositivo, pendientes de envío.",true);
    toast("Inicio de ruta guardado");
  }catch(e){err("inerr",e)}
  finally{HV_BUSY=false}
}
async function syncHighValueEvidence(record,stage){
  if(!record.routeInfo.altoValor)return;
  if(stage==="load"){
    if(record.serverRouteId)return;
    await syncHighValueArrival(record.highValueArrival);
    record.routePayload.llegada_id=record.highValueArrival.arrival.id;
  }
  const photos=stage==="load"?record.articleLoad:record.articleReturns;
  const count=stage==="load"?record.routeInfo.pk:record.checkout.fal;
  if(!highValuePhotosComplete(photos||[],count))throw new Error(`Evidencia incompleta de ${stage==="load"?"carga":"devoluciones"}.`);
  for(const photo of photos){
    const path=photo.path||`${ME.id}/${record.routePayload.llegada_id}/${stage}/${photo.item}-${photo.id}.jpg`;
    if(photo.blob){
      const {error}=await sb.storage.from("ruta-articulos").upload(path,photo.blob,{contentType:"image/jpeg",upsert:true});
      if(error)throw error;
      photo.path=path;photo.blob=null;await localPut("routes",record);
    }
    if(!photo.path)throw new Error("Una evidencia no tiene archivo ni ruta de almacenamiento.");
  }
  const evidence=photos.map(p=>({item:p.item,path:p.path,createdAt:p.createdAt}));
  if(stage==="load")record.routePayload.evidencia_carga=evidence;
  else record.checkout.extras.evidencia_devoluciones=evidence;
  await localPut("routes",record);
}
async function saveHighValueProgress(){
  if(!highValueActive())return true;
  try{
    if(syncBusy)throw new Error("Espera a que termine la sincronización y vuelve a continuar.");
    const record=await localGet("routes",routeLocalKey());
    if(!record)throw new Error("No se encontró la ruta local.");
    record.progress={result:S.result,fallos:S.fallos,inc:S.inc,incSel:[...S.incSel],comment:$("inctxt").value,stage:S.stage};
    await localPut("routes",record);return true;
  }catch(e){err("outerr",e);return false}
}
