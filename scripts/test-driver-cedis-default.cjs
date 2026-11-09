const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

for (const file of ["app.js", path.join("driver-app", "app.js")]) {
  test(`${file} prefills the saved CEDIS and falls back to the saved client`, () => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const start = source.indexOf("function prefillCliente(){");
    const end = source.indexOf("\nfunction fillClientes(sel)", start);
    assert.ok(start >= 0 && end > start, `prefillCliente must exist in ${file}`);
    const selects = { cli: {value:""}, ccli:{value:""}, cedis:{value:""}, ccedis:{value:""}, "cli-hint":{textContent:""} };
    const calls = [];
    const context = vm.createContext({
      DRIVER: {cedis_default_id:5,cliente_default_id:7},
      CLI: [{id:7,nombre:"Cliente",cedis:[{id:5,nombre:"Centro habitual"},{id:6,nombre:"Otro centro"}]}],
      $: id => selects[id],
      fillCedis: (select,id) => { select.value=""; calls.push(["fill",id]); },
      cliName: id => id===7?"Cliente":"",
      checkIn: () => calls.push(["checkIn"]),
      checkCan: () => calls.push(["checkCan"])
    });
    vm.runInContext(source.slice(start,end),context);
    vm.runInContext("prefillCliente()",context);
    assert.equal(selects.cli.value,"7");
    assert.equal(selects.cedis.value,"5");
    assert.equal(selects.ccli.value,"7");
    assert.equal(selects.ccedis.value,"5");
    assert.match(selects["cli-hint"].textContent,/CEDIS habitual/);

    vm.runInContext("DRIVER={cliente_default_id:7}; prefillCliente()",context);
    assert.equal(selects.cli.value,"7");
    assert.equal(selects.ccli.value,"7");
    assert.equal(selects.cedis.value,"");
    assert.equal(selects.ccedis.value,"");
    assert.match(selects["cli-hint"].textContent,/cliente habitual/);
  });
}
