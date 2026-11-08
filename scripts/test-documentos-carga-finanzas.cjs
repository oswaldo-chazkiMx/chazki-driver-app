const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PGlite}=require("@electric-sql/pglite");
const root=path.resolve(__dirname,"..");
const driver="00000000-0000-0000-0000-000000000001";
const fleet="00000000-0000-0000-0000-000000000002";
const ops="00000000-0000-0000-0000-000000000003";
const finance="00000000-0000-0000-0000-000000000004";
const supervisor="00000000-0000-0000-0000-000000000005";

test("first uploads, replacement review and finance access are enforced by the database",async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create table public.drivers(id uuid primary key,nombre text,codigo text,rol text);
      create table storage.objects(bucket_id text,name text);
      create table public.driver_documents(
        id uuid primary key default gen_random_uuid(),driver_id uuid references public.drivers(id),
        tipo text,storage_path text unique,vigencia date,estado text,origen text,
        creado_en timestamptz default now(),resuelto_en timestamptz,resuelto_por uuid,nota text
      );
      create unique index one_pending on public.driver_documents(driver_id,tipo) where estado='pendiente';
      create function public.puede_gestionar_documentos_driver() returns boolean language sql stable security definer as $$
        select exists(select 1 from public.drivers where id=auth.uid() and rol in ('ops','master'))
      $$;
      create function public.registrar_documento_flota(uuid,text,text,date) returns uuid language sql as $$ select null::uuid $$;
      create function public.resolver_documento_driver(uuid,boolean,text) returns text language sql as $$ select null::text $$;
      alter table public.driver_documents enable row level security;
      alter table storage.objects enable row level security;
      create policy document_own_ops on public.driver_documents for select to authenticated
        using(driver_id=auth.uid() or public.puede_gestionar_documentos_driver());
      create policy storage_own_ops on storage.objects for select to authenticated
        using(split_part(name,'/',1)=auth.uid()::text or public.puede_gestionar_documentos_driver());
      grant usage on schema public,auth,storage to authenticated;
      grant select on public.driver_documents,storage.objects to authenticated;
      grant execute on function public.resolver_documento_driver(uuid,boolean,text) to authenticated;
      grant execute on function public.registrar_documento_flota(uuid,text,text,date) to authenticated;
    `);
    await db.query("insert into public.drivers values ($1,'Driver','D1','driver'),($2,'Flotillero','F1','flotillero'),($3,'Operaciones','O1','ops'),($4,'Finanzas','F2','finanzas'),($5,'Supervisor','S1','ih')",[driver,fleet,ops,finance,supervisor]);
    const file=(id,type,n)=>`${id}/${type}/${n}`;
    for(const [id,type,n] of [[driver,"ine","first"],[driver,"ine","second"],[driver,"ine","third"],[driver,"ine","fourth"],[driver,"estado_cuenta","forbidden"],[fleet,"estado_cuenta","first"],[fleet,"constancia_fiscal","first"],[fleet,"licencia","first"]]){
      await db.query("insert into storage.objects values ('driver-documents',$1)",[file(id,type,n)]);
    }
    await db.exec(fs.readFileSync(path.join(root,"documentos-carga-y-finanzas.sql"),"utf8"));
    await db.exec("set role authenticated");
    const user=async id=>db.query("select set_config('test.uid',$1,false)",[id]);
    const send=(type,path,date)=>db.query("select public.enviar_documento_driver($1,$2,$3) as estado",[type,path,date]);
    await user(driver);
    assert.equal((await send("ine",file(driver,"ine","first"),"2030-01-01")).rows[0].estado,"aprobado");
    assert.equal((await send("ine",file(driver,"ine","second"),"2031-01-01")).rows[0].estado,"pendiente");
    await assert.rejects(send("ine",file(driver,"ine","third"),"2032-01-01"),/pendiente/);
    await assert.rejects(send("estado_cuenta",file(driver,"estado_cuenta","forbidden"),null),/invalido/);
    await assert.rejects(send("ine",file(fleet,"licencia","first"),"2030-01-01"),/ruta/);
    const pending=(await db.query("select id from public.driver_documents where driver_id=$1 and estado='pendiente'",[driver])).rows[0].id;
    await assert.rejects(db.query("select public.resolver_documento_driver($1,true,null)",[pending]),/Solo Operaciones/);
    await user(ops);
    assert.equal((await db.query("select public.resolver_documento_driver($1,false,'Revisar') as estado",[pending])).rows[0].estado,"rechazado");
    assert.equal((await db.query("select count(*)::int as n from public.driver_documents where driver_id=$1 and estado='aprobado'",[driver])).rows[0].n,1);
    await user(driver);
    assert.equal((await send("ine",file(driver,"ine","third"),"2032-01-01")).rows[0].estado,"pendiente");
    const second=(await db.query("select id from public.driver_documents where driver_id=$1 and estado='pendiente'",[driver])).rows[0].id;
    await user(ops);
    await db.query("select public.resolver_documento_driver($1,true,null)",[second]);
    assert.equal((await db.query("select count(*)::int as n from public.driver_documents where driver_id=$1 and estado='aprobado' and storage_path=$2",[driver,file(driver,"ine","third")])).rows[0].n,1);
    await user(fleet);
    assert.equal((await send("estado_cuenta",file(fleet,"estado_cuenta","first"),null)).rows[0].estado,"aprobado");
    assert.equal((await send("constancia_fiscal",file(fleet,"constancia_fiscal","first"),null)).rows[0].estado,"aprobado");
    assert.equal((await send("licencia",file(fleet,"licencia","first"),"2030-01-01")).rows[0].estado,"aprobado");
    await user(finance);
    assert.deepEqual((await db.query("select tipo from public.driver_documents order by tipo")).rows.map(x=>x.tipo),["constancia_fiscal","estado_cuenta"]);
    assert.deepEqual((await db.query("select tipo from public.listar_documentos_finanzas() order by tipo")).rows.map(x=>x.tipo),["constancia_fiscal","estado_cuenta"]);
    assert.equal((await db.query("select count(*)::int as n from storage.objects")).rows[0].n,2);
    await assert.rejects(db.query("select public.resolver_documento_driver($1,true,null)",[second]),/Solo Operaciones/);
    await assert.rejects(db.query("select public.registrar_documento_flota($1,'ine',$2,'2030-01-01')",[driver,file(driver,"ine","fourth")]),/Solo Operaciones/);
    await user(supervisor);
    assert.equal((await db.query("select count(*)::int as n from public.driver_documents")).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int as n from storage.objects")).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int as n from public.listar_documentos_finanzas()")).rows[0].n,0);
  }finally{await db.close()}
});
