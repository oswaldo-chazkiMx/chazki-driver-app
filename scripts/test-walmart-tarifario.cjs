const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PGlite}=require("@electric-sql/pglite");
const {execFileSync}=require("node:child_process");
const vm=require("node:vm");

const migration=fs.readFileSync(path.join(__dirname,"..","walmart-tarifario.sql"),"utf8");
const rehearsal=fs.readFileSync(path.join(__dirname,"..","ensayo-supabase","2-ensayo-walmart.sql"),"utf8");
const retentionDraft=fs.readFileSync(path.join(__dirname,"..","walmart-retencion-borrador.sql"),"utf8");
const retentionDecisionDraft=fs.readFileSync(path.join(__dirname,"..","walmart-decision-retencion-borrador.sql"),"utf8");
const liquidationDraft=fs.readFileSync(path.join(__dirname,"..","walmart-liquidacion-borrador.sql"),"utf8");
const mappingDraft=fs.readFileSync(path.join(__dirname,"..","walmart-mapeo-tarifas-borrador.sql"),"utf8");
const validationDraft=fs.readFileSync(path.join(__dirname,"..","walmart-validacion-borrador.sql"),"utf8");
const cancellationPaymentsDraft=fs.readFileSync(path.join(__dirname,"..","walmart-cancelaciones-pagos-borrador.sql"),"utf8");
const retentionDeadlineDraft=fs.readFileSync(path.join(__dirname,"..","walmart-plazo-retencion-borrador.sql"),"utf8");
const retentionProviderDraft=fs.readFileSync(path.join(__dirname,"..","walmart-retencion-proveedor-borrador.sql"),"utf8");
const bolsaDraft=fs.readFileSync(path.join(__dirname,"..","walmart-bolsa-borrador.sql"),"utf8");
const noShowDraft=fs.readFileSync(path.join(__dirname,"..","walmart-no-show-borrador.sql"),"utf8");
const noShowFlowDraft=fs.readFileSync(path.join(__dirname,"..","walmart-no-show-flujo-borrador.sql"),"utf8");
const noShowPrecloseDraft=fs.readFileSync(path.join(__dirname,"..","walmart-precierre-no-show-borrador.sql"),"utf8");
const noShowDiagnostic=fs.readFileSync(path.join(__dirname,"..","ensayo-supabase","4-diagnostico-no-show-walmart.sql"),"utf8");
const permissionRehearsal=fs.readFileSync(path.join(__dirname,"..","ensayo-supabase","5-ensayo-permisos-walmart.sql"),"utf8");
const concurrencyA=fs.readFileSync(path.join(__dirname,"..","ensayo-supabase","6-concurrencia-sesion-a.sql"),"utf8");
const concurrencyB=fs.readFileSync(path.join(__dirname,"..","ensayo-supabase","7-concurrencia-sesion-b.sql"),"utf8");
const noShowWorkflow=fs.readFileSync(path.join(__dirname,"..","no-show-workflow.sql"),"utf8");
const pnr=fs.readFileSync(path.join(__dirname,"..","pnr-claims-workflow.sql"),"utf8");
const app=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8");
const ops=fs.readFileSync(path.join(__dirname,"..","ops.js"),"utf8");

test("the Walmart permission rehearsal matches the financial draft files",()=>{
  execFileSync(process.execPath,[path.join(__dirname,"generar-ensayo-permisos-walmart.cjs"),"--check"]);
});

test("Walmart NO SHOW cutoff assigns Friday noon onward to the next payment week",async()=>{
  const db=new PGlite();
  try{
    await db.exec("create schema private; create role anon; create role authenticated");
    const start=noShowFlowDraft.indexOf("create or replace function private.walmart_semana_no_show");
    const end=noShowFlowDraft.indexOf("\ncreate table if not exists private.walmart_no_show_reportes",start);
    await db.exec(noShowFlowDraft.slice(start,end));
    const week=async(local)=>(await db.query(
      "select private.walmart_semana_no_show($1::timestamp at time zone 'America/Mexico_City')::text as value",[local]
    )).rows[0].value;
    assert.equal(await week("2026-11-07 00:00:00"),"2026-11-09");
    assert.equal(await week("2026-11-13 11:59:59"),"2026-11-09");
    assert.equal(await week("2026-11-13 12:00:00"),"2026-11-16");
    assert.equal(await week("2026-11-14 00:00:00"),"2026-11-16");
    await assert.rejects(db.query("select private.walmart_semana_no_show(null)"),/fecha de registro/);
  }finally{await db.close()}
});

test("the two-session advisory lock probes use the application lock key and do not write data",async()=>{
  const key="walmart-no-show-proveedor:-9223372036854775808";
  assert.ok(noShowFlowDraft.includes("'walmart-no-show-proveedor:'||p_proveedor_id::text"));
  assert.ok(concurrencyA.includes(key));
  assert.ok(concurrencyB.includes(key));
  const db=new PGlite();
  try{
    await db.exec(concurrencyA.replace("pg_sleep(45)","pg_sleep(0)"));
    await assert.rejects(db.exec(concurrencyB),/RESULTADO BLOQUEO: libre/);
  }finally{await db.close()}
});

test("isolated NO SHOW concurrency rehearsal checks overlap, exact balances and cleanup",async()=>{
  execFileSync(process.execPath,[path.join(__dirname,"generar-concurrencia-no-show.cjs"),"--check"]);
  const read=name=>fs.readFileSync(path.join(__dirname,"..","ensayo-supabase",name),"utf8");
  const db=new PGlite();
  try{
    await db.exec(read("8-concurrencia-preparar.sql"));
    await assert.rejects(db.exec(read("8-concurrencia-preparar.sql")),/Ya existe/);
    await db.exec(read("9-concurrencia-pago-a.sql").replace("pg_sleep(45)","pg_sleep(0)"));
    const second=read("10-concurrencia-pago-b.sql");
    await assert.rejects(db.exec(second),/Las sesiones no coincidieron/);
    await db.exec(second.replace("interval '2 seconds'","interval '0 seconds'"));
    await db.exec(read("11-concurrencia-verificar.sql"));
    assert.equal((await db.query("select to_regnamespace('ensayo_walmart_concurrencia') as ns")).rows[0].ns,null);
    await db.exec(read("8-concurrencia-preparar.sql"));
    await db.exec(read("12-concurrencia-limpiar.sql"));
    assert.equal((await db.query("select to_regnamespace('ensayo_walmart_concurrencia') as ns")).rows[0].ns,null);
    await db.exec("create schema ensayo_walmart_concurrencia");
    await assert.rejects(db.exec(read("12-concurrencia-limpiar.sql")),/Esquema sin marca/);
  }finally{await db.close()}
});

test("isolated PNR and NO SHOW rehearsal checks priority, overlap and cleanup",async()=>{
  execFileSync(process.execPath,[path.join(__dirname,"generar-concurrencia-pnr-no-show.cjs"),"--check"]);
  const read=name=>fs.readFileSync(path.join(__dirname,"..","ensayo-supabase",name),"utf8");
  const db=new PGlite();
  try{
    await db.exec(read("13-pnr-no-show-preparar.sql"));
    await assert.rejects(db.exec(read("13-pnr-no-show-preparar.sql")),/Ya existe/);
    await db.exec(read("14-pnr-no-show-pago-a.sql").replace("pg_sleep(45)","pg_sleep(0)"));
    const second=read("15-pnr-no-show-pago-b.sql");
    await assert.rejects(db.exec(second),/Las sesiones no coincidieron/);
    await db.exec(second.replace("interval '2 seconds'","interval '0 seconds'"));
    await db.exec(read("16-pnr-no-show-verificar.sql"));
    assert.equal((await db.query("select to_regnamespace('ensayo_walmart_pago') as ns")).rows[0].ns,null);
    await db.exec(read("13-pnr-no-show-preparar.sql"));
    await db.exec(read("17-pnr-no-show-limpiar.sql"));
    assert.equal((await db.query("select to_regnamespace('ensayo_walmart_pago') as ns")).rows[0].ns,null);
    await db.exec("create schema ensayo_walmart_pago");
    await assert.rejects(db.exec(read("17-pnr-no-show-limpiar.sql")),/Esquema sin marca/);
  }finally{await db.close()}
});

test("retention-release preview is hidden and never treats the deadline as authorization",async()=>{
  const elements={},calls=[],messages=[];
  const el=id=>elements[id]||(elements[id]={
    value:"",innerHTML:"",disabled:false,handlers:{},
    classList:{add(){},remove(){}},
    addEventListener(name,fn){this.handlers[name]=fn}
  });
  let response={data:{
    plazo:{estado:"calculado",plazo_cumplido:true,disponible_desde:"2026-11-08T12:00:00Z"},
    saldo:{saldo_total:700},bloqueos:{pnr_abiertos:true,pnr_saldo_pendiente:false,
      no_show_requiere_revision:false,ajustes_negativos_pendientes:false,cobertura_completa:false},
    reclamaciones_verificadas:false,liberacion_validada:false
  },error:null};
  const context=vm.createContext({
    WALMART_VALIDACION_ENABLED:true,ROL:"ih",PRV:[{id:10,nombre:"Proveedor"}],RECHAZOS_RUTA:[],RECHAZOS_RUTA_ERR:"",
    $:el,esc:s=>String(s??""),fm:n=>"$"+n,toast:s=>messages.push(s),
    porValidar:()=>[],sb:{rpc:async(name,args)=>{calls.push({name,args});return response}}
  });
  vm.runInContext(ops.slice(ops.indexOf("function vistaPorValidar()"),ops.indexOf("\nasync function verDetalleRuta(")),context);
  assert.doesNotMatch(context.vistaPorValidar(),/Consultar retención Walmart/);
  context.abrirRetencionWalmart();
  el("wm-ret-proveedor").value="10";
  await el("wm-ret-consultar").onclick();
  assert.equal(calls[0].name,"walmart_consultar_retencion_proveedor");
  assert.match(el("wm-ret-aviso").innerHTML,/Plazo cumplido/);
  assert.match(el("wm-ret-aviso").innerHTML,/Hay reclamaciones o descuentos que requieren revisión/);
  assert.match(el("wm-ret-aviso").innerHTML,/revisión es parcial y no autoriza la liberación/);
  assert.match(el("wm-ret-aviso").innerHTML,/\$700/);
  response={data:{...response.data,plazo:{...response.data.plazo,plazo_cumplido:false,
    disponible_desde:"2026-11-18T12:00:00Z"}},error:null};
  await el("wm-ret-consultar").onclick();
  assert.match(el("wm-ret-aviso").innerHTML,/El plazo vence/);
  assert.match(el("wm-ret-aviso").innerHTML,/2026/);
  response={data:{...response.data,liberacion_validada:true},error:null};
  await el("wm-ret-consultar").onclick();
  assert.match(el("wm-ret-aviso").innerHTML,/respuesta inválida/);
  response={data:null,error:{message:"Sin acceso"}};
  await el("wm-ret-consultar").onclick();
  assert.match(el("wm-ret-aviso").innerHTML,/Sin acceso/);
  context.WALMART_VALIDACION_ENABLED=false;
  assert.doesNotMatch(context.vistaPorValidar(),/Consultar retención Walmart/);
  context.abrirRetencionWalmart();
  assert.match(messages.at(-1),/supervisor autorizado/);
});

test("both driver pages provide the Walmart checkout controls",()=>{
  for(const file of ["index.html","driver-app.html"]){
    const html=fs.readFileSync(path.join(__dirname,"..",file),"utf8");
    for(const id of ["walmart-visitas","wm-asignadas","wm-realizadas","wm-folios","wm-error","wm-can-evidencia","wm-can-file","wm-can-camera","wm-can-status"]){
      assert.equal((html.match(new RegExp(`\\bid="${id}"`,"g"))||[]).length,1,`${file}: ${id}`);
    }
  }
});

test("Walmart validation UI requires an explicit provider and sends the reviewed calculation",async()=>{
  const elements={},calls=[],messages=[];
  const el=id=>elements[id]||(elements[id]={
    value:"",checked:false,innerHTML:"",disabled:false,handlers:{},
    classList:{add(){},remove(){}},
    addEventListener(name,fn){this.handlers[name]=fn}
  });
  let preview={pago_base:4500,total:4275,pago_semanal:3206.25,saldo_retenido:1068.75,porcentaje_retencion:25};
  const context=vm.createContext({
    ROL:"ih",PRV:[{id:10,nombre:"Flota",activo:true}],$:el,esc:String,fm:String,
    toast:message=>messages.push(message),registrarAuditoriaValidacion:async()=>({error:null}),
    cargaExtra:async()=>{},render:()=>{},
    sb:{rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==="walmart_previsualizar_ruta_porcentaje")return {data:preview,error:null};
      if(name==="walmart_validar_ruta")return {data:{pago_id:1},error:null};
      throw new Error("RPC inesperado");
    }}
  });
  vm.runInContext(ops.slice(ops.indexOf("async function abrirValidarWalmart("),ops.indexOf("\nasync function abrirValidar(")),context);
  await context.abrirValidarWalmart(1,{id_ruta:"R1",drivers:{nombre:"Driver"},cedis:{nombre:"Querétaro"},walmart_visitas_asignadas:100,walmart_visitas_realizadas:95});
  await el("wm-val-calcular").onclick();
  assert.match(el("wm-val-aviso").innerHTML,/Confirma el proveedor/);
  el("wm-val-proveedor").value="10";el("wm-val-ret-25").checked=true;
  await el("wm-val-calcular").onclick();
  assert.match(el("wm-val-aviso").innerHTML,/semanal antes de PNR/);
  assert.equal(el("wm-val-confirmar").disabled,false);
  el("wm-val-ret-25").handlers.change();
  assert.equal(el("wm-val-confirmar").disabled,true);
  await el("wm-val-calcular").onclick();
  await el("wm-val-confirmar").onclick();
  const validation=calls.find(c=>c.name==="walmart_validar_ruta");
  assert.equal(validation.args.p_calculo_esperado,preview);
  assert.equal(validation.args.p_aplicar_visitas,false);
  assert.equal(calls.find(c=>c.name==="walmart_previsualizar_ruta_porcentaje").args.p_proveedor_id,"10");
  assert.equal(calls.find(c=>c.name==="walmart_previsualizar_ruta_porcentaje").args.p_porcentaje_retencion,25);
  assert.match(messages[0],/pago semanal generado/);
});

test("Walmart preclose UI submits selected NO SHOW cases and retries with the same identifiers",async()=>{
  const calls=[],elements={},checkbox={dataset:{wmNsCaso:"case-1"},checked:false,disabled:false};
  const modal={innerHTML:"",classList:{add(){},remove(){}},
    querySelectorAll:()=>[checkbox],querySelector:()=>checkbox.checked?checkbox:null};
  const el=id=>id==="modal"?modal:elements[id]||(elements[id]={
    value:id==="wm-ns-semana"?"2026-11-09":"",innerHTML:"",disabled:false
  });
  let batchCalls=0,uuid=0;
  const context=vm.createContext({
    WALMART_VALIDACION_ENABLED:true,ROL:"ih",DRV:[{id:"driver",nombre:"Driver"}],$:el,
    lunesCoppel:()=>"2026-11-09",esc:String,fm:String,noShowFmtDate:String,toast(){},
    crypto:{randomUUID:()=>`request-${++uuid}`},
    sb:{rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==="walmart_consultar_no_show_precierre")return {data:{driver_id:"driver",lunes:args.p_lunes,cantidad:1,
        casos:[{caso_id:"case-1",monto:2700,fecha_servicio:"2026-11-08",cedis:"CEDIS",estado:"reportado",seleccionable:true,aplicado:false}]}};
      if(name==="walmart_aplicar_no_shows_precierre"){
        batchCalls++;
        if(batchCalls===1)throw new Error("Conexión interrumpida");
        return {data:[{pago_id:1}]};
      }
      throw new Error("RPC inesperado");
    }}
  });
  vm.runInContext(ops.slice(ops.indexOf("function abrirPrecierreNoShowWalmart("),ops.indexOf("\nasync function crearReporteNoShow(")),context);
  context.abrirPrecierreNoShowWalmart("driver");
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(el("wm-ns-resultado").innerHTML,/1 NO SHOW/);
  checkbox.checked=true;checkbox.onchange();
  await el("wm-ns-aplicar").onclick();
  assert.match(el("wm-ns-error").innerHTML,/reintentar/);
  await el("wm-ns-aplicar").onclick();
  const submissions=calls.filter(c=>c.name==="walmart_aplicar_no_shows_precierre");
  assert.equal(submissions.length,2);
  assert.equal(submissions[0].args.p_seleccion[0].solicitud_id,submissions[1].args.p_seleccion[0].solicitud_id);
  assert.equal(submissions[1].args.p_seleccion[0].monto,2700);
});

test("Walmart cancellation UI requires both photos and a reviewed calculation",async()=>{
  const elements={},calls=[],messages=[];
  const el=id=>elements[id]||(elements[id]={
    value:"",checked:false,innerHTML:"",disabled:false,handlers:{},
    classList:{add(){},remove(){}},
    addEventListener(name,fn){this.handlers[name]=fn}
  });
  const cancellation={id:1,drivers:{nombre:"Driver"},cedis:{nombre:"Querétaro"},capturado_at:"2026-11-09",foto_path:"salida",foto_bitacora_path:"bitacora"};
  const calculation={base_servicio:4500,pago_base:1800,total:1710,pago_semanal:1282.5,saldo_retenido:427.5,porcentaje_retencion:25};
  const context=vm.createContext({
    C:[cancellation],ROL:"ih",PRV:[{id:10,nombre:"Flota",activo:true}],photos:{salida:"url1"},
    $:el,esc:String,fm:String,dd:String,toast:message=>messages.push(message),cargaExtra:async()=>{},render(){},
    sb:{rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==="walmart_previsualizar_cancelacion_porcentaje")return {data:calculation,error:null};
      if(name==="walmart_validar_cancelacion")return {data:{pago_id:1},error:null};
      throw new Error("RPC inesperado");
    }}
  });
  vm.runInContext(ops.slice(ops.indexOf("async function abrirPagoCancelacionWalmart("),ops.indexOf("\nlet NOT=[]",ops.indexOf("async function abrirPagoCancelacionWalmart("))),context);
  await context.abrirPagoCancelacionWalmart(1);
  await el("wm-can-calcular").onclick();
  assert.match(el("wm-can-pago-aviso").innerHTML,/ambas fotos/);
  context.photos.bitacora="url2";
  await context.abrirPagoCancelacionWalmart(1);
  el("wm-can-proveedor").value="10";el("wm-can-unidad").value="3.5T";el("wm-can-ret-25").checked=true;
  await el("wm-can-calcular").onclick();
  assert.match(el("wm-can-pago-aviso").innerHTML,/cancelación 40%/);
  el("wm-can-ret-25").handlers.change();
  assert.equal(el("wm-can-confirmar").disabled,true);
  await el("wm-can-calcular").onclick();
  await el("wm-can-confirmar").onclick();
  assert.equal(calls.find(x=>x.name==="walmart_validar_cancelacion").args.p_calculo_esperado,calculation);
  assert.match(messages[0],/cancelación Walmart registrado/);
});

test("Walmart NO SHOW UI reviews before creation and routes appeals without changing legacy cases",async()=>{
  const elements={},calls=[],messages=[];
  const el=id=>elements[id]||(elements[id]={value:"",innerHTML:"",textContent:"",disabled:false});
  Object.assign(el("ns-driver"),{value:"driver"});
  Object.assign(el("ns-client"),{value:"1"});
  Object.assign(el("ns-cedis"),{value:"1"});
  Object.assign(el("ns-date"),{value:"2026-11-09"});
  Object.assign(el("ns-observations"),{value:"No se presento"});
  Object.assign(el("ns-wm-provider"),{value:"10"});
  Object.assign(el("ns-wm-unit"),{value:"3.5T"});
  Object.assign(el("ns-wm-option"),{value:"1"});
  const context=vm.createContext({
    $:el,esc:String,fm:String,NO_SHOW_CLIENTS:[{id:1,nombre:"WALMART"}],
    NO_SHOW_OPS:[{id:"w1",metodo_calculo:"walmart_60_saldo"},{id:"old",metodo_calculo:"manual"}],
    WALMART_VALIDACION_ENABLED:true,WM_NO_SHOW_REVIEW:null,NO_SHOW_ERR:"",
    crypto:{randomUUID:()=>"request-1"},textoInapropiadoNoShow:()=>false,
    cargarNoShowsOps:async()=>{},render(){},load:async()=>{},toast:x=>messages.push(x),prompt:()=>"nota",
    sb:{rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==="walmart_previsualizar_no_show")return {data:{base_servicio:4500,monto_penalizacion:2700},error:null};
      if(name==="walmart_crear_no_show"&&calls.filter(c=>c.name===name).length===1)return {error:{message:"Red no disponible"}};
      return {data:"ok",error:null};
    }}
  });
  vm.runInContext(ops.slice(ops.indexOf("async function crearReporteNoShow()"),ops.indexOf("\nasync function resolverPnROps(")),context);
  await context.crearReporteNoShow();
  assert.match(el("ns-form-error").innerHTML,/2700/);
  assert.deepEqual(calls.map(x=>x.name),["walmart_previsualizar_no_show"]);
  await context.crearReporteNoShow();
  assert.match(el("ns-form-error").innerHTML,/Red no disponible/);
  await context.crearReporteNoShow();
  const attempts=calls.filter(x=>x.name==="walmart_crear_no_show");
  assert.equal(attempts.length,2);
  assert.equal(attempts[0].args.p_solicitud_id,attempts[1].args.p_solicitud_id);
  assert.match(messages[0],/puede apelar/);
  await context.resolverApelacionNoShowOps("w1","aceptar");
  await context.resolverApelacionNoShowOps("old","rechazar");
  assert.equal(calls.at(-2).name,"walmart_resolver_apelacion_no_show");
  assert.equal(calls.at(-1).name,"resolver_apelacion_no_show");
  context.WALMART_VALIDACION_ENABLED=false;
  const count=calls.length;
  await context.resolverApelacionNoShowOps("w1","aceptar");
  assert.equal(calls.length,count);
  assert.match(messages.at(-1),/todavía no está habilitada/);
});

async function database(){
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema private; create schema auth; create schema storage;
    create table public.clientes(id bigint primary key,nombre text,activo boolean);
    create table public.cedis(id bigint primary key,cliente_id bigint references public.clientes(id),nombre text,activo boolean);
    create table public.proveedores(id bigint primary key,activo boolean);
    create table public.drivers(id uuid primary key);
    create table public.rutas(id bigint primary key,cedis_id bigint references public.cedis(id),estado text,fallidos integer);
    create table public.cancelaciones(id bigint primary key,driver_id uuid not null,cedis_id bigint not null,foto_path text not null);
    create table storage.objects(bucket_id text,name text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.user_id',true),'')::uuid
    $$;
    create function public.mi_acceso_administrativo() returns boolean language sql stable as $$
      select coalesce(current_setting('test.admin',true),'false')='true'
    $$;
    create function public.operativo_rol_actual() returns text language sql stable as $$
      select current_setting('test.rol',true)
    $$;
    create function public.operativo_asignado_a(bigint,bigint,text) returns boolean language sql stable as $$
      select $2::text=current_setting('test.cedis',true) and $3='ih'
    $$;
    create function public.operativo_normalizar(p_texto text) returns text language sql immutable as $$
      select regexp_replace(translate(lower(btrim(coalesce(p_texto,''))),'áéíóúüñ','aeiouun'),'[^a-z0-9]+','','g')
    $$;
    insert into public.clientes values (1,'WALMART',true);
    insert into public.proveedores values (10,true),(11,false);
    insert into public.drivers values ('00000000-0000-0000-0000-000000000001');
    insert into public.cedis values
      (1,1,'DS Querétaro',true),(2,1,'DS Veracruz',true),
      (3,1,'FC Guadalajara',true),(4,1,'FC Mérida',true);
  `);
  return db;
}

test("full Walmart rehearsal rolls back tables, functions, columns and trigger",async()=>{
  const db=await database();
  try{
    const body=migration.replace(/\r\n/g,"\n").split("begin;\n")[1].split("\ncommit;")[0].trim();
    assert.ok(rehearsal.replace(/\r\n/g,"\n").includes(body),"rehearsal must contain the current draft");
    await assert.rejects(db.exec(rehearsal),/ENSAYO OK WALMART/);
    const result=(await db.query(`select
      to_regclass('public.walmart_tarifas') as tarifas,
      to_regclass('private.walmart_acuerdos') as acuerdos,
      to_regprocedure('public.walmart_cambiar_modelo(bigint,bigint,smallint)') as cambiar,
      to_regclass('private.walmart_bolsa_decisiones') as decisiones_bolsa,
      to_regprocedure('public.walmart_decidir_bolsa(uuid,bigint,jsonb,numeric,text,boolean)') as decidir_bolsa,
      to_regprocedure('public.walmart_mi_bolsa()') as mi_bolsa,
      to_regprocedure('public.walmart_mis_movimientos_bolsa(date)') as movimientos_bolsa,
      to_regprocedure('private.validar_visitas_walmart()') as validar,
      exists(select 1 from pg_attribute where attrelid='public.rutas'::regclass
        and attname='walmart_visitas_asignadas' and not attisdropped) as columna,
      exists(select 1 from pg_trigger where tgrelid='public.rutas'::regclass
        and tgname='validar_visitas_walmart' and not tgisinternal) as trigger,
      exists(select 1 from pg_attribute where attrelid='public.cancelaciones'::regclass
        and attname='foto_bitacora_path' and not attisdropped) as bitacora`)).rows[0];
    assert.deepEqual(result,{tarifas:null,acuerdos:null,cambiar:null,decisiones_bolsa:null,decidir_bolsa:null,
      mi_bolsa:null,movimientos_bolsa:null,validar:null,columna:false,trigger:false,bitacora:false});
  }finally{await db.close()}
});

test("driver capture validates Walmart visits independently from deliveries",()=>{
  const elements={"wm-asignadas":{value:"100"},"wm-realizadas":{value:"95"},"wm-folios":{value:"A123\nB456"},"fal":{value:"2"}};
  const context=vm.createContext({WALMART_TARIFARIO_ENABLED:true,WALMART_VISITAS_ENABLED:true,S:{route:{cli:"WALMART"}},$:id=>elements[id]});
  vm.runInContext(app.slice(app.indexOf("const esRutaWalmart="),app.indexOf("\nfunction sumC()")),context);
  assert.equal(vm.runInContext("esRutaWalmart()",context),true);
  const result=vm.runInContext("datosVisitasWalmart()",context);
  assert.equal(result.datos.walmart_visitas_realizadas,95);
  assert.deepEqual(Array.from(result.datos.walmart_folios_avaya),["A123","B456"]);
  elements["wm-folios"].value="";
  assert.match(vm.runInContext("datosVisitasWalmart()",context).error,/folio Avaya/);
  elements["fal"].value="0";
  assert.equal(vm.runInContext("datosVisitasWalmart()",context).error,undefined);
  elements["wm-realizadas"].value="101";
  assert.match(vm.runInContext("datosVisitasWalmart()",context).error,/no pueden superar/);
  context.WALMART_TARIFARIO_ENABLED=false;
  assert.equal(vm.runInContext("esRutaWalmart()",context),false);
  context.WALMART_TARIFARIO_ENABLED=true;
  context.WALMART_VISITAS_ENABLED=false;
  assert.equal(vm.runInContext("esRutaWalmart()",context),false);
  context.WALMART_VISITAS_ENABLED=true;
  context.S.route.cli="OTRO";
  assert.equal(vm.runInContext("esRutaWalmart()",context),false);
});

test("offline Walmart checkout retains visits and folios when sync fails and retries",async()=>{
  const record={
    serverRouteId:42,routePayload:{viaja_con_auxiliar:false},manifests:[],
    checkout:{checkoutAt:"2026-11-08T10:00:00Z",ent:8,fal:2,hubo_incidencias:false,
      fallos:[],incidencias:[],extras:{walmart_visitas_asignadas:12,walmart_visitas_realizadas:11,walmart_folios_avaya:["A123"]}}
  };
  let saved=structuredClone(record),sent,fail=true,deleted=false,done;
  const context=vm.createContext({
    syncBusy:false,ME:{id:"driver"},navigator:{onLine:true},S:{route:{}},
    ROUTE_SYNC_ERROR:null,OFFLINE_MODE:false,routeLocalKey:()=>"route",
    localGet:async()=>structuredClone(saved),
    localPut:async(_,value)=>{saved=structuredClone(value)},
    localDelete:async()=>{deleted=true},
    syncAuxiliaryEvidence:async()=>{},
    sb:{from:table=>{
      assert.equal(table,"rutas");
      return {update:payload=>{
        sent=structuredClone(payload);
        return {eq:()=>({select:()=>({single:async()=>
          fail?{error:{message:"No se pudo cerrar",code:"P0001"}}:{data:{id:42},error:null}})})};
      }};
    }},
    setNetStatus:()=>{},err:()=>{},networkError:()=>false,renderRouteSyncError:()=>{},
    showRouteDone:value=>{done=value}
  });
  vm.runInContext(app.slice(app.indexOf("async function syncPendingRoute()"),app.indexOf("\nasync function retryPendingRouteSync()")),context);
  assert.equal(await vm.runInContext("syncPendingRoute()",context),false);
  assert.equal(deleted,false);
  assert.equal(saved.syncError.step,"cerrando la ruta en Supabase");
  assert.deepEqual(saved.checkout.extras,record.checkout.extras);
  fail=false;
  assert.equal(await vm.runInContext("syncPendingRoute()",context),true);
  assert.equal(deleted,true);
  assert.equal(done,false);
  assert.equal(sent.walmart_visitas_asignadas,12);
  assert.equal(sent.walmart_visitas_realizadas,11);
  assert.deepEqual(sent.walmart_folios_avaya,["A123"]);
});

test("offline Walmart cancellation retains both photos until upload and insertion succeed",async()=>{
  const record={key:"abc",driver_id:"driver",cedis_id:1,capturado_at:"2026-11-09T12:00:00Z",blob:"salida",bitacoraBlob:"bitacora"};
  const uploads=[];let fail=true,deleted=false,inserted;
  const context=vm.createContext({
    syncCancelBusy:false,ME:{id:"driver"},navigator:{onLine:true},OFFLINE_MODE:false,
    localGetAll:async()=>[record],localDelete:async()=>{deleted=true},
    setNetStatus:()=>{},err:()=>{},networkError:()=>true,
    sb:{
      storage:{from:()=>({upload:async(path,blob)=>{
        uploads.push([path,blob]);
        return {error:fail&&blob==="bitacora"?{message:"offline"}:null};
      }})},
      from:()=>({
        select:()=>({eq(){return this},maybeSingle:async()=>({data:null,error:null})}),
        insert:async payload=>{inserted=payload;return {error:null}}
      })
    }
  });
  vm.runInContext(app.slice(app.indexOf("async function syncPendingCancellations()"),app.indexOf("\nfunction drawCan()")),context);
  assert.equal(await vm.runInContext("syncPendingCancellations()",context),false);
  assert.equal(deleted,false);
  fail=false;
  assert.equal(await vm.runInContext("syncPendingCancellations()",context),true);
  assert.equal(deleted,true);
  assert.equal(inserted.foto_path,"driver/offline-abc.jpg");
  assert.equal(inserted.foto_bitacora_path,"driver/offline-abc-bitacora.jpg");
  assert.equal(uploads.length,4);
});

test("Walmart cancellation requires both photos without changing other clients",()=>{
  const elements={
    ccli:{value:"1"},ccedis:{value:"2"},bcan:{disabled:true},
    "wm-can-evidencia":{classList:{toggle:(_name,hidden)=>{elements.hidden=hidden}}}
  };
  const context=vm.createContext({
    $:id=>elements[id],cliName:()=>context.cliente,cliente:"WALMART",WALMART_TARIFARIO_ENABLED:true,
    ME:{id:"driver"},CANCEL_DAILY_LIMIT_EXEMPT_DRIVER_ID:"exempt",
    canUsedToday:false,canLimitUnknown:false,canBlob:"salida",canBitacoraBlob:null
  });
  vm.runInContext(app.slice(app.indexOf("const esCancelacionWalmart="),app.indexOf('\n$("wm-can-camera")')),context);
  vm.runInContext(app.slice(app.indexOf("function checkCan()"),app.indexOf('\n$("bcan").onclick')),context);
  vm.runInContext("checkCan()",context);
  assert.equal(elements.bcan.disabled,true);
  assert.equal(elements.hidden,false);
  context.canBitacoraBlob="bitacora";
  vm.runInContext("checkCan()",context);
  assert.equal(elements.bcan.disabled,false);
  context.cliente="COPPEL";context.canBitacoraBlob=null;
  vm.runInContext("checkCan()",context);
  assert.equal(elements.bcan.disabled,false);
  assert.equal(elements.hidden,true);
  context.canLimitUnknown=true;
  vm.runInContext("checkCan()",context);
  assert.equal(elements.bcan.disabled,true);
  context.canLimitUnknown=false;context.cliente="WALMART";context.WALMART_TARIFARIO_ENABLED=false;
  vm.runInContext("checkCan()",context);
  assert.equal(elements.bcan.disabled,false);
  assert.equal(elements.hidden,true);
});

test("Walmart cancellation evidence must be a distinct uploaded driver-owned photo",async()=>{
  const db=await database();
  const driver="00000000-0000-0000-0000-000000000001";
  try{
    await db.exec(migration);
    await db.query("insert into storage.objects values ('cancelaciones',$1)",[`${driver}/bitacora.jpg`]);
    await db.query("insert into public.cancelaciones(id,driver_id,cedis_id,foto_path,foto_bitacora_path) values (1,$1,1,$2,$3)",
      [driver,`${driver}/salida.jpg`,`${driver}/bitacora.jpg`]);
    await db.query("insert into public.cancelaciones(id,driver_id,cedis_id,foto_path) values (2,$1,1,$2)",[driver,`${driver}/legacy.jpg`]);
    const insert=(id,path)=>db.query("insert into public.cancelaciones(id,driver_id,cedis_id,foto_path,foto_bitacora_path) values ($1,$2,1,$3,$4)",
      [id,driver,`${driver}/salida.jpg`,path]);
    await assert.rejects(insert(3,`${driver}/missing.jpg`),/no se ha subido/);
    await assert.rejects(insert(4,"other/bitacora.jpg"),/no se ha subido/);
    await db.query("insert into storage.objects values ('cancelaciones',$1)",[`${driver}/salida.jpg`]);
    await assert.rejects(insert(5,`${driver}/salida.jpg`),/no se ha subido/);
    await assert.rejects(db.query("update public.cancelaciones set foto_bitacora_path=null where id=1"),/no puede modificarse/);
    await db.exec("insert into public.clientes values (2,'COPPEL',true); insert into public.cedis values (9,2,'Otro CEDIS',true)");
    await assert.rejects(db.query("insert into public.cancelaciones(id,driver_id,cedis_id,foto_path,foto_bitacora_path) values (6,$1,9,$2,$3)",
      [driver,`${driver}/salida.jpg`,`${driver}/bitacora.jpg`]),/solo corresponde/);
  }finally{await db.close()}
});

test("operations sees Walmart logbook evidence or an explicit missing-photo warning",()=>{
  const modal={classList:{remove(){}},querySelectorAll:()=>[]};
  const context=vm.createContext({
    C:[{id:1,ubicacion_validada:"dentro",estatus:"por_validar",cedis:{nombre:"Centro",clientes:{nombre:"WALMART"}},drivers:{nombre:"Driver"},foto_path:"salida",foto_bitacora_path:"bitacora"}],
    ROL:"ih",CEV:{},EVP:{},EVL:{},photos:{salida:"https://photo",bitacora:"https://logbook"},
    $:id=>id==="modal"?modal:{},esc:s=>String(s??""),estPill:()=>"",dd:()=>"",hh:()=>""
  });
  vm.runInContext(ops.slice(ops.indexOf("function revisarCan("),ops.indexOf("\nlet NOT=[]",ops.indexOf("function revisarCan("))),context);
  vm.runInContext("revisarCan(1)",context);
  assert.match(modal.innerHTML,/https:\/\/logbook/);
  assert.match(modal.innerHTML,/Bitácora de cancelación/);
  context.C[0].foto_bitacora_path=null;
  vm.runInContext("revisarCan(1)",context);
  assert.match(modal.innerHTML,/Falta la foto de la bitácora/);
});

test("Walmart rates retain both options, weekly percentages and confirmed centers",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    await db.exec(migration);
    const rows=(await db.query(`select c.nombre,w.tipo_unidad,w.vigencia_desde::text as desde,w.vigencia_hasta::text as hasta,
      w.tarifa_cliente::text,w.pago_opcion_1::text,w.pago_opcion_2::text,
      w.semanal_opcion_1::text,w.semanal_opcion_2::text
      from public.walmart_tarifas w join public.cedis c on c.id=w.cedis_id order by w.cedis_id`)).rows;
    assert.deepEqual(rows.map(x=>[x.nombre,x.tipo_unidad,x.tarifa_cliente,x.pago_opcion_1,x.pago_opcion_2,x.semanal_opcion_1,x.semanal_opcion_2]),[
      ["DS Querétaro","3.5T","5565.50","4500.00","4200.00","0.7500","0.8500"],
      ["DS Veracruz","3.5T","5565.50","4500.00","4200.00","0.8500","0.9000"],
      ["FC Guadalajara","Large","3969.00","3200.00","3000.00","0.7500","0.8500"],
      ["FC Mérida","Large","4500.00","3600.00","3400.00","0.8500","0.9000"]
    ]);
    assert.ok(rows.every(x=>x.desde==="2026-11-09"&&x.hasta==="2026-12-31"));
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from public.walmart_tarifas"),/permission denied/);
  }finally{await db.close()}
});

test("agreement changes are scoped to assigned CEDIS and audited once",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    await db.exec(`select set_config('test.user_id','00000000-0000-0000-0000-000000000001',false),
      set_config('test.admin','true',false),set_config('test.rol','ih',false),set_config('test.cedis','1',false);
      set role authenticated`);
    const change=(supplier,cedis,option)=>db.query("select public.walmart_cambiar_modelo($1,$2,$3::smallint) as opcion",[supplier,cedis,option]);
    const read=(supplier,cedis)=>db.query("select public.walmart_consultar_modelo($1,$2) as opcion",[supplier,cedis]);
    assert.equal((await read(10,1)).rows[0].opcion,1);
    await assert.rejects(read(10,2),/No tienes permiso/);
    await assert.rejects(read(11,1),/inactivo/);
    await assert.rejects(change(10,2,2),/No tienes permiso/);
    await assert.rejects(change(11,1,2),/inactivo/);
    await assert.rejects(change(10,1,3),/opción 1 o 2/);
    assert.equal((await change(10,1,2)).rows[0].opcion,2);
    assert.equal((await read(10,1)).rows[0].opcion,2);
    await change(10,1,2);
    await db.exec("select set_config('test.rol','ops',false)");
    await change(10,2,2);
    await db.exec("select set_config('test.rol','coordinador',false)");
    await assert.rejects(change(10,1,1),/No tienes permiso/);
    await assert.rejects(read(10,1),/No tienes permiso/);
    await db.exec("select set_config('test.rol','master',false),set_config('test.admin','false',false)");
    await assert.rejects(change(10,1,1),/Acceso administrativo requerido/);
    await db.exec("select set_config('test.admin','true',false)");
    await change(10,2,1);
    await db.exec("reset role");
    const agreements=(await db.query("select cedis_id,opcion from private.walmart_acuerdos order by cedis_id")).rows;
    assert.deepEqual(agreements,[{cedis_id:1,opcion:2},{cedis_id:2,opcion:1}]);
    const audit=(await db.query("select opcion_anterior,opcion_nueva from private.walmart_cambios_acuerdo order by id")).rows;
    assert.deepEqual(audit,[{opcion_anterior:1,opcion_nueva:2},{opcion_anterior:1,opcion_nueva:2},{opcion_anterior:2,opcion_nueva:1}]);
  }finally{await db.close()}
});

test("Walmart agreement history reconstructs the model at check-in",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    await db.exec(`
      insert into private.walmart_acuerdos(proveedor_id,cedis_id,opcion) values (10,1,1);
      insert into private.walmart_cambios_acuerdo
        (proveedor_id,cedis_id,opcion_anterior,opcion_nueva,actor_id,cambiado_en) values
        (10,1,1,2,'00000000-0000-0000-0000-000000000001','2026-11-09 12:00:00+00'),
        (10,1,2,1,'00000000-0000-0000-0000-000000000001','2026-11-11 12:00:00+00');
    `);
    const option=async(cedis,started)=>(await db.query(
      "select private.walmart_opcion_al_iniciar(10,$1,$2::timestamptz) as opcion",
      [cedis,started])).rows[0].opcion;
    assert.equal(await option(1,"2026-11-09T11:00:00Z"),1);
    assert.equal(await option(1,"2026-11-09T12:00:00Z"),2);
    assert.equal(await option(1,"2026-11-10T00:00:00Z"),2);
    assert.equal(await option(1,"2026-11-11T12:00:00Z"),1);
    assert.equal(await option(2,"2026-11-10T00:00:00Z"),1);
    await assert.rejects(option(99,"2026-11-10T00:00:00Z"),/no válido/);
    await assert.rejects(option(1,null),/Se requiere proveedor/);
    await db.exec("set role authenticated");
    await assert.rejects(option(1,"2026-11-10T00:00:00Z"),/permission denied/);
  }finally{await db.close()}
});

test("Walmart closure validates visits and flags legacy app closures for review",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    await db.exec("insert into public.rutas(id,cedis_id,estado,fallidos) values (1,1,'en_ruta',1)");
    await assert.rejects(db.exec("update public.rutas set estado='cerrada',walmart_visitas_asignadas=100 where id=1"),/visitas asignadas/);
    await assert.rejects(db.exec("update public.rutas set estado='cerrada',walmart_visitas_asignadas=100,walmart_visitas_realizadas=101 where id=1"),/visitas asignadas/);
    await assert.rejects(db.exec("update public.rutas set estado='cerrada',walmart_visitas_asignadas=100,walmart_visitas_realizadas=95 where id=1"),/folio Avaya/);
    await db.exec("update public.rutas set estado='cerrada',walmart_visitas_asignadas=100,walmart_visitas_realizadas=95,walmart_folios_avaya=array['A123'],walmart_requiere_revision=true where id=1");
    assert.equal((await db.query("select walmart_requiere_revision as revision from public.rutas where id=1")).rows[0].revision,false);
    await assert.rejects(db.exec("update public.rutas set walmart_visitas_realizadas=100 where id=1"),/ruta cerrada/);
    await db.exec("insert into public.rutas(id,cedis_id,estado,fallidos) values (2,1,'en_ruta',1)");
    await db.exec("update public.rutas set estado='cerrada',walmart_requiere_revision=false where id=2");
    assert.equal((await db.query("select walmart_requiere_revision as revision from public.rutas where id=2")).rows[0].revision,true);
    await assert.rejects(db.exec("update public.rutas set walmart_requiere_revision=false where id=2"),/ruta cerrada/);
    await db.exec("insert into public.clientes values (2,'COPPEL',true); insert into public.cedis values (5,2,'Otro CEDIS',true); insert into public.rutas(id,cedis_id,estado,fallidos) values (3,5,'en_ruta',1)");
    await db.exec("update public.rutas set estado='cerrada' where id=3");
    assert.equal((await db.query("select walmart_requiere_revision as revision from public.rutas where id=3")).rows[0].revision,null);
  }finally{await db.close()}
});

test("Walmart cancellation pays 40 percent with fiscal treatment and agreement retention",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async(cedis,fecha,unidad,option,fiscal)=>(await db.query(
      "select private.calcular_walmart_cancelacion_configurada($1,$2::date,$3,$4::smallint,$5,0.05,0.16,0.02) as result",
      [cedis,fecha,unidad,option,fiscal])).rows[0].result;
    const noFactura=await calc(1,"2026-11-09","3.5T",1,"SIN FACTURA");
    assert.equal(noFactura.base_servicio,4500);
    assert.equal(noFactura.pago_base,1800);
    assert.equal(noFactura.total,1710);
    assert.equal(noFactura.comision,34.2);
    assert.equal(noFactura.pago_semanal,1282.5);
    assert.equal(noFactura.saldo_retenido,427.5);
    const factura=await calc(1,"2026-11-09","3.5T",2,"FACTURA");
    assert.equal(factura.base_servicio,4200);
    assert.equal(factura.pago_base,1680);
    assert.equal(factura.total,1948.8);
    assert.equal(factura.pago_semanal,1656.48);
    assert.equal(factura.saldo_retenido,292.32);
    assert.equal(factura.descuento_visitas,0);
    assert.equal(factura.descuento_fallida,0);
    await assert.rejects(calc(1,"2026-11-08","3.5T",1,"FACTURA"),/sola tarifa Walmart vigente/);
    await assert.rejects(calc(1,"2027-01-01","3.5T",1,"FACTURA"),/sola tarifa Walmart vigente/);
    await assert.rejects(calc(1,"2026-11-09","Sedan",1,"FACTURA"),/Unidad sin tarifa/);
    await db.exec("set role authenticated");
    await assert.rejects(calc(1,"2026-11-09","3.5T",1,"FACTURA"),/permission denied/);
  }finally{await db.close()}
});

test("Walmart applies validated penalties, fiscal treatment and weekly split",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async args=>(await db.query("select private.calcular_walmart_importes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value",args)).rows[0].value;
    const args=[4500,0.75,100,95,true,false,"SIN FACTURA",0.05,0.16,0.02];
    const actual=await calc(args);
    assert.equal(actual.subtotal,4275);
    assert.equal(actual.impuesto,-213.75);
    assert.equal(actual.total,4061.25);
    assert.equal(actual.comision,81.23);
    assert.equal(actual.costo_total_imp,4142.48);
    assert.equal(actual.pago_semanal,3045.94);
    assert.equal(actual.saldo_retenido,1015.31);
    const extra=await calc([4500,0.75,100,95,true,true,"FACTURA",0.05,0.16,0.02]);
    assert.equal(extra.descuento_visitas,225);
    assert.equal(extra.descuento_fallida,225);
    assert.equal(extra.subtotal,4050);
    assert.equal(extra.total,4698);
    assert.equal(extra.comision,0);
    assert.equal(extra.costo_total_imp,4698);
    assert.equal(extra.pago_semanal+extra.saldo_retenido,extra.total);
    assert.equal((await calc([4500,0.75,100,70,false,false,"FACTURA",0.05,0.16,0.02])).subtotal,4500);
    await assert.rejects(calc([4500,0.75,100,101,true,false,"FACTURA",0.05,0.16,0.02]),/Datos inválidos/);
    await assert.rejects(calc([4500,0.75,100,0,true,true,"FACTURA",0.05,0.16,0.02]),/exceden el pago base/);
    await assert.rejects(calc([4500,0.75,100,95,false,false,"SIN FACTURA",0.05,0.16,1.1]),/Datos inválidos/);
    await assert.rejects(calc(["Infinity",0.75,100,95,false,false,"FACTURA",0.05,0.16,0.02]),/Datos inválidos/);
    await assert.rejects(calc([4500,"NaN",100,95,false,false,"FACTURA",0.05,0.16,0.02]),/Datos inválidos/);
  }finally{await db.close()}
});

test("assigned IH records the Walmart retention decision only before validation",async()=>{
  const db=await database();
  try{
    await db.exec(`
      create table public.liquidaciones(ruta_id bigint);
      create table public.pagos(ruta_id bigint,estatus text);
      create table public.validaciones_pendientes(ruta_id bigint,estatus text);
      create function private.es_valida() returns boolean language sql stable as $$
        select coalesce(current_setting('test.valida',true),'false')='true'
      $$;
      insert into public.clientes values (2,'COPPEL',true);
      insert into public.cedis values (5,2,'Coppel',true);
      insert into public.rutas values (1,1,'cerrada',0),(2,2,'cerrada',0),
        (3,1,'en_ruta',0),(4,5,'cerrada',0);
    `);
    await db.exec(retentionDecisionDraft);
    await db.exec(`
      select set_config('test.user_id','00000000-0000-0000-0000-000000000001',false);
      select set_config('test.admin','true',false);
      select set_config('test.valida','true',false);
      select set_config('test.rol','ih',false);
      select set_config('test.cedis','1',false);
      set role authenticated;
    `);
    const read=async(id)=>(await db.query("select public.walmart_consultar_retencion($1) as value",[id])).rows[0].value;
    const choose=async(id,value)=>(await db.query("select public.walmart_elegir_retencion($1,$2) as value",[id,value])).rows[0].value;
    assert.equal(await read(1),true);
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int as n from private.walmart_decisiones_retencion")).rows[0].n,0);
    await db.exec("set role authenticated");
    assert.equal(await choose(1,false),false);
    assert.equal(await read(1),false);
    assert.equal(await choose(1,true),true);
    assert.equal(await read(1),true);
    await assert.rejects(choose(1,null),/Selecciona/);
    await assert.rejects(choose(2,false),/asignada requerida/);
    await assert.rejects(choose(3,false),/asignada requerida/);
    await assert.rejects(choose(4,false),/asignada requerida/);
    await assert.rejects(read(2),/supervisor asignado/);
    await assert.rejects(db.query("select * from private.walmart_decisiones_retencion"),/permission denied/);
    await db.exec("reset role; insert into public.validaciones_pendientes values (1,'pendiente'); set role authenticated");
    await assert.rejects(choose(1,false),/pendiente de aprobacion/);
    await db.exec("reset role; delete from public.validaciones_pendientes; insert into public.liquidaciones values (1); set role authenticated");
    await assert.rejects(choose(1,false),/ruta validada/);
    await db.exec("reset role; delete from public.liquidaciones; insert into public.pagos values (1,'pagado'); set role authenticated");
    await assert.rejects(choose(1,false),/con pagos/);
    await db.exec("select set_config('test.rol','ops',false)");
    await assert.rejects(choose(1,false),/supervisor autorizado/);
    await assert.rejects(read(1),/supervisor asignado/);
    await db.exec("select set_config('test.rol','ih',false); select set_config('test.admin','false',false)");
    await assert.rejects(choose(1,false),/supervisor autorizado/);
    await db.exec("select set_config('test.admin','true',false); select set_config('test.valida','false',false)");
    await assert.rejects(choose(1,false),/supervisor autorizado/);
    await db.exec("reset role; set role anon");
    await assert.rejects(read(1),/permission denied/);
    await db.exec("reset role");
    const row=(await db.query("select aplicar_retencion,seleccionado_por from private.walmart_decisiones_retencion where ruta_id=1")).rows[0];
    assert.equal(row.aplicar_retencion,true);
    assert.equal(row.seleccionado_por,"00000000-0000-0000-0000-000000000001");
  }finally{await db.close()}
});

test("Walmart route retention decision changes the split without changing taxes or total",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    await db.exec(retentionDraft);
    const calc=async(fiscal,retention,option)=>(await db.query(
      "select private.calcular_walmart_ruta_con_retencion(1,'2026-11-09','3.5T',$1::smallint,100,95,true,false,$2,0.05,0.16,0.02,$3) as value",
      [option,fiscal,retention])).rows[0].value;
    for(const fiscal of ["FACTURA","SIN FACTURA"]){
      for(const option of [1,2]){
        const held=await calc(fiscal,true,option);
        const weekly=await calc(fiscal,false,option);
        assert.equal(held.aplicar_retencion,true);
        assert.equal(weekly.aplicar_retencion,false);
        assert.equal(weekly.total,held.total);
        assert.equal(weekly.impuesto,held.impuesto);
        assert.equal(weekly.comision,held.comision);
        assert.equal(weekly.porcentaje_semanal,held.porcentaje_semanal);
        assert.equal(weekly.pago_semanal,held.total);
        assert.equal(weekly.saldo_retenido,0);
        assert.equal(held.pago_semanal+held.saldo_retenido,held.total);
        assert.ok(held.saldo_retenido>0);
      }
    }
    await assert.rejects(calc("FACTURA",null,1),/decision de retencion/);
    await db.exec("set role authenticated");
    await assert.rejects(calc("FACTURA",false,1),/permission denied/);
  }finally{await db.close()}
});

async function prepareNoShowDraft(db){
  await db.exec(`
    create table if not exists public.no_show_casos(
      id uuid primary key default gen_random_uuid(),cuenta text,proveedor_id bigint,driver_id uuid,
      cedis_id bigint,fecha_servicio date,tipo_unidad text,estado text,
      vence_apelacion_en timestamptz,pago_penalizacion_id bigint,pago_reversion_id bigint,
      monto_penalizacion numeric,valor_servicio_contratado numeric,metodo_calculo text,
      cliente_id bigint,cliente_nombre text,cedis_nombre text,driver_nombre text,tarifa_servicio_id bigint,
      observaciones_supervisor text,creado_por uuid,apelacion text,apelacion_en timestamptz,
      resolucion text,resuelto_por uuid,resuelto_en timestamptz,creado_en timestamptz default now()
    );
    create table if not exists public.pagos(
      id bigint generated always as identity primary key,driver_id uuid,proveedor_id bigint,
      ruta_id bigint,concepto text,monto numeric,fecha date,estatus text
    );
    create table if not exists public.liquidaciones(ruta_id bigint,dcto_pago numeric,pago_driver numeric);
  `);
  await db.exec(noShowDraft);
}

test("Walmart NO SHOW calculates 60 percent of the selected historical tariff",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    await prepareNoShowDraft(db);
    const calculate=async(cedis,date,unit,option)=>(await db.query(
      "select private.calcular_walmart_no_show_configurado($1,$2,$3,$4::smallint) as value",
      [cedis,date,unit,option])).rows[0].value;
    for(const [cedis,unit,option,base,amount] of [
      [1,"3.5T",1,4500,2700],[1,"3.5T",2,4200,2520],
      [3,"Large",1,3200,1920],[4,"Large",2,3400,2040]
    ]){
      const result=await calculate(cedis,"2026-11-09",unit,option);
      assert.equal(result.base_servicio,base);
      assert.equal(result.monto_penalizacion,amount);
      assert.equal(result.porcentaje_no_show,0.6);
      assert.equal(result.opcion,option);
    }
    await assert.rejects(calculate(1,"2026-11-08","3.5T",1),/una sola tarifa/);
    await assert.rejects(calculate(1,"2026-11-09","Large",1),/una sola tarifa/);
    await assert.rejects(calculate(1,"2026-11-09","3.5T",3),/modelo Walmart confirmado/);
    await db.exec("set role authenticated");
    await assert.rejects(calculate(1,"2026-11-09","3.5T",1),/permission denied/);
  }finally{await db.close()}
});

test("Walmart NO SHOW carries unpaid balances without duplicating existing adjustments",async()=>{
  const db=await database();
  const driver="00000000-0000-0000-0000-000000000001";
  const other="00000000-0000-0000-0000-000000000002";
  const claim="00000000-0000-0000-0000-000000000003";
  try{
    await db.exec(migration);
    await db.query("insert into public.drivers values ($1),($2) on conflict do nothing",[driver,other]);
    await prepareNoShowDraft(db);
    const calc=(await db.query("select private.calcular_walmart_no_show_configurado(1,'2026-11-09','3.5T',1::smallint) as value")).rows[0].value;
    await db.query(`insert into public.no_show_casos(id,cuenta,proveedor_id,driver_id,cedis_id,
      fecha_servicio,tipo_unidad,estado,vence_apelacion_en,pago_penalizacion_id,pago_reversion_id,
      monto_penalizacion,valor_servicio_contratado)
      values ($1,'WALMART',10,$2,1,'2026-11-09','3.5T','reportado',
        now()+interval '1 hour',null,null,2700,4500)`,[claim,driver]);
    const register=async()=>(await db.query(
      "select private.walmart_registrar_saldo_no_show($1,1::smallint,$2::jsonb)",
      [claim,JSON.stringify(calc)]));
    await assert.rejects(register(),/no esta firme/);
    await db.exec("update public.no_show_casos set estado='apelacion_rechazada',pago_penalizacion_id=7");
    await assert.rejects(register(),/ajustes existentes/);
    await db.exec("update public.no_show_casos set pago_penalizacion_id=null");
    await register();
    await register();
    const apply=async(type,id,who,amount)=>(await db.query(
      "select private.walmart_aplicar_saldos_no_show($1,$2,10,$3,$4) as value",
      [type,id,who,amount])).rows[0].value;
    assert.deepEqual(await apply("ruta",1,other,100),{aplicado:0,restante:100});
    assert.deepEqual(await apply("ruta",2,driver,1000),{aplicado:1000,restante:0});
    assert.deepEqual(await apply("ruta",2,driver,1000),{aplicado:1000,restante:0});
    await assert.rejects(apply("ruta",2,driver,999),/otra aplicacion/);
    await db.exec("begin");
    assert.deepEqual(await apply("cancelacion",1,driver,1000),{aplicado:1000,restante:0});
    await db.exec("rollback");
    let balance=(await db.query("select saldo_pendiente,monto_aplicado from private.walmart_no_show_saldos")).rows[0];
    assert.equal(Number(balance.saldo_pendiente),1700);
    assert.equal(Number(balance.monto_aplicado),1000);
    await assert.rejects(db.exec("update public.no_show_casos set pago_penalizacion_id=8"),/requiere correccion auditada/);
    assert.deepEqual(await apply("cancelacion",1,driver,2000),{aplicado:1700,restante:300});
    balance=(await db.query("select saldo_pendiente,monto_aplicado from private.walmart_no_show_saldos")).rows[0];
    assert.equal(Number(balance.saldo_pendiente),0);
    assert.equal(Number(balance.monto_aplicado),2700);
    assert.equal(Number((await db.query("select count(*) as n from private.walmart_no_show_aplicaciones")).rows[0].n),2);
    await db.exec("set role authenticated");
    await assert.rejects(apply("ruta",3,driver,1),/permission denied/);
  }finally{await db.close()}
});

test("legacy Walmart NO SHOW diagnosis is read-only and flags missing or inconsistent movements",async()=>{
  const db=await database();
  try{
    await db.exec(`
      create table public.no_show_casos(
        cuenta text,estado text,proveedor_id bigint,driver_id uuid,monto_penalizacion numeric,
        pago_penalizacion_id bigint,pago_reversion_id bigint,metodo_calculo text,vence_apelacion_en timestamptz
      );
      create table public.pagos(id bigint primary key,driver_id uuid,proveedor_id bigint,
        ruta_id bigint,concepto text,monto numeric,estatus text);
      insert into public.pagos values
        (1,'00000000-0000-0000-0000-000000000001',10,null,'ajuste',-100,'pendiente'),
        (2,'00000000-0000-0000-0000-000000000001',10,null,'ajuste',100,'pendiente'),
        (3,'00000000-0000-0000-0000-000000000001',10,null,'ajuste',-99,'pendiente'),
        (4,'00000000-0000-0000-0000-000000000001',10,null,'ajuste',99,'pendiente');
      insert into public.no_show_casos values
        ('WALMART','reportado',10,'00000000-0000-0000-0000-000000000001',100,null,null,'manual',now()),
        ('WALMART','reportado',10,'00000000-0000-0000-0000-000000000001',100,1,null,'manual',now()+interval '1 day'),
        ('WALMART','apelacion_aceptada',10,'00000000-0000-0000-0000-000000000001',100,1,2,'manual',now()),
        ('WALMART','apelacion_aceptada',10,'00000000-0000-0000-0000-000000000001',100,1,null,'manual',now()),
        ('WALMART','reportado',10,'00000000-0000-0000-0000-000000000001',100,3,null,'manual',now()),
        ('WALMART','apelacion_aceptada',10,'00000000-0000-0000-0000-000000000001',100,1,4,'manual',now()),
        ('WALMART','reportado',10,'00000000-0000-0000-0000-000000000001',100,999,null,'manual',now()),
        ('WALMART','reportado',10,'00000000-0000-0000-0000-000000000001',100,1,2,'manual',now()),
        ('WALMART','apelado',null,'00000000-0000-0000-0000-000000000001',100,null,null,'manual',now()),
        ('WALMART','reportado',10,'00000000-0000-0000-0000-000000000001',100,null,null,'walmart_60_saldo',now()),
        (' walmart ','reportado',10,'00000000-0000-0000-0000-000000000001',100,null,null,'manual',now());
    `);
    const rows=(await db.query(noShowDiagnostic)).rows;
    assert.deepEqual(rows.map(row=>row.diagnostico),[
      "cuenta_no_normalizada","descuento_con_plazo_abierto","descuento_faltante",
      "descuento_inconsistente","descuento_y_reversion_existentes","reversion_faltante",
      "reversion_inconsistente","reversion_inesperada","sin_movimiento_requiere_revision",
      "sin_proveedor_requiere_revision"
    ]);
    assert.ok(rows.every(row=>Number(row.casos)===1));
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),4);
    await db.exec("delete from public.no_show_casos");
    const empty=(await db.query(noShowDiagnostic)).rows;
    assert.equal(empty[0].diagnostico,"sin_casos_anteriores");
    assert.equal(Number(empty[0].casos),0);
  }finally{await db.close()}
});

test("Walmart NO SHOW creation, appeals and expiry activate only the appropriate balance",async()=>{
  const db=await database();
  const supervisor="00000000-0000-0000-0000-000000000001";
  const driver="00000000-0000-0000-0000-000000000002";
  const coordinator="00000000-0000-0000-0000-000000000003";
  const request1="00000000-0000-0000-0000-000000000101";
  const request2="00000000-0000-0000-0000-000000000102";
  const request3="00000000-0000-0000-0000-000000000103";
  try{
    await db.exec(migration);
    await db.exec(`
      alter table public.drivers add column nombre text,add column rol text;
      update public.drivers set nombre='Supervisor',rol='ih';
      update public.walmart_tarifas set vigencia_desde=(now() at time zone 'America/Mexico_City')::date,
        vigencia_hasta=(now() at time zone 'America/Mexico_City')::date+30 where cedis_id=1;
      create table public.tarifas(id bigint primary key,cuenta text,activo boolean);
      create table private.walmart_tarifas_mapeo(walmart_tarifa_id bigint primary key,tarifa_id bigint);
      insert into public.tarifas values (11,'WALMART',true);
      insert into private.walmart_tarifas_mapeo select id,11 from public.walmart_tarifas where cedis_id=1;
      create table public.no_show_casos(
        id uuid primary key default gen_random_uuid(),driver_id uuid not null,proveedor_id bigint,
        cliente_id bigint,cedis_id bigint,cliente_nombre text,cedis_nombre text,driver_nombre text,
        cuenta text,tipo_unidad text,fecha_servicio date,tarifa_servicio_id bigint,
        valor_servicio_contratado numeric,metodo_calculo text,observaciones_supervisor text,monto_penalizacion numeric,
        creado_por uuid,estado text default 'reportado',vence_apelacion_en timestamptz default now()+interval '6 hours',
        pago_penalizacion_id bigint,pago_reversion_id bigint,apelacion text,apelacion_en timestamptz,
        resolucion text,resuelto_por uuid,resuelto_en timestamptz,creado_en timestamptz default now()
      );
      create table public.no_show_eventos(caso_id uuid,tipo text,mensaje text,actor_id uuid);
      create function public.no_show_es_supervisor() returns boolean language sql stable as $$
        select current_setting('test.rol',true)='ih'
      $$;
      create function public.no_show_es_coordinador() returns boolean language sql stable as $$
        select current_setting('test.rol',true)='coordinador'
      $$;
      create function public.no_show_texto_inapropiado(text) returns boolean language sql immutable as $$ select false $$;
      create function private.es_valida() returns boolean language sql stable as $$ select true $$;
    `);
    await db.query("insert into public.drivers(id,nombre,rol) values ($1,'Driver','driver'),($2,'Coordinacion','coordinador')",[driver,coordinator]);
    await prepareNoShowDraft(db);
    await db.exec(noShowFlowDraft);
    await db.exec(noShowPrecloseDraft);
    const appealStart=noShowWorkflow.indexOf("create or replace function public.apelar_no_show(");
    const appealEnd=noShowWorkflow.indexOf("\ncreate or replace function public.resolver_apelacion_no_show(",appealStart);
    await db.exec(noShowWorkflow.slice(appealStart,appealEnd));
    const resolveEnd=noShowWorkflow.indexOf("\nrevoke all on function public.crear_reporte_no_show",appealEnd);
    await db.exec(noShowWorkflow.slice(appealEnd,resolveEnd));
    const setUser=async(user,role)=>{
      await db.query("select set_config('test.user_id',$1,false),set_config('test.rol',$2,false),set_config('test.cedis','1',false),set_config('test.admin','true',false)",[user,role]);
    };
    await setUser(driver,"driver");
    await assert.rejects(db.query("select public.walmart_previsualizar_no_show(1,(now() at time zone 'America/Mexico_City')::date,'3.5T',10,1::smallint)"),/supervisor asignado/);
    await setUser(supervisor,"ih");
    await db.exec("select set_config('test.cedis','2',false)");
    await assert.rejects(db.query("select public.walmart_previsualizar_no_show(1,(now() at time zone 'America/Mexico_City')::date,'3.5T',10,1::smallint)"),/CEDIS asignado/);
    await db.exec("select set_config('test.cedis','1',false)");
    const preview=(await db.query("select public.walmart_previsualizar_no_show(1,(now() at time zone 'America/Mexico_City')::date,'3.5T',10,1::smallint) as value")).rows[0].value;
    const create=async(request,comment="No se presento",expected=preview)=>(await db.query(
      "select public.walmart_crear_no_show($1,$2,1,(now() at time zone 'America/Mexico_City')::date,'3.5T',10,1::smallint,$3,$4::jsonb) as value",
      [request,driver,comment,JSON.stringify(expected)])).rows[0].value;
    const case1=await create(request1);
    assert.equal(await create(request1),case1);
    const assigned=(await db.query(`select semana_no_show::text as semana,
      private.walmart_semana_no_show(creado_en)::text as esperada
      from private.walmart_no_show_reportes where caso_id=$1`,[case1])).rows[0];
    assert.equal(assigned.semana,assigned.esperada);
    await assert.rejects(create(request1,"Otro servicio"),/otros datos/);
    await assert.rejects(create(request2,"No se presento",{...preview,monto_penalizacion:1}),/cambio/);
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),0);
    assert.equal(Number((await db.query("select count(*) as n from private.walmart_no_show_saldos")).rows[0].n),0);
    await setUser(driver,"driver");
    await db.query("select public.apelar_no_show($1,'Tengo evidencia')",[case1]);
    await setUser(coordinator,"coordinador");
    await assert.rejects(db.query("select public.resolver_apelacion_no_show($1,'aceptar','Justificado')",[case1]),/resolucion sin ajuste duplicado/);
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),0);
    await db.query("select public.walmart_resolver_apelacion_no_show($1,'aceptar','Justificado')",[case1]);
    assert.equal((await db.query("select estado from public.no_show_casos where id=$1",[case1])).rows[0].estado,"apelacion_aceptada");
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),0);
    await db.query("select private.walmart_verificar_casos_no_show(10,$1)",[driver]);
    await assert.rejects(db.query("select public.walmart_resolver_apelacion_no_show($1,'aceptar','')",[case1]),/no admite/);
    await setUser(supervisor,"ih");
    const case2=await create(request2);
    await setUser(driver,"driver");
    await db.query("select public.apelar_no_show($1,'Solicito revision')",[case2]);
    await setUser(coordinator,"coordinador");
    await db.query("select public.walmart_resolver_apelacion_no_show($1,'rechazar','Sin evidencia')",[case2]);
    assert.equal(Number((await db.query("select saldo_pendiente from private.walmart_no_show_saldos where caso_id=$1",[case2])).rows[0].saldo_pendiente),2700);
    await setUser(supervisor,"ih");
    const case3=await create(request3);
    await db.query("update public.no_show_casos set vence_apelacion_en=now()-interval '1 second' where id=$1",[case3]);
    await db.query("select private.walmart_preparar_no_show(10,$1)",[driver]);
    assert.equal(Number((await db.query("select saldo_pendiente from private.walmart_no_show_saldos where caso_id=$1",[case3])).rows[0].saldo_pendiente),2700);
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),0);
    await setUser(driver,"driver");
    await assert.rejects(db.query("select public.walmart_resolver_apelacion_no_show($1,'aceptar','')",[case3]),/Solo Coordinacion/);
    await assert.rejects(db.query("select public.apelar_no_show($1,'Fuera de plazo')",[case3]),/plazo/);
    await setUser(supervisor,"ih");
    const week=(await db.query("select (date_trunc('week',now() at time zone 'America/Mexico_City')::date+14)::text as value")).rows[0].value;
    const review=async()=>(await db.query("select public.walmart_consultar_no_show_precierre($1,$2) as value",[driver,week])).rows[0].value;
    const cases=await review();
    assert.equal(cases.cantidad,3);
    assert.equal(cases.casos.find(c=>c.caso_id===case1).seleccionable,false);
    assert.equal(cases.casos.find(c=>c.caso_id===case2).seleccionable,true);
    assert.equal(cases.casos.find(c=>c.caso_id===case3).seleccionable,true);
    const request="00000000-0000-0000-0000-000000000104";
    const apply=async(id=case2,amount=2700)=>(await db.query(
      "select public.walmart_aplicar_no_show_precierre($1,$2,$3,$4) as value",[request,id,week,amount])).rows[0].value;
    await assert.rejects(apply(case1),/no esta disponible/);
    await assert.rejects(apply(case2,1),/cambio/);
    await db.exec("begin");
    await apply();
    await db.exec("rollback");
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),0);
    const applied=await apply();
    assert.equal((await apply()).pago_id,applied.pago_id);
    await assert.rejects(apply(case3),/decision diferente/);
    assert.equal((await review()).casos.find(c=>c.caso_id===case2).aplicado,true);
    assert.equal(Number((await db.query("select monto from public.pagos where id=$1",[applied.pago_id])).rows[0].monto),-2700);
    assert.equal(Number((await db.query("select saldo_pendiente from private.walmart_no_show_saldos where caso_id=$1",[case2])).rows[0].saldo_pendiente),0);
    await assert.rejects(db.query("update public.pagos set monto=0 where id=$1",[applied.pago_id]),/correccion auditada/);
    const selection=[
      {caso_id:case3,solicitud_id:"00000000-0000-0000-0000-000000000105",monto:2700},
      {caso_id:case1,solicitud_id:"00000000-0000-0000-0000-000000000106",monto:2700}
    ];
    const batch=async(items)=>db.query("select public.walmart_aplicar_no_shows_precierre($1,$2,$3::jsonb) as value",
      [driver,week,JSON.stringify(items)]);
    await assert.rejects(batch(selection),/no esta disponible/);
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),1);
    await assert.rejects(batch([selection[0],selection[0]]),/duplicados/);
    const batchResult=(await batch([selection[0]])).rows[0].value;
    assert.equal(batchResult.length,1);
    assert.equal((await batch([selection[0]])).rows[0].value[0].pago_id,batchResult[0].pago_id);
    await db.exec("select set_config('test.cedis','2',false)");
    await assert.rejects(review(),/todos los CEDIS/);
    await setUser(driver,"driver");
    await assert.rejects(review(),/Solo el supervisor/);
  }finally{await db.close()}
});

test("provider retention ledger preserves origin totals without attributing payment to a driver",async()=>{
  const db=await database();
  const actor="00000000-0000-0000-0000-000000000001";
  const payment="00000000-0000-0000-0000-000000000010";
  try{
    await db.exec(`
      alter table public.proveedores add column titular_id uuid,add column tipo text;
      alter table public.drivers add column proveedor_id bigint,add column rol text,add column estatus text;
      alter table public.rutas add column driver_id uuid;
      update public.proveedores set titular_id='00000000-0000-0000-0000-000000000001' where id=10;
      update public.proveedores set tipo='flotillero';
      update public.drivers set proveedor_id=10,rol='flotillero',estatus='activo' where id='00000000-0000-0000-0000-000000000001';
      insert into public.drivers(id,proveedor_id,rol,estatus) values ('00000000-0000-0000-0000-000000000002',10,'driver','activo');
      create table private.walmart_liquidaciones(ruta_id bigint primary key,proveedor_id bigint,saldo_retenido numeric,driver_id uuid);
      create table private.walmart_cancelaciones_pagadas(cancelacion_id bigint primary key,proveedor_id bigint,saldo_retenido numeric,driver_id uuid);
      create table private.walmart_proveedores_confirmados(ruta_id bigint,proveedor_id bigint);
      create table public.asignaciones_operativas(cliente_id bigint,cedis_id bigint,supervisor_id uuid);
      create table public.no_show_casos(id uuid,proveedor_id bigint,driver_id uuid,cedis_id bigint,cuenta text,
        metodo_calculo text,estado text,vence_apelacion_en timestamptz,pago_penalizacion_id bigint,pago_reversion_id bigint);
      create table private.walmart_no_show_reportes(caso_id uuid,proveedor_id bigint);
      create table private.walmart_no_show_saldos(caso_id uuid,proveedor_id bigint,driver_id uuid,saldo_pendiente numeric);
      create table public.pnr_reclamos(id uuid,driver_id uuid,cliente text,estado text);
      create table public.pnr_descuentos(reclamo_id uuid,saldo_pendiente numeric);
      create table public.pagos(proveedor_id bigint,driver_id uuid,estatus text,concepto text,monto numeric);
      create function private.es_valida() returns boolean language sql stable as $$
        select coalesce(current_setting('test.valida',true),'false')='true'
      $$;
      create function private.walmart_consultar_plazo(bigint,timestamptz) returns jsonb language sql stable as $$
        select jsonb_build_object('estado','calculado','ultima_ruta','2020-01-01T00:00:00Z'::timestamptz,
          'plazo_cumplido',coalesce(current_setting('test.plazo',true),'true')='true',
          'liberacion_validada',false,'rutas_sin_proveedor',42)
      $$;
      insert into public.rutas(id,cedis_id,estado,fallidos) values
        (1,1,'cerrada',0),(2,1,'cerrada',0),(3,1,'cerrada',0),(4,1,'cerrada',0),(5,1,'cerrada',0);
      update public.rutas set driver_id='00000000-0000-0000-0000-000000000002';
      insert into public.cancelaciones(id,driver_id,cedis_id,foto_path) values
        (1,'00000000-0000-0000-0000-000000000002',1,'foto'),
        (2,'00000000-0000-0000-0000-000000000002',1,'foto');
      insert into private.walmart_liquidaciones values
        (1,10,250,'00000000-0000-0000-0000-000000000001'),
        (2,10,350,'00000000-0000-0000-0000-000000000002'),
        (3,11,900,'00000000-0000-0000-0000-000000000002'),
        (4,10,0,'00000000-0000-0000-0000-000000000001'),
        (5,10,75,'00000000-0000-0000-0000-000000000002');
      insert into private.walmart_cancelaciones_pagadas values
        (1,10,100,'00000000-0000-0000-0000-000000000002'),
        (2,11,200,'00000000-0000-0000-0000-000000000002');
    `);
    await db.exec(retentionProviderDraft);
    await db.exec(bolsaDraft);
    const balance=async()=>(await db.query("select private.walmart_saldo_retenido_sin_liberar(10) as value")).rows[0].value;
    const blockers=async()=>(await db.query("select private.walmart_bloqueos_retencion(10) as value")).rows[0].value;
    assert.deepEqual(await blockers(),{pnr_abiertos:false,pnr_saldo_pendiente:false,
      no_show_requiere_revision:false,ajustes_negativos_pendientes:false,cobertura_completa:false});
    await db.exec(`
      insert into public.pnr_reclamos values ('00000000-0000-0000-0000-000000000020',
        '00000000-0000-0000-0000-000000000002','Walmart','revision');
      insert into public.pnr_descuentos values ('00000000-0000-0000-0000-000000000020',100);
      insert into public.no_show_casos values ('00000000-0000-0000-0000-000000000021',10,
        '00000000-0000-0000-0000-000000000002',1,'WALMART','walmart_60_saldo','reportado',now()+interval '1 hour',null,null);
      insert into public.pagos values (10,'00000000-0000-0000-0000-000000000002','pendiente','ajuste',-50);
    `);
    assert.deepEqual(await blockers(),{pnr_abiertos:true,pnr_saldo_pendiente:true,
      no_show_requiere_revision:true,ajustes_negativos_pendientes:true,cobertura_completa:false});
    await db.exec(`
      update public.pnr_reclamos set estado='cerrada_con_cargo';
      update public.pnr_descuentos set saldo_pendiente=0;
      insert into private.walmart_no_show_reportes values ('00000000-0000-0000-0000-000000000021',10);
      insert into private.walmart_no_show_saldos values ('00000000-0000-0000-0000-000000000021',10,
        '00000000-0000-0000-0000-000000000002',0);
      update public.pagos set estatus='pagado';
    `);
    assert.equal((await blockers()).no_show_requiere_revision,true);
    await db.exec("update public.no_show_casos set estado='apelacion_rechazada'");
    assert.deepEqual(await blockers(),{pnr_abiertos:false,pnr_saldo_pendiente:false,
      no_show_requiere_revision:false,ajustes_negativos_pendientes:false,cobertura_completa:false});
    await db.exec("update public.no_show_casos set proveedor_id=null");
    assert.equal((await blockers()).no_show_requiere_revision,true);
    await db.exec("update public.no_show_casos set proveedor_id=10,estado='reportado',vence_apelacion_en=now()-interval '1 second'");
    assert.equal((await blockers()).no_show_requiere_revision,false);
    await db.exec("update public.no_show_casos set metodo_calculo='manual'");
    assert.equal((await blockers()).no_show_requiere_revision,true);
    await db.exec("update public.no_show_casos set metodo_calculo='walmart_60_saldo'");
    await db.exec("update public.no_show_casos set estado='apelacion_aceptada'");
    assert.equal((await blockers()).no_show_requiere_revision,true);
    await db.exec("delete from private.walmart_no_show_saldos");
    assert.equal((await blockers()).no_show_requiere_revision,false);
    await db.exec("update public.pnr_descuentos set saldo_pendiente=5");
    assert.equal((await blockers()).pnr_saldo_pendiente,true);
    await db.exec("update public.pnr_reclamos set cliente='OTRO CLIENTE',estado='revision'");
    assert.equal((await blockers()).pnr_abiertos,true);
    await db.exec("update public.pnr_reclamos set estado='cerrada_con_cargo'");
    await db.exec("update public.pnr_descuentos set saldo_pendiente=0; update public.pagos set proveedor_id=11,estatus='pendiente'");
    assert.equal((await blockers()).ajustes_negativos_pendientes,false);
    await db.exec("update public.pagos set proveedor_id=null");
    assert.equal((await blockers()).ajustes_negativos_pendientes,true);
    await db.exec("update public.pagos set proveedor_id=10,estatus='pagado'");
    assert.deepEqual(await balance(),{proveedor_id:10,saldo_rutas:675,rutas:3,
      saldo_cancelaciones:100,cancelaciones:1,saldo_total:775,liberacion_validada:false});
    await assert.rejects(db.query("select private.walmart_saldo_retenido_sin_liberar($1)",[999]),/proveedor valido/);
    await db.exec("update private.walmart_liquidaciones set saldo_retenido='NaN' where ruta_id=1");
    await assert.rejects(balance(),/saldos retenidos invalidos/);
    await db.exec("update private.walmart_liquidaciones set saldo_retenido=250 where ruta_id=1");
    const insertPayment=amount=>db.query(`insert into private.walmart_liberaciones_proveedor(
      id,proveedor_id,monto,creado_por,ultima_ruta_en,confirmacion_sincronizacion,revision
    ) values ($1,10,$2,$3,now()-interval '31 days','Rutas revisadas','{}')`,[payment,amount,actor]);
    await assert.rejects(insertPayment("NaN"),/check constraint/);
    await assert.rejects(db.query(`insert into private.walmart_liberaciones_proveedor(
      id,proveedor_id,monto,creado_por,ultima_ruta_en,confirmacion_sincronizacion,revision
    ) values ($1,10,700,$2,now()-interval '29 days','Rutas revisadas','{}')`,[payment,actor]),/check constraint/);
    await assert.rejects(db.query(`insert into private.walmart_liberaciones_proveedor(
      id,proveedor_id,monto,creado_por,ultima_ruta_en,confirmacion_sincronizacion,revision
    ) values ($1,10,700,$2,now()-interval '31 days',' ','{}')`,[payment,actor]),/check constraint/);
    await db.exec("begin");
    await insertPayment(900);
    await db.query("insert into private.walmart_liberaciones_rutas values (3,$1,900)",[payment]);
    await assert.rejects(db.exec("commit"),/saldos originales del proveedor/);
    await db.exec("rollback");
    await db.exec("begin");
    await insertPayment(351);
    await db.query("insert into private.walmart_liberaciones_rutas values (2,$1,350)",[payment]);
    await assert.rejects(db.exec("commit"),/no coincide con sus saldos originales/);
    await db.exec("rollback");
    await db.exec("begin");
    await insertPayment(700);
    await db.query("insert into private.walmart_liberaciones_rutas values (1,$1,250)",[payment]);
    await db.query("insert into private.walmart_liberaciones_rutas values (2,$1,350)",[payment]);
    await db.query("insert into private.walmart_liberaciones_cancelaciones values (1,$1,100)",[payment]);
    await db.exec("commit");
    assert.deepEqual(await balance(),{proveedor_id:10,saldo_rutas:75,rutas:1,
      saldo_cancelaciones:0,cancelaciones:0,saldo_total:75,liberacion_validada:false});
    await db.exec("update private.walmart_liquidaciones set saldo_retenido=251 where ruta_id=1");
    await assert.rejects(balance(),/requiere revision contable/);
    await db.exec("update private.walmart_liquidaciones set saldo_retenido=250 where ruta_id=1");
    assert.equal((await db.query("select exists(select 1 from pg_attribute where attrelid='private.walmart_liberaciones_proveedor'::regclass and attname='driver_id' and not attisdropped) as has_driver")).rows[0].has_driver,false);
    await assert.rejects(db.query("insert into private.walmart_liberaciones_rutas values (2,$1,350)",[payment]),/duplicate key/);
    await assert.rejects(db.query("update private.walmart_liberaciones_proveedor set monto=1 where id=$1",[payment]),/correccion contable/);
    await assert.rejects(db.query("update private.walmart_liberaciones_proveedor set confirmacion_sincronizacion='Otro texto' where id=$1",[payment]),/correccion contable/);
    await assert.rejects(db.query("delete from private.walmart_liberaciones_cancelaciones where cancelacion_id=1"),/correccion contable/);
    await db.query("update private.walmart_liberaciones_proveedor set estatus='pagado',pagado_por=$1,pagado_en=now() where id=$2",[actor,payment]);
    await assert.rejects(db.query("update private.walmart_liberaciones_proveedor set estatus='pendiente',pagado_por=null,pagado_en=null where id=$1",[payment]),/correccion contable/);
    await db.exec("grant usage on schema private to authenticated; set role authenticated");
    await assert.rejects(db.query("select private.walmart_saldo_retenido_sin_liberar(10)"),/permission denied/);
    await assert.rejects(db.query("select * from private.walmart_liberaciones_proveedor"),/permission denied/);
    await assert.rejects(db.query("select * from public.walmart_mis_liberaciones('2020-01-01')"),/sesion y fecha validas/);
    await db.query("select set_config('test.user_id',$1,false)",[actor]);
    const own=(await db.query("select * from public.walmart_mis_liberaciones('2020-01-01')")).rows;
    assert.equal(own.length,1);
    assert.equal(own[0].id,payment);
    assert.equal(own[0].concepto,"liberacion_retencion_walmart");
    assert.equal(Number(own[0].monto),700);
    assert.equal(own[0].estatus,"pagado");
    assert.equal((await db.query("select * from public.walmart_mis_liberaciones('9999-01-01')")).rows.length,0);
    await db.query("select set_config('test.user_id',$1,false)",["00000000-0000-0000-0000-000000000002"]);
    await assert.rejects(db.query("select * from public.walmart_mis_liberaciones('2020-01-01')"),/Sin permiso/);
    await db.exec("reset role; update public.drivers set estatus='inactivo' where id='00000000-0000-0000-0000-000000000001'; set role authenticated");
    await db.query("select set_config('test.user_id',$1,false)",[actor]);
    await assert.rejects(db.query("select * from public.walmart_mis_liberaciones('2020-01-01')"),/Sin permiso/);
    await db.exec("reset role; update public.drivers set estatus='activo' where id='00000000-0000-0000-0000-000000000001'; set role authenticated");
    await assert.rejects(db.query("select public.walmart_consultar_retencion_proveedor(10)"),/Solo el supervisor/);
    await db.query("select set_config('test.user_id',$1,false)",[actor]);
    await db.exec("select set_config('test.admin','true',false),set_config('test.valida','true',false),set_config('test.rol','ih',false),set_config('test.cedis','1',false)");
    await db.exec(`reset role;
      insert into public.cancelaciones(id,driver_id,cedis_id,foto_path)
        values (3,'00000000-0000-0000-0000-000000000002',1,'foto');
      insert into private.walmart_cancelaciones_pagadas
        values (3,10,25,'00000000-0000-0000-0000-000000000002'); set role authenticated`);
    const preview=(await db.query("select public.walmart_consultar_retencion_proveedor(10) as value")).rows[0].value;
    assert.equal(preview.saldo.saldo_total,100);
    assert.equal(preview.plazo.plazo_cumplido,true);
    assert.equal(preview.plazo.rutas_sin_proveedor,undefined);
    assert.equal(preview.reclamaciones_verificadas,false);
    assert.equal(preview.liberacion_validada,false);
    await db.exec(`reset role;
      select set_config('test.rol','coordinador',false);
      create or replace function public.operativo_asignado_a(bigint,bigint,text) returns boolean language sql stable as $$
        select $2::text=current_setting('test.cedis',true) and $3 in ('ih','coordinador')
      $$;
      set role authenticated`);
    await assert.rejects(db.query(
      "select public.walmart_decidir_bolsa($1,10,$2::jsonb,0,null,true)",
      ["00000000-0000-0000-0000-000000000099",JSON.stringify(preview)]
    ),/descuentos sin cobertura verificada/);
    await db.exec("reset role; select set_config('test.rol','ih',false); set role authenticated");
    const newPayment="00000000-0000-0000-0000-000000000011";
    const register=(revision,confirmation="Rutas revisadas",id=newPayment)=>db.query(
      "select private.walmart_registrar_liberacion($1,10,$2::jsonb,$3) as value",
      [id,JSON.stringify(revision),confirmation]);
    await assert.rejects(register(preview),/permission denied/);
    await db.exec("reset role");
    await db.exec("select set_config('test.rol','driver',false)");
    await assert.rejects(register(preview),/Solo el supervisor/);
    await db.exec("select set_config('test.rol','ih',false)");
    await assert.rejects(register(preview),/no cubre todas las fuentes/);
    assert.equal(Number((await db.query("select count(*) as n from private.walmart_liberaciones_proveedor")).rows[0].n),1);
    const originalBlockers=(await db.query("select pg_get_functiondef('private.walmart_bloqueos_retencion(bigint)'::regprocedure) as definition")).rows[0].definition;
    await db.exec(`create or replace function private.walmart_bloqueos_retencion(p_proveedor_id bigint) returns jsonb language sql stable as $$
      select jsonb_build_object('cobertura_completa',true,
        'pnr_abiertos',coalesce(current_setting('test.blocked',true),'false')='true',
        'pnr_saldo_pendiente',false,'no_show_requiere_revision',false,'ajustes_negativos_pendientes',false)
    $$`);
    const originalPreview=(await db.query("select pg_get_functiondef('public.walmart_consultar_retencion_proveedor(bigint)'::regprocedure) as definition")).rows[0].definition;
    const incompletePreview=(await db.query("select public.walmart_consultar_retencion_proveedor(10) as value")).rows[0].value;
    await assert.rejects(register(incompletePreview),/reclamaciones o descuentos pendientes/);
    assert.ok(originalPreview.includes("'reclamaciones_verificadas',false"));
    await db.exec(originalPreview.replace("'reclamaciones_verificadas',false","'reclamaciones_verificadas',true"));
    await db.exec("select set_config('test.blocked','true',false)");
    const blockedPreview=(await db.query("select public.walmart_consultar_retencion_proveedor(10) as value")).rows[0].value;
    await assert.rejects(register(blockedPreview),/reclamaciones o descuentos pendientes/);
    await db.exec("select set_config('test.blocked','false',false),set_config('test.plazo','false',false)");
    const earlyPreview=(await db.query("select public.walmart_consultar_retencion_proveedor(10) as value")).rows[0].value;
    await assert.rejects(register(earlyPreview),/plazo de retencion/);
    await db.exec("select set_config('test.plazo','true',false)");
    const completePreview=(await db.query("select public.walmart_consultar_retencion_proveedor(10) as value")).rows[0].value;
    await assert.rejects(register({...completePreview,saldo:{...completePreview.saldo,saldo_total:1}}),/cambio/);
    await assert.rejects(register(completePreview," "),/documenta/);
    await db.exec("begin");
    const registered=(await register(completePreview)).rows[0].value;
    assert.deepEqual(registered,{id:newPayment,monto:100,estatus:"pendiente"});
    await db.exec("rollback");
    assert.equal(Number((await db.query("select count(*) as n from private.walmart_liberaciones_proveedor")).rows[0].n),1);
    assert.deepEqual((await register(completePreview)).rows[0].value,registered);
    assert.deepEqual((await register(completePreview)).rows[0].value,registered);
    assert.equal(Number((await db.query("select monto from private.walmart_liberaciones_rutas where ruta_id=5")).rows[0].monto),75);
    assert.equal(Number((await db.query("select monto from private.walmart_liberaciones_cancelaciones where cancelacion_id=3")).rows[0].monto),25);
    await assert.rejects(register(completePreview,"Otro texto"),/otra liberacion/);
    await assert.rejects(register(completePreview,"Rutas revisadas","00000000-0000-0000-0000-000000000012"),/cambio/);
    await assert.rejects(db.query("update private.walmart_liberaciones_proveedor set revision='{}' where id=$1",[newPayment]),/correccion contable/);
    await db.exec(originalBlockers);
    await db.exec(originalPreview);
    await db.exec("reset role");
    await db.query(`insert into private.walmart_bolsa_decisiones(liberacion_id,descuento,motivo,lunes_pago)
      values ($1,50,'Descuento de prueba','2026-11-09')`,[payment]);
    await db.exec("set role authenticated");
    await db.query("select set_config('test.user_id',$1,false)",[actor]);
    const ownBag=(await db.query("select public.walmart_mi_bolsa() as value")).rows[0].value;
    assert.equal(ownBag.proveedor_id,10);
    assert.equal(ownBag.saldo.saldo_total,0);
    assert.equal(ownBag.plazo.plazo_cumplido,true);
    assert.equal(ownBag.plazo.rutas_sin_proveedor,undefined);
    assert.equal(ownBag.liberacion_validada,false);
    const movements=(await db.query("select * from public.walmart_mis_movimientos_bolsa('2020-01-01')")).rows;
    assert.equal(movements.length,1);
    assert.equal(movements[0].id,payment);
    assert.equal(movements[0].concepto,"liberacion_retencion_walmart");
    assert.equal(Number(movements[0].monto),650);
    assert.equal(movements[0].fecha.toISOString().slice(0,10),"2026-11-09");
    assert.equal(movements[0].estatus,"pagado");
    await db.query("select set_config('test.user_id',$1,false)",["00000000-0000-0000-0000-000000000002"]);
    await assert.rejects(db.query("select public.walmart_mi_bolsa()"),/Solo el flotillero titular activo/);
    await assert.rejects(db.query("select * from public.walmart_mis_movimientos_bolsa('2020-01-01')"),/sesion activa y fecha validas/);
    await db.query("select set_config('test.user_id',$1,false)",[actor]);
    await db.exec("reset role; update public.drivers set estatus='inactivo' where id='00000000-0000-0000-0000-000000000001'; set role authenticated");
    await assert.rejects(db.query("select public.walmart_mi_bolsa()"),/Solo el flotillero titular activo/);
    await db.exec("reset role; update public.drivers set estatus='activo' where id='00000000-0000-0000-0000-000000000001'; set role authenticated");
    assert.equal((await db.query("select pg_get_functiondef('public.walmart_decidir_bolsa(uuid,bigint,jsonb,numeric,text,boolean)'::regprocedure) as definition")).rows[0].definition.includes("cobertura_completa"),true);
    await db.query("select set_config('test.user_id',$1,false)",["00000000-0000-0000-0000-000000000002"]);
    await db.exec("reset role; insert into public.no_show_casos(id,proveedor_id,cedis_id,cuenta) values ('00000000-0000-0000-0000-000000000022',10,2,'WALMART'); set role authenticated");
    await assert.rejects(db.query("select public.walmart_consultar_retencion_proveedor(10)"),/todos los CEDIS/);
  }finally{await db.close()}
});

test("Walmart retention waits 30 days after the last route and cancellation does not restart the clock",async()=>{
  const db=await database();
  try{
    await db.exec(`
      alter table public.rutas add column checkin_at timestamptz,add column checkout_at timestamptz;
      alter table public.rutas add column driver_id uuid;
      create table private.walmart_proveedores_confirmados(ruta_id bigint primary key,proveedor_id bigint);
      create table public.liquidaciones(ruta_id bigint,proveedor_id bigint,cuenta text);
      create table private.walmart_cancelaciones_pagadas(proveedor_id bigint,registrado_en timestamptz);
      insert into public.rutas(id,cedis_id,estado,fallidos,checkin_at,checkout_at)
        values (1,1,'cerrada',0,'2026-10-01 12:00+00','2026-10-01 16:00+00');
      insert into private.walmart_proveedores_confirmados values (1,10);
      insert into private.walmart_cancelaciones_pagadas values (10,'2026-10-25 12:00+00');
    `);
    await db.exec(retentionDeadlineDraft);
    const deadline=async(provider,date)=>(await db.query("select private.walmart_consultar_plazo($1,$2) as value",[provider,date])).rows[0].value;
    const almost=await deadline(10,"2026-10-31 15:59:59+00");
    assert.equal(almost.plazo_cumplido,false);
    assert.equal(almost.liberacion_validada,false);
    const exactly=await deadline(10,"2026-10-31 16:00:00+00");
    assert.equal(exactly.plazo_cumplido,true);
    assert.equal(new Date(exactly.ultima_ruta).toISOString(),"2026-10-01T16:00:00.000Z");
    assert.equal((await deadline(11,"2026-10-31 12:00:00+00")).estado,"sin_ruta_confirmada");
    await db.exec("insert into public.rutas(id,cedis_id,estado,fallidos,checkin_at,checkout_at) values (2,1,'cerrada',0,'2026-10-15 10:00+00','2026-10-15 12:00+00')");
    const unknown=await deadline(10,"2026-11-15 12:00:00+00");
    assert.equal(unknown.estado,"requiere_revision");
    assert.equal(unknown.rutas_sin_proveedor,1);
    assert.equal(unknown.plazo_cumplido,false);
    await db.exec("insert into private.walmart_proveedores_confirmados values (2,11)");
    assert.equal((await deadline(10,"2026-11-15 12:00:00+00")).plazo_cumplido,true);
    await db.exec("insert into public.liquidaciones values (2,10,'WALMART')");
    await assert.rejects(deadline(10,"2026-11-15 12:00:00+00"),/proveedores historicos distintos/);
    await db.exec(`
      delete from public.liquidaciones;
      update private.walmart_proveedores_confirmados set proveedor_id=10 where ruta_id=2;
      update public.rutas set driver_id=case id when 1 then '00000000-0000-0000-0000-000000000001'::uuid
        else '00000000-0000-0000-0000-000000000002'::uuid end;
      insert into public.rutas(id,cedis_id,estado,fallidos,checkin_at,checkout_at,driver_id)
        values (4,1,'cerrada',0,'2026-10-20 10:00+00','2026-10-20 12:00+00','00000000-0000-0000-0000-000000000001');
      insert into public.liquidaciones values (4,10,'WALMART');
    `);
    const last=await deadline(10,"2026-11-19 11:59:59+00");
    assert.equal(new Date(last.ultima_ruta).toISOString(),"2026-10-20T12:00:00.000Z");
    assert.equal(last.plazo_cumplido,false);
    assert.equal((await deadline(10,"2026-11-19 12:00:00+00")).plazo_cumplido,true);
    await db.exec("insert into public.rutas(id,cedis_id,estado,fallidos,checkin_at,checkout_at) values (5,1,'en_ruta',0,'2026-11-18 12:00+00',null); insert into private.walmart_proveedores_confirmados values (5,10)");
    assert.equal((await deadline(10,"2026-11-19 12:00:00+00")).estado,"requiere_revision");
    assert.equal((await deadline(10,"2026-11-19 12:00:00+00")).plazo_cumplido,false);
    await db.exec("insert into public.rutas(id,cedis_id,estado,fallidos,checkin_at) values (3,1,'cerrada',0,null)");
    assert.equal((await deadline(10,"2026-11-15 12:00:00+00")).estado,"requiere_revision");
    await db.exec("insert into private.walmart_proveedores_confirmados values (3,10)");
    await assert.rejects(deadline(10,"2026-11-15 12:00:00+00"),/sin fecha de inicio/);
    await db.exec("set role authenticated");
    await assert.rejects(deadline(10,"2026-11-15 12:00:00+00"),/permission denied/);
  }finally{await db.close()}
});

test("Walmart liquidation writes weekly payment, retained balance and existing PNR atomically",async()=>{
  const db=await database();
  const driver="00000000-0000-0000-0000-000000000001";
  const claim="00000000-0000-0000-0000-000000000002";
  try{
    await db.exec(migration);
    await db.exec(retentionDraft);
    await db.exec(`
      alter table public.proveedores add column tipo_registro text,add column titular_id uuid,add column tipo text;
      alter table public.drivers add column nombre text,add column rol text,add column proveedor_id bigint,add column estatus text;
      update public.drivers set nombre='Driver',rol='driver',proveedor_id=10,estatus='activo';
      update public.proveedores set tipo_registro='SIN FACTURA',titular_id='${driver}',tipo='flotillero' where id=10;
      alter table public.rutas add column driver_id uuid,add column tipo_unidad text,
        add column checkin_at timestamptz,add column entregados integer,add column paquetes_asignados integer;
      alter table public.cancelaciones add column ruta_id bigint,add column estatus text,add column capturado_at timestamptz;
      create table public.parametros_pago(clave text primary key,valor numeric);
      insert into public.parametros_pago values
        ('retencion_sin_factura',0.05),('iva',0.16),('comision_sin_factura',0.02);
      create table public.tarifas(
        id bigint generated always as identity primary key,cuenta text,cliente text,ciudad text,ubicacion text,
        tipo_unidad text,esquema text,zona text,variable text,conc text,tarifa_cliente numeric,pago_base numeric,
        activo boolean,vigencia_desde date,vigencia_hasta date,fuente text,
        constraint tarifas_cuenta_check check (cuenta in ('COPPEL','MELI')),
        unique(cuenta,conc,vigencia_desde)
      );
      create table public.liquidaciones(
        id bigint generated always as identity primary key,ruta_id bigint unique,driver_id uuid,
        proveedor_id bigint,tarifa_id bigint,cuenta text,conc text,esquema text,tipo_unidad text,
        entregados integer,asignados integer,efectividad numeric,pago_base numeric,regla_pago text,
        dcto_pago numeric,bono_pago numeric,ajuste_pago numeric,costo_total numeric,registro_fiscal text,
        retencion numeric,neto numeric,comision numeric,costo_pl numeric,iva numeric,total_costo_imp numeric,
        pago_driver numeric,cobro_base numeric,dcto_cobro numeric,ajuste_cobro numeric,venta_total numeric,
        utilidad numeric,margen numeric,excepcion_supervisor boolean,validada_por uuid
      );
      create table public.pagos(
        id bigint generated always as identity primary key,driver_id uuid,proveedor_id bigint,ruta_id bigint,
        concepto text,monto numeric,fecha date,estatus text
      );
      create table public.validaciones_pendientes(ruta_id bigint,estatus text);
      create table public.pnr_descuentos(
        reclamo_id uuid primary key,driver_id uuid,saldo_pendiente numeric,monto_aplicado numeric,
        creado_en timestamptz,aplicado_en timestamptz
      );
      create table public.pnr_descuentos_aplicaciones(reclamo_id uuid,driver_id uuid,ruta_id text,monto numeric);
      create table public.pnr_reclamos(id uuid,driver_id uuid,cliente text,estado text);
      create table public.pnr_reclamo_eventos(reclamo_id uuid,tipo text,mensaje text);
      create table public.no_show_eventos(caso_id uuid,tipo text,mensaje text,actor_id uuid);
      create function public.no_show_es_supervisor() returns boolean language sql stable as $$
        select current_setting('test.rol',true)='ih'
      $$;
      create function public.no_show_es_coordinador() returns boolean language sql stable as $$
        select current_setting('test.rol',true)='coordinador'
      $$;
      create function public.no_show_texto_inapropiado(text) returns boolean language sql immutable as $$ select false $$;
      create function private.es_valida() returns boolean language sql stable as $$
        select coalesce(current_setting('test.valida',true),'false')='true'
      $$;
    `);
    await db.query(`insert into public.rutas(id,cedis_id,estado,fallidos,driver_id,tipo_unidad,checkin_at,
      entregados,paquetes_asignados,walmart_visitas_asignadas,walmart_visitas_realizadas,walmart_requiere_revision)
      values (1,1,'cerrada',0,$1,'3.5T','2026-11-09 12:00+00',95,100,100,95,false),
        (2,1,'cerrada',0,$1,'3.5T','2026-11-10 12:00+00',95,100,100,95,false),
        (3,1,'cerrada',0,$1,'3.5T','2026-11-11 12:00+00',95,100,100,95,false),
        (4,1,'cerrada',0,$1,'3.5T','2026-11-12 12:00+00',95,100,null,null,true)`,[driver]);
    await db.query("insert into public.pnr_descuentos values ($1,$2,100,0,now(),null)",[claim,driver]);
    const pnrStart=pnr.indexOf("create or replace function public.aplicar_descuentos_pnr_a_pago()");
    const pnrEnd=pnr.indexOf("\nrevoke all on function",pnrStart);
    await db.exec(pnr.slice(pnrStart,pnrEnd));
    await db.exec(retentionDecisionDraft);
    await prepareNoShowDraft(db);
    await assert.rejects(db.exec(permissionRehearsal),/ENSAYO OK: permisos declarados y rechazo sin usuario verificados; cambios revertidos/);
    assert.equal((await db.query("select to_regclass('private.walmart_no_show_reportes') as table_name")).rows[0].table_name,null);
    assert.equal((await db.query("select to_regprocedure('public.walmart_crear_no_show(uuid,uuid,bigint,date,text,bigint,smallint,text,jsonb)') as fn")).rows[0].fn,null);
    assert.equal(Number((await db.query("select count(*) as n from public.tarifas")).rows[0].n),0);
    await db.exec(noShowFlowDraft);
    await db.exec("alter table public.no_show_casos alter column estado set default 'reportado',alter column vence_apelacion_en set default now()+interval '6 hours'");
    const appealStart=noShowWorkflow.indexOf("create or replace function public.apelar_no_show(");
    const appealEnd=noShowWorkflow.indexOf("\ncreate or replace function public.resolver_apelacion_no_show(",appealStart);
    await db.exec(noShowWorkflow.slice(appealStart,appealEnd));
    await db.exec(liquidationDraft);
    await db.exec(cancellationPaymentsDraft);
    await db.exec(mappingDraft);
    await db.exec(mappingDraft);
    await db.exec(validationDraft);
    assert.equal(Number((await db.query("select count(*) as n from private.walmart_tarifas_mapeo")).rows[0].n),4);
    await db.exec("update public.tarifas set tarifa_cliente=1 where ubicacion='DS Querétaro'");
    await assert.rejects(db.exec(mappingDraft),/difiere/);
    await db.exec("rollback");
    assert.equal(Number((await db.query("select tarifa_cliente as valor from public.tarifas where ubicacion='DS Querétaro'")).rows[0].valor),1);
    await db.exec("update public.tarifas set tarifa_cliente=5565.50 where ubicacion='DS Querétaro'");
    await db.query("select set_config('test.user_id',$1,false)",[driver]);
    await db.exec("select set_config('test.admin','true',false),set_config('test.valida','true',false),set_config('test.rol','ih',false),set_config('test.cedis','1',false)");
    for(const percent of [0,10,15,25]){
      const selected=(await db.query("select public.walmart_previsualizar_ruta_porcentaje(1,10,$1::smallint,true,false) as value",[percent])).rows[0].value;
      assert.equal(selected.porcentaje_retencion,percent);
      assert.equal(selected.saldo_retenido,Math.round(selected.total*percent)/100);
      assert.equal(Math.round((selected.pago_semanal+selected.saldo_retenido)*100),Math.round(selected.total*100));
    }
    await assert.rejects(db.query("select public.walmart_previsualizar_ruta_porcentaje(1,10,12::smallint,true,false)"),/Selecciona una retencion/);
    const preview=(await db.query("select public.walmart_previsualizar_ruta_porcentaje(1,10,25::smallint,true,false) as value")).rows[0].value;
    const register=async(snapshot=preview)=>(await db.query(
      "select public.walmart_validar_ruta(1,true,false,$1::jsonb) as value",[JSON.stringify(snapshot)]
    )).rows[0].value;
    await assert.rejects(register({...preview,total:1}),/cambio/);
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),0);
    await db.exec("alter table public.pagos disable trigger aplicar_descuentos_pnr_a_pago");
    await assert.rejects(register(),/descuento automatico PNR no esta activo/);
    await db.exec("alter table public.pagos enable trigger aplicar_descuentos_pnr_a_pago");
    await assert.rejects(db.query("insert into public.no_show_casos(cuenta,estado,proveedor_id,driver_id) values ('WALMART','reportado',10,$1)",[driver]),/captura del tarifario Walmart/);
    await db.query("insert into public.no_show_casos(cuenta,estado,proveedor_id,driver_id) values ('MELI','reportado',10,$1)",[driver]);
    await db.exec("update public.no_show_casos set cuenta='WALMART'");
    await db.exec("begin");
    const withUnreviewedNoShow=await register();
    assert.equal(withUnreviewedNoShow.no_show_aplicado,0);
    assert.equal(withUnreviewedNoShow.pago_semanal,preview.pago_semanal-100);
    await db.exec("rollback");
    await db.exec("delete from public.no_show_casos where metodo_calculo is null");
    await db.exec("begin");
    await register();
    await db.exec("rollback");
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),0);
    assert.equal(Number((await db.query("select saldo_pendiente as saldo from public.pnr_descuentos")).rows[0].saldo),100);
    const result=await register();
    assert.equal(result.pago_semanal,preview.pago_semanal-100);
    assert.equal(result.pago_estatus,"pendiente");
    assert.equal(result.saldo_retenido,preview.saldo_retenido);
    assert.deepEqual(await register(),result);
    const payment=(await db.query("select driver_id,proveedor_id,monto::numeric,estatus from public.pagos")).rows[0];
    assert.equal(payment.driver_id,driver);
    assert.equal(Number(payment.proveedor_id),10);
    assert.equal(Number(payment.monto),preview.pago_semanal-100);
    assert.equal(payment.estatus,"pendiente");
    const discount=(await db.query("select saldo_pendiente::numeric,monto_aplicado::numeric from public.pnr_descuentos")).rows[0];
    assert.equal(Number(discount.saldo_pendiente),0);
    assert.equal(Number(discount.monto_aplicado),100);
    assert.equal(Number((await db.query("select count(*) as n from public.pnr_descuentos_aplicaciones")).rows[0].n),1);
    assert.equal(Number((await db.query("select count(*) as n from private.walmart_liquidaciones")).rows[0].n),1);
    await assert.rejects(db.exec("update public.rutas set driver_id=null where id=1"),/requiere ajuste o anulacion auditada/);
    await assert.rejects(db.exec("update public.liquidaciones set pago_driver=1 where ruta_id=1"),/requiere ajuste o anulacion auditada/);
    await assert.rejects(db.exec("delete from public.pagos where ruta_id=1"),/requiere anulacion auditada/);
    await assert.rejects(db.exec("update public.pagos set monto=1 where ruta_id=1"),/requiere ajuste o anulacion auditada/);
    const secondClaim="00000000-0000-0000-0000-000000000004";
    await db.exec("update public.walmart_tarifas set vigencia_desde=least(vigencia_desde,(now() at time zone 'America/Mexico_City')::date) where cedis_id=1");
    const noShowCalc=(await db.query("select public.walmart_previsualizar_no_show(1,(now() at time zone 'America/Mexico_City')::date,'3.5T',10,1::smallint) as value")).rows[0].value;
    const noShowCase=(await db.query(`select public.walmart_crear_no_show('00000000-0000-0000-0000-000000000003',$1,1,
      (now() at time zone 'America/Mexico_City')::date,'3.5T',10,1::smallint,'No se presento',$2::jsonb) as value`,
      [driver,JSON.stringify(noShowCalc)])).rows[0].value;
    await db.query("select public.apelar_no_show($1,'Solicito revision')",[noShowCase]);
    await db.exec("select set_config('test.rol','coordinador',false)");
    await db.query("select public.walmart_resolver_apelacion_no_show($1,'rechazar','Sin evidencia')",[noShowCase]);
    await db.exec("select set_config('test.rol','ih',false)");
    await db.query("insert into public.pnr_descuentos values ($1,$2,3000,0,now(),null)",[secondClaim,driver]);
    const withoutRetention=(await db.query("select public.walmart_previsualizar_ruta(2,10,false,true,false) as value")).rows[0].value;
    assert.equal(Number((await db.query(`select count(*) as n from pg_trigger
      where tgrelid='public.pagos'::regclass and tgname='zz_walmart_no_show_en_pago_ruta'
        and not tgisinternal`)).rows[0].n),0);
    await db.exec("begin");
    await db.query("select public.walmart_validar_ruta(2,true,false,$1::jsonb)",[JSON.stringify(withoutRetention)]);
    await db.exec("rollback");
    assert.equal(Number((await db.query("select saldo_pendiente from public.pnr_descuentos where reclamo_id=$1",[secondClaim])).rows[0].saldo_pendiente),3000);
    assert.equal(Number((await db.query("select saldo_pendiente from private.walmart_no_show_saldos where caso_id=$1",[noShowCase])).rows[0].saldo_pendiente),2700);
    const second=(await db.query("select public.walmart_validar_ruta(2,true,false,$1::jsonb) as value",[JSON.stringify(withoutRetention)])).rows[0].value;
    assert.equal(second.saldo_retenido,0);
    const afterPnr=withoutRetention.total-3000;
    assert.ok(afterPnr>0&&afterPnr<2700);
    assert.equal(second.pago_semanal,afterPnr);
    assert.equal(second.no_show_aplicado,0);
    assert.equal(Number((await db.query("select monto_aplicado from public.pnr_descuentos where reclamo_id=$1",[secondClaim])).rows[0].monto_aplicado),3000);
    assert.equal(Number((await db.query("select monto_aplicado from private.walmart_no_show_saldos where caso_id=$1",[noShowCase])).rows[0].monto_aplicado),0);
    await db.query("insert into storage.objects values ('cancelaciones',$1),('cancelaciones',$2)",[`${driver}/salida.jpg`,`${driver}/bitacora.jpg`]);
    await db.query(`insert into public.cancelaciones(id,driver_id,cedis_id,foto_path,foto_bitacora_path,ruta_id,estatus,capturado_at)
      values (3,$1,1,$2,$3,3,'aprobada','2026-11-11 12:00+00')`,[driver,`${driver}/salida.jpg`,`${driver}/bitacora.jpg`]);
    const cancellation=(await db.query("select public.walmart_previsualizar_cancelacion_porcentaje(3,10,'3.5T',10::smallint) as value")).rows[0].value;
    assert.equal(cancellation.porcentaje_retencion,10);
    assert.equal(cancellation.saldo_retenido,Math.round(cancellation.total*10)/100);
    const paidCancellation=(await db.query("select public.walmart_validar_cancelacion(3,10,'3.5T',true,$1::jsonb) as value",[JSON.stringify(cancellation)])).rows[0].value;
    assert.equal(paidCancellation.pago_semanal,cancellation.pago_semanal);
    assert.equal(paidCancellation.no_show_aplicado,0);
    assert.equal(Number((await db.query("select saldo_pendiente from private.walmart_no_show_saldos where caso_id=$1",[noShowCase])).rows[0].saldo_pendiente),2700);
    assert.deepEqual((await db.query("select public.walmart_validar_cancelacion(3,10,'3.5T',true,$1::jsonb) as value",[JSON.stringify(cancellation)])).rows[0].value,paidCancellation);
    const linkedRoute=(await db.query("select public.walmart_previsualizar_ruta(3,10,true,true,false) as value")).rows[0].value;
    await assert.rejects(db.query("select public.walmart_validar_ruta(3,true,false,$1::jsonb)",[JSON.stringify(linkedRoute)]),/ruta ya tiene una cancelacion pagada/);
    await assert.rejects(db.query("select public.walmart_previsualizar_ruta_porcentaje(4,10,15::smallint,true,false)"),/requieren revision/);
    const simple=(await db.query("select public.walmart_previsualizar_ruta_porcentaje(4,10,15::smallint,false,false) as value")).rows[0].value;
    assert.equal(simple.porcentaje_retencion,15);
    assert.equal(simple.saldo_retenido,Math.round(simple.total*15)/100);
    const simplePaid=(await db.query("select public.walmart_validar_ruta(4,false,false,$1::jsonb) as value",[JSON.stringify(simple)])).rows[0].value;
    assert.equal(simplePaid.pago_semanal,simple.pago_semanal-simplePaid.no_show_aplicado);
    await db.query("update public.pagos set estatus='pagado' where id=$1",[result.pago_id]);
    assert.equal((await register()).pago_estatus,"pagado");
    await assert.rejects(db.query("update public.pagos set estatus='pendiente' where id=$1",[result.pago_id]),/requiere ajuste o anulacion auditada/);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select private.walmart_registrar_liquidacion(1,true,false,$1::jsonb)",[JSON.stringify(preview)]),/permission denied/);
    assert.equal((await register()).pago_estatus,"pagado");
    await db.exec("select set_config('test.cedis','2',false)");
    await assert.rejects(register(),/asignada al supervisor/);
    await db.exec("select set_config('test.cedis','1',false),set_config('test.rol','coordinador',false)");
    await assert.rejects(register(),/Solo el supervisor asignado/);
  }finally{await db.close()}
});

test("approved Walmart cancellation pays 40 percent with retained balance and PNR without a fake route",async()=>{
  const db=await database();
  const driver="00000000-0000-0000-0000-000000000001";
  const claim="00000000-0000-0000-0000-000000000002";
  try{
    await db.exec(migration);
    await db.exec(`
      alter table public.proveedores add column tipo_registro text;
      update public.proveedores set tipo_registro='SIN FACTURA' where id=10;
      alter table public.rutas add column driver_id uuid,add column tipo_unidad text;
      alter table public.cancelaciones add column estatus text,add column capturado_at timestamptz,add column ruta_id bigint;
      create table public.parametros_pago(clave text primary key,valor numeric);
      insert into public.parametros_pago values ('retencion_sin_factura',0.05),('iva',0.16),('comision_sin_factura',0.02);
      create table public.liquidaciones(ruta_id bigint,dcto_pago numeric,pago_driver numeric);
      create table public.pagos(id bigint generated always as identity primary key,
        driver_id uuid,proveedor_id bigint,ruta_id bigint,concepto text,monto numeric,fecha date,estatus text);
      create table public.pnr_descuentos(reclamo_id uuid primary key,driver_id uuid,saldo_pendiente numeric,
        monto_aplicado numeric,creado_en timestamptz,aplicado_en timestamptz);
      create table public.pnr_descuentos_aplicaciones(reclamo_id uuid,driver_id uuid,ruta_id text,monto numeric);
      create table public.pnr_reclamo_eventos(reclamo_id uuid,tipo text,mensaje text);
      create function private.es_valida() returns boolean language sql stable as $$
        select coalesce(current_setting('test.valida',true),'false')='true'
      $$;
    `);
    await db.query("insert into storage.objects values ('cancelaciones',$1),('cancelaciones',$2)",[`${driver}/salida.jpg`,`${driver}/bitacora.jpg`]);
    await db.query("insert into public.rutas(id,cedis_id,estado,fallidos,driver_id,tipo_unidad) values (4,1,'cerrada',0,$1,'3.5T'),(5,1,'cerrada',0,$1,'3.5T')",[driver]);
    await db.exec("insert into public.liquidaciones(ruta_id) values (5)");
    await db.query(`insert into public.cancelaciones(id,driver_id,cedis_id,foto_path,foto_bitacora_path,estatus,capturado_at)
      values (1,$1,1,$2,$3,'aprobada','2026-11-09 12:00+00'),
             (2,$1,1,$2,null,'aprobada','2026-11-09 12:00+00'),
             (3,$1,1,$2,$3,'aprobada','2026-11-10 12:00+00')`,
      [driver,`${driver}/salida.jpg`,`${driver}/bitacora.jpg`]);
    await db.query(`insert into public.cancelaciones(id,driver_id,cedis_id,foto_path,foto_bitacora_path,estatus,capturado_at,ruta_id)
      values (4,$1,1,$2,$3,'aprobada','2026-11-11 12:00+00',4),
        (5,$1,1,$2,$3,'aprobada','2026-11-12 12:00+00',4),
        (6,$1,1,$2,$3,'aprobada','2026-11-13 12:00+00',5)`,
      [driver,`${driver}/salida.jpg`,`${driver}/bitacora.jpg`]);
    await db.query("insert into public.pnr_descuentos values ($1,$2,2000,0,now(),null)",[claim,driver]);
    const pnrStart=pnr.indexOf("create or replace function public.aplicar_descuentos_pnr_a_pago()");
    const pnrEnd=pnr.indexOf("\nrevoke all on function",pnrStart);
    await db.exec(pnr.slice(pnrStart,pnrEnd));
    await prepareNoShowDraft(db);
    await db.exec(noShowFlowDraft);
    await db.exec(cancellationPaymentsDraft);
    await db.query("select set_config('test.user_id',$1,false)",[driver]);
    await db.exec("select set_config('test.admin','true',false),set_config('test.valida','true',false),set_config('test.rol','ih',false),set_config('test.cedis','1',false); set role authenticated");
    const preview=async(id,hold=true)=>(await db.query(
      "select public.walmart_previsualizar_cancelacion($1,10,'3.5T',$2) as value",[id,hold]
    )).rows[0].value;
    await assert.rejects(preview(2),/fotos de salida y bitacora/);
    const calc=await preview(1);
    assert.equal(calc.pago_base,1800);
    assert.equal(calc.total,1710);
    assert.equal(calc.pago_semanal,1282.5);
    assert.equal(calc.saldo_retenido,427.5);
    const validate=async(snapshot=calc)=>(await db.query(
      "select public.walmart_validar_cancelacion(1,10,'3.5T',true,$1::jsonb) as value",[JSON.stringify(snapshot)]
    )).rows[0].value;
    await assert.rejects(validate({...calc,total:1}),/cambio/);
    await db.exec("begin");
    assert.equal((await validate()).pnr_aplicado,1282.5);
    await db.exec("rollback");
    await db.exec("reset role");
    assert.equal(Number((await db.query("select saldo_pendiente as saldo from public.pnr_descuentos")).rows[0].saldo),2000);
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),0);
    await db.exec("set role authenticated");
    const result=await validate();
    assert.equal(result.pago_semanal,0);
    assert.equal(result.pnr_aplicado,1282.5);
    assert.equal(result.saldo_retenido,427.5);
    assert.deepEqual(await validate(),result);
    await db.exec("reset role");
    const pending=(await db.query("select saldo_pendiente,monto_aplicado from public.pnr_descuentos")).rows[0];
    assert.equal(Number(pending.saldo_pendiente),717.5);
    assert.equal(Number(pending.monto_aplicado),1282.5);
    assert.equal(Number((await db.query("select count(*) as n from private.walmart_cancelaciones_pnr")).rows[0].n),1);
    assert.equal(Number((await db.query("select count(*) as n from public.pnr_descuentos_aplicaciones")).rows[0].n),0);
    assert.equal((await db.query("select ruta_id from public.pagos")).rows[0].ruta_id,null);
    await db.exec("set role authenticated");
    const calcFull=(await db.query("select public.walmart_previsualizar_cancelacion(3,10,'3.5 TN',false) as value")).rows[0].value;
    assert.equal(calcFull.saldo_retenido,0);
    assert.equal(calcFull.pago_semanal,1710);
    const complete=(await db.query("select public.walmart_validar_cancelacion(3,10,'3.5 TN',false,$1::jsonb) as value",[JSON.stringify(calcFull)])).rows[0].value;
    assert.equal(complete.pnr_aplicado,717.5);
    assert.equal(complete.pago_semanal,992.5);
    assert.deepEqual((await db.query("select public.walmart_validar_cancelacion(3,10,'3.5 TN',false,$1::jsonb) as value",[JSON.stringify(calcFull)])).rows[0].value,complete);
    await assert.rejects(preview(6),/ya tiene liquidacion o pago/);
    const linked=await preview(4);
    await db.query("select public.walmart_validar_cancelacion(4,10,'3.5T',true,$1::jsonb)",[JSON.stringify(linked)]);
    await assert.rejects(preview(5),/ya tiene una cancelacion pagada/);
    await db.exec("reset role");
    await assert.rejects(db.exec("update public.cancelaciones set estatus='rechazada' where id=1"),/requiere ajuste o anulacion auditada/);
    await assert.rejects(db.exec("delete from public.pagos"),/requiere anulacion auditada/);
    await db.exec("set role authenticated; select set_config('test.cedis','2',false)");
    await assert.rejects(validate(),/asignada requerida/);
    await db.exec("select set_config('test.cedis','1',false),set_config('test.rol','coordinador',false)");
    await assert.rejects(validate(),/Solo el supervisor asignado/);
  }finally{await db.close()}
});

test("Walmart calculation uses the confirmed provider and IH decision and refuses unreviewed routes",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    await db.exec(retentionDraft);
    await db.exec(`
      create table public.liquidaciones(ruta_id bigint);
      create table public.pagos(ruta_id bigint,estatus text);
      create table public.validaciones_pendientes(ruta_id bigint,estatus text);
      create function private.es_valida() returns boolean language sql stable as $$
        select coalesce(current_setting('test.valida',true),'false')='true'
      $$;
      alter table public.proveedores add column tipo_registro text;
      update public.proveedores set tipo_registro='SIN FACTURA' where id=10;
      create table public.parametros_pago(clave text primary key,valor numeric);
      insert into public.parametros_pago values
        ('retencion_sin_factura',0.05),('iva',0.16),('comision_sin_factura',0.02);
      alter table public.rutas add column tipo_unidad text, add column checkin_at timestamptz;
      insert into public.rutas(id,cedis_id,estado,fallidos,tipo_unidad,checkin_at,
        walmart_visitas_asignadas,walmart_visitas_realizadas,walmart_requiere_revision)
      values (1,1,'cerrada',0,'3.5T','2026-11-09 12:00:00+00',100,95,false),
        (2,1,'cerrada',0,'3.5T','2026-11-09 12:00:00+00',100,95,true),
        (3,1,'cerrada',0,'3.5T','2026-11-09 12:00:00+00',100,95,false);
      select set_config('test.user_id','00000000-0000-0000-0000-000000000001',false);
      select set_config('test.admin','true',false);
      select set_config('test.valida','true',false);
      select set_config('test.rol','ih',false);
      select set_config('test.cedis','1',false);
    `);
    await db.exec(retentionDecisionDraft);
    const calculate=async(id)=>(await db.query(
      "select private.walmart_calcular_decision_guardada($1,true,false,'SIN FACTURA',0.05,0.16,0.02) as value",[id]
    )).rows[0].value;
    await assert.rejects(calculate(1),/debe confirmar/);
    await assert.rejects(calculate(2),/requieren revision/);
    await db.query("select public.walmart_elegir_retencion($1,$2)",[1,false]);
    await assert.rejects(calculate(1),/confirmar el proveedor/);
    await assert.rejects(db.query("select public.walmart_confirmar_proveedor_ruta(1,999)"),/proveedor existente/);
    assert.equal((await db.query("select public.walmart_confirmar_proveedor_ruta(1,10) as opcion")).rows[0].opcion,1);
    const weekly=await calculate(1);
    assert.equal(weekly.aplicar_retencion,false);
    assert.equal(weekly.pago_semanal,4061.25);
    assert.equal(weekly.saldo_retenido,0);
    assert.equal(weekly.retencion_seleccionada_por,"00000000-0000-0000-0000-000000000001");
    assert.equal(weekly.proveedor_id,10);
    assert.equal(weekly.proveedor_confirmado_por,"00000000-0000-0000-0000-000000000001");
    assert.equal(weekly.opcion,1);
    await db.exec("update private.walmart_acuerdos set opcion=2 where proveedor_id=10 and cedis_id=1");
    const snapshot=await calculate(1);
    assert.equal(snapshot.opcion,1);
    assert.equal(snapshot.pago_base,4500);
    await db.query("select public.walmart_elegir_retencion($1,$2)",[1,true]);
    const held=await calculate(1);
    assert.equal(held.pago_semanal,3045.94);
    assert.equal(held.saldo_retenido,1015.31);
    assert.equal(held.total,weekly.total);
    await assert.rejects(db.query(
      "select public.walmart_previsualizar_ruta(3,11,false,true,false)"
    ),/registro fiscal valido/);
    assert.equal((await db.query("select count(*)::int as n from private.walmart_proveedores_confirmados where ruta_id=3")).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int as n from private.walmart_decisiones_retencion where ruta_id=3")).rows[0].n,0);
    const preview=(await db.query(
      "select public.walmart_previsualizar_ruta(3,10,false,true,false) as value"
    )).rows[0].value;
    assert.equal(preview.proveedor_id,10);
    assert.equal(preview.opcion,2);
    assert.equal(preview.pago_semanal,3790.5);
    assert.equal(preview.saldo_retenido,0);
    await db.exec("insert into public.pagos values (1,'pagado')");
    await assert.rejects(db.query("select public.walmart_confirmar_proveedor_ruta(1,11)"),/con pagos/);
    await db.exec("set role authenticated");
    await assert.rejects(calculate(1),/permission denied/);
  }finally{await db.close()}
});

test("configured Walmart calculation uses the confirmed model and exact route tariff",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async(cedis,fecha,unidad,opcion)=>(await db.query(
      "select private.calcular_walmart_tarifa_configurada($1,$2::date,$3,$4::smallint,100,95,true,false,'SIN FACTURA',0.05,0.16,0.02) as value",
      [cedis,fecha,unidad,opcion])).rows[0].value;
    for(const [cedis,unidad] of [[1,"3.5T"],[2,"3.5T"],[3,"Large"],[4,"Large"]]){
      await assert.rejects(calc(cedis,"2026-11-08",unidad,1),/una sola tarifa/);
      assert.equal((await calc(cedis,"2026-11-09",unidad,1)).vigencia_desde,"2026-11-09");
    }
    const first=await calc(1,"2026-11-09","3.5T",1);
    assert.equal(first.pago_base,4500);
    assert.equal(first.tarifa_cliente,5565.5);
    assert.equal(first.porcentaje_semanal,0.75);
    assert.equal(first.opcion,1);
    assert.equal(first.pago_semanal,3045.94);
    const second=await calc(1,"2026-12-31","3.5T",2);
    assert.equal(second.pago_base,4200);
    assert.equal(second.porcentaje_semanal,0.85);
    assert.equal(second.opcion,2);
    const merida=await calc(4,"2026-11-15","Large van",2);
    assert.equal(merida.tipo_unidad,"Large");
    const queretaroTn=await calc(1,"2026-11-15","3.5 TN",1);
    assert.equal(queretaroTn.tipo_unidad,"3.5T");
    assert.equal(Number(queretaroTn.pago_base),4500);
    const meridaTn=await calc(4,"2026-11-15","1.5 TN",2);
    assert.equal(meridaTn.tipo_unidad,"Large");
    assert.equal(Number(meridaTn.pago_base),3400);
    assert.equal(merida.pago_base,3400);
    assert.equal(merida.porcentaje_semanal,0.9);
    await assert.rejects(calc(1,"2026-11-08","3.5T",1),/una sola tarifa/);
    await assert.rejects(calc(1,"2027-01-01","3.5T",1),/una sola tarifa/);
    await assert.rejects(calc(1,"2026-11-15","Large",1),/una sola tarifa/);
    await assert.rejects(calc(1,"2026-11-15","5T",1),/Unidad sin tarifa/);
    await assert.rejects(calc(1,"2026-11-15","3.5T",null),/modelo Walmart confirmado/);
    await db.exec(`insert into public.walmart_tarifas
      (cedis_id,tipo_unidad,esquema,zona,variable,vigencia_desde,vigencia_hasta,
       tarifa_cliente,pago_opcion_1,pago_opcion_2,semanal_opcion_1,semanal_opcion_2)
      values (1,'3.5T','RUTA','LOCAL','REGULAR','2026-11-15','2026-12-15',1,1,1,0.75,0.85)`);
    await assert.rejects(calc(1,"2026-11-15","3.5T",1),/encontradas 2/);
  }finally{await db.close()}
});

test("Walmart load rolls back if a center is missing or ambiguous",async()=>{
  for(const sql of [
    "update public.cedis set activo=false where id=4",
    "insert into public.cedis values (5,1,'FC Merida',true)"
  ]){
    const db=await database();
    try{
      await db.exec(sql);
      await assert.rejects(db.exec(migration),/exactamente un CEDIS Walmart activo/);
      await db.exec("rollback");
      assert.equal((await db.query("select to_regclass('public.walmart_tarifas') as tabla")).rows[0].tabla,null);
    }finally{await db.close()}
  }
});

test("Walmart load does not overwrite existing conflicting rates",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    await db.exec("update public.walmart_tarifas set pago_opcion_1=1 where cedis_id=1");
    await assert.rejects(db.exec(migration),/difiere del archivo/);
    await db.exec("rollback");
    assert.equal((await db.query("select pago_opcion_1::text as pago from public.walmart_tarifas where cedis_id=1")).rows[0].pago,"1.00");
  }finally{await db.close()}
});

test("Walmart load rejects an overlapping older draft without changing it",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    await db.exec(`update public.walmart_tarifas set vigencia_desde='2026-11-01' where cedis_id=1`);
    await assert.rejects(db.exec(migration),/se superpone con la vigencia Walmart/);
    await db.exec("rollback");
    const rows=(await db.query("select vigencia_desde::text as desde from public.walmart_tarifas where cedis_id=1")).rows;
    assert.deepEqual(rows,[{desde:"2026-11-01"}]);
  }finally{await db.close()}
});
