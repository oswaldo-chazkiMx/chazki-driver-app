const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PGlite}=require("@electric-sql/pglite");

const migration=fs.readFileSync(path.join(__dirname,"..","coppel-peak-borrador.sql"),"utf8");
async function database(){
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table public.clientes(id bigint primary key,nombre text,activo boolean);
    create table public.cedis(id bigint primary key,cliente_id bigint references public.clientes(id),nombre text,activo boolean);
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

test("rate calculation uses delivered packages with exact 90 and 95 percent thresholds",async()=>{
  const db=await database();
  try{
    await db.exec(migration);
    const calc=async(asignados,entregados)=>(await db.query(
      "select private.calcular_coppel_peak_ruta(30,5,$1,$2) as result",[asignados,entregados])).rows[0].result;
    assert.deepEqual(await calc(100,89),{pago_base:2670,descuento_efectividad:133.5,bono_efectividad:0,subtotal:2536.5});
    assert.deepEqual(await calc(100,90),{pago_base:2700,descuento_efectividad:0,bono_efectividad:0,subtotal:2700});
    assert.deepEqual(await calc(100,94),{pago_base:2820,descuento_efectividad:0,bono_efectividad:0,subtotal:2820});
    assert.deepEqual(await calc(100,95),{pago_base:2850,descuento_efectividad:0,bono_efectividad:475,subtotal:3325});
    assert.equal((await calc(100,0)).subtotal,0);
    await assert.rejects(calc(100,101),/Datos inválidos/);
    await assert.rejects(calc(0,0),/Datos inválidos/);
    await assert.rejects(db.query("select private.calcular_coppel_peak_ruta('Infinity'::numeric,5,100,95)"),/Datos inválidos/);
    await assert.rejects(db.query("select private.calcular_coppel_peak_ruta(30,'Infinity'::numeric,100,95)"),/Datos inválidos/);
    await assert.rejects(db.query("select private.calcular_coppel_peak_ruta('NaN'::numeric,5,100,95)"),/Datos inválidos/);
  }finally{await db.close()}
});

test("attendance requires all six weekdays and any NO SHOW disqualifies the week",async()=>{
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

test("weekly bonus uses each validated route's plaza and includes Sunday without duplicates",async()=>{
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
    assert.equal(await calc(true,routes),"0");
    assert.equal(await calc(false,routes.slice(0,1)),"200.00");
    await assert.rejects(calc(false,[...routes,routes[0]]),/duplicada o inválida/);
    await assert.rejects(calc(false,[{...routes[0],cedis_id:999}]),/sin configuración Peak/);
    await assert.rejects(calc(false,[{...routes[0],fecha:"2026-11-16"}]),/duplicada o inválida/);
  }finally{await db.close()}
});

test("Sunday bonus pays once per Sunday with routes and never for cancellation alone",async()=>{
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
