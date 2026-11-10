const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {PGlite}=require("@electric-sql/pglite");

const root=path.resolve(__dirname,"..");
const ops=fs.readFileSync(path.join(root,"ops.js"),"utf8");
const sql=fs.readFileSync(path.join(root,"route-validation-rejection.sql"),"utf8");

test("validation modal exposes rejection and requires a reason before calling the RPC",async()=>{
  const calls=[],messages=[],elements={};
  let promptValue="";
  const el=id=>elements[id]||(elements[id]={
    value:"",checked:false,innerHTML:"",textContent:"",disabled:false,handlers:{},
    classList:{add(){},remove(){},toggle(){}},
    addEventListener(name,fn){this.handlers[name]=fn}
  });
  const modal=el("modal");
  let refreshed=false,rendered=false;
  const route={id:42,id_ruta:"R-42",driver_id:"driver",estado:"cerrada",entregados:9,paquetes_asignados:10,
    drivers:{nombre:"Driver"},cedis:{nombre:"Centro",clientes:{nombre:"MELI"}}};
  const context=vm.createContext({
    prompt:()=>promptValue,toast:message=>messages.push(message),
    sb:{rpc:async(name,args)=>{calls.push({name,args});return {data:true,error:null}}},
    $:el,R:[route],WALMART_VALIDACION_ENABLED:false,COPPEL_PEAK_ENABLED:false,ROL:"ops",
    esc:String,fm:String,esCoord:()=>true,cargarTarifas:async()=>{},
    provDe:()=>({id:1,tipo_registro:"RFC"}),cuentaDe:()=>"MELI",
    sugeridasConPeak:()=>({l:[{id:1,ubicacion:"Local",tipo_unidad:"Van",pago_base:100,tarifa_cliente:130}],nota:""}),
    tiposSinEquivalencia:[],cargaExtra:async()=>{refreshed=true},render:()=>{rendered=true}
  });
  vm.runInContext(ops.slice(ops.indexOf("async function rechazarValidacionRuta("),ops.indexOf("\nasync function restaurarValidacionRuta(")),context);
  vm.runInContext(ops.slice(ops.indexOf("async function abrirValidar("),ops.indexOf('\n$("loading-phrase")')),context);

  await context.abrirValidar(42);
  assert.match(modal.innerHTML,/id="m-rechazar">Rechazar/);
  promptValue="";
  await el("m-rechazar").onclick();
  assert.equal(calls.length,0);
  assert.match(messages.at(-1),/motivo de rechazo/);

  promptValue="Evidencia insuficiente";
  await el("m-rechazar").onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{
    name:"rechazar_validacion_ruta",
    args:{p_ruta_id:42,p_motivo:"Evidencia insuficiente"}
  });
  assert.equal(refreshed,true);
  assert.equal(rendered,true);
  assert.match(messages.at(-1),/motivo registrado/);
  assert.match(ops,/id="m-rechazar">Rechazar/);
});

test("rejected routes leave the pending list and retain a restorable audit row",()=>{
  const route={id:42,id_ruta:"R-42",estado:"cerrada",checkin_at:"2026-11-09",driver_id:"driver",
    drivers:{nombre:"Driver"},cedis:{nombre:"Centro",clientes:{nombre:"MELI"}},
    paquetes_asignados:10,entregados:9};
  const context=vm.createContext({
    R:[route],LIQ:{},PEND:[],RECHAZOS_RUTA:[{
      ruta_id:42,motivo:"Evidencia insuficiente",rechazada_por_email:"ops@chazki.com",rechazada_en:"2026-11-09"
    }],RECHAZOS_RUTA_ERR:"",ROL:"ops",WALMART_VALIDACION_ENABLED:false,
    cuentaDe:()=>true,provDe:()=>({nombre:"Flota",tipo_registro:"RFC"}),
    dd:String,esc:String,pc:String
  });
  const pending=ops.slice(ops.indexOf("const porValidar="),ops.indexOf("\nfunction toast"));
  const view=ops.slice(ops.indexOf("function vistaPorValidar()"),ops.indexOf("\nfunction abrirRetencionWalmart("));
  vm.runInContext(pending,context);
  vm.runInContext(view,context);
  assert.equal(vm.runInContext("porValidar().length",context),0);
  const html=vm.runInContext("vistaPorValidar()",context);
  assert.match(html,/Rutas rechazadas/);
  assert.match(html,/Evidencia insuficiente/);
  assert.match(html,/data-rechazo-restaurar="42"/);
});

test("database rejection RPC checks role, route state, existing validations, and supports restoration",async()=>{
  const db=new PGlite();
  const opsId="00000000-0000-0000-0000-000000000001";
  const financeId="00000000-0000-0000-0000-000000000002";
  try{
    await db.exec(`
      create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.uid',true),'')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql stable as $$
        select jsonb_build_object('email',current_setting('test.email',true))
      $$;
      create function public.mi_acceso_administrativo() returns boolean language sql stable as $$
        select current_setting('test.role',true) in ('master','ops','coordinador','ih','finanzas')
      $$;
      create table auth.users(id uuid primary key);
      create table public.drivers(id uuid primary key,rol text);
      create table public.rutas(id bigint primary key,estado text);
      create table public.liquidaciones(ruta_id bigint);
      create table public.validaciones_pendientes(ruta_id bigint,estatus text);
      insert into auth.users values('${opsId}'),('${financeId}');
      insert into public.drivers values('${opsId}','ops'),('${financeId}','finanzas');
      insert into public.rutas values(1,'cerrada'),(2,'cerrada'),(3,'cerrada'),(4,'en_ruta');
      insert into public.liquidaciones values(2);
      insert into public.validaciones_pendientes values(3,'pendiente');
      select set_config('test.uid','${opsId}',false);
      select set_config('test.email','ops@chazki.com',false);
      select set_config('test.role','ops',false);
    `);
    await db.exec(sql);
    await assert.rejects(db.query("select public.rechazar_validacion_ruta(1,'   ')"),/motivo de rechazo/);
    await assert.rejects(db.query("select public.rechazar_validacion_ruta(2,'Duplicada')"),/liquidación validada/);
    await assert.rejects(db.query("select public.rechazar_validacion_ruta(3,'Pendiente')"),/pendiente de aprobación/);
    await assert.rejects(db.query("select public.rechazar_validacion_ruta(4,'Abierta')"),/no está cerrada/);

    await db.query("select public.rechazar_validacion_ruta(1,'Evidencia insuficiente')");
    const saved=(await db.query("select motivo,rechazada_por_email from public.ruta_validacion_rechazos where ruta_id=1")).rows[0];
    assert.deepEqual(saved,{motivo:"Evidencia insuficiente",rechazada_por_email:"ops@chazki.com"});
    await assert.rejects(db.query("select public.rechazar_validacion_ruta(1,'Segundo motivo')"),/ya fue rechazada/);
    await db.query("select public.restaurar_validacion_ruta(1)");
    const history=(await db.query("select restaurada_por_email,restaurada_en is not null as restored from public.ruta_validacion_rechazos where ruta_id=1")).rows[0];
    assert.deepEqual(history,{restaurada_por_email:"ops@chazki.com",restored:true});
    await db.query("select public.rechazar_validacion_ruta(1,'Segunda revisión')");
    assert.equal((await db.query("select count(*)::int as n from public.ruta_validacion_rechazos where ruta_id=1 and restaurada_en is null")).rows[0].n,1);

    await db.exec(`select set_config('test.uid','${financeId}',false);select set_config('test.role','finanzas',false)`);
    await assert.rejects(db.query("select public.rechazar_validacion_ruta(1,'Sin permiso')"),/Tu rol no puede rechazar/);
  }finally{await db.close()}
});
