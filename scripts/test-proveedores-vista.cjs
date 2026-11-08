const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "ops.js"), "utf8");
const escapeFunction = source.slice(0, source.indexOf("\n"));
const view = source.slice(source.indexOf("let AFILIADOS="), source.indexOf("let PADRON="));

function render(afiliados, isOps = false, expanded = null, editing = null) {
  const context = vm.createContext({ DRV: [], PRV: [], ROL: isOps ? "ops" : "ih", esOps: () => isOps });
  vm.runInContext(escapeFunction + "\n" + view, context);
  context.items = afiliados;
  context.expanded = expanded;
  context.editing = editing;
  return vm.runInContext("AFILIADOS=items; AFILIADO_ABIERTO=expanded; AFILIADO_EDITAR=editing; vistaProveedores()", context);
}
const fixtures = [
  {id:"owner", nombre:"<Flotillero>", rol:"flotillero", proveedor_id:1, proveedor_tipo:"flotillero", titular_id:"owner", proveedor_activo:true},
  {id:"driver", nombre:"Ana", rol:"driver", proveedor_id:1, proveedor_tipo:"flotillero", telefono:"123", correo_contacto:"a@example.test"},
  {id:"other", nombre:"Otro", rol:"driver", proveedor_id:2, proveedor_tipo:"independiente"}
];

test("affiliate view omits provider creation and the provider table for operations and supervisors", () => {
  for (const isOps of [false, true]) {
    const html = render(fixtures, isOps);
    assert.doesNotMatch(html, /Alta de proveedor|<h3[^>]*>Proveedores<\/h3>|id="np-ok"/);
    assert.match(html, /Drivers y flotilleros/);
    assert.match(html, /Solicitudes de vinculación pendientes/);
  }
});

test("finance retains its separate provider listing", () => {
  const context = vm.createContext({ DRV: [], PRV: [{nombre:"Proveedor existente",tipo:"independiente"}], ROL: "finanzas" });
  vm.runInContext(escapeFunction + "\n" + view, context);
  const html = vm.runInContext("vistaProveedores()", context);
  assert.match(html, /<h3[^>]*>Proveedores<\/h3>/);
  assert.match(html, /Proveedor existente/);
});

test("fleet, roster and documents hide their heading and filters without changing other tabs", async () => {
  const classes=()=>({hidden:false,toggle(name, force){if(name==="hide")this.hidden=force}});
  const bar={classList:classes()}, heading={classList:classes()};
  const title={}, description={};
  const button=tab=>({dataset:{t:tab},classList:classes()});
  const context=vm.createContext({
    tab:"r",ROL:"finanzas",PADRON_LOADING:false,NAV_INFO:{p:["Proveedores","",""],j:["Padrón","",""],r:["Rutas","",""],n:["NO SHOW","",""]},
    document:{querySelectorAll:()=>[],querySelector:s=>s===".bar"?bar:heading},
    $:id=>id==="page-title"?title:description,render(){},load(){},cargarPadron:async()=>{}
  });
  const select=source.slice(source.indexOf("function seleccionarTab("),source.indexOf("function aplicarRol()"));
  vm.runInContext(select,context);
  context.b=button("p");vm.runInContext("seleccionarTab(b)",context);
  assert.equal(bar.classList.hidden,true);assert.equal(heading.classList.hidden,true);
  context.b=button("j");vm.runInContext("seleccionarTab(b)",context);
  assert.equal(bar.classList.hidden,true);assert.equal(heading.classList.hidden,true);
  await Promise.resolve();
  context.b=button("g");vm.runInContext("seleccionarTab(b)",context);
  assert.equal(bar.classList.hidden,true);assert.equal(heading.classList.hidden,true);
  context.b=button("r");vm.runInContext("seleccionarTab(b)",context);
  assert.equal(bar.classList.hidden,false);assert.equal(heading.classList.hidden,false);
  context.b=button("n");vm.runInContext("seleccionarTab(b)",context);
  assert.equal(bar.classList.hidden,true);assert.equal(heading.classList.hidden,false);
});

test("supervisor can expand only a fleet owner and sees only their drivers", () => {
  const html = render(fixtures, false, "owner", "driver");
  assert.match(html, /data-af-ver="owner" aria-expanded="true"/);
  assert.doesNotMatch(html, /data-af-ver="driver"/);
  assert.match(html, /data-af-invitar="1"/);
  assert.match(html, /data-af-vincular="1"/);
  assert.match(html, /aprobación y el traslado seguro aún no están disponibles|aprobación y el traslado seguro aún no están habilitados/);
  assert.match(html, /data-af-editar="driver"/);
  assert.doesNotMatch(html, /data-af-editar="other"/);
  assert.match(html, /&lt;Flotillero&gt;/);
  assert.match(html, /Correo de contacto/);
  assert.match(html, /Driver independiente/);
  assert.doesNotMatch(html, /data-rol=|data-prov=/);
  assert.doesNotMatch(html, /<option[^>]*>ops|<option[^>]*>master/);
  assert.equal((html.match(/>Ana</g)||[]).length,1);
  assert.match(html, /Driver independiente/);
});

test("linked drivers appear only under their owner, without hiding ungrouped drivers", () => {
  const closed=render([...fixtures,{id:"orphan",nombre:"Sin titular",rol:"driver",proveedor_id:3,proveedor_tipo:"flotillero"}]);
  assert.doesNotMatch(closed, />Ana</);
  assert.match(closed, />Otro</);
  assert.match(closed, />Sin titular</);
  assert.match(closed, /data-af-ver="owner"/);
  const open=render(fixtures,false,"owner");
  assert.equal((open.match(/>Ana</g)||[]).length,1);
});

test("inactive fleet cannot invite and missing owner provider is not expandable", () => {
  const inactive = [{...fixtures[0], proveedor_activo:false}];
  assert.match(render(inactive, false, "owner"), /data-af-invitar="1" disabled/);
  assert.doesNotMatch(render([{...fixtures[0], proveedor_id:null}]), /data-af-ver=/);
  assert.match(render([], true), /No hay drivers ni flotilleros registrados/);
});

test("adding a driver submits a request without changing provider", async () => {
  const fn=source.slice(source.indexOf("async function abrirSolicitudVinculacion("),source.indexOf("async function guardarContactoFlota("));
  const el=value=>({value,innerHTML:"",classList:{remove(){},add(){},contains(){return false}}});
  const fields={modal:el(""),"af-sol-cerrar":el(""),"af-sol-contenido":el(""),"af-sol-error":el(""),"af-sol-guardar":el(""),"af-sol-driver":el("ind")};
  const calls=[];
  const context=vm.createContext({
    AFILIADOS:fixtures,tab:"p", $:id=>fields[id], toast(){},render(){},cargarAfiliados:async()=>{},
    fetchPaged:async fn=>{await fn();return [{id:"ind",nombre:"<Independiente>",codigo:"123"}]},
    sb:{rpc:async (name,args)=>{calls.push({name,args});return {data:"Solicitud registrada",error:null}}}
  });
  vm.runInContext(escapeFunction+"\n"+fn,context);
  await vm.runInContext('abrirSolicitudVinculacion("1")',context);
  assert.match(fields["af-sol-contenido"].innerHTML,/&lt;Independiente&gt;/);
  await fields["af-sol-guardar"].onclick();
  assert.deepEqual(calls.map(x=>x.name),["listar_independientes_vinculacion","solicitar_vinculacion_flota"]);
  assert.equal(calls[1].args.p_driver_id,"ind");
  assert.equal(calls[1].args.p_proveedor_id,1);
});
