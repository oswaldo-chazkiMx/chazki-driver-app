const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PGlite}=require("@electric-sql/pglite");

test("integration diagnostic reports schema and function definitions without business rows",async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create schema private;
      create table public.rutas(id bigint primary key, estado text);
      insert into public.rutas values (1,'DATO-PRIVADO-DE-PRUEBA');
      create function private.validar_core() returns boolean language sql as $$select true$$;
    `);
    const sql=fs.readFileSync(path.join(__dirname,"..","ensayo-supabase","3-diagnostico-integracion.sql"),"utf8");
    const result=(await db.query(sql)).rows[0].diagnostico;
    assert.ok(result.columnas.some(column=>column.tabla==="rutas"&&column.nombre==="estado"));
    assert.ok(result.restricciones.some(constraint=>constraint.tabla==="rutas"));
    assert.ok(result.funciones.some(fn=>fn.esquema==="private"&&fn.nombre==="validar_core"));
    assert.doesNotMatch(JSON.stringify(result),/DATO-PRIVADO-DE-PRUEBA/);
    assert.equal((await db.query("select count(*)::int as total from public.rutas")).rows[0].total,1);
  }finally{await db.close()}
});

test("COPPEL tariff diagnostic reads only active centers and relevant tariff rows",async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create table public.clientes(id bigint,nombre text,activo boolean);
      create table public.cedis(id bigint,cliente_id bigint,nombre text,ciudad text,activo boolean);
      create table public.tarifas(id bigint,cuenta text,cliente text,ciudad text,ubicacion text,
        tipo_unidad text,esquema text,zona text,variable text,pago_base numeric,tarifa_cliente numeric,
        vigencia_desde date,vigencia_hasta date,activo boolean);
      create function public.operativo_normalizar(text) returns text language sql immutable as $$
        select regexp_replace(lower(coalesce($1,'')),'[^a-z0-9]','','g')
      $$;
      insert into public.clientes values (1,'COPPEL',true),(2,'OTRO',true);
      insert into public.cedis values (1,1,'CEDIS','CIUDAD',true),(2,1,'INACTIVO','CIUDAD',false),(3,2,'OTRO','CIUDAD',true);
      insert into public.tarifas values
        (1,'COPPEL','COPPEL','CIUDAD','CEDIS','SEDAN','PAQUETE','LOCAL','REGULAR',30,50,'2026-01-01',null,true),
        (2,'COPPEL','COPPEL','CIUDAD','CEDIS','SEDAN','PAQUETE','FORANEA','REGULAR',30,50,'2026-01-01',null,true),
        (3,'COPPEL','COPPEL','CIUDAD','CEDIS','SEDAN','PAQUETE','LOCAL','REGULAR',30,50,'2025-01-01','2026-11-08',true);
    `);
    const sql=fs.readFileSync(path.join(__dirname,"..","ensayo-supabase","4-consulta-tarifas-coppel.sql"),"utf8");
    const result=(await db.query(sql)).rows[0].diagnostico_tarifas_coppel;
    assert.deepEqual(result.cedis.map(row=>row.id),[1]);
    assert.deepEqual(result.tarifas.map(row=>row.id),[1]);
    assert.equal(result.tarifas[0].tarifa_cliente,50);
  }finally{await db.close()}
});
