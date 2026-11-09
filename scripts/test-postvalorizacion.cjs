const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PGlite}=require("@electric-sql/pglite");
const vm=require("node:vm");

const draft=fs.readFileSync(path.join(__dirname,"..","postvalorizacion-borrador.sql"),"utf8");
const coppelDraft=fs.readFileSync(path.join(__dirname,"..","postvalorizacion-coppel-borrador.sql"),"utf8");
const pnrDraft=fs.readFileSync(path.join(__dirname,"..","postvalorizacion-pnr-borrador.sql"),"utf8");
const pnrAplicacionDraft=fs.readFileSync(path.join(__dirname,"..","postvalorizacion-pnr-aplicacion-borrador.sql"),"utf8");
const pnrAnulacionDraft=fs.readFileSync(path.join(__dirname,"..","pnr-anulacion-proteccion-borrador.sql"),"utf8");
const anulacion=fs.readFileSync(path.join(__dirname,"..","liquidation-annulment-audit.sql"),"utf8");
const ops=fs.readFileSync(path.join(__dirname,"..","ops.js"),"utf8");

test("post valorizacion calcula abonos y descuentos fiscales sin retencion Walmart",async()=>{
  const db=new PGlite();
  try{
    await db.exec("create schema private; create role anon; create role authenticated");
    await db.exec(draft);
    const calc=async(cuenta,tipo,base,disponible,registro)=>(await db.query(
      "select private.postvalorizacion_calcular($1,$2,$3,$4,$5,0.05,0.02,0.16) as value",
      [cuenta,tipo,base,disponible,registro]
    )).rows[0].value;
    const abono=await calc("WALMART","abono",100,0,"FACTURA");
    assert.equal(abono.efecto_pago,116);
    assert.equal(abono.efecto_semanal,116);
    assert.equal(abono.efecto_saldo_retenido,0);
    assert.equal(abono.base_pendiente,0);
    const descuento=await calc("COPPEL","descuento",100,47.5,"SIN FACTURA");
    assert.equal(descuento.base_aplicada,50);
    assert.equal(descuento.base_pendiente,50);
    assert.equal(descuento.efecto_pago,-47.5);
    const bloqueado=await calc("WALMART","descuento",100,0,"FACTURA");
    assert.equal(bloqueado.base_aplicada,0);
    assert.equal(bloqueado.base_pendiente,100);
    assert.equal(bloqueado.efecto_pago,0);
    for(const registro of ["FACTURA","SIN FACTURA"]){
      for(const disponible of [0.01,0.07,1.23,47.5]){
        const partial=await calc("WALMART","descuento",100,disponible,registro);
        assert.ok(-partial.efecto_pago<=disponible);
        assert.equal(Math.round((partial.base_aplicada+partial.base_pendiente)*100),10000);
        if(partial.base_aplicada<100){
          const next=Math.round((partial.base_aplicada+0.01)*100)/100;
          const fiscal=(await db.query(
            "select private.postvalorizacion_fiscal($1,$2,0.05,0.02,0.16) as value",[next,registro]
          )).rows[0].value;
          assert.ok(fiscal.pago_proveedor>disponible);
        }
      }
    }
    await assert.rejects(calc("WALMART","abono",0,0,"FACTURA"),/Datos invalidos/);
    await assert.rejects(calc("OTRO","abono",100,0,"FACTURA"),/Datos invalidos/);
    await assert.rejects(calc("WALMART","abono",100.001,0,"FACTURA"),/Datos invalidos/);
    await db.exec("set role authenticated");
    await assert.rejects(calc("WALMART","abono",100,0,"FACTURA"),/permission denied/);
  }finally{await db.close()}
});

test("pantalla COPPEL captura el concepto y permite aprobarlo sin afirmar que esta pagado",async()=>{
  const elements={},calls=[];
  const el=id=>elements[id]||(elements[id]={value:"",innerHTML:"",disabled:false,isConnected:true});
  const destination=el("destino");
  let concepts=[];
  const context=vm.createContext({
    ROL:"ih",PRV:[{id:10,nombre:"Proveedor"}],$:el,esc:String,fm:String,
    crypto:{randomUUID:()=>"request-id"},
    sb:{rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==="coppel_postval_listar")return {data:concepts,error:null};
      if(name==="coppel_postval_proponer"){
        concepts=[{id:"request-id",tipo:args.p_tipo,monto_base:args.p_monto_base,descripcion:args.p_descripcion,estado:"pendiente"}];
        return {data:{},error:null};
      }
      if(name==="coppel_postval_aprobar"){concepts[0].estado="aprobado";return {data:{},error:null}}
      if(name==="coppel_postval_resumen_pnr")return {data:{
        alcance:"actividad_confirmada",requiere_revision_fuentes:true,reclamos_pendientes:2,saldo_pendiente:30
      },error:null};
      throw new Error("RPC inesperado");
    }}
  });
  vm.runInContext(ops.slice(ops.indexOf("async function cargarPostvalCoppel("),ops.indexOf("\nfunction mostrarPrecierreCoppel(")),context);
  const detail={rutas:[{proveedor_id:10}],cancelaciones:[]};
  await context.cargarPostvalCoppel(destination,"driver","2026-11-09",detail,false);
  assert.match(destination.innerHTML,/aún no se aplican a pagos/);
  el("coppel-postval-proveedor").value="10";
  el("coppel-postval-tipo").value="descuento";
  el("coppel-postval-base").value="100.00";
  el("coppel-postval-descripcion").value="Ajuste autorizado";
  await el("coppel-postval-enviar").onclick();
  const sent=calls.find(x=>x.name==="coppel_postval_proponer");
  assert.equal(sent.args.p_proveedor_id,"10");
  assert.equal(sent.args.p_tipo,"descuento");
  assert.equal(sent.args.p_monto_base,"100.00");
  assert.match(destination.innerHTML,/pendiente/);
  await el("coppel-postval-pnr-0").onclick();
  assert.equal(calls.find(x=>x.name==="coppel_postval_resumen_pnr").args.p_id,"request-id");
  assert.match(el("coppel-postval-pnr-aviso-0").innerHTML,/dato parcial/);
  assert.match(el("coppel-postval-pnr-aviso-0").innerHTML,/No se ha aplicado ningún descuento/);
  context.ROL="coordinador";
  await context.cargarPostvalCoppel(destination,"driver","2026-11-09",detail,false);
  assert.match(destination.innerHTML,/Aprobar/);
  await el("coppel-postval-aprobar-0").onclick();
  assert.equal(calls.find(x=>x.name==="coppel_postval_aprobar").args.p_id,"request-id");
  assert.match(destination.innerHTML,/aprobado/);
});

test("supervisor propone y coordinacion aprueba el concepto de un precierre COPPEL abierto",async()=>{
  const db=new PGlite();
  const ih="00000000-0000-0000-0000-000000000001";
  const coord="00000000-0000-0000-0000-000000000002";
  const id="00000000-0000-0000-0000-000000000010";
  const rejectedId="00000000-0000-0000-0000-000000000011";
  const driver="00000000-0000-0000-0000-000000000020";
  try{
    await db.exec(`
      create schema private; create schema auth; create role anon; create role authenticated;
      create table public.drivers(id uuid primary key);
      create table public.proveedores(id bigint primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.uid',true),'')::uuid
      $$;
      create function public.mi_acceso_administrativo() returns boolean language sql stable as $$
        select coalesce(current_setting('test.admin',true),'false')='true'
      $$;
      create function public.operativo_rol_actual() returns text language sql stable as $$
        select current_setting('test.rol',true)
      $$;
      create function private.coppel_peak_bloqueo_semana(uuid,date) returns void language sql as $$ select $$;
      create function public.coppel_peak_consultar_precierre(uuid,date) returns jsonb language sql stable as $$
        select jsonb_build_object('estado',current_setting('test.estado',true),
          'rutas',jsonb_build_array(jsonb_build_object('proveedor_id',10)),
          'cancelaciones','[]'::jsonb)
      $$;
    `);
    await db.query("insert into public.drivers values ($1),($2),($3)",[ih,coord,driver]);
    await db.exec("insert into public.proveedores values (10),(11)");
    await db.exec(coppelDraft);
    await db.query("select set_config('test.uid',$1,false)",[ih]);
    await db.exec("select set_config('test.admin','true',false),set_config('test.rol','ih',false),set_config('test.estado','completo',false); set role authenticated");
    const propose=(provider,amount,description="Servicio complementario")=>db.query(
      "select public.coppel_postval_proponer($1,$2,'2026-11-09',$3,'abono',$4,$5) as value",
      [id,driver,provider,amount,description]
    );
    const proposal=(await propose(10,100)).rows[0].value;
    assert.equal(proposal.estado,"pendiente");
    assert.equal(proposal.proveedor_id,10);
    const list=async()=>(await db.query("select public.coppel_postval_listar($1,'2026-11-09') as value",[driver])).rows[0].value;
    assert.equal((await list()).length,1);
    assert.equal((await propose(10,100)).rows[0].value.id,id);
    await assert.rejects(propose(10,101),/identificador corresponde/);
    await assert.rejects(propose(11,100),/no figura/);
    await assert.rejects(propose(10,100,"x"),/descripcion validos/);
    await db.query("select public.coppel_postval_proponer($1,$2,'2026-11-09',10,'descuento',50,'Concepto duplicado')",[rejectedId,driver]);
    await assert.rejects(db.query("select public.coppel_postval_aprobar($1)",[id]),/Solo coordinacion/);
    await db.query("select set_config('test.uid',$1,false)",[coord]);
    await db.exec("select set_config('test.rol','coordinador',false),set_config('test.estado','requiere_revision',false)");
    await assert.rejects(db.query("select public.coppel_postval_aprobar($1)",[id]),/acceso completo/);
    await assert.rejects(list(),/acceso completo/);
    await db.exec("select set_config('test.estado','completo',false)");
    const approved=(await db.query("select public.coppel_postval_aprobar($1) as value",[id])).rows[0].value;
    assert.equal(approved.estado,"aprobado");
    assert.equal(approved.aprobado_por,coord);
    assert.ok((await list()).some(x=>x.estado==="aprobado"));
    assert.equal((await db.query("select public.coppel_postval_aprobar($1) as value",[id])).rows[0].value.aprobado_por,coord);
    await assert.rejects(db.query("select public.coppel_postval_rechazar($1,'no')",[rejectedId]),/motivo del rechazo/);
    const rejected=(await db.query("select public.coppel_postval_rechazar($1,'Concepto duplicado') as value",[rejectedId])).rows[0].value;
    assert.equal(rejected.estado,"rechazado");
    assert.equal(rejected.rechazado_por,coord);
    assert.equal((await db.query("select public.coppel_postval_rechazar($1,'Concepto duplicado') as value",[rejectedId])).rows[0].value.estado,"rechazado");
    await assert.rejects(db.query("select public.coppel_postval_aprobar($1)",[rejectedId]),/ya fue rechazada/);
    await assert.rejects(db.query("select public.coppel_postval_rechazar($1,'No corresponde')",[id]),/ya fue aprobada/);
    await assert.rejects(db.query("select * from private.postvalorizaciones_coppel"),/permission denied/);
    await db.exec("select set_config('test.estado','cerrada',false)");
    await assert.rejects(db.query("select public.coppel_postval_aprobar($1)",[id]),/abierto/);
  }finally{await db.close()}
});

test("PNR considera drivers confirmados del proveedor sin duplicarlos ni revelar otros CEDIS",async()=>{
  const db=new PGlite();
  const actor="00000000-0000-0000-0000-000000000001";
  const d1="00000000-0000-0000-0000-000000000011";
  const d2="00000000-0000-0000-0000-000000000012";
  const d3="00000000-0000-0000-0000-000000000013";
  const id="00000000-0000-0000-0000-000000000101";
  try{
    await db.exec(`
      create schema private; create schema auth; create role anon; create role authenticated;
      create table public.cedis(id bigint primary key,cliente_id bigint);
      create table public.rutas(id bigint primary key,driver_id uuid,cedis_id bigint,checkin_at timestamptz);
      create table public.liquidaciones(ruta_id bigint,proveedor_id bigint);
      create table public.cancelaciones(id bigint primary key,cedis_id bigint,capturado_at timestamptz);
      create table private.coppel_peak_cancelaciones(cancelacion_id bigint,driver_id uuid,proveedor_id bigint,lunes date);
      create table private.postvalorizaciones_coppel(id uuid primary key,driver_contexto uuid,lunes date,proveedor_id bigint);
      create table public.pnr_descuentos(driver_id uuid,saldo_pendiente numeric);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.uid',true),'')::uuid
      $$;
      create function public.mi_acceso_administrativo() returns boolean language sql stable as $$ select true $$;
      create function public.operativo_rol_actual() returns text language sql stable as $$ select current_setting('test.rol',true) $$;
      create function public.operativo_asignado_a(bigint,bigint,text) returns boolean language sql stable as $$
        select $2::text=any(string_to_array(current_setting('test.cedis',true),','))
      $$;
      create function public.coppel_peak_consultar_precierre(uuid,date) returns jsonb language sql stable as $$
        select jsonb_build_object('estado',current_setting('test.estado',true))
      $$;
      insert into public.cedis values (22,1),(23,2);
    `);
    await db.query(`insert into public.rutas values
      (1,$1,22,'2026-11-09 12:00+00'),(2,$1,22,'2026-11-10 12:00+00'),
      (3,$2,23,'2026-11-11 12:00+00'),(4,$3,22,'2026-11-12 12:00+00'),
      (5,$3,22,'2026-11-08 12:00+00')`,[d1,d2,d3]);
    await db.exec("insert into public.liquidaciones values (1,10),(2,10),(3,10),(4,11),(5,10); insert into public.cancelaciones values (1,22,'2026-11-09 12:00+00'),(2,22,'2026-11-10 12:00+00')");
    await db.query("insert into private.coppel_peak_cancelaciones values (1,$1,10,'2026-11-09')",[d1]);
    await db.query("insert into public.pnr_descuentos values ($1,10),($2,20),($3,100)",[d1,d2,d3]);
    await db.query("insert into private.postvalorizaciones_coppel values ($1,$2,'2026-11-09',10)",[id,d1]);
    await db.exec(pnrDraft);
    await db.query("select set_config('test.uid',$1,false)",[actor]);
    await db.exec("select set_config('test.rol','coordinador',false),set_config('test.estado','completo',false),set_config('test.cedis','22,23',false); set role authenticated");
    const report=async()=>(await db.query("select public.coppel_postval_resumen_pnr($1) as value",[id])).rows[0].value;
    const result=await report();
    assert.equal(result.reclamos_pendientes,2);
    assert.equal(result.saldo_pendiente,30);
    assert.equal(result.alcance,"actividad_confirmada");
    assert.equal(result.requiere_revision_fuentes,true);
    await db.exec("select set_config('test.cedis','22',false)");
    await assert.rejects(report(),/todos los CEDIS/);
    await db.exec("select set_config('test.cedis','22,23',false),set_config('test.estado','requiere_revision',false)");
    await assert.rejects(report(),/acceso completo/);
    await db.exec("select set_config('test.estado','completo',false); reset role");
    await db.exec("create table private.walmart_proveedores_confirmados(ruta_id bigint,proveedor_id bigint); insert into private.walmart_proveedores_confirmados values (4,10); set role authenticated");
    assert.equal((await report()).saldo_pendiente,130);
    await db.exec("reset role");
    await db.exec("delete from private.walmart_proveedores_confirmados; create table private.walmart_cancelaciones_pagadas(cancelacion_id bigint,driver_id uuid,proveedor_id bigint)");
    await db.query("insert into private.walmart_cancelaciones_pagadas values (2,$1,10)",[d3]);
    await db.exec("set role authenticated");
    assert.equal((await report()).saldo_pendiente,130);
    await assert.rejects(db.query("select * from private.postval_actividad_confirmada(10,'2026-11-09')"),/permission denied/);
  }finally{await db.close()}
});

test("ledger semanal aplica saldos PNR por reclamo y driver, con reintento idempotente y rollback",async()=>{
  const db=new PGlite();
  const driver1="00000000-0000-0000-0000-000000000011";
  const driver2="00000000-0000-0000-0000-000000000012";
  const other="00000000-0000-0000-0000-000000000013";
  const claim1="00000000-0000-0000-0000-000000000021";
  const claim2="00000000-0000-0000-0000-000000000022";
  const claim3="00000000-0000-0000-0000-000000000023";
  const first="00000000-0000-0000-0000-000000000031";
  const second="00000000-0000-0000-0000-000000000032";
  try{
    await db.exec(`
      create schema private; create role anon; create role authenticated;
      create table public.drivers(id uuid primary key);
      create table private.postvalorizaciones_coppel(
        id uuid primary key,proveedor_id bigint,lunes date,estado text,tipo text
      );
      create table public.pnr_descuentos(
        reclamo_id uuid primary key,driver_id uuid,monto numeric(12,2),
        saldo_pendiente numeric(12,2),monto_aplicado numeric(12,2),
        creado_en timestamptz,aplicado_en timestamptz
      );
      create table public.pnr_reclamo_eventos(reclamo_id uuid,tipo text,mensaje text);
      create table private.actividad(driver_id uuid,proveedor_id bigint,lunes date);
      create function private.postval_actividad_confirmada(bigint,date)
        returns table(driver_id uuid,cliente_id bigint,cedis_id bigint)
        language sql stable as $$
          select a.driver_id,1::bigint,1::bigint from private.actividad a
          where a.proveedor_id=$1 and a.lunes=$2
        $$;
      create function private.coppel_postval_bloqueo_proveedor(bigint,date)
        returns void language sql as $$ select $$;
    `);
    await db.query("insert into public.drivers values ($1),($2),($3)",[driver1,driver2,other]);
    await db.query("insert into private.actividad values ($1,10,'2026-11-09'),($2,10,'2026-11-09'),($1,10,'2026-11-09'),($3,11,'2026-11-09')",[driver1,driver2,other]);
    await db.query(`insert into public.pnr_descuentos values
      ($1,$4,100,30,70,'2026-01-01',null),
      ($2,$5,80,80,0,'2026-01-02',null),
      ($3,$6,200,200,0,'2026-01-03',null)`,
      [claim1,claim2,claim3,driver1,driver2,other]);
    await db.query("insert into private.postvalorizaciones_coppel values ($1,10,'2026-11-09','aprobado','abono'),($2,10,'2026-11-09','aprobado','abono')",[first,second]);
    await db.exec(pnrAplicacionDraft);
    const apply=async(id,amount)=>(await db.query("select private.postval_aplicar_pnr_a_abono($1,$2) as value",[id,amount])).rows[0].value;
    assert.deepEqual(await apply(first,50),{aplicado:50,restante:0});
    assert.deepEqual(await apply(first,50),{aplicado:50,restante:0});
    await assert.rejects(apply(first,51),/otro importe/);
    let rows=(await db.query("select reclamo_id,driver_id,monto::text from private.postval_pnr_aplicaciones order by reclamo_id")).rows;
    assert.deepEqual(rows,[
      {reclamo_id:claim1,driver_id:driver1,monto:"30.00"},
      {reclamo_id:claim2,driver_id:driver2,monto:"20.00"}
    ]);
    let balances=(await db.query("select saldo_pendiente::text,monto_aplicado::text from public.pnr_descuentos order by reclamo_id")).rows;
    assert.deepEqual(balances,[
      {saldo_pendiente:"0.00",monto_aplicado:"100.00"},
      {saldo_pendiente:"60.00",monto_aplicado:"20.00"},
      {saldo_pendiente:"200.00",monto_aplicado:"0.00"}
    ]);
    await db.exec("begin");
    assert.deepEqual(await apply(second,100),{aplicado:60,restante:40});
    await db.exec("rollback");
    assert.deepEqual(await apply(second,100),{aplicado:60,restante:40});
    rows=(await db.query("select reclamo_id,driver_id,monto::text from private.postval_pnr_aplicaciones where postval_id=$1",[second])).rows;
    assert.deepEqual(rows,[{reclamo_id:claim2,driver_id:driver2,monto:"60.00"}]);
    assert.equal(Number((await db.query("select count(*) as n from public.pnr_reclamo_eventos")).rows[0].n),3);
    await db.exec("set role authenticated");
    await assert.rejects(apply(first,50),/permission denied/);
  }finally{await db.close()}
});

test("anulacion bloquea rutas con aplicaciones PNR sin perder pago, liquidacion ni auditoria",async()=>{
  const db=new PGlite();
  const actor="00000000-0000-0000-0000-000000000001";
  try{
    await db.exec(`
      create schema private; create schema auth; create role anon; create role authenticated;
      create table auth.users(id uuid primary key);
      create table public.drivers(id uuid primary key,rol text);
      create table public.liquidaciones(ruta_id bigint primary key);
      create table public.pagos(id bigint primary key,ruta_id bigint,concepto text,estatus text);
      create table public.pnr_descuentos_aplicaciones(ruta_id text,monto numeric);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.uid',true),'')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      create function public.mi_acceso_administrativo() returns boolean language sql stable as $$ select true $$;
      insert into public.liquidaciones values (1),(2),(3);
      insert into public.pagos values (1,1,'servicio','pendiente'),(2,2,'servicio','pendiente'),
        (3,3,'servicio','pagado');
      insert into public.pnr_descuentos_aplicaciones values ('1',25);
    `);
    await db.query("insert into auth.users values ($1)",[actor]);
    await db.query("insert into public.drivers values ($1,'coordinador')",[actor]);
    await db.exec(anulacion);
    await db.exec(pnrAnulacionDraft);
    await db.query("select set_config('test.uid',$1,false)",[actor]);
    await db.exec("set role authenticated");
    const cancel=route=>db.query("select public.anular_liquidacion($1,'Correccion')",[route]);
    await assert.rejects(cancel("1"),/descuentos PNR registrados/);
    await assert.rejects(cancel("3"),/marcado como pagado/);
    await cancel("2");
    await db.exec("reset role");
    assert.deepEqual((await db.query("select ruta_id from public.liquidaciones order by ruta_id")).rows.map(x=>Number(x.ruta_id)),[1,3]);
    assert.deepEqual((await db.query("select id from public.pagos order by id")).rows.map(x=>Number(x.id)),[1,3]);
    assert.deepEqual((await db.query("select ruta_id from public.liquidacion_anulaciones")).rows,[{ruta_id:"2"}]);
    await assert.rejects(db.exec("delete from public.liquidaciones where ruta_id=1"),/descuentos PNR registrados/);
  }finally{await db.close()}
});
