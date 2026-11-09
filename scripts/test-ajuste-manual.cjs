const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PGlite}=require("@electric-sql/pglite");

const draft=fs.readFileSync(path.join(__dirname,"..","coppel-peak-ajuste-manual-borrador.sql"),"utf8");

test("manual COPPEL adjustment is scoped, auditable, idempotent and changes only its destination week",async()=>{
  const db=new PGlite();
  const ih="00000000-0000-0000-0000-000000000001";
  const driver="00000000-0000-0000-0000-000000000002";
  const id="00000000-0000-0000-0000-000000000010";
  try{
    await db.exec(`
      create schema private; create schema auth; create role anon; create role authenticated;
      create table public.drivers(id uuid primary key);
      create table public.proveedores(id bigint primary key);
      create table public.pagos(id bigint generated always as identity primary key,driver_id uuid,
        proveedor_id bigint,ruta_id bigint,concepto text,monto numeric(12,2),fecha date,estatus text);
      create table private.coppel_peak_cierres(driver_id uuid,lunes date,primary key(driver_id,lunes));
      create table public.clientes(id bigint primary key,nombre text);
      create table public.cedis(id bigint primary key,cliente_id bigint);
      create table public.rutas(id bigint primary key,driver_id uuid,cedis_id bigint,checkin_at timestamptz);
      create table public.cancelaciones(id bigint primary key,driver_id uuid,cedis_id bigint,capturado_at timestamptz,estatus text);
      create table public.no_show_casos(id uuid primary key,driver_id uuid,cliente_id bigint,cedis_id bigint,
        cuenta text,fecha_servicio date,estado text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.uid',true),'')::uuid
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
      create function public.operativo_normalizar(text) returns text language sql immutable as $$ select lower($1) $$;
      create function private.coppel_peak_bloqueo_semana(uuid,date) returns void language sql as $$ select $$;
      create function public.coppel_peak_consultar_semana(uuid,date) returns jsonb language sql stable as $$
        select jsonb_build_object('estado',current_setting('test.estado',true),
          'rutas','[{"ruta_id":1,"proveedor_id":10}]'::jsonb,
          'cancelaciones','[]'::jsonb,
          'no_shows','[{"caso_id":"00000000-0000-0000-0000-000000000020","estado":"reportado"}]'::jsonb)
      $$;
      insert into public.clientes values (1,'COPPEL');
      insert into public.cedis values (1,1),(2,1);
      insert into public.proveedores values (10),(11);
    `);
    await db.query("insert into public.drivers values ($1),($2)",[ih,driver]);
    await db.query("insert into private.coppel_peak_cierres values ($1,'2026-11-09')",[driver]);
    await db.query(`insert into public.rutas values
      (1,$1,1,'2026-11-09 12:00+00'),(2,$1,1,'2026-11-10 12:00+00'),(3,$1,2,'2026-11-11 12:00+00')`,[driver]);
    await db.query("insert into public.cancelaciones values (4,$1,1,'2026-11-12 12:00+00','aprobada')",[driver]);
    await db.query("insert into public.no_show_casos values ('00000000-0000-0000-0000-000000000020',$1,1,1,'COPPEL','2026-11-10','apelacion_aceptada')",[driver]);
    await db.exec(draft);
    await db.query("select set_config('test.uid',$1,false)",[ih]);
    await db.exec("select set_config('test.admin','true',false),set_config('test.rol','ih',false),set_config('test.cedis','1',false),set_config('test.estado','cerrada',false); set role authenticated");
    const candidates=(await db.query("select public.coppel_peak_posibles_retroactivos($1,'2026-11-09') as value",[driver])).rows[0].value;
    assert.deepEqual(candidates.map(x=>[x.tipo,x.id]),[
      ["cancelacion","4"],["no_show","00000000-0000-0000-0000-000000000020"],["ruta","2"]
    ]);
    const register=(request=id,provider=10,week="2099-01-05",amount=-100,reason="Correccion revisada")=>db.query(
      "select public.coppel_peak_registrar_ajuste_manual($1,$2,'2026-11-09',$3,$4::date,$5,$6) as value",
      [request,driver,provider,week,amount,reason]);
    await assert.rejects(register(id,11),/proveedor no figura/);
    const past=(await db.query("select (date '2026-11-16' < date_trunc('week',now() at time zone 'America/Mexico_City')::date) as value")).rows[0].value;
    if(past)await assert.rejects(register(id,10,"2026-11-16"),/semana actual o una futura/);
    await assert.rejects(register(id,10,"2099-01-06"),/semana posterior/);
    await assert.rejects(register(id,10,"2099-01-05",0),/importe final/);
    await db.exec("begin");
    const rolled=(await register()).rows[0].value;
    assert.equal(Number(rolled.monto),-100);
    await db.exec("rollback");
    await db.exec("reset role");
    assert.equal(Number((await db.query("select count(*) as n from public.pagos")).rows[0].n),0);
    await db.exec("set role authenticated");
    const result=(await register()).rows[0].value;
    assert.equal((await register()).rows[0].value.pago_id,result.pago_id);
    await assert.rejects(register(id,10,"2099-01-05",-101),/otro ajuste/);
    const credit=(await register("00000000-0000-0000-0000-000000000011",10,"2099-01-05",50)).rows[0].value;
    assert.equal(Number(credit.monto),50);
    const listed=(await db.query("select public.coppel_peak_listar_ajustes_manuales($1,'2026-11-09') as value",[driver])).rows[0].value;
    assert.deepEqual(listed.map(x=>Number(x.monto)),[-100,50]);
    assert.equal(listed[0].motivo,"Correccion revisada");
    await assert.rejects(db.query("select * from private.coppel_peak_ajustes_manuales"),/permission denied/);
    await db.exec("reset role");
    const payments=(await db.query("select monto::text,fecha::text,concepto,estatus from public.pagos order by id")).rows;
    assert.deepEqual(payments,[
      {monto:"-100.00",fecha:"2099-01-05",concepto:"ajuste",estatus:"pendiente"},
      {monto:"50.00",fecha:"2099-01-05",concepto:"ajuste",estatus:"pendiente"}
    ]);
    await assert.rejects(db.exec("update public.pagos set monto=1"),/corrección auditada/);
    await assert.rejects(db.exec("delete from private.coppel_peak_ajustes_manuales"),/corrección auditada/);
    await db.exec("update public.pagos set estatus='pagado' where id=2");
    await assert.rejects(db.exec("update public.pagos set estatus='pendiente' where id=2"),/corrección auditada/);
    await db.query("insert into private.coppel_peak_cierres values ($1,'2099-01-12')",[driver]);
    await db.exec("set role authenticated");
    await assert.rejects(register("00000000-0000-0000-0000-000000000012",10,"2099-01-12"),/destino ya está cerrada/);
    await db.exec("select set_config('test.rol','coordinador',false)");
    await assert.rejects(register(),/Solo el supervisor/);
  }finally{await db.close()}
});
