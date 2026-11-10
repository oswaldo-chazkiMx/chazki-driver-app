const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {PGlite}=require("@electric-sql/pglite");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"high-value.js"),"utf8");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
const migration=fs.readFileSync(path.join(root,"route-high-value-evidence.sql"),"utf8");
const normalize=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
function context(extra={}){
  const c=vm.createContext({textoAux:normalize,...extra});vm.runInContext(source,c);return c;
}
test("saved photo resolution caps both orientations below 24 MP without upscaling",()=>{
  const size=vm.runInContext("evidencePhotoSize",context());
  for(const [w,h,ew,eh] of [[8000,6000,2560,1920],[6000,8000,1920,2560],[12000,3000,2560,640],[800,600,800,600],[4000,4000,2560,2560]]){
    const result=size(w,h);
    assert.equal(result.width,ew);assert.equal(result.height,eh);
    assert.ok(result.width*result.height<24000000);assert.ok(Math.max(result.width,result.height)<=2560);
  }
  for(const pair of [[0,100],[NaN,100],[100,Infinity]])assert.throws(()=>size(...pair),/dimensiones/);
});
test("JPEG encoder enforces a real two MiB limit and surfaces failures",async()=>{
  const encode=vm.runInContext("encodeEvidencePhoto",context());
  const calls=[];
  const canvas={width:2560,height:1920,toBlob:(done,type,quality)=>{
    calls.push([type,quality]);done({size:quality>.7?3*1024*1024:500000,type});
  }};
  assert.equal((await encode(canvas)).size,500000);
  assert.deepEqual(calls,[["image/jpeg",.82],["image/jpeg",.7]]);
  canvas.toBlob=done=>done({size:2*1024*1024});
  assert.equal((await encode(canvas)).size,2*1024*1024);
  canvas.toBlob=done=>done({size:2*1024*1024+1});
  await assert.rejects(encode(canvas),/2 MB/);
  canvas.toBlob=done=>done(null);await assert.rejects(encode(canvas),/comprimir/);
  await assert.rejects(encode({...canvas,height:2561}),/resolución/);
});
test("camera file decoding respects orientation, releases bitmap and rejects invalid input",async()=>{
  let closed=false,options,drawn;
  const canvas={getContext:()=>({drawImage:(...args)=>{drawn=args}})};
  const c=context({createImageBitmap:async(_,opts)=>{
    options=opts;return {width:6000,height:8000,close:()=>{closed=true}};
  },document:{createElement:()=>canvas}});
  const decode=vm.runInContext("evidencePhotoCanvas",c);
  await decode({size:5000,type:"image/jpeg"});
  assert.equal(options.imageOrientation,"from-image");assert.equal(closed,true);
  assert.equal(canvas.width,1920);assert.equal(canvas.height,2560);assert.equal(drawn[3],1920);
  await assert.rejects(decode({size:100,type:"text/plain"}),/fotografía válida/);
  await assert.rejects(decode({size:0,type:"image/jpeg"}),/fotografía válida/);
});
test("native article picker snapshots item, preserves evidence on cancel, and disallows third photo",()=>{
  const elements={"hv-load-item":{value:"2"},"hv-load-file":{click:()=>{clicks++}}};
  let clicks=0,error="";
  const c=context({$:id=>elements[id],err:(_,e)=>{if(e)error=e.message}});
  vm.runInContext("HV_DRAFT={registration:{pk:2}};HV_PHOTOS.load=[{item:1},{item:1}];openHighValueCamera('load')",c);
  assert.equal(clicks,1);assert.equal(vm.runInContext("HV_CAMERA.item",c),2);
  assert.equal(vm.runInContext("HV_PHOTOS.load.length",c),2);
  elements["hv-load-item"].value="1";
  vm.runInContext("openHighValueCamera('load')",c);
  assert.equal(clicks,1);assert.match(error,/falten fotografías/);
  const markup=vm.runInContext("highValuePhotoPanel('load')",c);
  assert.match(markup,/accept="image\/\*" capture="environment"/);
  assert.doesNotMatch(markup,/<video/);
});
test("BT arrival and auxiliary checkout use the device picker while Circuito keeps its current camera",async()=>{
  let clicked=0;
  const selector={value:"bt",click:()=>{clicked++}};
  const c=context({$:()=>selector,err:()=>{},cliName:()=>"COPPEL BT",tipoUnidadRuta:()=>"3.5T"});
  vm.runInContext(app.slice(app.indexOf("async function abrirCamaraAuxiliar("),app.indexOf("\nfunction textoMarcaAgua(")),c);
  await vm.runInContext("abrirCamaraAuxiliar('in')",c);
  assert.equal(clicked,1);
  c.S={route:{altoValor:true}};
  await vm.runInContext("abrirCamaraAuxiliar('out')",c);
  assert.equal(clicked,2);
  let cleared=0,error="";
  selector.value="circuito";c.clearAuxCapture=()=>{cleared++};c.checkIn=()=>{};
  c.navigator={mediaDevices:null};c.err=(_,e)=>{if(e)error=e.message};
  await vm.runInContext("abrirCamaraAuxiliar('in')",c);
  assert.equal(clicked,2);assert.equal(cleared,1);assert.match(error,/cámara/);
});
test("scope: only supported accounts and units; BT is an explicit choice",()=>{
  const c=context({$:()=>({value:"circuito"}),cliName:()=>"COPPEL BT",tipoUnidadRuta:()=>"3.5T"});
  const scope=vm.runInContext("isHighValueRoute",c);
  for(const [client,unit] of [["LIVERPOOL BT","Large"],["COPPEL BT","3.5T"],["LIVERPOOL","3.5T"],["COPPEL","3.5 T"],["WALMART","3,5T"]])
    assert.equal(scope(client,unit),true,client);
  for(const [client,unit] of [["WALMART","Large"],["COPPEL","OTRA"],["MERCADO LIBRE","3.5T"],["WALMART EXPRESS","3.5T"],["LIVERPOOL","Small"]])
    assert.equal(scope(client,unit),false,client);
  assert.equal(vm.runInContext("highValueSelected()",c),false);
  c.$=()=>({value:"bt"});assert.equal(vm.runInContext("highValueSelected()",c),true);
  c.$=()=>({value:""});assert.equal(vm.runInContext("highValueSelected()",c),false);
});
test("exactly two photos PER article, not just a matching total",()=>{
  const complete=vm.runInContext("highValuePhotosComplete",context());
  assert.equal(complete([],0),true);
  assert.equal(complete([{item:1},{item:1}],1),true);
  assert.equal(complete([{item:1}],1),false);
  assert.equal(complete([{item:1},{item:1},{item:1},{item:2}],2),false);
  assert.equal(complete([{item:1},{item:1},{item:2},{item:2}],2),true);
  assert.equal(complete([{item:0},{item:0}],1),false);
  assert.equal(complete([],1.5),false);
});
test("arrival persists tap time, GPS distance and photo without an editable time",async()=>{
  let saved;const elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,{value:({cli:"1",cedis:"2","aux-mode":"solo"})[id]||""});return elements.get(id)};
  const c=context({$,ME:{id:"driver"},crypto:require("node:crypto").webcrypto,
    AUX_CAMERA:{in:{blob:new Blob(["arrival"]) }},cedObj:()=>({lat:19,lng:-99}),
    tipoUnidadRuta:()=>"3.5T",distM:()=>42,
    navigator:{onLine:false,geolocation:{getCurrentPosition:success=>success({coords:{latitude:19.1,longitude:-99.1,accuracy:5}})}},
    localPut:async(store,value)=>{saved=structuredClone(value)},err:()=>{},setNetStatus:()=>{},clearAuxCapture:()=>{}});
  vm.runInContext("syncHighValueUI=()=>{}",c);
  const before=Date.now();await vm.runInContext("recordHighValueArrival()",c);
  assert.equal(saved.arrival.distancia_m,42);assert.equal(saved.arrival.precision_m,5);
  assert.equal(saved.arrival.viaja_con_auxiliar,false);assert.equal(saved.arrivalBlob.size,7);
  assert.ok(Date.parse(saved.arrival.llegada_at)>=before);
  assert.equal(elements.has("hora"),false);
});
test("GPS failure leaves no successful arrival",async()=>{
  let saved=false,error="";
  const c=context({$:()=>({value:"1"}),cedObj:()=>({lat:19,lng:-99}),AUX_CAMERA:{in:{blob:new Blob(["x"])}},
    navigator:{geolocation:{getCurrentPosition:(_,failure)=>failure({message:"Permiso denegado"})}},
    localPut:async()=>{saved=true},err:(_,e)=>{if(e)error=e.message}});
  vm.runInContext("syncHighValueUI=()=>{}",c);await vm.runInContext("recordHighValueArrival()",c);
  assert.equal(saved,false);assert.match(error,/ubicación/);
});
test("missing CEDIS coordinates block arrival explicitly",async()=>{
  let error="";
  const c=context({$:()=>({value:"1"}),cedObj:()=>({lat:null,lng:null}),err:(_,e)=>{if(e)error=e.message}});
  vm.runInContext("syncHighValueUI=()=>{}",c);await vm.runInContext("recordHighValueArrival()",c);
  assert.match(error,/coordenadas/);
});
test("evidence retry persists each uploaded photo and does not upload it twice",async()=>{
  let uploads=0,saves=0;
  const c=context({ME:{id:"driver"},localPut:async()=>{saves++},
    sb:{storage:{from:()=>({upload:async()=>{uploads++;return {error:null}}})}}});
  const sync=vm.runInContext("syncHighValueEvidence",c);
  const record={routeInfo:{altoValor:true},routePayload:{llegada_id:"arrival"},checkout:{fal:1,extras:{}},
    articleReturns:[{item:1,id:"a",blob:new Blob(["a"])},{item:1,id:"b",blob:new Blob(["b"])}]};
  await sync(record,"returns");await sync(record,"returns");
  assert.equal(uploads,2);assert.equal(record.checkout.extras.evidencia_devoluciones.length,2);
  assert.equal(record.articleReturns[0].blob,null);assert.ok(saves>=3);
  record.articleReturns.pop();await assert.rejects(sync(record,"returns"),/incompleta/);
});
test("full BT synchronization retries return photos without losing arrival, load or checkout",async()=>{
  const driver="driver",stamp="2026-11-09T12:00:00Z";
  const photo=(id,item)=>({id,item,blob:new Blob([id]),createdAt:stamp});
  let saved={key:"route",routeInfo:{altoValor:true,pk:2,checkin:stamp},
    routePayload:{driver_id:driver,id_ruta:"BT-1",checkin_at:stamp,viaja_con_auxiliar:false},
    highValueArrival:{arrival:{id:"arrival",driver_id:driver},arrivalBlob:new Blob(["arrival"])},
    articleLoad:[photo("l1",1),photo("l2",1),photo("l3",2),photo("l4",2)],
    articleReturns:[photo("r1",1),photo("r2",1)],manifests:[],
    checkout:{checkoutAt:stamp,ent:1,fal:1,hubo_incidencias:false,fallos:[],incidencias:[],extras:{}}};
  let fail=true,deleted=false,inserted,closed,arrivalCount=0,loadUploads=0;
  const c=context({syncBusy:false,ME:{id:driver},navigator:{onLine:true},S:{route:{}},
    ROUTE_SYNC_ERROR:null,OFFLINE_MODE:false,routeLocalKey:()=>"route",
    localGet:async()=>structuredClone(saved),localPut:async(_,r)=>{saved=structuredClone(r)},
    localDelete:async()=>{deleted=true},networkError:()=>false,err:()=>{},setNetStatus:()=>{},renderRouteSyncError:()=>{},showRouteDone:()=>{},
    sb:{storage:{from:()=>({upload:async p=>{
      if(p.includes("/returns/")&&fail){fail=false;return {error:{message:"Error de red simulado"}}}
      if(p.includes("/load/"))loadUploads++;return {error:null};
    }})},from:table=>{
      if(table==="ruta_llegadas")return {upsert:async()=>{arrivalCount++;return {error:null}}};
      assert.equal(table,"rutas");
      const lookup={eq:()=>lookup,maybeSingle:async()=>({data:null,error:null})};
      return {select:()=>lookup,insert:payload=>{inserted=structuredClone(payload);return {select:()=>({single:async()=>({data:{id:42},error:null})})}},
        update:payload=>{closed=structuredClone(payload);return {eq:()=>({select:()=>({single:async()=>({data:{id:42},error:null})})})}}};
    }}});
  vm.runInContext(app.slice(app.indexOf("async function syncAuxiliaryEvidence("),app.indexOf("\nasync function retryPendingRouteSync()")),c);
  assert.equal(await vm.runInContext("syncPendingRoute()",c),false);
  assert.equal(saved.serverRouteId,42);assert.equal(deleted,false);assert.equal(saved.checkout.fal,1);
  assert.equal(inserted.evidencia_carga.length,4);assert.equal(inserted.llegada_id,"arrival");
  assert.equal(await vm.runInContext("syncPendingRoute()",c),true);
  assert.equal(deleted,true);assert.equal(loadUploads,4);assert.equal(arrivalCount,1);
  assert.equal(closed.evidencia_devoluciones.length,2);assert.equal(closed.estado,"cerrada");
});
test("web and Android load identical BT logic before the app",()=>{
  assert.equal(fs.readFileSync(path.join(root,"driver-app","high-value.js"),"utf8"),source);
  assert.equal(fs.readFileSync(path.join(root,"driver-app","app.js"),"utf8"),app);
  const html=fs.readFileSync(path.join(root,"driver-app.html"),"utf8");
  assert.ok(html.indexOf('src="high-value.js')<html.indexOf('src="app.js'));
  assert.equal(fs.readFileSync(path.join(root,"driver-app","index.html"),"utf8"),html);
});
test("remote BT recovery is atomic and keeps auxiliary evidence references",async()=>{
  const route={id:42,tipo_unidad:"3.5T",auxiliar_requerido:true,viaja_con_auxiliar:true,alto_valor:true,
    llegada_id:"arrival",id_ruta:"BT-42",paquetes_asignados:1,zonas:["Norte"],
    hora_llegada_cedis:"2026-11-09T10:00:00Z",checkin_at:"2026-11-09T11:00:00Z",
    cedis:{id:1,nombre:"CEDIS",cliente_id:1},evidencia_carga:[{item:1,path:"p1"},{item:1,path:"p2"}],
    evidencia_auxiliar_checkin_path:"aux.jpg"};
  for(const missingArrival of [true,false]){
    let saved;
    const c=context({ME:{id:"driver"},S:{route:null},ROUTE_SYNC_ERROR:null,
      localGet:async()=>null,localPut:async(_,r)=>{saved=structuredClone(r)},routeLocalKey:()=>"route",
      cliName:()=>"LIVERPOOL BT",prefillCan:()=>{},setStage:()=>{},updFin:()=>{},requiereManif:()=>false,
      sb:{from:table=>{
        const q={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:[route]}),
          single:async()=>missingArrival?{error:new Error("Llegada no disponible")}:
            {data:{llegada_at:route.hora_llegada_cedis,distancia_m:20}}};
        return q;
      }}});
    vm.runInContext(app.slice(app.indexOf("async function resumeRoute()"),app.indexOf("\nasync function syncAuxiliaryEvidence(")),c);
    if(missingArrival){await assert.rejects(vm.runInContext("resumeRoute()",c),/Llegada no disponible/);assert.equal(saved,undefined)}
    else{
      await vm.runInContext("resumeRoute()",c);
      assert.equal(saved.routeInfo.altoValor,true);
      assert.equal(saved.auxiliary.checkinPath,"aux.jpg");
      assert.equal(saved.routePayload.llegada_id,"arrival");
      assert.equal(vm.runInContext("S.route.altoValor",c),true);
    }
  }
});
test("schema enforces BT evidence, preserves Circuito and legacy routes, and restricts arrival access",async()=>{
  const db=new PGlite();
  const driver="00000000-0000-0000-0000-000000000001";
  const arrival="00000000-0000-0000-0000-000000000010";
  try{
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function public.mi_acceso_administrativo() returns boolean language sql stable as $$ select false $$;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
      create table public.drivers(id uuid primary key);
      create table public.clientes(id bigint primary key,nombre text);
      create table public.cedis(id bigint primary key,cliente_id bigint,lat double precision,lng double precision);
      create table public.rutas(id bigint primary key,driver_id uuid,cedis_id bigint,tipo_unidad text,
        viaja_con_auxiliar boolean,checkin_at timestamptz,hora_llegada_cedis timestamptz,
        paquetes_asignados integer,fallidos integer,estado text default 'en_ruta');
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text,name text);
      insert into public.clientes values(1,'COPPEL BT'),(2,'MERCADO LIBRE');
      insert into public.cedis values(1,1,19,-99),(2,2,19,-99);
    `);
    await db.query("insert into public.drivers values($1)",[driver]);
    await db.exec(migration);await db.exec(migration);
    for(const name of ["arrival","l1","l2","r1","r2"])
      await db.query("insert into storage.objects values('ruta-articulos',$1)",[`${driver}/${name}.jpg`]);
    await db.query(`insert into public.ruta_llegadas(id,driver_id,cedis_id,llegada_at,lat,lng,precision_m,distancia_m,viaja_con_auxiliar,tipo_unidad,foto_path)
      values($1,$2,1,'2026-11-09 10:00Z',19,-99,5,999,false,'3.5T',$3)`,[arrival,driver,`${driver}/arrival.jpg`]);
    assert.equal((await db.query("select distancia_m from public.ruta_llegadas")).rows[0].distancia_m,0);
    const photos=names=>JSON.stringify(names.map(name=>({item:1,path:`${driver}/${name}.jpg`})));
    const insert=(id,mode,high,load,cedis=1)=>db.query(`insert into public.rutas
      (id,driver_id,cedis_id,tipo_unidad,viaja_con_auxiliar,checkin_at,paquetes_asignados,
        alto_valor,modalidad_operacion,llegada_id,evidencia_carga)
      values($1,$2,$3,'3.5T',false,'2026-11-09 11:00Z',1,$4,$5,$6,$7::jsonb)`,
      [id,driver,cedis,high,mode,high?arrival:null,load]);
    await insert(1,"circuito",false,"[]");
    await insert(2,null,false,"[]");
    await assert.rejects(insert(3,"bt",true,photos(["l1"])),/dos fotos/);
    await assert.rejects(insert(3,"bt",false,"[]"),/solo aplica/);
    await assert.rejects(insert(3,"bt",true,photos(["l1","l2"]),2),/solo aplica/);
    await insert(3,"bt",true,photos(["l1","l2"]));
    const route=(await db.query("select * from public.rutas where id=3")).rows[0];
    assert.equal(new Date(route.hora_llegada_cedis).toISOString(),"2026-11-09T10:00:00.000Z");
    await assert.rejects(db.exec("update public.rutas set alto_valor=false,modalidad_operacion='circuito' where id=3"),/desactivar/);
    await assert.rejects(db.exec("update public.rutas set estado='cerrada',fallidos=1 where id=3"),/dos fotos/);
    await assert.rejects(db.query("update public.rutas set estado='cerrada',fallidos=1,evidencia_devoluciones=$1 where id=3",[photos(["l1","l2"])]),/fotos nuevas/);
    await db.query("update public.rutas set estado='cerrada',fallidos=1,evidencia_devoluciones=$1 where id=3",[photos(["r1","r2"])]);
    const complete=(list,count=1)=>db.query("select public.evidencia_articulos_completa($1::jsonb,$2,$3) as ok",[JSON.stringify(list),count,driver]);
    assert.equal((await complete([{item:1,path:`${driver}/l1.jpg`},{item:1,path:`${driver}/l1.jpg`}])).rows[0].ok,false);
    assert.equal((await complete([{item:1,path:"other/l1.jpg"},{item:1,path:"other/l2.jpg"}])).rows[0].ok,false);
    assert.equal((await complete([],0)).rows[0].ok,true);
    await db.query("select set_config('test.uid',$1,false)",[driver]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select id from public.ruta_llegadas")).rows.length,1);
    await assert.rejects(db.exec("update public.ruta_llegadas set distancia_m=0"),/permission denied/);
    await db.exec("reset role");
    await db.query("select set_config('test.uid',$1,false)",["00000000-0000-0000-0000-000000000099"]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select id from public.ruta_llegadas")).rows.length,0);
  }finally{await db.close()}
});
