const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PGlite}=require("@electric-sql/pglite");
const vm=require("node:vm");

const migration=fs.readFileSync(path.join(__dirname,"..","walmart-tarifario.sql"),"utf8");
const app=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8");

async function database(){
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema private; create schema auth;
    create table public.clientes(id bigint primary key,nombre text,activo boolean);
    create table public.cedis(id bigint primary key,cliente_id bigint references public.clientes(id),nombre text,activo boolean);
    create table public.proveedores(id bigint primary key,activo boolean);
    create table public.drivers(id uuid primary key);
    create table public.rutas(id bigint primary key,cedis_id bigint references public.cedis(id),estado text,fallidos integer);
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

test("driver capture validates Walmart visits independently from deliveries",()=>{
  const elements={"wm-asignadas":{value:"100"},"wm-realizadas":{value:"95"},"wm-folios":{value:"A123\nB456"},"fal":{value:"2"}};
  const context=vm.createContext({S:{route:{cli:"WALMART"}},$:id=>elements[id]});
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
    assert.ok(rows.every(x=>x.desde==="2026-11-01"&&x.hasta==="2026-12-31"));
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

test("configured Walmart calculation uses the confirmed model and exact route tariff",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async(cedis,fecha,unidad,opcion)=>(await db.query(
      "select private.calcular_walmart_tarifa_configurada($1,$2::date,$3,$4::smallint,100,95,true,false,'SIN FACTURA',0.05,0.16,0.02) as value",
      [cedis,fecha,unidad,opcion])).rows[0].value;
    const first=await calc(1,"2026-11-01","3.5T",1);
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
    assert.equal(merida.pago_base,3400);
    assert.equal(merida.porcentaje_semanal,0.9);
    await assert.rejects(calc(1,"2026-10-31","3.5T",1),/una sola tarifa/);
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
