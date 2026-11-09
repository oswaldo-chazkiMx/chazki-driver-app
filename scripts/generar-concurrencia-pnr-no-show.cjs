const fs=require("node:fs");
const path=require("node:path");
const {execFileSync}=require("node:child_process");

const root=path.join(__dirname,"..");
execFileSync(process.execPath,[path.join(__dirname,"generar-concurrencia-no-show.cjs"),"--check"]);
const read=name=>fs.readFileSync(path.join(root,name),"utf8").replace(/\r\n/g,"\n");
const extract=(text,start,end)=>{
  const first=text.indexOf(start),last=text.indexOf(end,first);
  if(first<0||last<0)throw new Error(`No se encontro ${start}`);
  return text.slice(first,last);
};
const swap=(text,changes)=>{
  for(const [from,to] of changes){
    if(!text.includes(from))throw new Error(`Falta dependencia: ${from}`);
    text=text.replaceAll(from,to);
  }
  return text;
};
const pnr=swap(extract(read("pnr-claims-workflow.sql"),
  "create or replace function public.aplicar_descuentos_pnr_a_pago()",
  "\ndrop trigger if exists aplicar_descuentos_pnr_a_pago"),[
  ["public.aplicar_descuentos_pnr_a_pago","ensayo_walmart_pago.aplicar_pnr"],
  ["public.pnr_descuentos_aplicaciones","ensayo_walmart_pago.pnr_aplicaciones"],
  ["public.pnr_descuentos","ensayo_walmart_pago.pnr_descuentos"],
  ["public.pnr_reclamo_eventos","ensayo_walmart_pago.pnr_eventos"],
  ["public.liquidaciones","ensayo_walmart_pago.liquidaciones"],
  ["set search_path = public, pg_temp","set search_path = ''"]
]);
const noShow=swap(extract(read("walmart-no-show-borrador.sql"),
  "create or replace function private.walmart_no_show_en_pago_ruta()",
  "\nrevoke all on function private.walmart_no_show_en_pago_ruta"),[
  ["private.walmart_no_show_en_pago_ruta","ensayo_walmart_pago.aplicar_no_show"],
  ["private.walmart_no_show_rutas","ensayo_walmart_pago.rutas"],
  ["private.walmart_verificar_casos_no_show","ensayo_walmart_pago.verificar"],
  ["private.walmart_aplicar_saldos_no_show","ensayo_walmart_pago.aplicar"],
  ["public.liquidaciones","ensayo_walmart_pago.liquidaciones"]
]);
const locker=swap(extract(read("walmart-no-show-flujo-borrador.sql"),
  "create or replace function private.walmart_no_show_bloquear(",
  "\nrevoke all on function private.walmart_no_show_bloquear"),[
  ["private.walmart_no_show_bloquear","ensayo_walmart_pago.bloquear"]
]);
let setup=read(path.join("ensayo-supabase","8-concurrencia-preparar.sql"))
  .replaceAll("ensayo_walmart_concurrencia","ensayo_walmart_pago")
  .replaceAll("walmart-no-show-concurrencia-v1","walmart-pnr-no-show-concurrencia-v1");
const extra=`
  create table ensayo_walmart_pago.pnr_descuentos(
    reclamo_id uuid primary key,driver_id uuid,saldo_pendiente numeric,
    monto_aplicado numeric,creado_en timestamptz,aplicado_en timestamptz
  );
  create table ensayo_walmart_pago.pnr_aplicaciones(reclamo_id uuid,driver_id uuid,ruta_id text,monto numeric);
  create table ensayo_walmart_pago.pnr_eventos(reclamo_id uuid,tipo text,mensaje text);
  create table ensayo_walmart_pago.liquidaciones(ruta_id bigint primary key,dcto_pago numeric,pago_driver numeric);
  create table ensayo_walmart_pago.rutas(ruta_id bigint primary key,proveedor_id bigint,driver_id uuid);
  create table ensayo_walmart_pago.pagos(
    id bigint primary key,driver_id uuid,proveedor_id bigint,ruta_id bigint,concepto text,monto numeric,estatus text
  );
  execute $funcion_ensayo$
    create function ensayo_walmart_pago.verificar(bigint,uuid) returns void language plpgsql as 'begin return; end'
  $funcion_ensayo$;
  execute $funcion_ensayo$
${pnr}
  $funcion_ensayo$;
  execute $funcion_ensayo$
${noShow}
  $funcion_ensayo$;
  execute $funcion_ensayo$
${locker}
  $funcion_ensayo$;
  create trigger aplicar_descuentos_pnr_a_pago before insert or update of monto,estatus
    on ensayo_walmart_pago.pagos for each row execute function ensayo_walmart_pago.aplicar_pnr();
  create trigger zz_walmart_no_show_en_pago_ruta before insert
    on ensayo_walmart_pago.pagos for each row execute function ensayo_walmart_pago.aplicar_no_show();
  insert into ensayo_walmart_pago.pnr_descuentos values (
    '00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',1000,0,now(),null
  );
  insert into ensayo_walmart_pago.rutas values
    (-9223372036854775807,-9223372036854775808,'00000000-0000-0000-0000-000000000002'),
    (-9223372036854775806,-9223372036854775808,'00000000-0000-0000-0000-000000000002');
  insert into ensayo_walmart_pago.liquidaciones values (-9223372036854775807,0,2000),(-9223372036854775806,0,2000);
`;
const tail="end;\n$instalacion_ensayo$;\n";
if(!setup.endsWith(tail))throw new Error("Cambio inesperado en la preparacion del ensayo aislado");
setup=setup.slice(0,-tail.length)+extra+tail;
const a=`-- SOLO EN PRUEBAS. Ejecutar despues del archivo 13.
-- Mientras espera, ejecutar el archivo 15 desde la segunda sesion.
do $ensayo$
begin
  perform ensayo_walmart_pago.bloquear(-9223372036854775808,'00000000-0000-0000-0000-000000000002');
  insert into ensayo_walmart_pago.pagos values (
    1,'00000000-0000-0000-0000-000000000002',-9223372036854775808,
    -9223372036854775807,'servicio',2000,'pendiente'
  );
  perform pg_catalog.pg_sleep(45);
end;
$ensayo$;
`;
const b=`-- SOLO EN PRUEBAS. Ejecutar mientras sigue corriendo el archivo 14.
do $ensayo$
declare v_inicio timestamptz;
begin
  v_inicio:=pg_catalog.clock_timestamp();
  perform ensayo_walmart_pago.bloquear(-9223372036854775808,'00000000-0000-0000-0000-000000000002');
  if pg_catalog.clock_timestamp()-v_inicio<interval '2 seconds' then
    raise exception 'Las sesiones no coincidieron al menos 2 segundos; repite el ensayo';
  end if;
  insert into ensayo_walmart_pago.pagos values (
    2,'00000000-0000-0000-0000-000000000002',-9223372036854775808,
    -9223372036854775806,'servicio',2000,'pendiente'
  );
end;
$ensayo$;
`;
const verify=`-- SOLO EN PRUEBAS. Ejecutar al terminar los archivos 14 y 15.
-- Si no hay error, valida saldos y elimina el esquema aislado.
do $ensayo$
begin
  if not exists (select 1 from ensayo_walmart_pago.marca where id='walmart-pnr-no-show-concurrencia-v1') then
    raise exception 'Marca del esquema distinta';
  end if;
  if not exists (select 1 from ensayo_walmart_pago.pnr_descuentos where saldo_pendiente=0 and monto_aplicado=1000)
    or not exists (select 1 from ensayo_walmart_pago.saldos where saldo_pendiente=0 and monto_aplicado=2700)
    or (select count(*) from ensayo_walmart_pago.pnr_aplicaciones)<>1
    or (select count(*) from ensayo_walmart_pago.aplicaciones)<>2
    or not exists (select 1 from ensayo_walmart_pago.pagos where id=1 and monto=0)
    or not exists (select 1 from ensayo_walmart_pago.pagos where id=2 and monto=300)
    or not exists (select 1 from ensayo_walmart_pago.liquidaciones where ruta_id=-9223372036854775807 and dcto_pago=2000 and pago_driver=0)
    or not exists (select 1 from ensayo_walmart_pago.liquidaciones where ruta_id=-9223372036854775806 and dcto_pago=1700 and pago_driver=300) then
    raise exception 'ENSAYO FALLIDO: prioridad o saldo incorrecto';
  end if;
  drop schema ensayo_walmart_pago cascade;
end;
$ensayo$;
`;
const cleanup=read(path.join("ensayo-supabase","12-concurrencia-limpiar.sql"))
  .replaceAll("ensayo_walmart_concurrencia","ensayo_walmart_pago")
  .replaceAll("walmart-no-show-concurrencia-v1","walmart-pnr-no-show-concurrencia-v1");
for(const [name,contents] of [
  ["13-pnr-no-show-preparar.sql",setup],["14-pnr-no-show-pago-a.sql",a],
  ["15-pnr-no-show-pago-b.sql",b],["16-pnr-no-show-verificar.sql",verify],
  ["17-pnr-no-show-limpiar.sql",cleanup]
]){
  const file=path.join(root,"ensayo-supabase",name);
  if(process.argv.includes("--check")){
    if(!fs.existsSync(file)||fs.readFileSync(file,"utf8")!==contents)throw new Error(`${name}: regenerar el ensayo`);
  }else fs.writeFileSync(file,contents);
}
console.log(process.argv.includes("--check")?"Ensayo PNR actualizado":"Ensayo PNR generado");
