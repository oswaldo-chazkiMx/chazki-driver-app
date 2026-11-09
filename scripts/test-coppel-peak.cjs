const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PGlite}=require("@electric-sql/pglite");

const migration=fs.readFileSync(path.join(__dirname,"..","coppel-peak-borrador.sql"),"utf8");
const precierre=fs.readFileSync(path.join(__dirname,"..","coppel-peak-precierre-borrador.sql"),"utf8");
const solicitudes=fs.readFileSync(path.join(__dirname,"..","coppel-peak-solicitudes-borrador.sql"),"utf8");
const aprobacion=fs.readFileSync(path.join(__dirname,"..","coppel-peak-aprobacion-borrador.sql"),"utf8");
const cierre=fs.readFileSync(path.join(__dirname,"..","coppel-peak-cierre-borrador.sql"),"utf8");
const cancelaciones=fs.readFileSync(path.join(__dirname,"..","coppel-peak-cancelaciones-borrador.sql"),"utf8");
const ajustes=fs.readFileSync(path.join(__dirname,"..","coppel-peak-ajustes-borrador.sql"),"utf8");
const ajusteManual=fs.readFileSync(path.join(__dirname,"..","coppel-peak-ajuste-manual-borrador.sql"),"utf8");
const postvalCoppel=fs.readFileSync(path.join(__dirname,"..","postvalorizacion-coppel-borrador.sql"),"utf8");
const rehearsal=fs.readFileSync(path.join(__dirname,"..","ensayo-supabase","1-ensayo-coppel.sql"),"utf8");
async function database(){
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table public.clientes(id bigint primary key,nombre text,activo boolean);
    create table public.cedis(id bigint primary key,cliente_id bigint references public.clientes(id),nombre text,activo boolean);
    create table public.rutas(id bigint primary key,driver_id uuid,cedis_id bigint,checkin_at timestamptz);
    create table public.cancelaciones(id bigint primary key,driver_id uuid,cedis_id bigint,capturado_at timestamptz,estatus text);
    create table public.no_show_casos(id bigint primary key,driver_id uuid,cuenta text,fecha_servicio date,estado text);
    create table public.tarifas(id bigint primary key,zona text);
    create table public.liquidaciones(id bigint primary key,ruta_id bigint,tarifa_id bigint,cuenta text,tipo_unidad text,esquema text,entregados integer,proveedor_id bigint,registro_fiscal text);
    create function public.operativo_normalizar(p_texto text) returns text language sql immutable as $$
      select regexp_replace(translate(lower(btrim(coalesce(p_texto,''))),'áéíóúüñ','aeiouun'),'[^a-z0-9]+','','g')
    $$;
    insert into public.clientes values (1,'COPPEL',true);
    insert into public.cedis values
      (24,1,'Express Aguascalientes',true),(23,1,'Express Ensenada',true),
      (22,1,'DS Coppel AZC',true),(21,1,'DS Coppel Iztapalapa',true),
      (20,1,'Express Durango',true),(19,1,'Express Gómez Palacio',true),
      (18,1,'DS Coppel Tecámac',true),(17,1,'Express Toluca',true),
      (15,1,'Express Guadalajara',true),(14,1,'DS Coppel Monterrey',true),
      (13,1,'Express Puebla',true),(12,1,'Express San Luis Potosí',true),
      (11,1,'Express Mazatlán',true),(10,1,'Hermosillo',true),
      (9,1,'Express Ciudad Obregón',true),(8,1,'Express Xalapa',true),
      (7,1,'Express Zacatecas',true),(6,1,'DS Express Izcalli',true);
  `);
  return db;
}

test("full COPPEL rehearsal rolls back all created objects on its intentional error",async()=>{
  const db=await database();
  try{
    const body=migration.replace(/\r\n/g,"\n").split("begin;\n")[1].split("\ncommit;")[0].trim();
    assert.ok(rehearsal.replace(/\r\n/g,"\n").includes(body),"rehearsal must contain the current draft");
    await assert.rejects(db.exec(rehearsal),/ENSAYO OK COPPEL/);
    const result=(await db.query(`select
      to_regclass('private.coppel_peak_plazas') as tabla,
      to_regprocedure('private.calcular_coppel_peak_ruta(numeric,numeric,integer,integer)') as calculo,
      to_regprocedure('private.coppel_peak_previsualizar_semana(uuid,date)') as prevision`)).rows[0];
    assert.deepEqual(result,{tabla:null,calculo:null,prevision:null});
  }finally{await db.close()}
});

test("peak configuration retains plaza amounts and exact dates",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    await db.exec(migration);
    const rows=(await db.query(`select cedis_id,pago_paquete::text as base,
      bono_efectividad_paquete::text as efectividad,bono_asistencia_paquete::text as asistencia,
      cancelacion_garantizada as cancelacion,inicio::text as inicio,fin::text as fin
      from private.coppel_peak_plazas order by cedis_id`)).rows;
    assert.deepEqual(rows.map(x=>[x.cedis_id,x.base,x.efectividad,x.asistencia,x.cancelacion]),[
      [6,"40.00","0.00","0.00",false],[7,"33.00","0.00","0.00",false],
      [8,"30.00","0.00","2.00",false],[9,"35.00","0.00","0.00",false],
      [10,"35.00","0.00","3.00",false],[11,"40.00","0.00","0.00",false],
      [12,"33.00","0.00","0.00",false],[13,"30.00","3.00","2.00",true],
      [14,"35.00","0.00","3.00",true],[15,"40.00","0.00","0.00",false],
      [17,"30.00","5.00","0.00",true],[18,"30.00","5.00","2.00",true],
      [19,"35.00","0.00","0.00",false],[20,"35.00","0.00","0.00",false],
      [21,"30.00","5.00","2.00",true],[22,"30.00","5.00","2.00",true],
      [23,"38.00","0.00","0.00",false],[24,"35.00","0.00","0.00",false]
    ]);
    assert.ok(rows.every(x=>x.inicio==="2026-11-09"&&x.fin==="2027-01-10"));
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from private.coppel_peak_plazas"),/permission denied/);
  }finally{await db.close()}
});

test("route calculation applies the selected 5 percent to base and bonus from 95 percent",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async(asignados,entregados,descuento=false)=>(await db.query(
      "select private.calcular_coppel_peak_ruta(30,5,$1,$2,$3) as result",[asignados,entregados,descuento])).rows[0].result;
    assert.deepEqual(await calc(100,89),{pago_base:2670,descuento_efectividad:0,bono_efectividad:0,subtotal:2670});
    assert.deepEqual(await calc(100,89,true),{pago_base:2670,descuento_efectividad:133.5,bono_efectividad:0,subtotal:2536.5});
    assert.deepEqual(await calc(100,90),{pago_base:2700,descuento_efectividad:0,bono_efectividad:0,subtotal:2700});
    assert.deepEqual(await calc(100,94),{pago_base:2820,descuento_efectividad:0,bono_efectividad:0,subtotal:2820});
    assert.deepEqual(await calc(100,95),{pago_base:2850,descuento_efectividad:0,bono_efectividad:475,subtotal:3325});
    assert.deepEqual(await calc(100,95,true),{pago_base:2850,descuento_efectividad:142.5,bono_efectividad:475,subtotal:3182.5});
    assert.equal((await calc(100,0)).subtotal,0);
    await assert.rejects(calc(100,101),/Datos inválidos/);
    await assert.rejects(calc(0,0),/Datos inválidos/);
    await assert.rejects(calc(100,95,null),/Datos inválidos/);
    await assert.rejects(db.query("select private.calcular_coppel_peak_ruta('Infinity'::numeric,5,100,95)"),/Datos inválidos/);
    await assert.rejects(db.query("select private.calcular_coppel_peak_ruta(30,'Infinity'::numeric,100,95)"),/Datos inválidos/);
    await assert.rejects(db.query("select private.calcular_coppel_peak_ruta('NaN'::numeric,5,100,95)"),/Datos inválidos/);
  }finally{await db.close()}
});

test("configured route calculation rejects special zones, vehicles and out-of-period dates",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async(cedis,fecha,unidad,esquema,zona)=>(await db.query(
      "select private.coppel_peak_calcular_ruta_configurada($1,$2::date,$3,$4,$5,100,95) as result",
      [cedis,fecha,unidad,esquema,zona])).rows[0].result;
    assert.deepEqual(await calc(22,"2026-11-09","Sedan","PAQUETE","LOCAL"),
      {pago_base:2850,descuento_efectividad:0,bono_efectividad:475,subtotal:3325});
    assert.deepEqual(await calc(24,"2027-01-10","SEDAN","PAQUETE","LOCAL"),
      {pago_base:3325,descuento_efectividad:0,bono_efectividad:0,subtotal:3325});
    await assert.rejects(calc(22,"2026-11-08","SEDAN","PAQUETE","LOCAL"),/No hay tarifa/);
    await assert.rejects(calc(22,"2027-01-11","SEDAN","PAQUETE","LOCAL"),/No hay tarifa/);
    await assert.rejects(calc(5,"2026-11-09","SEDAN","PAQUETE","LOCAL"),/No hay tarifa/);
    await assert.rejects(calc(22,"2026-11-09","SEDAN","PAQUETE","LOCAL (huixquilucan)"),/no corresponde/);
    await assert.rejects(calc(22,"2026-11-09","SEDAN","PAQUETE","LOCAL (zona 2)"),/no corresponde/);
    await assert.rejects(calc(13,"2026-11-09","SEDAN","PAQUETE","FORANEA"),/no corresponde/);
    await assert.rejects(calc(13,"2026-11-09","3.5T","RUTA","LOCAL"),/no corresponde/);
    await assert.rejects(calc(13,"2026-11-09",null,"PAQUETE","LOCAL"),/no corresponde/);
  }finally{await db.close()}
});

test("attendance completeness reports missing weekdays and active NO SHOW",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async(lunes,days,noShow)=>(await db.query(
      "select private.coppel_peak_asistencia_completa($1::date,$2::date[],$3) as result",
      [lunes,days,noShow])).rows[0].result;
    const week=["2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13","2026-11-14"];
    assert.equal(await calc("2026-11-09",week,false),true);
    assert.equal(await calc("2026-11-09",[...week,"2026-11-15"],false),true);
    assert.equal(await calc("2026-11-09",week,true),false);
    assert.equal(await calc("2026-11-09",[...week.slice(0,5),"2026-11-15"],false),false);
    assert.equal(await calc("2026-11-09",[...week.slice(0,5),week[0]],false),false);
    await assert.rejects(calc("2026-11-10",week,false),/Semana o asistencia/);
    await assert.rejects(calc("2026-11-09",[...week,"2026-11-16"],false),/pertenecer a la semana/);
    await assert.rejects(calc("2027-01-11",[],false),/Semana o asistencia/);
  }finally{await db.close()}
});

test("potential attendance bonus uses validated routes even when NO SHOW requires review",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const days=["2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13","2026-11-14"];
    const routes=[
      {ruta_id:1,cedis_id:22,fecha:"2026-11-09",entregados:100},
      {ruta_id:2,cedis_id:14,fecha:"2026-11-15",entregados:50},
      {ruta_id:3,cedis_id:17,fecha:"2026-11-14",entregados:20}
    ];
    const calc=async(noShow,entries)=>(await db.query(
      "select private.calcular_coppel_peak_asistencia($1::date,$2::date[],$3,$4::jsonb)::text as result",
      ["2026-11-09",days,noShow,JSON.stringify(entries)])).rows[0].result;
    assert.equal(await calc(false,routes),"350.00");
    assert.equal(await calc(true,routes),"350.00");
    assert.equal(await calc(false,routes.slice(0,1)),"200.00");
    await assert.rejects(calc(false,[...routes,routes[0]]),/duplicada o inválida/);
    await assert.rejects(calc(false,[{...routes[0],cedis_id:999}]),/sin configuración Peak/);
    await assert.rejects(calc(false,[{...routes[0],fecha:"2026-11-16"}]),/duplicada o inválida/);
  }finally{await db.close()}
});

test("weekly preview derives attendance and validated routes from database records",async()=>{
  const db=await database();
  const driver="00000000-0000-0000-0000-000000000001";
  try{
    await db.exec(migration);
    await db.exec(`
      insert into public.rutas values
        (1,'${driver}',22,'2026-11-09 16:00+00'),
        (2,'${driver}',22,'2026-11-11 16:00+00'),
        (3,'${driver}',22,'2026-11-12 16:00+00'),
        (4,'${driver}',22,'2026-11-13 16:00+00'),
        (5,'${driver}',14,'2026-11-14 16:00+00'),
        (6,'${driver}',14,'2026-11-15 16:00+00');
      insert into public.cancelaciones values
        (1,'${driver}',22,'2026-11-10 16:00+00','pendiente');
      insert into public.tarifas values (1,'LOCAL'),(2,'LOCAL (huixquilucan)');
      insert into public.liquidaciones values
        (1,1,1,'COPPEL','SEDAN','PAQUETE',100,10,'FACTURA'),
        (2,2,2,'COPPEL','SEDAN','PAQUETE',100,10,'FACTURA');
    `);
    const preview=async()=>(await db.query("select private.coppel_peak_previsualizar_semana($1,'2026-11-09') as result",[driver])).rows[0].result;
    let result=await preview();
    assert.equal(result.bono_asistencia_potencial,200);
    assert.equal(result.asistencia_completa,false);
    assert.deepEqual(result.dias_faltantes,["2026-11-10"]);
    assert.equal(result.rutas_domingo,1);
    assert.equal(result.bono_domingo_base,300);
    assert.equal(result.domingo_requiere_revision,true);
    assert.equal(result.rutas_validadas.length,1);
    assert.deepEqual(result.proveedores,[10]);
    assert.equal(result.asistencia_requiere_revision,false);
    await db.exec("update public.cancelaciones set estatus='aprobada' where id=1");
    result=await preview();
    assert.equal(result.bono_asistencia_potencial,200);
    assert.equal(result.asistencia_completa,true);
    assert.deepEqual(result.dias_faltantes,[]);
    assert.deepEqual(result.dias_asistencia,["2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13","2026-11-14","2026-11-15"]);
    await db.exec("insert into public.liquidaciones values (3,6,1,'COPPEL','SEDAN','PAQUETE',50,11,'SIN FACTURA')");
    assert.equal((await preview()).bono_asistencia_potencial,350);
    assert.equal((await preview()).asistencia_requiere_revision,true);
    assert.equal((await preview()).domingo_requiere_revision,false);
    await db.exec("update public.liquidaciones set proveedor_id=null where id=3");
    assert.equal((await preview()).asistencia_requiere_revision,true);
    assert.equal((await preview()).domingo_requiere_revision,true);
    await db.exec("update public.liquidaciones set proveedor_id=10,registro_fiscal=null where id=3");
    assert.equal((await preview()).asistencia_requiere_revision,true);
    await db.exec("update public.liquidaciones set registro_fiscal='SIN FACTURA' where id=3");
    assert.equal((await preview()).asistencia_requiere_revision,true);
    await db.exec("update public.liquidaciones set registro_fiscal='FACTURA' where id=3");
    assert.equal((await preview()).asistencia_requiere_revision,false);
    await db.exec(`insert into public.no_show_casos values (1,'${driver}','COPPEL','2026-11-11','apelacion_aceptada')`);
    result=await preview();
    assert.equal(result.hubo_no_show,false);
    assert.equal(result.bono_asistencia_potencial,350);
    assert.equal(result.asistencia_completa,true);
    for(const estado of ["reportado","apelado","apelacion_rechazada"]){
      await db.query("update public.no_show_casos set estado=$1 where id=1",[estado]);
      result=await preview();
      assert.equal(result.hubo_no_show,true,estado);
      assert.equal(result.bono_asistencia_potencial,350,estado);
      assert.equal(result.asistencia_completa,false,estado);
    }
    await db.exec("update public.no_show_casos set estado='apelacion_aceptada' where id=1");
    await db.exec(`insert into public.no_show_casos values (2,'${driver}','COPPEL','2026-11-12','reportado')`);
    result=await preview();
    assert.equal(result.hubo_no_show,true);
    assert.equal(result.bono_asistencia_potencial,350);
    assert.equal(result.asistencia_completa,false);
    assert.equal(result.bono_domingo_base,300);
    await db.exec("insert into public.liquidaciones values (4,1,1,'COPPEL','SEDAN','PAQUETE',100,10,'FACTURA')");
    await assert.rejects(preview(),/duplicada o inválida/);
  }finally{await db.close()}
});

test("weekly preview requires access to every contributing center",async()=>{
  const db=await database();
  const driver="00000000-0000-0000-0000-000000000001";
  const actor="00000000-0000-0000-0000-000000000002";
  try{
    await db.exec(migration);
    await db.exec(`
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.user_id',true),'')::uuid
      $$;
      create function public.mi_acceso_administrativo() returns boolean language sql stable as $$
        select current_setting('test.activo',true)='true'
      $$;
      create function public.operativo_rol_actual() returns text language sql stable as $$
        select current_setting('test.rol',true)
      $$;
      create function public.operativo_asignado_a(bigint,bigint,text) returns boolean language sql stable as $$
        select $2::text=current_setting('test.cedis',true) and $3=current_setting('test.rol',true)
      $$;
      alter table public.no_show_casos add column cliente_id bigint, add column cedis_id bigint;
      insert into public.rutas values (1,'${driver}',22,'2026-11-09 16:00+00');
    `);
    await db.exec(precierre);
    const preview=()=>db.query("select public.coppel_peak_consultar_semana($1,'2026-11-09') as result",[driver]);
    await assert.rejects(preview(),/Sin permiso/);
    await db.query("select set_config('test.user_id',$1,false),set_config('test.activo','true',false),set_config('test.rol','ih',false),set_config('test.cedis','22',false)",[actor]);
    let result=(await preview()).rows[0].result;
    assert.equal(result.estado,"completo");
    assert.equal(result.resumen.bono_asistencia_potencial,0);
    await assert.rejects(db.query("select public.coppel_peak_consultar_semana($1,'2026-11-10')",[driver]),/semana COPPEL inválidos/);
    await assert.rejects(db.query("select public.coppel_peak_consultar_semana('00000000-0000-0000-0000-000000000003','2026-11-09')"),/Sin actividad COPPEL accesible/);
    await db.exec(`insert into public.rutas values (2,'${driver}',21,'2026-11-11 16:00+00')`);
    result=(await preview()).rows[0].result;
    assert.equal(result.estado,"requiere_revision");
    assert.equal(result.resumen,undefined);
    await db.exec("delete from public.rutas where id=2");
    await db.exec(`insert into public.cancelaciones values (1,'${driver}',21,'2026-11-10 16:00+00','aprobada')`);
    assert.equal((await preview()).rows[0].result.estado,"requiere_revision");
    await db.exec("update public.cancelaciones set estatus='pendiente'");
    assert.equal((await preview()).rows[0].result.estado,"completo");
    await db.exec(`insert into public.no_show_casos(id,driver_id,cuenta,fecha_servicio,estado,cliente_id,cedis_id)
      values (1,'${driver}','COPPEL','2026-11-10','reportado',1,21)`);
    assert.equal((await preview()).rows[0].result.estado,"requiere_revision");
    await db.exec("update public.no_show_casos set estado='apelacion_aceptada'");
    assert.equal((await preview()).rows[0].result.resumen.hubo_no_show,false);
    await db.exec("update public.no_show_casos set estado='reportado'");
    await db.exec("select set_config('test.rol','coordinador',false)");
    assert.equal((await preview()).rows[0].result.estado,"requiere_revision");
    await db.exec("update public.no_show_casos set cedis_id=22");
    assert.equal((await preview()).rows[0].result.resumen.hubo_no_show,true);
    await db.exec("update public.no_show_casos set cedis_id=21");
    await db.exec("select set_config('test.rol','master',false)");
    assert.equal((await preview()).rows[0].result.resumen.hubo_no_show,true);
    await db.exec("select set_config('test.rol','flotillero',false)");
    await assert.rejects(preview(),/Sin permiso/);
    await db.exec("select set_config('test.rol','ih',false),set_config('test.activo','false',false)");
    await assert.rejects(preview(),/Sin permiso/);
    await db.exec("select set_config('test.activo','true',false),set_config('test.rol','master',false); set role authenticated");
    assert.equal((await preview()).rows[0].result.resumen.hubo_no_show,true);
    await db.exec("reset role");
    await db.exec("set role anon");
    await assert.rejects(preview(),/permission denied/);
  }finally{await db.close()}
});

test("review requests notify only a fully assigned coordinator or operations without duplicates",async()=>{
  const db=await database();
  const driver="00000000-0000-0000-0000-000000000001";
  const actor="00000000-0000-0000-0000-000000000002";
  const coord="00000000-0000-0000-0000-000000000003";
  const partial="00000000-0000-0000-0000-000000000004";
  const ops="00000000-0000-0000-0000-000000000005";
  const second="00000000-0000-0000-0000-000000000006";
  const third="00000000-0000-0000-0000-000000000007";
  try{
    await db.exec(migration);
    await db.exec(`
      create schema auth;
      create table auth.users(id uuid primary key,email text);
      create table public.drivers(id uuid primary key,rol text,estatus text);
      create table public.staff_autorizados(email text primary key,rol text);
      create table public.asignaciones_operativas(cliente_id bigint,cedis_id bigint,coordinador_id uuid);
      create table public.notificaciones(usuario uuid,titulo text,cuerpo text,tipo text,ref_tipo text,ref_id bigint);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.user_id',true),'')::uuid
      $$;
      create function public.mi_acceso_administrativo() returns boolean language sql stable as $$
        select current_setting('test.activo',true)='true'
      $$;
      create function public.operativo_rol_actual() returns text language sql stable as $$
        select current_setting('test.rol',true)
      $$;
      create function public.operativo_asignado_a(bigint,bigint,text) returns boolean language sql stable as $$
        select ($2::text=current_setting('test.cedis',true) and $3='ih')
          or ($3='coordinador' and exists (
            select 1 from public.asignaciones_operativas a
            where a.cliente_id=$1 and a.cedis_id=$2 and a.coordinador_id=auth.uid()
          ))
      $$;
      alter table public.no_show_casos add column cliente_id bigint, add column cedis_id bigint;
      insert into public.drivers values
        ('${driver}','driver','activo'),('${actor}','ih','activo'),('${coord}','coordinador','activo'),
        ('${partial}','coordinador','activo'),('${ops}','ops','activo'),
        ('${second}','driver','activo'),('${third}','driver','activo');
      alter table public.drivers add column nombre text;
      update public.drivers set nombre='Nombre de prueba';
      insert into auth.users values ('${coord}','coord@example.test'),('${partial}','partial@example.test'),('${ops}','ops@example.test');
      insert into public.staff_autorizados values ('coord@example.test','coordinador'),('partial@example.test','coordinador'),('ops@example.test','ops');
      insert into public.asignaciones_operativas values (1,22,'${coord}'),(1,21,'${coord}'),(1,22,'${partial}');
      insert into public.rutas values
        (1,'${driver}',22,'2026-11-09 16:00+00'),(2,'${driver}',21,'2026-11-10 16:00+00'),
        (3,'${second}',22,'2026-11-09 16:00+00'),(4,'${second}',21,'2026-11-10 16:00+00'),
        (5,'${third}',22,'2026-11-09 16:00+00'),(6,'${third}',21,'2026-11-10 16:00+00');
    `);
    await db.exec(precierre);
    await db.exec(solicitudes);
    await db.query("select set_config('test.user_id',$1,false),set_config('test.activo','true',false),set_config('test.rol','ih',false),set_config('test.cedis','22',false)",[actor]);
    const request=async(id)=>(await db.query("select public.coppel_peak_solicitar_revision($1,'2026-11-09') as id",[id])).rows[0].id;
    const first=await request(driver);
    assert.equal(await request(driver),first);
    await assert.rejects(db.query("select public.coppel_peak_listar_solicitudes()"),/Solo coordinación/);
    await db.query("select set_config('test.rol','coordinador',false),set_config('test.user_id',$1,false)",[coord]);
    let listed=(await db.query("select public.coppel_peak_listar_solicitudes() as result")).rows[0].result;
    assert.equal(listed.length,1);
    assert.equal(listed[0].id,first);
    await db.query("select set_config('test.user_id',$1,false)",[partial]);
    listed=(await db.query("select public.coppel_peak_listar_solicitudes() as result")).rows[0].result;
    assert.equal(listed.length,0);
    await db.query("select set_config('test.rol','ih',false),set_config('test.user_id',$1,false)",[actor]);
    let notifications=(await db.query("select usuario,ref_id from public.notificaciones")).rows;
    assert.equal(notifications.length,1);
    assert.equal(notifications[0].usuario,coord);
    await db.query("update public.drivers set estatus='inactivo' where id=$1",[coord]);
    await request(second);
    notifications=(await db.query("select usuario,ref_id from public.notificaciones order by ref_id")).rows;
    assert.deepEqual(notifications.map(x=>x.usuario),[coord,ops]);
    await db.query("update public.drivers set estatus='inactivo' where id=$1",[ops]);
    await assert.rejects(request(third),/No hay coordinación autorizada ni Operaciones/);
    assert.equal((await db.query("select count(*)::int as n from private.coppel_peak_solicitudes_revision")).rows[0].n,2);
    await db.exec("select set_config('test.rol','coordinador',false)");
    await assert.rejects(request(driver),/Solo el supervisor autorizado/);
    await db.exec("select set_config('test.rol','ih',false),set_config('test.cedis','99',false)");
    await assert.rejects(request(driver),/Sin actividad COPPEL accesible/);
    await db.exec("set role anon");
    await assert.rejects(request(driver),/permission denied/);
  }finally{await db.close()}
});

test("attendance decision requires the reviewed summary and registers one pending provider bonus",async()=>{
  const db=await database();
  const driver="00000000-0000-0000-0000-000000000001";
  const actor="00000000-0000-0000-0000-000000000002";
  const independent="00000000-0000-0000-0000-000000000003";
  const ambiguous="00000000-0000-0000-0000-000000000004";
  const reject="00000000-0000-0000-0000-000000000005";
  const sunday="00000000-0000-0000-0000-000000000006";
  const canceled="00000000-0000-0000-0000-000000000007";
  const noShowDriver="00000000-0000-0000-0000-000000000008";
  try{
    await db.exec(migration);
    await db.exec(`
      create schema auth;
      create table public.drivers(id uuid primary key);
      create table public.proveedores(id bigint primary key);
      create table public.pagos(id bigint generated always as identity primary key,driver_id uuid,
        proveedor_id bigint,ruta_id bigint,concepto text,monto numeric,fecha date,estatus text);
      create table public.parametros_pago(clave text primary key,valor numeric);
      create table public.pnr_descuentos(
        reclamo_id uuid primary key,driver_id uuid,monto numeric(12,2),saldo_pendiente numeric(12,2),
        monto_aplicado numeric(12,2),creado_en timestamptz,aplicado_en timestamptz
      );
      create table public.pnr_reclamo_eventos(reclamo_id uuid,tipo text,mensaje text);
      create table private.coppel_peak_solicitudes_revision(driver_id uuid,lunes date,estado text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.user_id',true),'')::uuid
      $$;
      create function public.mi_acceso_administrativo() returns boolean language sql stable as $$
        select current_setting('test.activo',true)='true'
      $$;
      create function public.operativo_rol_actual() returns text language sql stable as $$
        select current_setting('test.rol',true)
      $$;
      create function public.operativo_asignado_a(bigint,bigint,text) returns boolean language sql stable as $$
        select $2::text=any(string_to_array(current_setting('test.cedis',true),',')) and $3 in ('ih','coordinador')
      $$;
      alter table public.no_show_casos alter column id type uuid using gen_random_uuid(),
        add column cliente_id bigint, add column cedis_id bigint, add column proveedor_id bigint;
      insert into public.drivers values ('${driver}'),('${actor}'),('${independent}'),('${ambiguous}'),('${reject}'),('${sunday}'),('${canceled}'),('${noShowDriver}');
      insert into public.proveedores values (10),(11);
      alter table public.drivers add column proveedor_id bigint;
      alter table public.proveedores add column tipo_registro text;
      update public.proveedores set tipo_registro=case when id=10 then 'FACTURA' else 'SIN FACTURA' end;
      update public.drivers set proveedor_id=10 where id='${canceled}';
      insert into public.parametros_pago values ('retencion_sin_factura',0.05),('comision_sin_factura',0.02),('iva',0.16);
      insert into public.clientes values (2,'OTRO CLIENTE',true);
      insert into public.cedis values (30,2,'Destino 1',true),(31,2,'Destino 2',true),
        (32,2,'Destino 3',true),(33,2,'Destino 4',true);
      insert into public.rutas values (1,'${driver}',22,'2026-11-09 16:00+00'),(2,'${independent}',22,'2026-11-09 16:00+00');
      insert into public.tarifas values (1,'LOCAL');
      insert into public.liquidaciones values
        (1,1,1,'COPPEL','SEDAN','PAQUETE',100,10,'FACTURA'),
        (2,2,1,'COPPEL','SEDAN','PAQUETE',100,11,'SIN FACTURA');
      insert into private.coppel_peak_solicitudes_revision values ('${driver}','2026-11-09','pendiente');
    `);
    await db.exec(precierre);
    await db.exec(aprobacion);
    const ajuste=async(tipo,pendiente,base,registro="FACTURA",subtotal=base,disponible=1000000)=>(await db.query(
      "select private.coppel_peak_calcular_ajuste_retroactivo($1,$2,$3,$4,$5,$6,0.05,0.02,0.16) as value",
      [tipo,pendiente,base,subtotal,disponible,registro])).rows[0].value;
    const primera=await ajuste("descuento",500,180);
    assert.equal(primera.ajuste_base,-180);
    assert.equal(primera.ajuste_pago,-208.8);
    assert.equal(primera.pendiente_base,320);
    assert.equal(primera.base_resultante,0);
    const segunda=await ajuste("descuento",primera.pendiente_base,500);
    assert.equal(segunda.ajuste_base,-320);
    assert.equal(segunda.pendiente_base,0);
    assert.equal(segunda.base_resultante,180);
    assert.equal((await ajuste("descuento",500,0)).pendiente_base,500);
    assert.equal((await ajuste("abono",75,180)).ajuste_pago,87);
    assert.equal((await ajuste("descuento",100,1000,"FACTURA")).ajuste_pago,-116);
    assert.equal((await ajuste("descuento",100,1000,"SIN FACTURA")).ajuste_pago,-95);
    assert.equal((await ajuste("abono",100,1000,"FACTURA")).ajuste_pago,116);
    assert.equal((await ajuste("abono",100,1000,"SIN FACTURA")).ajuste_pago,95);
    const centavos=await ajuste("descuento",0.01,0.03,"FACTURA",0.04);
    assert.equal(centavos.base_resultante,0.02);
    assert.equal(centavos.subtotal_resultante,0.03);
    assert.equal(centavos.ajuste_pago,-0.02);
    const conBono=await ajuste("descuento",150,100,"SIN FACTURA",120);
    assert.equal(conBono.ajuste_base,-100);
    assert.equal(conBono.subtotal_resultante,20);
    assert.equal(conBono.pendiente_base,50);
    assert.equal(conBono.ajuste_pago,-95);
    const conPnr=await ajuste("descuento",100,100,"FACTURA",100,50);
    assert.equal(conPnr.ajuste_base,-43.1);
    assert.equal(conPnr.ajuste_pago,-50);
    assert.equal(conPnr.pendiente_base,56.9);
    const sinFactura=await ajuste("descuento",100,100,"SIN FACTURA",100,50);
    assert.equal(sinFactura.ajuste_base,-52.63);
    assert.equal(sinFactura.ajuste_pago,-50);
    assert.equal(sinFactura.pendiente_base,47.37);
    const sinDisponible=await ajuste("descuento",100,100,"FACTURA",100,0);
    assert.equal(sinDisponible.ajuste_base,0);
    assert.equal(sinDisponible.pendiente_base,100);
    await assert.rejects(ajuste("descuento",10.001,100),/Datos inválidos/);
    await assert.rejects(ajuste("descuento",10,-1),/Datos inválidos/);
    await assert.rejects(ajuste("otro",10,100),/Datos inválidos/);
    await assert.rejects(ajuste("descuento",10,100,"FACTURA",99),/Datos inválidos/);
    await assert.rejects(ajuste("descuento",10,100,"FACTURA",100,-1),/Datos inválidos/);
    await db.exec("create or replace function private.coppel_peak_fecha_actual() returns date language sql stable as $$ select date '2026-11-15' $$");
    await db.query("select set_config('test.user_id',$1,false),set_config('test.activo','true',false),set_config('test.rol','ih',false),set_config('test.cedis','22',false)",[actor]);
    const preview=async(id)=>(await db.query("select public.coppel_peak_consultar_semana($1,'2026-11-09')->'resumen' as value",[id])).rows[0].value;
    const decide=async(id,apply,snapshot)=>(await db.query("select public.coppel_peak_aprobar_asistencia($1,'2026-11-09',$2,$3::jsonb) as value",[id,apply,JSON.stringify(snapshot)])).rows[0].value;
    let summary=await preview(driver);
    await assert.rejects(decide(driver,true,summary),/después de terminar la semana/);
    await db.exec("create or replace function private.coppel_peak_fecha_actual() returns date language sql stable as $$ select date '2026-11-16' $$");
    await db.exec(`insert into public.no_show_casos(id,driver_id,cuenta,fecha_servicio,estado,cliente_id,cedis_id)
      values ('10000000-0000-0000-0000-000000000011','${driver}','COPPEL','2026-11-10','reportado',1,22)`);
    await assert.rejects(decide(driver,true,summary),/resumen cambió/);
    summary=await preview(driver);
    assert.equal(summary.hubo_no_show,true);
    const result=await decide(driver,true,summary);
    assert.equal(result.fiscal.bono_base,200);
    assert.equal(result.fiscal.pago_proveedor,232);
    assert.equal((await decide(driver,true,summary)).pago_id,result.pago_id);
    const payment=(await db.query("select driver_id,proveedor_id,concepto,monto::text,estatus from public.pagos")).rows[0];
    assert.deepEqual(payment,{driver_id:driver,proveedor_id:10,concepto:"bono",monto:"232.00",estatus:"pendiente"});
    assert.equal((await db.query("select estado from private.coppel_peak_solicitudes_revision")).rows[0].estado,"resuelta");
    await assert.rejects(decide(driver,false,summary),/ya fue decidida/);
    assert.equal((await db.query("select count(*)::int as n from public.pagos")).rows[0].n,1);
    const summary2=await preview(independent);
    const result2=await decide(independent,true,summary2);
    assert.equal(result2.fiscal.pago_proveedor,190);
    assert.equal((await db.query("select proveedor_id from public.pagos where id=$1",[result2.pago_id])).rows[0].proveedor_id,11);
    await db.exec(`
      insert into public.rutas values (3,'${ambiguous}',22,'2026-11-10 16:00+00'),
        (4,'${ambiguous}',22,'2026-11-11 16:00+00'),(5,'${reject}',22,'2026-11-10 16:00+00'),
        (8,'${sunday}',22,'2026-11-15 16:00+00');
      insert into public.liquidaciones values
        (3,3,1,'COPPEL','SEDAN','PAQUETE',100,10,'FACTURA'),
        (4,4,1,'COPPEL','SEDAN','PAQUETE',100,11,'SIN FACTURA'),
        (5,5,1,'COPPEL','SEDAN','PAQUETE',100,10,'FACTURA'),
        (8,8,1,'COPPEL','SEDAN','PAQUETE',100,10,'FACTURA');
    `);
    const summary3=await preview(ambiguous);
    assert.equal(summary3.asistencia_requiere_revision,true);
    await assert.rejects(decide(ambiguous,true,summary3),/Revisa el proveedor y el registro fiscal/);
    const summary4=await preview(reject);
    const result4=await decide(reject,false,summary4);
    assert.equal(result4.pago_id,null);
    assert.equal((await decide(reject,false,summary4)).aplica,false);
    assert.equal((await db.query("select count(*)::int as n from public.pagos")).rows[0].n,2);
    await db.exec(`insert into public.rutas values (6,'${ambiguous}',22,'2026-11-12 16:00+00')`);
    await assert.rejects(decide(ambiguous,true,await preview(ambiguous)),/rutas COPPEL sin validar/);
    await db.exec(`
      alter table public.liquidaciones add column asignados integer,add column pago_base numeric,
        add column dcto_pago numeric,add column bono_pago numeric;
      alter table public.no_show_casos add column vence_apelacion_en timestamptz,
        add column pago_penalizacion_id bigint,add column pago_reversion_id bigint;
      update public.liquidaciones set asignados=100,pago_base=3000,dcto_pago=0,bono_pago=0;
      insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
        values ('${independent}',11,2,'servicio',2850,'2026-11-09','pendiente'),
          ('${sunday}',10,8,'servicio',3480,'2026-11-15','pendiente');
    `);
    await db.exec(cancelaciones);
    await db.exec(cierre);
    await db.exec(ajustes);
    await db.exec(postvalCoppel);
    const preclose=async(id)=>(await db.query("select public.coppel_peak_consultar_precierre($1,'2026-11-09') as value",[id])).rows[0].value;
    const independentPreclose=await preclose(independent);
    const close=async()=>(await db.query("select public.coppel_peak_cerrar_semana($1,'2026-11-09',true,$2::jsonb) as value",
      [independent,JSON.stringify(independentPreclose)])).rows[0].value;
    const postvalId="20000000-0000-0000-0000-000000000001";
    const rejectedPostvalId="20000000-0000-0000-0000-000000000002";
    await db.query("select public.coppel_postval_proponer($1,$2,'2026-11-09',11,'abono',100,'Servicio adicional')",
      [postvalId,independent]);
    await db.query("select public.coppel_postval_proponer($1,$2,'2026-11-09',11,'abono',50,'Concepto duplicado')",
      [rejectedPostvalId,independent]);
    await assert.rejects(close(),/post valorizaciones pendientes de integrar/);
    await db.query("select set_config('test.rol','coordinador',false),set_config('test.user_id',$1,false)",[driver]);
    await db.query("select public.coppel_postval_aprobar($1)",[postvalId]);
    await db.query("select public.coppel_postval_rechazar($1,'Concepto duplicado')",[rejectedPostvalId]);
    await assert.rejects(close(),/post valorizaciones pendientes de integrar/);
    await db.query("insert into public.rutas values (200,$1,22,'2026-11-09 16:00+00')",[noShowDriver]);
    await db.exec(`insert into public.liquidaciones(id,ruta_id,tarifa_id,cuenta,tipo_unidad,esquema,entregados,proveedor_id,registro_fiscal,asignados,pago_base,dcto_pago,bono_pago)
      values (200,200,1,'COPPEL','SEDAN','PAQUETE',100,11,'SIN FACTURA',100,3000,0,0)`);
    await db.query(`insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
      values ($1,11,200,'servicio',2850,'2026-11-09','pendiente')`,[noShowDriver]);
    const otherPreclose=await preclose(noShowDriver);
    await assert.rejects(db.query(
      "select public.coppel_peak_cerrar_semana($1,'2026-11-09',false,$2::jsonb)",
      [noShowDriver,JSON.stringify(otherPreclose)]
    ),/post valorizaciones pendientes de integrar/);
    await db.exec("delete from public.pagos where ruta_id=200; delete from public.liquidaciones where ruta_id=200; delete from public.rutas where id=200");
    await db.query("delete from private.postvalorizaciones_coppel where id=$1",[postvalId]);
    await db.query("select set_config('test.rol','ih',false),set_config('test.user_id',$1,false)",[actor]);
    const closed=await close();
    assert.equal(closed.estado,"cerrada");
    assert.equal(closed.rutas[0].pago,2850);
    assert.equal((await close()).estado,"cerrada");
    await db.exec(ajusteManual);
    await db.exec("begin");
    const manualId="40000000-0000-0000-0000-000000000001";
    const manual=async()=>(await db.query(
      "select public.coppel_peak_registrar_ajuste_manual($1,$2,'2026-11-09',11,'2099-01-05',-50,'Diferencia revisada') as value",
      [manualId,independent])).rows[0].value;
    const manualResult=await manual();
    assert.equal(Number(manualResult.monto),-50);
    assert.equal((await manual()).pago_id,manualResult.pago_id);
    assert.equal((await db.query("select public.coppel_peak_listar_ajustes_manuales($1,'2026-11-09') as value",[independent])).rows[0].value.length,1);
    await db.exec("rollback");
    assert.equal((await db.query("select count(*)::int as n from public.pagos where driver_id=$1",[independent])).rows[0].n,2);
    await db.query("update public.drivers set proveedor_id=10 where id=$1",[independent]);
    const ajusteId="10000000-0000-0000-0000-000000000001";
    const proponer=async(id=ajusteId,proveedor=11,monto=100,origen="manual",origenId=null)=>(await db.query(
      "select public.coppel_peak_proponer_ajuste($1,$2,'2026-11-09',$3,'descuento',$4,'Diferencia revisada',$5,$6) as value",
      [id,independent,proveedor,monto,origen,origenId])).rows[0].value;
    const autorizar=async(otras)=>(await db.query(
      "select public.coppel_peak_autorizar_ajuste($1,$2) as value",[ajusteId,otras])).rows[0].value;
    const propuesta=await proponer();
    assert.equal(propuesta.estado,"pendiente_revision");
    assert.equal(propuesta.proveedor_id,11);
    assert.equal((await proponer()).id,ajusteId);
    await assert.rejects(proponer(ajusteId,11,101),/identificador del ajuste/);
    await assert.rejects(proponer("10000000-0000-0000-0000-000000000002",10),/proveedor no figura/);
    await assert.rejects(proponer("10000000-0000-0000-0000-000000000002",11,100,"ruta",1),/ruta no pertenece/);
    await assert.rejects(autorizar(true),/Solo coordinación/);
    await assert.rejects(db.query("select public.coppel_peak_listar_ajustes()"),/Solo coordinación, Operaciones o Finanzas/);
    await db.exec("select set_config('test.rol','coordinador',false),set_config('test.cedis','21',false)");
    await assert.rejects(autorizar(true),/Sin actividad COPPEL accesible/);
    assert.deepEqual((await db.query("select public.coppel_peak_listar_ajustes() as value")).rows[0].value,[]);
    await db.exec("select set_config('test.cedis','22',false)");
    assert.equal((await db.query("select public.coppel_peak_listar_ajustes() as value")).rows[0].value.length,1);
    const autorizada=await autorizar(true);
    assert.equal(autorizada.estado,"autorizado");
    assert.equal(autorizada.permitir_otras_cuentas,true);
    assert.equal((await autorizar(true)).autorizado_en,autorizada.autorizado_en);
    await assert.rejects(autorizar(false),/ya fue autorizado con otra condición/);
    const autorizarDestino=async(cedis)=>(await db.query(
      "select public.coppel_peak_autorizar_destino_ajuste($1,$2) as value",[ajusteId,cedis])).rows[0].value;
    await assert.rejects(autorizarDestino(30),/acceso al origen y al destino/);
    await assert.rejects(autorizarDestino(22),/otra cuenta activa/);
    await db.exec("select set_config('test.cedis','22,30',false)");
    assert.equal((await autorizarDestino(30)).rol_autorizador,"coordinador");
    await db.exec("select set_config('test.rol','finanzas',false)");
    assert.equal((await db.query("select public.coppel_peak_listar_ajustes() as value")).rows[0].value.length,1);
    const finanzas=await autorizarDestino(31);
    assert.equal(finanzas.rol_autorizador,"finanzas");
    assert.equal((await autorizarDestino(31)).autorizado_en,finanzas.autorizado_en);
    await db.exec("select set_config('test.rol','ops',false)");
    assert.equal((await autorizarDestino(32)).rol_autorizador,"ops");
    await db.exec("select set_config('test.rol','master',false)");
    assert.equal((await autorizarDestino(33)).rol_autorizador,"master");
    assert.equal((await db.query("select public.coppel_peak_listar_ajustes() as value")).rows[0].value[0].destinos.length,4);
    await db.exec("select set_config('test.rol','coordinador',false),set_config('test.cedis','22,30',false)");
    assert.deepEqual((await db.query("select public.coppel_peak_listar_ajustes() as value")).rows[0].value[0].destinos.map(x=>x.cedis_id),[30]);
    assert.equal((await db.query("select count(*)::int as n from public.pagos where driver_id=$1",[independent])).rows[0].n,2);
    await db.exec("select set_config('test.rol','ih',false),set_config('test.cedis','22',false)");
    await assert.rejects(autorizarDestino(31),/Sin permiso/);
    await assert.rejects(db.exec("update public.liquidaciones set entregados=99 where ruta_id=2"),/semana COPPEL está cerrada/);
    await assert.rejects(db.exec("update public.pagos set monto=1 where ruta_id=2"),/semana COPPEL cerrada/);
    await assert.rejects(db.exec("update public.rutas set cedis_id=21 where id=2"),/ruta pertenece a una semana COPPEL cerrada/);
    await assert.rejects(db.exec(`insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
      values ('${independent}',11,2,'servicio',10,'2026-11-09','pendiente')`),/semana COPPEL está cerrada/);
    await assert.rejects(db.exec("update public.liquidaciones set ruta_id=3 where ruta_id=2"),/semana COPPEL está cerrada/);
    await db.exec("update public.pagos set estatus='pagado' where ruta_id=2");
    await assert.rejects(db.exec("delete from public.pagos where ruta_id=2"),/semana COPPEL cerrada/);
    await db.exec(`insert into public.rutas values (7,'${independent}',21,'2026-11-11 16:00+00')`);
    await assert.rejects(proponer("10000000-0000-0000-0000-000000000002",11,50,"ruta","7"),/Sin acceso al CEDIS/);
    await db.exec("select set_config('test.cedis','22,21',false)");
    const tardia=await proponer("10000000-0000-0000-0000-000000000002",11,50,"ruta","7");
    assert.equal(tardia.origen_tipo,"ruta");
    assert.equal(tardia.origen_id,"7");
    await db.exec("select set_config('test.cedis','22',false),set_config('test.rol','coordinador',false)");
    assert.equal((await db.query("select public.coppel_peak_listar_ajustes() as value")).rows[0].value.length,1);
    await assert.rejects(db.query("select public.coppel_peak_autorizar_ajuste($1,true)",[tardia.id]),/Sin acceso al CEDIS/);
    await db.exec("select set_config('test.rol','ih',false)");
    const frozen=(await db.query("select public.coppel_peak_consultar_semana($1,'2026-11-09') as value",[independent])).rows[0].value;
    assert.equal(frozen.estado,"cerrada");
    assert.equal(frozen.rutas.length,1);
    assert.deepEqual(frozen.resumen,summary2);
    await assert.rejects(db.exec(`insert into public.liquidaciones(id,ruta_id,tarifa_id,cuenta,tipo_unidad,esquema,entregados,proveedor_id,registro_fiscal)
      values (7,7,1,'COPPEL','SEDAN','PAQUETE',50,11,'SIN FACTURA')`),/semana COPPEL está cerrada/);
    const sundaySummary=await preclose(sunday);
    const sundayClose=async()=>(await db.query("select public.coppel_peak_cerrar_semana($1,'2026-11-09',false,$2::jsonb) as value",
      [sunday,JSON.stringify(sundaySummary)])).rows[0].value;
    const sundayResult=await sundayClose();
    assert.equal(sundayResult.domingo.bono_base,300);
    assert.equal(sundayResult.domingo.pago_proveedor,348);
    await sundayClose();
    assert.equal((await db.query("select count(*)::int as n from public.pagos where driver_id=$1 and concepto='bono'",[sunday])).rows[0].n,1);
    await db.exec(`insert into public.cancelaciones values (20,'${canceled}',22,'2026-11-10 16:00+00','aprobada');
      insert into public.pnr_descuentos values
        ('30000000-0000-0000-0000-000000000001','${canceled}',30,30,0,'2026-01-01',null),
        ('30000000-0000-0000-0000-000000000002','${canceled}',100,100,0,'2026-01-02',null),
        ('30000000-0000-0000-0000-000000000003','${driver}',20,20,0,'2026-01-03',null)`);
    let canceledSummary=await preclose(canceled);
    const closeCanceled=async()=>(await db.query("select public.coppel_peak_cerrar_semana($1,'2026-11-09',false,$2::jsonb) as value",
      [canceled,JSON.stringify(canceledSummary)])).rows[0].value;
    await assert.rejects(closeCanceled(),/Captura el importe de cada cancelación/);
    const registerCancel=async(base)=>(await db.query("select public.coppel_peak_registrar_cancelacion(20,$1,10) as value",[base])).rows[0].value;
    await db.exec("begin");
    const rolledBack=await registerCancel(100);
    assert.equal(rolledBack.pnr_aplicado,116);
    await db.exec("rollback");
    assert.equal((await db.query("select count(*)::int as n from private.coppel_peak_cancelaciones_pnr")).rows[0].n,0);
    assert.deepEqual((await db.query("select saldo_pendiente::text as saldo from public.pnr_descuentos order by reclamo_id")).rows.map(x=>x.saldo),["30.00","100.00","20.00"]);
    const cancelResult=await registerCancel(100);
    assert.equal(cancelResult.fiscal.pago_proveedor,116);
    assert.equal(cancelResult.pnr_aplicado,116);
    assert.equal((await registerCancel(100)).pago_id,cancelResult.pago_id);
    assert.deepEqual((await db.query("select monto::text as monto from private.coppel_peak_cancelaciones_pnr order by reclamo_id")).rows.map(x=>x.monto),["30.00","86.00"]);
    assert.deepEqual((await db.query("select saldo_pendiente::text as saldo from public.pnr_descuentos order by reclamo_id")).rows.map(x=>x.saldo),["0.00","14.00","20.00"]);
    assert.equal((await db.query("select count(*)::int as n from public.pnr_reclamo_eventos")).rows[0].n,2);
    await assert.rejects(db.exec("update public.cancelaciones set estatus='rechazada' where id=20"),/corrección auditada/);
    await assert.rejects(db.exec("delete from public.cancelaciones where id=20"),/corrección auditada/);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from private.coppel_peak_cancelaciones_pnr"),/permission denied/);
    await db.exec("reset role");
    await assert.rejects(registerCancel(150),/ya tiene un importe registrado/);
    await db.exec(`insert into public.cancelaciones values (21,'${canceled}',22,'2026-11-11 16:00+00','aprobada')`);
    const zero=(await db.query("select public.coppel_peak_registrar_cancelacion(21,0,10) as value")).rows[0].value;
    assert.equal(zero.pago_id,null);
    assert.equal(zero.pnr_aplicado,0);
    assert.equal((await db.query("select saldo_pendiente::text as saldo from public.pnr_descuentos where reclamo_id='30000000-0000-0000-0000-000000000002'")).rows[0].saldo,"14.00");
    await assert.rejects(closeCanceled(),/El precierre cambió/);
    canceledSummary=await preclose(canceled);
    assert.equal(canceledSummary.cancelaciones[0].pago,0);
    await assert.rejects(db.query("update public.pagos set monto=99 where id=$1",[cancelResult.pago_id]),/corrección auditada/);
    await assert.rejects(db.query("delete from private.coppel_peak_cancelaciones_pnr"),/corrección auditada/);
    const cancelClose=await closeCanceled();
    assert.equal(cancelClose.cancelaciones[0].base,100);
    assert.equal(cancelClose.cancelaciones[0].pago_id,cancelResult.pago_id);
    assert.equal(cancelClose.cancelaciones[0].pnr_aplicado,116);
    assert.equal(cancelClose.cancelaciones[0].pago_neto,0);
    await assert.rejects(db.query("update public.pagos set monto=99 where id=$1",[cancelResult.pago_id]),/semana COPPEL cerrada/);
    await db.query("update public.pagos set estatus='pagado' where id=$1",[cancelResult.pago_id]);
    await assert.rejects(db.query("update public.pagos set estatus='pendiente' where id=$1",[cancelResult.pago_id]),/semana COPPEL cerrada|corrección auditada/);
    await db.exec(`
      insert into public.rutas values (9,'${noShowDriver}',22,'2026-11-09 16:00+00');
      insert into public.liquidaciones(id,ruta_id,tarifa_id,cuenta,tipo_unidad,esquema,entregados,proveedor_id,registro_fiscal)
        values (9,9,1,'COPPEL','SEDAN','PAQUETE',50,10,'FACTURA');
      insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
        values ('${noShowDriver}',10,9,'servicio',1740,'2026-11-09','pendiente');
      insert into public.no_show_casos(id,driver_id,cuenta,fecha_servicio,estado,cliente_id,cedis_id,proveedor_id,vence_apelacion_en)
        values ('10000000-0000-0000-0000-000000000012','${noShowDriver}','COPPEL','2026-11-10','reportado',1,22,10,now()+interval '1 day');
    `);
    let nsSummary=await preclose(noShowDriver);
    const closeNs=async()=>(await db.query("select public.coppel_peak_cerrar_semana($1,'2026-11-09',false,$2::jsonb) as value",
      [noShowDriver,JSON.stringify(nsSummary)])).rows[0].value;
    await assert.rejects(closeNs(),/NO SHOW con apelación pendiente/);
    await db.exec("update public.no_show_casos set vence_apelacion_en=now()-interval '1 second' where id='10000000-0000-0000-0000-000000000012'");
    await assert.rejects(closeNs(),/El precierre cambió/);
    nsSummary=await preclose(noShowDriver);
    const closedNs=await closeNs();
    assert.equal(closedNs.no_shows.length,1);
    const nsProposal=(await db.query("select public.coppel_peak_proponer_ajuste($1,$2,'2026-11-09',10,'abono',50,'Revisión de NO SHOW','no_show',$3) as value",
      ["10000000-0000-0000-0000-000000000003",noShowDriver,"10000000-0000-0000-0000-000000000012"])).rows[0].value;
    assert.equal(nsProposal.origen_tipo,"no_show");
    await assert.rejects(db.exec("update public.no_show_casos set estado='apelacion_aceptada' where id='10000000-0000-0000-0000-000000000012'"),/NO SHOW para revisión retroactiva/);
    await db.exec("select set_config('test.activo','false',false)");
    await assert.rejects(decide(independent,true,summary2),/Sin permiso/);
    await db.exec("set role anon");
    await assert.rejects(decide(independent,true,summary2),/permission denied/);
  }finally{await db.close()}
});

test("Sunday bonus pays once per Sunday with registered routes, not cancellation alone",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async(fecha,rutas)=>(await db.query(
      "select private.coppel_peak_bono_domingo($1::date,$2)::text as result",
      [fecha,rutas])).rows[0].result;
    assert.equal(await calc("2026-11-15",0),"0");
    assert.equal(await calc("2026-11-15",1),"300");
    assert.equal(await calc("2026-11-15",3),"300");
    assert.equal(await calc("2026-11-14",1),"0");
    assert.equal(await calc("2027-01-10",1),"300");
    await assert.rejects(calc("2026-11-08",1),/Fecha o número de rutas inválidos/);
    await assert.rejects(calc("2027-01-11",1),/Fecha o número de rutas inválidos/);
    await assert.rejects(calc("2026-11-15",-1),/Fecha o número de rutas inválidos/);
  }finally{await db.close()}
});

test("bonus fiscal calculation matches invoice and non-invoice route treatment",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async(bono,registro,ret=0.05,com=0.02,iva=0.16)=>(await db.query(
      "select private.coppel_peak_fiscal_bono($1,$2,$3,$4,$5) as result",
      [bono,registro,ret,com,iva])).rows[0].result;
    assert.deepEqual(await calc(300,"SIN FACTURA"),{
      bono_base:300,retencion:15,neto:285,comision:5.7,iva:0,pago_proveedor:285,costo_total_imp:290.7
    });
    assert.deepEqual(await calc(300,"FACTURA"),{
      bono_base:300,retencion:0,neto:300,comision:0,iva:48,pago_proveedor:348,costo_total_imp:348
    });
    assert.deepEqual(await calc(0,"FACTURA"),{
      bono_base:0,retencion:0,neto:0,comision:0,iva:0,pago_proveedor:0,costo_total_imp:0
    });
    await assert.rejects(calc(300,"OTRO"),/Datos fiscales inválidos/);
    await assert.rejects(calc(-1,"FACTURA"),/Datos fiscales inválidos/);
    await assert.rejects(calc(300,"FACTURA",0.05,0.02,1.1),/Datos fiscales inválidos/);
    await assert.rejects(calc("Infinity","FACTURA"),/Datos fiscales inválidos/);
  }finally{await db.close()}
});

test("reconciliation proposes only the difference and flags overpayments for review",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async(total,registered)=>(await db.query(
      "select private.coppel_peak_conciliar_bono($1::numeric,$2::numeric) as result",
      [total,registered])).rows[0].result;
    assert.deepEqual(await calc(350,0),{calculado:350,registrado:0,estado:"pendiente",diferencia:350});
    assert.deepEqual(await calc(350,350),{calculado:350,registrado:350,estado:"conciliado",diferencia:0});
    assert.deepEqual(await calc(500,350),{calculado:500,registrado:350,estado:"pendiente",diferencia:150});
    assert.deepEqual(await calc(0,350),{calculado:0,registrado:350,estado:"revision",diferencia:-350});
    await assert.rejects(calc(-1,0),/Importes inválidos/);
    await assert.rejects(calc(1.001,0),/Importes inválidos/);
    await assert.rejects(calc("NaN",0),/Importes inválidos/);
  }finally{await db.close()}
});

test("missing centers or conflicts roll back the draft without changing existing data",async()=>{
  for(const sql of ["update public.cedis set nombre='otro' where id=18","update public.cedis set activo=false where id=22"]){
    const db=await database();
    try{
      await db.exec(sql);
      await assert.rejects(db.exec(migration),/no coincide con el diagnóstico/);
      await db.exec("rollback");
      assert.equal((await db.query("select to_regclass('private.coppel_peak_plazas') as tabla")).rows[0].tabla,null);
    }finally{await db.close()}
  }
  const db=await database();
  try{
    await db.exec(migration);
    await db.exec("update private.coppel_peak_plazas set pago_paquete=1 where cedis_id=24");
    await assert.rejects(db.exec(migration),/difiere del borrador/);
    await db.exec("rollback");
    assert.equal((await db.query("select pago_paquete::text as pago from private.coppel_peak_plazas where cedis_id=24")).rows[0].pago,"1.00");
  }finally{await db.close()}
});
