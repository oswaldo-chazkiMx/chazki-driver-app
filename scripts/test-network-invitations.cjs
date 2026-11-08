const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ops = fs.readFileSync(path.join(root, "ops.js"), "utf8");
const driver = fs.readFileSync(path.join(root, "app.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "network-invitations.sql"), "utf8");
const escapeFunction = ops.slice(0, ops.indexOf("\n"));

function opsContext() {
  const context = vm.createContext({ location: { origin: "https://example.test" }, encodeURIComponent });
  vm.runInContext(escapeFunction + "\n" + ops.slice(ops.indexOf("let PADRON="), ops.indexOf("function enlazarInvitaciones()")), context);
  return context;
}

test("padrón distinguishes account and authorization and escapes data", () => {
  const context = opsContext();
  vm.runInContext(`PADRON=[
    {email:"one@example.test",nombre:"<Driver>",estatus_padron:"ACTIVO",driver_id:null},
    {email:"two@example.test",nombre:"Cuenta",estatus_padron:null,driver_id:"id",estatus_cuenta:"activo",correo_confirmado:true}
  ]`, context);
  const html = vm.runInContext("vistaPadron()", context);
  assert.match(html, /&lt;Driver&gt;/);
  assert.match(html, /Sin cuenta/);
  assert.match(html, /Fuera del padrón/);
  assert.match(html, /correo confirmado/);
  assert.match(html, /Preparar correo/);
});

test("invitations render manual resend and approval actions according to status", () => {
  const context = opsContext();
  vm.runInContext(`PRV=[]; CLIENTES_NOMBRE={}; INVR=[
    {id:1,email:"x@example.test",tipo:"driver",estatus:"enviada"},
    {id:2,email:"y@example.test",tipo:"driver",estatus:"pendiente_aprobacion",invitado_por_rol:"flotillero"},
    {id:3,email:"z@example.test",tipo:"driver",estatus:"aceptada"}
  ]`, context);
  const html = vm.runInContext("vistaInvitaciones()", context);
  assert.match(html, /Preparar \/ reenviar correo/);
  assert.match(html, /data-inv-ok="2"/);
  assert.match(html, /mailto:z%40example.test/);
  assert.match(html, /se envía manualmente/);
});

test("padrón paginates without hiding RPC errors", async () => {
  const context = opsContext();
  context.sb = { rpc: async () => ({ data: Array.from({ length: 51 }, (_, i) => ({ email: `${i}@example.test` })), error: null }) };
  await vm.runInContext("cargarPadron()", context);
  assert.equal(vm.runInContext("PADRON.length", context), 50);
  assert.equal(vm.runInContext("PADRON_MAS", context), true);
  context.sb.rpc = async () => ({ data: null, error: { message: "permission denied" } });
  await vm.runInContext("cargarPadron()", context);
  assert.match(vm.runInContext("vistaPadron()", context), /permission denied/);
});

test("fleet owner can resend only pending requests and email approved invitations", () => {
  const context = vm.createContext({ location: { protocol: "capacitor:", origin: "capacitor://localhost" }, encodeURIComponent });
  vm.runInContext(escapeFunction + "\n" + driver.slice(driver.indexOf("function invitarHtml()"), driver.indexOf("function drawDrivers()")), context);
  vm.runInContext(`CLI=[]; INVS_ERR=""; INVS=[
    {id:1,email:"one@example.test",estatus:"pendiente_aprobacion",creado_en:"2026-01-01"},
    {id:2,email:"two@example.test",estatus:"enviada",creado_en:"2026-01-01"},
    {id:3,email:"three@example.test",estatus:"rechazada",creado_en:"2026-01-01"}
  ]`, context);
  const html = vm.runInContext("invitarHtml()", context);
  assert.match(html, /data-iv-reenviar="1"/);
  assert.doesNotMatch(html, /data-iv-reenviar="[23]"/);
  assert.match(html, /Preparar correo/);
  assert.match(html, /https%3A%2F%2Fchazki-driver-app.vercel.app/);
});

test("SQL keeps table read under RLS and limits roster and resend functions", () => {
  assert.match(sql, /grant select on public\.invitaciones_red to authenticated/i);
  assert.match(sql, /using \(public\.invitacion_red_visible\(invitaciones_red\)\)/i);
  assert.match(sql, /coalesce\(public\.operativo_rol_actual\(\), ''\) not in \('master', 'ops', 'coordinador', 'ih'\)/i);
  assert.match(sql, /v_inv\.invitado_por <> auth\.uid\(\)/i);
  assert.match(sql, /ultimo_aviso_en > now\(\) - interval '1 minute'/i);
  assert.match(sql, /revoke all on function public\.notificar_solicitud_invitacion_red\(bigint\) from public, anon, authenticated/i);
});

test("invitation warnings distinguish roster, inactive accounts and authentication bans", () => {
  const context = opsContext();
  const warnings = vm.runInContext(`avisosEstadoInvitacion({
    en_padron:true,padron_activo:false,cuenta_inactiva:true,cuenta_bloqueada:true,
    inactivo_desde:"2026-01-01T00:00:00Z"
  },new Date("2026-01-03T12:00:00Z"))`, context);
  assert.match(warnings.join(" "), /padrón, pero su alta no está activa/);
  assert.match(warnings.join(" "), /Usuario bloqueado/);
  assert.match(warnings.join(" "), /Tiempo inactiva: 2 días/);
  assert.match(warnings.join(" "), /no reactiva la cuenta/);
  const unknown = vm.runInContext(`avisosEstadoInvitacion({
    en_padron:true,padron_activo:true,cuenta_inactiva:true,cuenta_bloqueada:false,
    inactivo_desde:null
  })`, context);
  assert.match(unknown.join(" "), /ya tiene alta en el padrón/);
  assert.match(unknown.join(" "), /No se conoce la fecha/);
  assert.doesNotMatch(unknown.join(" "), /Usuario bloqueado/);
});

test("invitation preflight requires a valid response and allows cancellation", async () => {
  const context = opsContext();
  let prompt;
  context.confirm = message => { prompt = message; return false; };
  context.sb = { rpc: async () => ({ data: { en_padron:true,padron_activo:true,cuenta_inactiva:false,cuenta_bloqueada:false }, error: null }) };
  assert.equal(await vm.runInContext(`confirmarEstadoInvitacion("test@example.test")`, context), false);
  assert.match(prompt, /ya tiene alta en el padrón/);
  context.sb.rpc = async () => ({ data: null, error: { message: "permission denied" } });
  await assert.rejects(vm.runInContext(`confirmarEstadoInvitacion("test@example.test")`, context), /permission denied/);
  context.sb.rpc = async () => ({ data: {}, error: null });
  await assert.rejects(vm.runInContext(`confirmarEstadoInvitacion("test@example.test")`, context), /respuesta inválida/);
});

test("invitation history displays recorded status and escapes the actor", () => {
  const context = opsContext();
  vm.runInContext(`PRV=[]; CLIENTES_NOMBRE={}; INVR=[{id:1,email:"x@example.test",tipo:"driver",estatus:"enviada"}];
    INVR_AUD=[{invitacion_id:1,evento:"invitacion",actor_id:"<actor>",registrado_en:"2026-01-03T00:00:00Z",
      estado:{en_padron:false,padron_activo:false,cuenta_inactiva:true,cuenta_bloqueada:false,inactivo_desde:"2026-01-01T00:00:00Z"}}]`, context);
  const html = vm.runInContext("vistaInvitaciones()", context);
  assert.match(html, /Tiempo inactiva: 2 días/);
  assert.match(html, /&lt;actor&gt;/);
});

test("sharing an invitation checks status and records preparation before opening email", async () => {
  const context = opsContext();
  vm.runInContext(ops.slice(ops.indexOf("function enlazarInvitaciones()"), ops.indexOf("function enlazar(){")), context);
  const link = { dataset: { invCompartir: "1", canal: "correo" }, href: "mailto:x@example.test" };
  const calls = [];
  context.$ = () => null;
  context.document = { querySelectorAll: selector => selector === "[data-inv-compartir]" ? [link] : [] };
  context.window = { location: { href: "" } };
  context.confirm = () => true;
  context.render = () => {};
  context.toast = message => { throw new Error(message); };
  context.sb = { rpc: async (name, args) => {
    calls.push({ name, args });
    return name === "consultar_estado_invitacion"
      ? { data: { en_padron:true,padron_activo:true,cuenta_inactiva:false,cuenta_bloqueada:false }, error: null }
      : { error: null };
  } };
  vm.runInContext(`INVR=[{id:1,email:"x@example.test"}]; tab="w"; cargarInvitaciones=async()=>{}; enlazarInvitaciones()`, context);
  await link.onclick({ preventDefault() {} });
  assert.deepEqual(calls.map(x => x.name), ["consultar_estado_invitacion", "registrar_preparacion_invitacion_red"]);
  assert.equal(calls[1].args.p_canal, "correo");
  assert.equal(context.window.location.href, "mailto:x@example.test");
});

test("driver invitation selects a fleet and disables CEDIS and tax scheme", async () => {
  const context = opsContext();
  vm.runInContext(ops.slice(ops.indexOf("function enlazarInvitaciones()"), ops.indexOf("function enlazar(){")), context);
  const element = value => ({ value, disabled:false, classList:{ toggle() {} } });
  const fields = {
    "iv-t":element("driver"),"iv-r":element("FACTURA"),"iv-c":element("9"),"iv-p":element("12"),
    "iv-n":element("Test"),"iv-m":element("test@example.test"),"iv-ok":element("")
  };
  const calls = [];
  context.$ = id => fields[id] || null;
  context.document = { querySelectorAll: () => [] };
  context.sb = { rpc: async (name, args) => {
    calls.push({ name, args });
    if(name==="consultar_estado_invitacion") return {data:{en_padron:false,padron_activo:false,cuenta_inactiva:false,cuenta_bloqueada:false},error:null};
    return {data:"Listo",error:null};
  }};
  context.toast = () => {};
  context.render = () => {};
  vm.runInContext(`cargarInvitaciones=async()=>{}; enlazarInvitaciones()`, context);
  assert.equal(fields["iv-r"].disabled,true);
  assert.equal(fields["iv-c"].disabled,true);
  assert.equal(fields["iv-p"].disabled,false);
  fields["iv-ok"].onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(x=>x.name),["consultar_estado_invitacion","invitar_driver_flotillero"]);
  assert.equal(calls[1].args.p_proveedor_id,12);
  assert.equal("p_cedis_id" in calls[1].args,false);
  assert.equal("p_esquema" in calls[1].args,false);
});
