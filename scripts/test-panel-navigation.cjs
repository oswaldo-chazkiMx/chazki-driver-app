const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname,"..");
const source = fs.readFileSync(path.join(root,"ops.js"),"utf8");
const html = fs.readFileSync(path.join(root,"ops.html"),"utf8");
const esc = source.slice(0,source.indexOf("\n"));
const navigation = source.slice(source.indexOf("function seleccionarTab("),source.indexOf("function aplicarRol("));
const loading = source.slice(source.indexOf("let PANEL_LOAD="),source.indexOf("async function cargarAnulaciones("));

function panelContext() {
  const elements = {};
  const element = () => ({
    value:"",innerHTML:"",textContent:"",attributes:{},
    classList:{add(){},remove(){},toggle(){}},
    setAttribute(name,value){this.attributes[name]=value}
  });
  for (const id of ["view","kpis","d1","d2","fcli","page-title","page-description"]) elements[id]=element();
  elements.d1.value="2026-11-08";elements.d2.value="2026-11-08";
  const calls = [], messages = [];
  const ctx = vm.createContext({
    tab:"r",ROL:"master",NAV_INFO:{},R:[],C:[],photos:{},CLIENTES_NOMBRE:{1:"Cliente"},
    COPPEL_PEAK_ENABLED:false,TAR:["cached"],
    $:id=>elements[id],
    document:{querySelectorAll:()=>[],querySelector:()=>element()},
    toast:message=>messages.push(message),
    render:()=>{calls.push("render:"+ctx.tab);elements.view.innerHTML="fresh:"+ctx.tab},
    esCoord:()=>true,veFin:()=>true,esOps:()=>true,
    fetchPaged:async()=>[],
    sb:{from:()=>({
      select(){return this},gte(){return this},lte(){return this},order(){return this}
    })}
  });
  for (const name of ["cargarCambiosTarifario","cargaTF","cargarAfiliados","cargarInvitaciones","cargarPadron","cargarAsignacionesEquipo","cargarDocumentosFinanzas","cargarNoShowsOps","cargaEventos","cargaExtra","cargarRevisionesCoppel","cargarAnulaciones","cargarAuditorias","cargarDocumentosOps","cargarPnrsOps"]) {
    ctx[name] = async arg => {calls.push(name);if(arg!==undefined)calls.push(arg)};
  }
  vm.runInContext(esc+"\n"+navigation+"\n"+loading,ctx);
  return {ctx,elements,calls,messages};
}

test("every menu option reloads data, including repeated clicks and the existing filters", async () => {
  const {ctx,calls,elements} = panelContext();
  const expected = {
    r:"cargaExtra",v:"cargaExtra",a:"cargaExtra",l:"cargarAnulaciones",
    c:"cargaEventos",i:"cargaExtra",f:"cargaExtra",b:"cargaExtra",k:"cargaExtra",
    d:"cargaExtra",t:"cargaTF",h:"cargarCambiosTarifario",
    p:"cargarAfiliados",w:"cargarInvitaciones",j:"cargarPadron",e:"cargarAsignacionesEquipo",
    x:"cargarAuditorias",y:"cargarAuditorias",z:"cargarAuditorias",
    g:"cargarDocumentosOps",q:"cargarPnrsOps",n:"cargarNoShowsOps"
  };
  for (const [tab,loader] of Object.entries(expected)) {
    for (let click=0;click<2;click++) {
      calls.length=0;
      ctx.button={dataset:{t:tab}};
      const request=vm.runInContext("seleccionarTab(button)",ctx);
      assert.match(elements.view.innerHTML,/Actualizando datos/);
      await request;
      assert.ok(calls.includes(loader),`${tab} should call ${loader}`);
      assert.equal(calls.at(-1),"render:"+tab);
      assert.equal(elements.view.attributes["aria-busy"],"false");
      assert.equal(elements.d1.value,"2026-11-08");
      assert.equal(elements.d2.value,"2026-11-08");
    }
  }
  assert.equal(ctx.TAR,null);
});

test("role-specific loaders remain intact and finance providers fetch current providers", async () => {
  const {ctx,calls} = panelContext();
  ctx.ROL="finanzas";
  ctx.button={dataset:{t:"p"}};
  await vm.runInContext("seleccionarTab(button)",ctx);
  assert.ok(calls.includes("cargaExtra"));
  assert.ok(!calls.includes("cargarAfiliados"));
  calls.length=0;ctx.button.dataset.t="g";
  await vm.runInContext("seleccionarTab(button)",ctx);
  assert.deepEqual(calls,["cargarDocumentosFinanzas","render:g"]);
  calls.length=0;ctx.ROL="master";ctx.COPPEL_PEAK_ENABLED=true;ctx.button.dataset.t="a";
  await vm.runInContext("seleccionarTab(button)",ctx);
  assert.ok(calls.includes("cargarRevisionesCoppel"));
});

test("rapid navigation serializes requests, skips obsolete tabs and renders only the newest", async () => {
  const {ctx,calls,elements} = panelContext();
  let release,started;
  const entered = new Promise(resolve=>{started=resolve});
  const pending = new Promise(resolve=>{release=resolve});
  ctx.cargarInvitaciones=async()=>{calls.push("invitations:start");started();await pending;calls.push("invitations:end")};
  ctx.button={dataset:{t:"w"}};
  const first=vm.runInContext("seleccionarTab(button)",ctx);
  await entered;
  ctx.button={dataset:{t:"j"}};
  const skipped=vm.runInContext("seleccionarTab(button)",ctx);
  ctx.button={dataset:{t:"p"}};
  const last=vm.runInContext("seleccionarTab(button)",ctx);
  assert.deepEqual(calls,["invitations:start"]);
  release();
  await Promise.all([first,skipped,last]);
  assert.deepEqual(calls,["invitations:start","invitations:end","cargarAfiliados","render:p"]);
  assert.equal(elements.view.innerHTML,"fresh:p");
  assert.equal(elements.view.attributes["aria-busy"],"false");
});

test("filters are captured at selection and route data really refreshes from the source", async () => {
  const {ctx,calls,elements} = panelContext();
  const routes = [], queryRanges = [];
  let version=0;
  ctx.sb.from=table=>({
    table,select(){return this},
    gte(column,value){queryRanges.push([column,value]);return this},
    lte(column,value){queryRanges.push([column,value]);return this},
    order(){return this}
  });
  ctx.fetchPaged=async build=>{
    const query=build();
    return query.table==="rutas"?[{
      id:++version,cedis:{cliente_id:1},ruta_incidencias:[]
    }]:[];
  };
  ctx.render=()=>routes.push(ctx.R[0]?.id);
  elements.fcli.value="1";
  const first=vm.runInContext("load()",ctx);
  elements.d1.value="2026-11-01";
  elements.fcli.value="2";
  await first;
  assert.deepEqual(routes,[1]);
  assert.ok(queryRanges.some(([column,date])=>column==="checkin_at"&&date.startsWith("2026-11-08")));
  elements.fcli.value="1";
  await vm.runInContext("load()",ctx);
  assert.deepEqual(routes,[1,2]);
  assert.ok(calls.includes("cargaExtra"));
});

test("failed refresh is explicit and the next click can recover", async () => {
  const {ctx,elements,messages} = panelContext();
  ctx.cargarAfiliados=async()=>{throw new Error("<network error>")};
  ctx.button={dataset:{t:"p"}};
  await vm.runInContext("seleccionarTab(button)",ctx);
  assert.match(elements.view.innerHTML,/role="alert"/);
  assert.match(elements.view.innerHTML,/&lt;network error&gt;/);
  assert.equal(elements.view.attributes["aria-busy"],"false");
  assert.match(messages[0],/network error/);
  ctx.cargarAfiliados=async()=>{};
  await vm.runInContext("seleccionarTab(button)",ctx);
  assert.equal(elements.view.innerHTML,"fresh:p");
  ctx.tab="r";ctx.fetchPaged=async()=>{throw new Error("permission denied")};
  await vm.runInContext("load()",ctx);
  assert.match(elements.view.innerHTML,/No se pudieron cargar las rutas y cancelaciones.*permission denied/);
  elements.d1.value="";
  await vm.runInContext("load()",ctx);
  assert.match(elements.view.innerHTML,/periodo de fechas válido/);
});

test("initial navigation sets selection without fetching before dates are initialized", () => {
  const {ctx,calls} = panelContext();
  ctx.button={dataset:{t:"r"}};
  vm.runInContext("seleccionarTab(button,false)",ctx);
  assert.deepEqual(calls,[]);
  assert.match(source,/seleccionarTab\(f,false\)/);
});

test("refresh has neutral loading; branded welcome exists only at sign-in", () => {
  const overlay=html.slice(html.indexOf('<div id="loading"'),html.indexOf('<div id="auth"'));
  const auth=html.slice(html.indexOf('<div id="auth"'),html.indexOf('<div id="panel"'));
  const header=html.slice(html.indexOf("<header>"),html.indexOf("</header>"));
  assert.doesNotMatch(overlay,/logo|Bienvenido|MÉXICO|México/);
  assert.match(overlay,/Cargando panel/);
  assert.match(auth,/welcome-logo/);
  assert.match(auth,/Bienvenido/);
  assert.match(auth,/México/);
  assert.doesNotMatch(header,/Bienvenido/);
  assert.match(header,/<h1>Panel de operaciones<\/h1><span class="country-badge"><img src="mexico.svg" alt="Bandera de México"><span>MX<\/span>/);
});

test("loading phrases cover a full cycle without repeats and also appear at startup", () => {
  const {ctx}=panelContext();
  const phrases=vm.runInContext("Array.from({length:FRASES_CARGA.length},()=>siguienteFraseCarga())",ctx);
  assert.ok(phrases.length>=10);
  assert.equal(new Set(phrases).size,phrases.length);
  assert.equal(vm.runInContext("siguienteFraseCarga()",ctx),phrases[0]);
  assert.match(source,/\$\("loading-phrase"\)\.textContent=siguienteFraseCarga\(\)/);
  assert.match(html,/id="loading-phrase"/);
  const flag=fs.readFileSync(path.join(root,"mexico.svg"),"utf8");
  assert.match(flag,/viewBox="0 0 30 20"/);
  assert.match(flag,/#006847/);
  assert.match(flag,/#ce1126/);
  assert.doesNotMatch(flag,/<script|(?:href|src)=|<image/);
  assert.match(html,/header \.country-badge img\{[^}]*width:24px;height:16px/);
});

test("delivery animation identifies the current section without fake progress or unsafe labels", () => {
  const {ctx}=panelContext();
  ctx.NAV_INFO.w=["Invitaciones <pendientes>"];
  const markup=vm.runInContext('cargaPanelHtml("w")',ctx);
  assert.match(markup,/Consultando lo más reciente de Invitaciones &lt;pendientes&gt;/);
  assert.match(markup,/role="status" aria-live="polite"/);
  assert.match(markup,/class="dispatch-map" aria-hidden="true"/);
  assert.match(markup,/class="dispatch-van"/);
  assert.doesNotMatch(markup,/%|setTimeout|Bienvenido|<img|<script/);
  assert.match(vm.runInContext('cargaPanelHtml("unknown")',ctx),/tu panel/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\).*\.dispatch-van\{animation:none/);
  assert.match(html,/\.dispatch-pulse i\{animation:none\}/);
});

test("startup always removes loading, even if authorization or client lookup throws", async () => {
  const startup=source.slice(source.indexOf("async function boot("),source.indexOf("async function iniciarPanel("));
  const calls=[],classes=new Set(["hide"]);
  const elements={
    loading:{classList:{add:value=>calls.push(value)}},
    panel:{classList:{contains:value=>classes.has(value)}},
    auth:{classList:{remove:value=>calls.push("auth:"+value)}},
    amsg:{innerHTML:""}
  };
  const ctx=vm.createContext({
    $:id=>elements[id],toast:message=>calls.push(message),
    iniciarPanel:async()=>{throw new Error("<auth unavailable>")}
  });
  vm.runInContext(esc+"\n"+startup,ctx);
  await vm.runInContext("boot()",ctx);
  assert.match(elements.amsg.innerHTML,/&lt;auth unavailable&gt;/);
  assert.deepEqual(calls,["auth:hide","hide"]);
  classes.clear();calls.length=0;
  await vm.runInContext("boot()",ctx);
  assert.match(calls[0],/No se pudo iniciar el panel/);
  assert.equal(calls.at(-1),"hide");
});
