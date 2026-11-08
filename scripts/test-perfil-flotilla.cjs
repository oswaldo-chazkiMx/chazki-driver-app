const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PGlite}=require("@electric-sql/pglite");
const ids={owner:"00000000-0000-0000-0000-000000000001",driver:"00000000-0000-0000-0000-000000000002",other:"00000000-0000-0000-0000-000000000003",ops:"00000000-0000-0000-0000-000000000004"};

test("fleet documents and profile are restricted to the active linked fleet",async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create table public.proveedores(id bigint primary key,titular_id uuid,tipo text,activo boolean);
      create table public.drivers(id uuid primary key,nombre text,codigo text,estatus text,rol text,proveedor_id bigint,telefono text,correo_contacto text);
      create table public.vehiculos(id bigint,driver_id uuid,placas text,tipo text,marca_modelo text,activo boolean);
      create table public.licencias(driver_id uuid,numero text,tipo text,vigencia date);
      create table public.driver_documents(id uuid default gen_random_uuid(),driver_id uuid,tipo text,storage_path text, vigencia date,estado text,origen text,resuelto_en timestamptz);
      create table storage.objects(bucket_id text,name text);
      alter table public.driver_documents enable row level security;
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated;
      grant select on public.driver_documents,storage.objects to authenticated;
      create policy own_files on storage.objects for select to authenticated using (split_part(name,'/',1)=auth.uid()::text);
    `);
    await db.query("insert into public.drivers(id,nombre,estatus,rol,proveedor_id) values ($1,'owner','activo','flotillero',1),($2,'driver','activo','driver',1),($3,'other','activo','driver',2),($4,'ops','activo','ops',null)",Object.values(ids));
    await db.query("insert into public.proveedores values (1,$1,'flotillero',true),(2,$2,'independiente',true)",[ids.owner,ids.other]);
    await db.exec(fs.readFileSync(path.join(__dirname,"..","perfil-flotilla-aprobaciones.sql"),"utf8"));
    for (const [tipo,tarifa] of [["Moto","Moto"],["Auto hatch","Sedan"],["Auto sedan","Sedan"],["Small van","Small"],["Large van","Large"],["3.5T","3.5T"],["4.5T",null],["5T",null],["RABÓN",null],["TORTON SECO",null],["TORTON REFRIGERADO",null],["TRAILER 53 SECO",null],["TRAILER 53 REFRIGERADO",null]]) {
      assert.equal((await db.query("select public.categoria_tarifaria_vehiculo($1) as tarifa",[tipo])).rows[0].tarifa,tarifa);
    }
    const first=`${ids.driver}/ine/flotilla/${ids.owner}/first.pdf`,second=`${ids.driver}/ine/flotilla/${ids.owner}/second.pdf`;
    await db.query("insert into storage.objects values ('driver-documents',$1),('driver-documents',$2)",[first,second]);
    await db.exec("set role authenticated");
    const user=id=>db.query("select set_config('test.uid',$1,false)",[id]);
    await user(ids.owner);
    assert.equal((await db.query("select public.perfil_driver_de_flotilla($1) as p",[ids.driver])).rows[0].p.nombre,"driver");
    await assert.rejects(db.query("select public.perfil_driver_de_flotilla($1)",[ids.other]),/permiso/);
    assert.equal((await db.query("select public.enviar_documento_flotillero($1,'ine',$2,'2030-01-01') as estado",[ids.driver,first])).rows[0].estado,"aprobado");
    assert.equal((await db.query("select public.enviar_documento_flotillero($1,'ine',$2,'2031-01-01') as estado",[ids.driver,second])).rows[0].estado,"pendiente");
    assert.equal((await db.query("select count(*)::int as n from public.driver_documents where estado='aprobado'")).rows[0].n,1);
    await assert.rejects(db.query("select public.enviar_documento_flotillero($1,'estado_cuenta',$2,null)",[ids.driver,first]),/invalido/);
    assert.equal((await db.query("select count(*)::int as n from storage.objects")).rows[0].n,2);
    await user(ids.driver);
    assert.equal((await db.query("select count(*)::int as n from storage.objects")).rows[0].n,2);
    await user(ids.other);
    assert.equal((await db.query("select count(*)::int as n from public.driver_documents")).rows[0].n,0);
    await assert.rejects(db.query("select public.perfil_driver_de_flotilla($1)",[ids.driver]),/permiso/);
    await db.exec("reset role; update public.proveedores set activo=false where id=1; set role authenticated");
    await user(ids.owner);
    assert.equal((await db.query("select count(*)::int as n from storage.objects")).rows[0].n,0);
  }finally{await db.close()}
});
