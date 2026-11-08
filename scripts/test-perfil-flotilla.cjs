const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PGlite}=require("@electric-sql/pglite");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8");
const ops=fs.readFileSync(path.join(__dirname,"..","ops.js"),"utf8");
const ids={owner:"00000000-0000-0000-0000-000000000001",driver:"00000000-0000-0000-0000-000000000002",other:"00000000-0000-0000-0000-000000000003",ops:"00000000-0000-0000-0000-000000000004"};

test("fleet profile is read-only and shows linked driver document actions",async()=>{
  const sheet={classList:{add(){}},querySelectorAll:()=>[]},elements={"sheet":sheet,"fleet-profile-close":{}, "fleet-profile-error":{}};
  const context=vm.createContext({
    DOC_TIPOS:[{k:"ine",n:"INE"},{k:"estado_cuenta",n:"Estado de cuenta",soloFlotillero:true}],
    $:id=>elements[id],abrirSheet:html=>{context.html=html},toast(){},
    sb:{rpc:async()=>({data:{nombre:"<Driver>",telefono:"555",vehiculo:{placas:"ABC"}},error:null}),
      from:()=>({select:()=>({eq:()=>({order:async()=>({data:[],error:null})})})})}
  });
  vm.runInContext(app.slice(0,app.indexOf("\n"))+"\n"+app.slice(app.indexOf("async function abrirPerfilDriver("),app.indexOf("\nconst EST=",app.indexOf("async function abrirPerfilDriver("))),context);
  await vm.runInContext('abrirPerfilDriver("driver")',context);
  assert.match(context.html,/&lt;Driver&gt;/);
  assert.match(context.html,/data-fleet-doc="ine"/);
  assert.doesNotMatch(context.html,/estado_cuenta|<input/);
});

test("vehicle types without an equivalence never suggest another type's rate",()=>{
  const context=vm.createContext({cuentaDe:()=>"MELI",TAR:[
    {cuenta:"MELI",tipo_unidad:"Sedan",ubicacion:"CEDIS",vigencia_desde:"2000-01-01",activo:true},
    {cuenta:"MELI",tipo_unidad:"5T",ubicacion:"CEDIS",vigencia_desde:"2000-01-01",activo:true},
    {cuenta:"MELI",tipo_unidad:"RABÓN",ubicacion:"CEDIS",vigencia_desde:"2000-01-01",activo:false}
  ]});
  const nz=ops.slice(ops.indexOf("const nz="),ops.indexOf("\n",ops.indexOf("const nz=")));
  const sugeridas=ops.slice(ops.indexOf("const tiposSinEquivalencia="),ops.indexOf("\nconst filaRes=",ops.indexOf("function sugeridas(")));
  vm.runInContext(nz+"\n"+sugeridas,context);
  const route=tipo=>({tipo_unidad:tipo,checkin_at:"2025-01-01T12:00:00Z",cedis:{nombre:"CEDIS",clientes:{nombre:"MELI"}}});
  const missing=context.sugeridas(route("RABÓN"),true);
  assert.equal(missing.l.length,0);assert.match(missing.nota,/No hay tarifa vigente para RABÓN/);
  assert.deepEqual(Array.from(context.sugeridas(route("5T"),true).l,t=>t.tipo_unidad),["5T"]);
  assert.equal(context.sugeridas(route("Sedan"),true).l.length,3);
});

test("Coppel routes retain the registered type when it has no tariff equivalence",()=>{
  const context=vm.createContext({VEHICULO:{tipo:"5T"},DRIVER:{},$:()=>({value:"3.5T"}),esCoppel:()=>true});
  vm.runInContext(app.slice(app.indexOf("const TIPOS_SIN_EQUIVALENCIA="),app.indexOf("\nfunction syncUnidad()")),context);
  assert.equal(vm.runInContext("tipoUnidadRuta()",context),"5T");
  context.VEHICULO={tipo:"Sedan"};
  assert.equal(vm.runInContext("tipoUnidadRuta()",context),"3.5T");
});

test("profile forms submit vehicle and license requests through approval-aware RPCs",async()=>{
  const elements={"edit-vehicle":{},"edit-license":{},"save-contact":{},"sheet":{classList:{add(){}}},
    "vp-placas":{value:"ABC"},"vp-tipo":{value:"RABÓN"},"vp-marca":{value:"Camión"},
    "vp-save":{},"vp-error":{},"vp-cancel":{},
    "lp-numero":{value:"123"},"lp-tipo":{value:"A"},"lp-vigencia":{value:"2030-01-01"},
    "lp-save":{},"lp-error":{},"lp-cancel":{}};
  const calls=[];
  const context=vm.createContext({$:id=>elements[id],VEHICULO:null,
    esc:x=>String(x),abrirSheet:html=>{context.html=html},toast(){},err(){},
    sb:{rpc:async(name,args)=>{calls.push({name,args});return {data:"pendiente",error:null}}}
  });
  vm.runInContext(app.slice(app.indexOf("let LICENCIA=null;"),app.indexOf("\nconst DOC_TIPOS=")),context);
  vm.runInContext("loadPerfil=async()=>{}",context);
  elements["edit-vehicle"].onclick();
  assert.match(context.html,/RABÓN/);assert.match(context.html,/TORTON SECO/);
  await elements["vp-save"].onclick();
  assert.equal(calls[0].name,"solicitar_vehiculo_perfil");
  assert.equal(calls[0].args.p_tipo,"RABÓN");
  elements["edit-license"].onclick();
  await elements["lp-save"].onclick();
  assert.equal(calls[1].name,"solicitar_licencia_perfil");
  assert.equal(calls[1].args.p_vigencia,"2030-01-01");
});

test("fleet documents and profile are restricted to the active linked fleet",async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage; create schema private;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function private.es_ops() returns boolean language sql stable security definer as $$ select auth.uid() = '00000000-0000-0000-0000-000000000004'::uuid $$;
      create function private.es_master() returns boolean language sql stable as $$ select false $$;
      create function public.puede_gestionar_documentos_driver() returns boolean language sql stable security definer as $$ select private.es_ops() $$;
      create function public.actualizar_contacto_driver(p_telefono text,p_correo_contacto text) returns boolean language sql as $$ select true $$;
      create table public.proveedores(id bigint primary key,titular_id uuid,tipo text,activo boolean);
      create table public.drivers(id uuid primary key,nombre text,codigo text,estatus text,rol text,proveedor_id bigint,telefono text,correo_contacto text);
      create table public.vehiculos(id bigint generated always as identity primary key,driver_id uuid,placas text,tipo text,marca_modelo text,activo boolean);
      create table public.licencias(driver_id uuid primary key,numero text,tipo text,vigencia date);
      create table public.cambios_perfil(id bigint generated always as identity primary key,driver_id uuid,datos jsonb,anterior jsonb,estatus text default 'pendiente',resuelto_por uuid,resuelto_en timestamptz,nota text);
      create table public.tarifas(id bigint primary key,tipo_unidad text,activo boolean,vigencia_desde date,vigencia_hasta date);
      create table public.rutas(id bigint primary key,tipo_unidad text,checkin_at timestamptz);
      create table public.no_show_casos(tipo_unidad text,tarifa_servicio_id bigint,tarifa_no_show_id bigint,fecha_servicio date);
      create table public.reglas_penalizacion(tipo_unidad text);
      create function public.crear_reporte_no_show(p_driver_id uuid,p_cedis_id bigint,p_fecha_servicio date,p_observaciones text,p_entregas_contratadas integer,p_monto_manual numeric)
      returns uuid language plpgsql as $$ declare v_driver record; begin
        select p_observaciones as tipo_unidad into v_driver;
        perform 1 from public.tarifas t where regexp_replace(upper(coalesce(t.tipo_unidad, '')), '[^A-Z0-9]', '', 'g')
          = regexp_replace(upper(v_driver.tipo_unidad), '[^A-Z0-9]', '', 'g');
        perform 1 from public.tarifas t where regexp_replace(upper(coalesce(t.tipo_unidad, '')), '[^A-Z0-9]', '', 'g')
          = regexp_replace(upper(v_driver.tipo_unidad), '[^A-Z0-9]', '', 'g');
        perform 1 from public.reglas_penalizacion g where (g.tipo_unidad is null or regexp_replace(upper(g.tipo_unidad), '[^A-Z0-9]', '', 'g')
          = regexp_replace(upper(v_driver.tipo_unidad), '[^A-Z0-9]', '', 'g'));
        return p_driver_id;
      end $$;
      create function private.calc_liquidacion(p_ruta_id bigint,p_tarifa_id bigint,p_registro text,p_excepcion boolean,p_ajuste_pago numeric,p_ajuste_cobro numeric)
      returns jsonb language plpgsql stable as $$ declare t record; begin
        select * into t from public.tarifas where id=p_tarifa_id;
        if not found then raise exception 'Tarifa no encontrada'; end if;
        return jsonb_build_object('tarifa',t.id);
      end $$;
      create table public.driver_documents(id uuid default gen_random_uuid(),driver_id uuid,tipo text,storage_path text, vigencia date,estado text,origen text,resuelto_en timestamptz);
      create table storage.objects(bucket_id text,name text);
      alter table public.driver_documents enable row level security;
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated;
      grant select on public.driver_documents,storage.objects to authenticated;
      grant select,update on public.drivers to authenticated;
      create policy own_files on storage.objects for select to authenticated using (split_part(name,'/',1)=auth.uid()::text);
    `);
    await db.query("insert into public.drivers(id,nombre,estatus,rol,proveedor_id) values ($1,'owner','activo','flotillero',1),($2,'driver','activo','driver',1),($3,'other','activo','driver',2),($4,'ops','activo','ops',null)",Object.values(ids));
    await db.query("insert into public.proveedores values (1,$1,'flotillero',true),(2,$2,'independiente',true)",[ids.owner,ids.other]);
    await db.exec(fs.readFileSync(path.join(__dirname,"..","perfil-flotilla-aprobaciones.sql"),"utf8"));
    await db.exec(fs.readFileSync(path.join(__dirname,"..","perfil-flotilla-aprobaciones.sql"),"utf8"));
    assert.equal((await db.query("select private.coincide_tipo_tarifa_perfil('RABÓN','RABON') as coincide")).rows[0].coincide,true);
    assert.equal((await db.query("select private.coincide_tipo_tarifa_perfil('4.5T','45T') as coincide")).rows[0].coincide,false);
    assert.equal((await db.query("select private.coincide_tipo_tarifa_perfil('Sedan','SEDAN') as coincide")).rows[0].coincide,true);
    const body=(await db.query("select pg_get_functiondef('public.crear_reporte_no_show(uuid,bigint,date,text,integer,numeric)'::regprocedure) as def")).rows[0].def;
    assert.equal((body.match(/private\.coincide_tipo_tarifa_perfil/g)||[]).length,3);
    await db.query("select public.crear_reporte_no_show($1,1,'2025-01-01','5T',null,null)",[ids.driver]);
    await db.exec(`insert into public.tarifas values
      (1,'Sedan',true,'2020-01-01',null),(2,'5T',true,'2020-01-01',null),
      (3,'5T',false,'2020-01-01',null),(4,'RABON',true,'2020-01-01',null);
      insert into public.rutas values (1,'5T','2025-01-01T12:00:00Z'),(2,'Sedan','2025-01-01T12:00:00Z')`);
    await assert.rejects(db.query("select private.calc_liquidacion(1,1,'',false,0,0)"),/No hay tarifa activa/);
    await assert.rejects(db.query("select private.calc_liquidacion(1,3,'',false,0,0)"),/No hay tarifa activa/);
    assert.equal((await db.query("select private.calc_liquidacion(1,2,'',false,0,0) as resultado")).rows[0].resultado.tarifa,2);
    assert.equal((await db.query("select private.calc_liquidacion(2,1,'',false,0,0) as resultado")).rows[0].resultado.tarifa,1);
    await assert.rejects(db.query("insert into public.no_show_casos values ('5T',1,null,'2025-01-01')"),/No hay tarifa activa/);
    await assert.rejects(db.query("insert into public.no_show_casos values ('5T',2,1,'2025-01-01')"),/No hay tarifa activa/);
    await db.query("insert into public.no_show_casos values ('RABÓN',4,null,'2025-01-01')");
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
    await assert.rejects(db.query("select public.actualizar_contacto_driver('555',null)"),/Actualiza la app/);
    assert.equal((await db.query("select public.solicitar_contacto_perfil($1) as estado",[{telefono:"555",emergencia_nombre:"Contacto"}])).rows[0].estado,"guardado");
    await assert.rejects(db.query("update public.drivers set telefono='999' where id=$1",[ids.driver]),/Solicita los cambios/);
    assert.equal((await db.query("select public.solicitar_contacto_perfil($1) as estado",[{telefono:"777",emergencia_telefono:"123"}])).rows[0].estado,"pendiente");
    const mixed=(await db.query("select telefono, emergencia_telefono from public.drivers where id=$1",[ids.driver])).rows[0];
    assert.equal(mixed.telefono,"555");assert.equal(mixed.emergencia_telefono,"123");
    await assert.rejects(db.query("select public.solicitar_contacto_perfil($1)",[{correo_contacto:"foo@example.test"}]),/pendiente/);
    await assert.rejects(db.query("select public.solicitar_contacto_perfil($1)",[{rol:"ops"}]),/no permitido/);
    await assert.rejects(db.query("select public.resolver_cambio_perfil(1,true,null)"),/Solo Operaciones/);
    await user(ids.ops);
    assert.equal((await db.query("select public.resolver_cambio_perfil(1,true,null) as estado")).rows[0].estado,"aprobada");
    await user(ids.driver);
    assert.equal((await db.query("select telefono from public.drivers where id=$1",[ids.driver])).rows[0].telefono,"777");
    assert.equal((await db.query("select public.solicitar_vehiculo_perfil('ABC','Auto hatch','Modelo') as estado")).rows[0].estado,"guardado");
    assert.equal((await db.query("select public.solicitar_vehiculo_perfil('DEF','RABÓN','Modelo') as estado")).rows[0].estado,"pendiente");
    await db.exec("reset role; update public.vehiculos set placas='CAMBIO' where placas='ABC'; set role authenticated");
    await user(ids.ops);
    await assert.rejects(db.query("select public.resolver_cambio_perfil(2,true,null)"),/cambió desde la solicitud/);
    assert.equal((await db.query("select public.resolver_cambio_perfil(2,false,'Obsoleta') as estado")).rows[0].estado,"rechazada");
    await user(ids.driver);
    assert.equal((await db.query("select public.solicitar_licencia_perfil('123','A','2030-01-01') as estado")).rows[0].estado,"guardado");
    assert.equal((await db.query("select public.solicitar_licencia_perfil('456','B','2031-01-01') as estado")).rows[0].estado,"pendiente");
    await user(ids.ops);
    assert.equal((await db.query("select public.resolver_cambio_perfil(3,true,null) as estado")).rows[0].estado,"aprobada");
    await db.exec("reset role");
    assert.equal((await db.query("select numero from public.licencias where driver_id=$1",[ids.driver])).rows[0].numero,"456");
    await assert.rejects(db.query("insert into public.vehiculos(driver_id,placas,tipo,activo) values($1,'OTRO','Moto',true)",[ids.driver]),/vehiculos_uno_activo_por_driver/);
    await db.exec("set role authenticated");
    await user(ids.other);
    assert.equal((await db.query("select count(*)::int as n from public.driver_documents")).rows[0].n,0);
    await assert.rejects(db.query("select public.perfil_driver_de_flotilla($1)",[ids.driver]),/permiso/);
    await db.exec("reset role; update public.proveedores set activo=false where id=1; set role authenticated");
    await user(ids.owner);
    assert.equal((await db.query("select count(*)::int as n from storage.objects")).rows[0].n,0);
  }finally{await db.close()}
});
