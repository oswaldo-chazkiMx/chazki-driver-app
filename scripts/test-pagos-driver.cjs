const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8");

test("payment loading preserves fleet privacy and reports errors instead of showing zero",async()=>{
  const elements={"t-gan":{innerHTML:"",insertAdjacentHTML(){} }},calls=[];
  let response={data:null,error:{message:"Sin conexión"}};
  const query={
    select(v){calls.push(["select",v]);return this},
    gte(){return this},order(){return this},
    eq(k,v){calls.push(["eq",k,v]);return Promise.resolve(response)},
    then(resolve,reject){return Promise.resolve(response).then(resolve,reject)}
  };
  const context=vm.createContext({
    ACC:{puede_ver_ganancias:false,es_flotillero:false},ME:{id:"driver"},WALMART_TARIFARIO_ENABLED:false,
    $:id=>elements[id],loadEstatus(){},drawG(){},
    sb:{from(table){calls.push(["from",table]);return query}}
  });
  vm.runInContext(app.slice(app.indexOf("let PAGOS=[],PAGOS_ERROR="),app.indexOf("\nlet RUTAS_K=")),context);
  await context.loadGan();
  assert.match(elements["t-gan"].innerHTML,/transportista/);
  assert.equal(calls.length,0);
  context.ACC={puede_ver_ganancias:true,es_flotillero:false};
  await context.loadGan();
  assert.ok(calls.some(c=>c[0]==="eq"&&c[1]==="driver_id"&&c[2]==="driver"));
  assert.equal(vm.runInContext("PAGOS_ERROR",context),"Sin conexión");
  response={data:[{id:1}],error:null};
  await context.loadGan();
  assert.equal(vm.runInContext("PAGOS_ERROR",context),"");
  assert.equal(vm.runInContext("PAGOS.length",context),1);
});

test("payment display distinguishes unavailable data from an empty account",()=>{
  const elements=Object.fromEntries(["glabel","gtot","gsub","bars","gdes","gflo","gflota","gpag"].map(id=>
    [id,{innerHTML:"",textContent:"",classList:{toggle(){}}}]));
  const context=vm.createContext({
    $:id=>elements[id],ACC:{es_flotillero:false},PAGOS_ERROR:"Error de permisos",WALMART_TARIFARIO_ENABLED:false,
    BOLSA_WALMART:null,BOLSA_WALMART_ERROR:"",
    esc:s=>s,NO_SHOW_CASES:[],PAGOS:[],gp:"sem",fmt:n=>"$"+n
  });
  const start=app.indexOf("const parseF=");
  const end=app.indexOf('\ndocument.querySelectorAll("#gseg button")',start);
  vm.runInContext(app.slice(start,end),context);
  context.drawG();
  assert.equal(elements.gtot.textContent,"—");
  assert.match(elements.gpag.innerHTML,/No se pudieron cargar los pagos: Error de permisos/);
  context.PAGOS_ERROR="";
  context.drawG();
  assert.match(elements.gsub.textContent,/incluye pendientes y pagados/);
  assert.match(elements.gpag.innerHTML,/Aún no tienes pagos registrados/);
});

test("only flotilleros load the Walmart wallet, and its releases join the payment history",async()=>{
  const calls=[],elements={"t-gan":{innerHTML:"",insertAdjacentHTML(){}}};
  const query={
    select(){return this},gte(){return this},order(){return this},eq(){return this},
    then(resolve,reject){return Promise.resolve({data:[{id:1}],error:null}).then(resolve,reject)}
  };
  const wallet={saldo:{saldo_total:775},plazo:{estado:"calculado",plazo_cumplido:false,
    disponible_desde:"2026-11-15T12:00:00Z"},liberacion_validada:false};
  const context=vm.createContext({
    ACC:{puede_ver_ganancias:true,es_flotillero:true},ME:{id:"owner"},WALMART_TARIFARIO_ENABLED:true,
    $:id=>elements[id],loadEstatus(){},drawG(){},
    sb:{from(){return query},rpc(name,args){
      calls.push([name,args]);
      if(name==="walmart_mi_bolsa")return Promise.resolve({data:wallet,error:null});
      if(name==="walmart_mis_movimientos_bolsa")return Promise.resolve({data:[
        {id:"release-1",concepto:"liberacion_retencion_walmart",monto:650,fecha:"2026-11-09",estatus:"pendiente"}
      ],error:null});
      throw new Error("RPC inesperado");
    }}
  });
  vm.runInContext(app.slice(app.indexOf("let PAGOS=[],PAGOS_ERROR="),app.indexOf("\nlet RUTAS_K=")),context);
  context.WALMART_TARIFARIO_ENABLED=false;
  await context.loadGan();
  assert.equal(calls.length,0);
  assert.equal(vm.runInContext("PAGOS.length",context),1);
  assert.equal(vm.runInContext("PAGOS_ERROR",context),"");
  context.WALMART_TARIFARIO_ENABLED=true;
  await context.loadGan();
  assert.deepEqual(calls.map(c=>c[0]),["walmart_mi_bolsa","walmart_mis_movimientos_bolsa"]);
  assert.equal(vm.runInContext("PAGOS.length",context),2);
  assert.equal(vm.runInContext("PAGOS[1].bolsa_walmart",context),true);
  assert.equal(vm.runInContext("BOLSA_WALMART.saldo.saldo_total",context),775);
  context.ACC.es_flotillero=false;
  const count=calls.length;
  await context.loadGan();
  assert.equal(calls.length,count);
  context.ACC.puede_ver_ganancias=false;
  await context.loadGan();
  assert.equal(calls.length,count);
});

test("the flotillero wallet displays the due date without promising a payment",()=>{
  const elements=Object.fromEntries(["glabel","gtot","gsub","bars","gdes","gflo","gflota","gpag"].map(id=>
    [id,{innerHTML:"",textContent:"",classList:{toggle(){}}}]));
  const context=vm.createContext({
    $:id=>elements[id],ACC:{es_flotillero:true},PAGOS_ERROR:"",WALMART_TARIFARIO_ENABLED:true,
    BOLSA_WALMART:{saldo:{saldo_total:775},plazo:{estado:"calculado",plazo_cumplido:false,
      disponible_desde:"2026-11-15T12:00:00Z"},liberacion_validada:false},BOLSA_WALMART_ERROR:"",
    esc:s=>s,NO_SHOW_CASES:[],PAGOS:[],gp:"sem",fmt:n=>"$"+n
  });
  const start=app.indexOf("const parseF=");
  const end=app.indexOf('\ndocument.querySelectorAll("#gseg button")',start);
  vm.runInContext(app.slice(start,end),context);
  context.drawG();
  assert.match(elements.gpag.innerHTML,/Bolsa Walmart retenida: \$775/);
  assert.match(elements.gpag.innerHTML,/El plazo de retención vence el/);
  assert.match(elements.gpag.innerHTML,/no autoriza ni confirma la liberación/);
  context.BOLSA_WALMART.plazo={estado:"requiere_revision",plazo_cumplido:false};
  context.drawG();
  assert.match(elements.gpag.innerHTML,/no se puede estimar el vencimiento/);
  assert.doesNotMatch(elements.gpag.innerHTML,/venció el/);
});

test("weekly payment total includes a manual adjustment",()=>{
  const elements=Object.fromEntries(["glabel","gtot","gsub","bars","gdes","gflo","gflota","gpag"].map(id=>
    [id,{innerHTML:"",textContent:"",classList:{toggle(){}}}]));
  const date=new Date(),dateStr=[date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
  const context=vm.createContext({
    $:id=>elements[id],ACC:{es_flotillero:true},PAGOS_ERROR:"",WALMART_TARIFARIO_ENABLED:true,
    BOLSA_WALMART:null,BOLSA_WALMART_ERROR:"",
    esc:s=>s,NO_SHOW_CASES:[],gp:"sem",fmt:n=>"$"+n,
    PAGOS:[
      {id:1,concepto:"servicio",monto:100,fecha:dateStr,estatus:"pendiente",drivers:{nombre:"Conductor"}},
      {id:2,concepto:"ajuste",monto:-20,fecha:dateStr,estatus:"pendiente",drivers:{nombre:"Conductor"}}
    ]
  });
  const start=app.indexOf("const parseF=");
  const end=app.indexOf('\ndocument.querySelectorAll("#gseg button")',start);
  vm.runInContext(app.slice(start,end),context);
  context.drawG();
  assert.equal(elements.gtot.textContent,"$80");
  assert.match(elements.gdes.innerHTML,/Ajustes<\/span><b>\$-20/);
  assert.match(elements.gflo.innerHTML,/Conductor<\/span><b>\$80/);
  assert.doesNotMatch(elements.gdes.innerHTML,/Liberación retención Walmart/);
});
