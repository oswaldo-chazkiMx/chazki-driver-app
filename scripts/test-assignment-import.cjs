const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {PGlite}=require("@electric-sql/pglite");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"ops.js"),"utf8");
const migration=fs.readFileSync(path.join(root,"operational-assignments-by-email.sql"),"utf8");
const ids={
  master:"00000000-0000-0000-0000-000000000001",
  supervisor:"00000000-0000-0000-0000-000000000002",
  coordinator1:"00000000-0000-0000-0000-000000000003",
  coordinator2:"00000000-0000-0000-0000-000000000004"
};
const row=(cedis,coordinator)=>({
  CLIENTE:"Cliente Uno",CEDIS:cedis,
  "CORREO SUPERVISOR":" SUPERVISOR@CHAZKI.COM ",
  "CORREO COORDINADOR":coordinator,
  SUPERVISOR:"Nombre que no debe usarse",
  "COORDINADOR ASIGNADO":"Otro nombre",
  CORREOS:"faltante@chazki.com"
});

test("one supervisor imports different coordinators independently despite missing accounts and invalid rows",async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.uid',true),'')::uuid
      $$;
      create function public.mi_acceso_administrativo() returns boolean language sql stable as $$
        select current_setting('test.role',true) in ('master','ops','ih','coordinador')
      $$;
      create function public.operativo_rol_actual() returns text language sql stable as $$
        select current_setting('test.role',true)
      $$;
      create table public.drivers(id uuid primary key,nombre text,rol text);
      create table auth.users(id uuid primary key,email text);
      create table public.clientes(id bigint primary key,nombre text);
      create table public.cedis(id bigint primary key,cliente_id bigint,nombre text);
      create table public.asignaciones_operativas(
        cliente_id bigint references public.clientes(id),cedis_id bigint references public.cedis(id),
        supervisor_id uuid references public.drivers(id),coordinador_id uuid references public.drivers(id),
        actualizado_en timestamptz not null default now(),primary key(cliente_id,cedis_id)
      );
      insert into public.drivers values
        ('${ids.master}','Master','master'),
        ('${ids.supervisor}','Nombre repetido','ih'),
        ('${ids.coordinator1}','Nombre repetido','coordinador'),
        ('${ids.coordinator2}','Nombre repetido','coordinador');
      insert into auth.users values
        ('${ids.supervisor}','supervisor@chazki.com'),
        ('${ids.coordinator1}','uno@chazki.com'),
        ('${ids.coordinator2}','dos@chazki.com');
      insert into public.clientes values(1,'Cliente Uno'),(2,'Cliente Dos');
      insert into public.cedis values
        (10,1,'Norte'),(11,1,'Sur'),(12,1,'Centro'),(13,1,'Restringido'),(14,1,'Sin cuenta'),(20,2,'Norte');
      insert into public.asignaciones_operativas(cliente_id,cedis_id,supervisor_id,coordinador_id)
        values (1,11,'${ids.supervisor}','${ids.coordinator1}');
      select set_config('test.uid','${ids.master}',false);
      select set_config('test.role','master',false);
    `);
    const base=fs.readFileSync(path.join(root,"operational-responsibility-approvals.sql"),"utf8");
    await db.exec(base.slice(base.indexOf("create or replace function public.operativo_normalizar("),base.indexOf("create or replace function public.operativo_rol_actual(")));
    await db.exec(migration);
    await db.exec(migration);
    const importRows=async rows=>(await db.query("select public.importar_asignaciones_por_correo($1::jsonb) as result",[JSON.stringify(rows)])).rows[0].result;
    const result=await importRows([
      row("Norte","uno@chazki.com"),
      row("Sur","no-existe@chazki.com"),
      row("Centro","dos@chazki.com"),
      {...row("Norte","DOS@CHAZKI.COM"),CLIENTE:"Cliente Dos"},
      row("Sin cuenta","")
    ]);
    assert.equal(result.importadas,3);
    assert.equal(result.errores.length,2);
    assert.deepEqual(result.errores.map(x=>[x.fila,x.supervisor_resuelto,x.coordinador_resuelto]),[[3,true,false],[6,true,false]]);
    const assignments=(await db.query("select cliente_id,cedis_id,supervisor_id,coordinador_id from public.asignaciones_operativas order by cliente_id,cedis_id")).rows;
    assert.deepEqual(assignments.map(x=>[Number(x.cliente_id),Number(x.cedis_id),x.coordinador_id]),[
      [1,10,ids.coordinator1],[1,11,ids.coordinator1],[1,12,ids.coordinator2],[2,20,ids.coordinator2]
    ]);
    assert.ok(assignments.every(x=>x.supervisor_id===ids.supervisor));
    const corrected=await importRows([row("Sur","dos@chazki.com")]);
    assert.deepEqual(corrected,{importadas:1,errores:[]});
    const invalid=await importRows([row("Norte","supervisor@chazki.com"),row("No existe","uno@chazki.com")]);
    assert.equal(invalid.importadas,0);
    assert.equal(invalid.errores[0].coordinador_resuelto,false);
    assert.equal(invalid.errores[1].cedis_resuelto,false);
    await db.exec("alter table public.asignaciones_operativas add constraint test_restricted check (cedis_id <> 13)");
    const isolated=await importRows([row("Restringido","uno@chazki.com"),row("Centro","uno@chazki.com")]);
    assert.equal(isolated.importadas,1);
    assert.match(isolated.errores[0].motivo,/test_restricted/);
    const old=(await db.query("select public.importar_asignaciones_operativas($1::jsonb) as result",[JSON.stringify([row("Centro","dos@chazki.com")])])).rows[0].result;
    assert.deepEqual(old,{importadas:1,errores:[]});
    await assert.rejects(importRows(null),/lista de hasta/);
    await assert.rejects(importRows({}),/lista de hasta/);
    await assert.rejects(importRows(Array(5001).fill({})),/lista de hasta/);
    for(const role of ["ops","ih","coordinador","driver",""]){
      await db.query("select set_config('test.role',$1,false)",[role]);
      await assert.rejects(importRows([row("Norte","uno@chazki.com")]),/Solo la cuenta maestra/);
    }
    await db.exec("select set_config('test.role','master',false);select set_config('test.uid','',false)");
    await assert.rejects(importRows([]),/Solo la cuenta maestra/);
    const grants=(await db.query(`select
      has_function_privilege('anon','public.importar_asignaciones_por_correo(jsonb)','execute') as anon,
      has_function_privilege('authenticated','public.importar_asignaciones_por_correo(jsonb)','execute') as authenticated
    `)).rows[0];
    assert.deepEqual(grants,{anon:false,authenticated:true});
  }finally{await db.close()}
});

test("CSV preserves independent rows for the same supervisor and ignores contact/name columns",()=>{
  const ctx=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf("function parseCsvTable("),source.indexOf("const normTxt=")),ctx);
  ctx.csv='CLIENTE;CEDIS;SUPERVISOR;COORDINADOR ASIGNADO;CORREO SUPERVISOR;CORREO COORDINADOR;CORREOS\nCliente Uno;Norte;Nombres;Otros;supervisor@chazki.com;uno@chazki.com;faltante@chazki.com\nCliente Uno;Sur;Nombres;Otros;supervisor@chazki.com;no-existe@chazki.com;\nCliente Dos;Norte;Nombres;Otros;supervisor@chazki.com;dos@chazki.com;';
  const parsed=vm.runInContext("parseCsvTable(csv)",ctx);
  assert.equal(parsed.length,3);
  assert.deepEqual(Array.from(parsed,x=>x["CORREO COORDINADOR"]),["uno@chazki.com","no-existe@chazki.com","dos@chazki.com"]);
  assert.ok(parsed.every(x=>x["CORREO SUPERVISOR"]==="supervisor@chazki.com"));
  assert.ok(parsed.every(x=>!("CORREOS" in x)&&!("SUPERVISOR" in x)));
});

test("UI calls explicit email RPC and reports missing migration and malformed results",async()=>{
  const elements={
    "asignaciones-csv":{files:[{size:10,text:async()=>"csv"}]},
    "asignaciones-error":{innerHTML:""},
    "asignaciones-import":{disabled:false}
  };
  const calls=[];
  const ctx=vm.createContext({
    $:id=>elements[id],parseCsvTable:()=>[row("Norte","uno@chazki.com")],
    sb:{rpc:async(name,args)=>{calls.push([name,args]);return {data:{importadas:1,errores:[]},error:null}}},
    cargarAsignacionesEquipo:async()=>{},render(){},toast(){}
  });
  vm.runInContext(source.slice(0,source.indexOf("\n"))+"\n"+source.slice(source.indexOf("async function importarAsignaciones("),source.indexOf("async function resolverCambioTarifario(")),ctx);
  await vm.runInContext("importarAsignaciones()",ctx);
  assert.equal(calls[0][0],"importar_asignaciones_por_correo");
  assert.equal(elements["asignaciones-import"].disabled,false);
  ctx.sb.rpc=async()=>({data:null,error:{code:"PGRST202",message:"Function not found"}});
  await vm.runInContext("importarAsignaciones()",ctx);
  assert.match(elements["asignaciones-error"].innerHTML,/operational-assignments-by-email.sql/);
  ctx.sb.rpc=async()=>({data:null,error:null});
  await vm.runInContext("importarAsignaciones()",ctx);
  assert.match(elements["asignaciones-error"].innerHTML,/respuesta inválida/);
  assert.equal(elements["asignaciones-import"].disabled,false);
});
