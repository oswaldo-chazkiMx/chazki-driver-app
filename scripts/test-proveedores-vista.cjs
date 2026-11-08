const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "ops.js"), "utf8");
const escapeFunction = source.slice(0, source.indexOf("\n"));
const view = source.slice(source.indexOf("function vistaProveedores()"), source.indexOf("let PADRON="));

function render(drivers, providers, isOps = true) {
  const context = vm.createContext({ DRV: drivers, PRV: providers, esOps: () => isOps });
  vm.runInContext(escapeFunction + "\n" + view, context);
  return vm.runInContext("vistaProveedores()", context);
}

test("the fleet view excludes staff but retains drivers, fleet owners and existing provider labels", () => {
  const drivers = [
    { id: "staff-id", nombre: "Personal administrativo", rol: "ih", proveedor_id: 1 },
    { id: "driver-id", nombre: "Driver", rol: "driver", proveedor_id: 1 },
    { id: "owner-id", nombre: "Flotillero", rol: "flotillero", proveedor_id: 1 }
  ];
  const html = render(drivers, [{ id: 1, nombre: "Proveedor", tipo: "flotillero", titular_id: "staff-id" }]);
  assert.match(html, /data-gd="driver-id"/);
  assert.match(html, /data-gd="owner-id"/);
  assert.doesNotMatch(html, /data-gd="staff-id"/);
  assert.doesNotMatch(html, /<option value="staff-id">/);
  assert.match(html, /Personal administrativo/);
  assert.match(html, /El personal administrativo se consulta en Equipo/);
});

test("the fleet view handles an empty driver list and leaves other roles read-only", () => {
  assert.match(render([{ id: "s", nombre: "Supervisor", rol: "ih" }], []), /No hay drivers ni flotilleros registrados/);
  const html = render([{ id: "d", nombre: "Driver", rol: "driver" }], [], false);
  assert.doesNotMatch(html, /data-gd=/);
  assert.match(html, /Proveedores/);
});
