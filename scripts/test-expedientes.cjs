const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { PGlite } = require("@electric-sql/pglite");
const root=path.resolve(__dirname,"..");
const ops=fs.readFileSync(path.join(root,"ops.js"),"utf8");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
const escapeFunction=ops.slice(0,ops.indexOf("\n"));

test("affiliate query specifies the driver provider relationship",()=>{
  assert.match(ops,/proveedores!drivers_proveedor_id_fkey\(nombre,tipo\)/);
});

test("documents view lists all affiliates and preserves document history",()=>{
  const c=vm.createContext({ROL:"ops",esOps:()=>true,DOCDRIVERSERR:"",DOCOPSERR:"",DOCOPS:[
    {driver_id:"a",tipo:"seguro",estado:"aprobado",vigencia:"2099-01-01",drivers:{nombre:"Ana"}},
    {driver_id:"a",tipo:"ine",estado:"rechazado",vigencia:"2099-01-01",drivers:{nombre:"Ana"}}
  ],DOCDRIVERS:[
    {id:"a",nombre:"Ana",rol:"driver",proveedores:{tipo:"independiente"}},
    {id:"b",nombre:"Bruno",rol:"driver",proveedores:{tipo:"flotillero"}},
    {id:"c",nombre:"Carla",rol:"flotillero"},
    {id:"d",nombre:"Sin proveedor",rol:"driver"}
  ]});
  vm.runInContext(escapeFunction+"\n"+ops.slice(ops.indexOf("const DOC_OPS_TIPOS="),ops.indexOf("async function importarDocumentoFlota()")),c);
  const html=vm.runInContext("vistaDocumentosOps()",c);
  assert.match(html,/Ana/);assert.match(html,/Bruno/);assert.match(html,/Carla/);
  assert.match(html,/Driver independiente/);assert.match(html,/Driver de flotillero/);assert.match(html,/Flotillero/);
  assert.match(html,/Comprobante de domicilio: sin registrar/);
  assert.match(html,/Constancia de situación fiscal: sin registrar/);
  assert.match(html,/rechazado/);
  assert.equal(vm.runInContext("tiposExpediente(DOCDRIVERS[0]).length",c),5);
  assert.equal(vm.runInContext("tiposExpediente(DOCDRIVERS[2]).length",c),7);
});

test("finance sees only read-only fiscal and bank document view",()=>{
  const c=vm.createContext({ROL:"finanzas",esOps:()=>false,DOCOPSERR:"",DOCOPS:[
    {nombre:"<Flotillero>",tipo:"estado_cuenta",estado:"aprobado",url:"https://example.test/a"}
  ]});
  vm.runInContext(escapeFunction+"\n"+ops.slice(ops.indexOf("const DOC_OPS_TIPOS="),ops.indexOf("async function importarDocumentoFlota()")),c);
  const html=vm.runInContext("vistaDocumentosOps()",c);
  assert.match(html,/&lt;Flotillero&gt;/);
  assert.match(html,/Estado de cuenta/);
  assert.doesNotMatch(html,/data-doc-approve|data-doc-reject|doc-flota-save/);
});

test("driver app selects required documents according to role and handles no-expiry documents",()=>{
  const c=vm.createContext({DRIVER:{rol:"driver"}});
  vm.runInContext(app.slice(app.indexOf("const DOC_TIPOS="),app.indexOf("async function loadDocs()")),c);
  assert.equal(vm.runInContext("docTiposActuales().length",c),5);
  vm.runInContext("DRIVER.rol='flotillero'",c);
  assert.equal(vm.runInContext("docTiposActuales().length",c),7);
  assert.equal(vm.runInContext("estadoDoc({vigencia:null}).txt",c),"Sin vencimiento");
});

test("driver app sends files through the approval-aware function and reports the resulting state",async()=>{
  for(const status of ["aprobado","pendiente"]){
    const els={
      "doc-upload-cancel":{},"doc-upload":{},
      "doc-file":{files:[{name:"identificacion.pdf",type:"application/pdf",size:10}]},
      "doc-date":{value:"2030-01-01"},"doc-upload-error":{},
      sheet:{classList:{add(){}}}
    };
    const calls=[],messages=[];
    const c=vm.createContext({
      DOCS:[],ME:{id:"driver-id"},crypto:{randomUUID:()=>"test-id"},
      docTiposActuales:()=>[{k:"ine"}],docTypeName:()=>"INE",
      abrirSheet(){},$:id=>els[id],toast:m=>messages.push(m),loadDocs:async()=>{},
      sb:{storage:{from:()=>({upload:async(p)=>{calls.push(["upload",p]);return {error:null}}})},
        rpc:async(name,args)=>{calls.push([name,args]);return {data:status,error:null}}}
    });
    vm.runInContext(escapeFunction+"\n"+app.slice(app.indexOf("function abrirCargaDocumento("),app.indexOf("\ndrawDocs();",app.indexOf("function abrirCargaDocumento("))),c);
    vm.runInContext('abrirCargaDocumento("ine")',c);
    await els["doc-upload"].onclick();
    assert.equal(calls[1][0],"enviar_documento_driver");
    assert.equal(calls[1][1].p_storage_path,"driver-id/ine/test-id.pdf");
    assert.match(messages[0],status==="aprobado"?/vigente/:/Operaciones/);
  }
});

test("document migration enforces roles, no-expiry rules and preserves existing documents",async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create table public.drivers(id uuid primary key,rol text);
      create table storage.objects(bucket_id text,name text);
      create table public.driver_documents(
        id uuid primary key default gen_random_uuid(),driver_id uuid references public.drivers(id),
        tipo text constraint driver_documents_tipo_check check(tipo in ('seguro','licencia','tarjeta','ine')),
        storage_path text, vigencia date not null,estado text,origen text,creado_en timestamptz,resuelto_en timestamptz,resuelto_por uuid
      );
      create function public.puede_gestionar_documentos_driver() returns boolean language sql stable as $$ select current_setting('test.role',true)='ops' $$;
      create function public.registrar_documento_flota(uuid,text,text,date) returns uuid language sql as $$ select null::uuid $$;
      alter table public.driver_documents enable row level security;
      grant usage on schema public,auth,storage to authenticated;
      grant select on public.drivers to authenticated;
      grant insert,select on public.driver_documents to authenticated;
      select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
      select set_config('test.role','ops',false);
      insert into public.drivers values ('00000000-0000-0000-0000-000000000002','driver'),('00000000-0000-0000-0000-000000000003','flotillero');
      insert into public.driver_documents(driver_id,tipo,storage_path,vigencia,estado,origen) values
        ('00000000-0000-0000-0000-000000000002','ine','old','2030-01-01','aprobado','flota');
      insert into storage.objects values ('driver-documents','00000000-0000-0000-0000-000000000003/estado_cuenta/file');
    `);
    await db.exec(fs.readFileSync(path.join(root,"expedientes-afiliados.sql"),"utf8"));
    await db.query("select public.registrar_documento_flota($1,$2,$3,$4)",["00000000-0000-0000-0000-000000000003","estado_cuenta","00000000-0000-0000-0000-000000000003/estado_cuenta/file",null]);
    await assert.rejects(db.query("select public.registrar_documento_flota($1,$2,$3,$4)",["00000000-0000-0000-0000-000000000002","estado_cuenta","00000000-0000-0000-0000-000000000002/estado_cuenta/file",null]),/categoria/);
    await assert.rejects(db.query("select public.registrar_documento_flota($1,$2,$3,$4)",["00000000-0000-0000-0000-000000000003","licencia","x",null]),/vigencia/);
    assert.equal((await db.query("select count(*)::int as n from public.driver_documents where storage_path='old' and estado='aprobado'")).rows[0].n,1);
    await db.exec("select set_config('test.uid','00000000-0000-0000-0000-000000000002',false); set role authenticated");
    await assert.rejects(db.exec("insert into public.driver_documents(driver_id,tipo,storage_path,vigencia,estado,origen) values ('00000000-0000-0000-0000-000000000002','estado_cuenta','00000000-0000-0000-0000-000000000002/estado_cuenta/x',null,'pendiente','driver')"),/row-level security/);
    await db.exec("insert into public.driver_documents(driver_id,tipo,storage_path,vigencia,estado,origen) values ('00000000-0000-0000-0000-000000000002','domicilio','00000000-0000-0000-0000-000000000002/domicilio/x',null,'pendiente','driver')");
    await db.exec("select set_config('test.uid','00000000-0000-0000-0000-000000000003',false)");
    await db.exec("insert into public.driver_documents(driver_id,tipo,storage_path,vigencia,estado,origen) values ('00000000-0000-0000-0000-000000000003','estado_cuenta','00000000-0000-0000-0000-000000000003/estado_cuenta/x',null,'pendiente','driver')");
  }finally{await db.close()}
});
