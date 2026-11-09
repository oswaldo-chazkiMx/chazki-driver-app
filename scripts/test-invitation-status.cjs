const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { PGlite } = require("@electric-sql/pglite");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const ops = read("ops.js"), app = read("app.js"), shared = read("invitaciones.js");
const esc = ops.slice(0, ops.indexOf("\n"));

function context() {
  const ctx = vm.createContext({ location: { origin:"https://example.test", protocol:"https:" }, encodeURIComponent, INV_PRESELECCION:null });
  vm.runInContext(esc + "\n" + shared, ctx);
  return ctx;
}

test("mail status distinguishes sent, verified, unverified and unregistered accounts", () => {
  const ctx = context();
  for (const [invite, expected] of [
    [{}, /Sin envío de validación registrado.*Sin cuenta registrada/],
    [{cuenta_creada:true}, /Sin envío de validación registrado.*Correo pendiente de validar/],
    [{cuenta_creada:true,correo_enviado_en:"2026-11-09T01:00:00Z"}, /Enviado por Supabase:.*Correo pendiente de validar/],
    [{cuenta_creada:true,correo_validado_en:"2026-11-09T02:00:00Z"}, /Sin envío de validación registrado.*Correo validado:/],
    [{cuenta_creada:true,correo_enviado_en:"2026-11-09T01:00:00Z",correo_validado_en:"2026-11-09T02:00:00Z"}, /Enviado por Supabase:.*Correo validado:/]
  ]) {
    ctx.invite = invite;
    assert.match(vm.runInContext("correoInvitacionHtml(invite)", ctx), expected);
  }
});

test("listing paginates all invitations and surfaces RPC and malformed-response errors", async () => {
  const ctx = context(), calls = [];
  const rows = Array.from({length:1201}, (_, id) => ({id}));
  ctx.sb = { rpc(name, args) {
    return { async range(start, end) {
      calls.push({name, args, start, end});
      return {data:rows.slice(start, end + 1), error:null};
    }};
  }};
  const result = await vm.runInContext("listarInvitacionesRed(sb,true)", ctx);
  assert.equal(result.length,1201);
  assert.equal(result[1200].id,1200);
  assert.deepEqual(calls.map(x=>[x.name,x.args.p_solo_propias,x.start,x.end]), [
    ["listar_invitaciones_red",true,0,499],
    ["listar_invitaciones_red",true,500,999],
    ["listar_invitaciones_red",true,1000,1499]
  ]);
  ctx.sb.rpc = () => ({range:async()=>({data:null,error:{message:"permission denied"}})});
  await assert.rejects(vm.runInContext("listarInvitacionesRed(sb)",ctx),/permission denied/);
  ctx.sb.rpc = () => ({range:async()=>({data:null,error:null})});
  await assert.rejects(vm.runInContext("listarInvitacionesRed(sb)",ctx),/respuesta inválida/);
});

test("both invitation views put cancelled invitations last with delete actions only there", () => {
  const ctx = context();
  vm.runInContext(ops.slice(ops.indexOf("let PADRON="), ops.indexOf("function enlazarInvitaciones()")),ctx);
  vm.runInContext(app.slice(app.indexOf("function invitarHtml()"),app.indexOf("function drawDrivers()")),ctx);
  vm.runInContext(`PRV=[];CLIENTES_NOMBRE={};CLI=[];DRVS=[];INVS_ERR="";
    INVR=[
      {id:1,email:"cancelled@example.test",estatus:"cancelada",tipo:"driver",creado_en:"2026-11-01"},
      {id:2,email:"approved@example.test",estatus:"enviada",tipo:"driver",creado_en:"2026-11-01",cuenta_creada:true,correo_enviado_en:"2026-11-02"},
      {id:3,email:"accepted@example.test",estatus:"aceptada",tipo:"driver",creado_en:"2026-11-01",cuenta_creada:true,correo_validado_en:"2026-11-03"}
    ];INVS=INVR;
    INVR_AUD=[{invitacion_id:2,evento:"correo",estado:{},registrado_en:"2026-11-02",actor_id:"<actor>"}]`,ctx);
  for (const [view, attribute] of [["vistaInvitaciones()","inv"],["invitarHtml()","iv"]]) {
    const html = vm.runInContext(view,ctx);
    assert.ok(html.indexOf("cancelled@example.test") > html.indexOf("accepted@example.test"));
    assert.match(html,new RegExp(`data-${attribute}-eliminar="1"`));
    assert.doesNotMatch(html,new RegExp(`data-${attribute}-eliminar="[23]"`));
    assert.match(html,/Canceladas \(1\)/);
    assert.match(html,/Enviado por Supabase:/);
    assert.match(html,/Correo validado:/);
    assert.match(html,/Actualizar estados/);
  }
  const html = vm.runInContext("vistaInvitaciones()",ctx);
  assert.match(html,/Correo preparado.*&lt;actor&gt;.*no confirma envío/);
});

test("ops deletion requires confirmation, calls scoped RPC and refreshes, showing errors", async () => {
  const ctx = context(), button = {dataset:{invEliminar:"9"}}, calls = [], messages = [];
  vm.runInContext(ops.slice(ops.indexOf("let PADRON="),ops.indexOf("function enlazar(){")),ctx);
  ctx.$ = () => null;
  ctx.document = {querySelectorAll:s=>s==="[data-inv-eliminar]"?[button]:[]};
  ctx.confirm = () => false;
  ctx.toast = message => messages.push(message);
  ctx.sb = {rpc:async(name,args)=>{calls.push([name,args.p_id]);return {data:"Eliminada",error:null}}};
  vm.runInContext("tab='w';cargarInvitaciones=async()=>{};render=()=>{};enlazarInvitaciones()",ctx);
  await button.onclick();
  assert.equal(calls.length,0);
  ctx.confirm = () => true;
  await button.onclick();
  assert.deepEqual(calls,[["eliminar_invitacion_red",9]]);
  ctx.sb.rpc = async()=>({data:null,error:{message:"Sin permiso"}});
  await button.onclick();
  assert.equal(button.disabled,false);
  assert.equal(messages.at(-1),"Sin permiso");
  ctx.sb.rpc = async()=>{throw new Error("Network unavailable")};
  await button.onclick();
  assert.equal(button.disabled,false);
  assert.equal(messages.at(-1),"Network unavailable");
});

test("executive invitation dashboard retains labelled fields, states and loading safeguards", () => {
  const ctx=context();
  vm.runInContext(ops.slice(ops.indexOf("let PADRON="),ops.indexOf("function enlazarInvitaciones()")),ctx);
  vm.runInContext(`PRV=[];CLIENTES_NOMBRE={};INVR=[
    {id:1,nombre:"<Invitado>",email:"pending@example.test",estatus:"pendiente_aprobacion",invitado_por_rol:"flotillero",tipo:"driver"},
    {id:2,email:"verified@example.test",estatus:"aceptada",tipo:"driver",correo_validado_en:"2026-11-09"},
    {id:3,email:"cancelled@example.test",estatus:"cancelada",tipo:"driver",correo_validado_en:"2026-11-09"}
  ]`,ctx);
  let html=vm.runInContext("vistaInvitaciones()",ctx);
  assert.match(html,/class="doc-page inv-page"/);
  assert.match(html,/No canceladas<\/span><strong>2/);
  assert.match(html,/Por aprobar<\/span><strong>1/);
  assert.match(html,/Correo validado<\/span><strong>1/);
  assert.match(html,/&lt;Invitado&gt;/);
  assert.match(html,/data-inv-ok="1"/);
  assert.match(html,/data-inv-no="1"/);
  assert.match(html,/doc-status-approved/);
  assert.match(html,/doc-status-missing">Cancelada/);
  assert.doesNotMatch(html,/class="pill/);
  for(const id of ["iv-n","iv-m","iv-t","iv-r","iv-c","iv-p"]){
    assert.match(html,new RegExp(`<label class="doc-import-field">[^<]+<(input|select) id="${id}"`));
  }
  assert.match(html,/role="region" aria-label="Invitaciones canceladas"/);
  vm.runInContext('INVR_LOADING=true',ctx);
  html=vm.runInContext("vistaInvitaciones()",ctx);
  assert.match(html,/<fieldset disabled class="inv-form">/);
  assert.match(html,/Correo validado<\/span><strong>—/);
  vm.runInContext('INVR_LOADING=false;INVR=[];INVR_ERR="<fallo>"',ctx);
  html=vm.runInContext("vistaInvitaciones()",ctx);
  assert.match(html,/role="alert">&lt;fallo&gt;/);
  assert.match(html,/No canceladas<\/span><strong>—/);
  assert.doesNotMatch(html,/Sin invitaciones\./);
});

test("fleet owners can cancel and remove their invitations with confirmation and refresh", async () => {
  const ctx = context(), calls = [], messages = [];
  const button = id => ({disabled:false,getAttribute:()=>id});
  const remove = button("7"), cancel = button("8"), refresh = {}, error = {textContent:""};
  const box = {innerHTML:"",querySelectorAll:s=>
    s==="[data-iv-eliminar]"?[remove]:s==="[data-iv-cancelar]"?[cancel]:[]};
  ctx.$ = id => ({"drbox":box,"iv-actualizar":refresh,"iv-e":error}[id]||null);
  ctx.rangoK = () => [new Date(0),new Date()];
  ctx.confirm = () => false;
  ctx.toast = message => messages.push(message);
  ctx.sb = {rpc:async(name,args)=>{calls.push([name,args.p_id]);return {data:null,error:null}}};
  vm.runInContext(app.slice(app.indexOf("function invitarHtml()"),app.indexOf("async function abrirPerfilDriver(")),ctx);
  vm.runInContext(`DRVS=[];INVS=[];INVS_ERR="";CLI=[];dp="sem";loadDrivers=async()=>{refreshCount++};refreshCount=0;drawDrivers()`,ctx);
  await remove.onclick();
  await cancel.onclick();
  assert.equal(calls.length,0);
  ctx.confirm = () => true;
  await remove.onclick();
  await cancel.onclick();
  assert.deepEqual(calls,[["eliminar_invitacion_red",7],["cancelar_invitacion_red",8]]);
  assert.equal(vm.runInContext("refreshCount",ctx),2);
  await refresh.onclick();
  assert.equal(vm.runInContext("refreshCount",ctx),3);
  ctx.sb.rpc = async()=>({data:null,error:{message:"La invitación ya cambió"}});
  await remove.onclick();
  assert.equal(remove.disabled,false);
  assert.equal(error.textContent,"La invitación ya cambió");
  ctx.sb.rpc = async()=>{throw new Error("Network unavailable")};
  await cancel.onclick();
  assert.equal(cancel.disabled,false);
  assert.equal(error.textContent,"Network unavailable");
});

test("SQL reads actual Auth timestamps, scopes every role and preserves deleted history", async () => {
  const db = new PGlite();
  const own = "00000000-0000-0000-0000-000000000001";
  const other = "00000000-0000-0000-0000-000000000002";
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema private;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.uid',true),'')::uuid
      $$;
      create function public.mi_acceso_administrativo() returns boolean language sql stable as $$
        select coalesce(current_setting('test.role',true),'') in ('master','ops','coordinador','ih')
      $$;
      create function public.operativo_rol_actual() returns text language sql stable as $$
        select current_setting('test.role',true)
      $$;
      create table public.asignaciones_operativas(cedis_id bigint,supervisor_id uuid,coordinador_id uuid);
      create table public.invitaciones_red(
        id bigint primary key,email text,nombre text,tipo text,cedis_id bigint,estatus text,
        invitado_por uuid,creado_en timestamptz default now(),invitacion_flotillero_id bigint references public.invitaciones_red(id)
      );
      create table auth.users(
        id uuid primary key,email text,confirmation_sent_at timestamptz,email_confirmed_at timestamptz,
        encrypted_password text
      );
      create table private.audit(invitation_id bigint references public.invitaciones_red(id));
      alter table public.invitaciones_red enable row level security;
      grant usage on schema auth to authenticated;
      grant select on public.invitaciones_red to authenticated;
    `);
    // Install the real visibility rules without unrelated registration dependencies.
    const registration = read("registro-por-invitacion.sql");
    await db.exec(registration.slice(registration.indexOf("create or replace function public.invitacion_red_visible("),registration.indexOf("create or replace function public.invitar_driver_flotillero(")));
    await db.exec(read("invitaciones-estado.sql"));
    await db.exec(read("invitaciones-estado.sql"));
    await db.exec(`
      insert into public.invitaciones_red(id,email,tipo,cedis_id,estatus,invitado_por,creado_en) values
        (1,'cancelled@example.test','flotillero',10,'cancelada','${own}','2026-11-08'),
        (2,'pending@example.test','driver',10,'enviada','${own}','2026-11-07'),
        (3,'verified@example.test','driver',10,'aceptada','${other}','2026-11-06'),
        (4,'unregistered@example.test','driver',20,'pendiente_aprobacion','${other}','2026-11-05'),
        (5,'child@example.test','driver',10,'cancelada','${own}','2026-11-04');
      update public.invitaciones_red set invitacion_flotillero_id=1 where id=5;
      insert into private.audit values (1);
      insert into public.asignaciones_operativas values (10,'${own}','${own}');
      insert into auth.users values
        ('${own}','pending@example.test','2026-11-07T01:00Z',null,'never expose'),
        ('${other}','verified@example.test','2026-11-06T01:00Z','2026-11-06T02:00Z','never expose');
      select set_config('test.uid','${own}',false);
    `);
    const list = async (onlyOwn = false) => (await db.query("select * from public.listar_invitaciones_red($1)",[onlyOwn])).rows.map(row=>row.listar_invitaciones_red);
    for (const role of ["master","ops","coordinador","ih","flotillero"]) {
      await db.query("select set_config('test.role',$1,false)",[role]);
      const rows = await list();
      assert.deepEqual(rows.map(x=>x.id),role==="master"||role==="ops"?[2,3,4,1,5]:role==="flotillero"?[2,1,5]:[2,3,1,5]);
      assert.deepEqual((await list(true)).map(x=>x.id),[2,1,5]);
      const pending = rows.find(x=>x.id===2);
      assert.equal(pending.correo_enviado_en,"2026-11-07T01:00:00+00:00");
      assert.equal(pending.correo_validado_en,null);
      assert.equal(pending.cuenta_creada,true);
      assert.equal(JSON.stringify(rows).includes("never expose"),false);
      assert.equal(JSON.stringify(rows).includes("encrypted_password"),false);
      await assert.rejects(db.query("select public.eliminar_invitacion_red(2)"),/Solo puedes eliminar/);
    }
    await db.exec("select set_config('test.role','ops',false)");
    const rows = await list();
    assert.equal(rows.find(x=>x.id===3).correo_validado_en,"2026-11-06T02:00:00+00:00");
    assert.equal(rows.find(x=>x.id===4).cuenta_creada,false);
    assert.equal(rows.find(x=>x.id===4).correo_enviado_en,null);
    for (const role of ["master","ops","coordinador","ih","flotillero"]) {
      await db.query("select set_config('test.role',$1,false)",[role]);
      await db.query("select public.eliminar_invitacion_red(1)");
      assert.equal((await list()).some(x=>x.id===1),false);
      assert.equal((await db.query("select eliminado_por from public.invitaciones_red where id=1")).rows[0].eliminado_por,own);
      await assert.rejects(db.query("select public.eliminar_invitacion_red(1)"),/Solo puedes eliminar/);
      assert.equal((await db.query("select count(*)::int as n from private.audit")).rows[0].n,1);
      assert.equal((await db.query("select invitacion_flotillero_id from public.invitaciones_red where id=5")).rows[0].invitacion_flotillero_id,1);
      await db.exec("update public.invitaciones_red set eliminado_en=null,eliminado_por=null where id=1");
    }
    await db.exec(`select set_config('test.role','flotillero',false);select set_config('test.uid','${other}',false)`);
    await assert.rejects(db.query("select public.eliminar_invitacion_red(1)"),/no tienes permiso/);
    assert.equal((await list()).some(x=>x.id===1),false);
    await db.exec(`select set_config('test.uid','${own}',false)`);
    await db.query("select public.eliminar_invitacion_red(1)");
    await db.exec("set role authenticated");
    assert.equal((await db.query("select * from public.invitaciones_red where id=1")).rows.length,0);
    await assert.rejects(db.query("update public.invitaciones_red set eliminado_en=null where id=1"),/permission denied/);
    await db.exec("reset role");
    await db.exec("select set_config('test.uid','',false)");
    await assert.rejects(list(),/Sesion requerida/);
    await assert.rejects(db.query("select public.eliminar_invitacion_red(1)"),/Sesion requerida/);
    const grants = (await db.query(`select
      has_function_privilege('anon','public.listar_invitaciones_red(boolean)','execute') as anon_list,
      has_function_privilege('anon','public.eliminar_invitacion_red(bigint)','execute') as anon_delete,
      has_function_privilege('authenticated','public.eliminar_invitacion_red(bigint)','execute') as auth_delete
    `)).rows[0];
    assert.deepEqual(grants,{anon_list:false,anon_delete:false,auth_delete:true});
  } finally { await db.close(); }
});

test("web and Android load shared invitation code before their entrypoints", () => {
  for (const [html, entry] of [["ops.html","ops.js"],["driver-app.html","app.js"]]) {
    const page = read(html);
    assert.ok(page.indexOf('src="invitaciones.js?') < page.indexOf(`src="${entry}?`));
  }
  assert.match(read("scripts/prepare-android-web.js"),/\["invitaciones.js", "invitaciones.js"\]/);
});
