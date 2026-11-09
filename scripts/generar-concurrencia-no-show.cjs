const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..");
const source=fs.readFileSync(path.join(root,"walmart-no-show-borrador.sql"),"utf8").replace(/\r\n/g,"\n");
const start=source.indexOf("create or replace function private.walmart_aplicar_saldos_no_show(");
const end=source.indexOf("\nrevoke all on function private.walmart_aplicar_saldos_no_show",start);
if(start<0||end<0)throw new Error("No se encontro la funcion de aplicacion NO SHOW");
let application=source.slice(start,end);
for(const [original,replacement] of [
  ["private.walmart_aplicar_saldos_no_show","ensayo_walmart_concurrencia.aplicar"],
  ["private.walmart_no_show_lotes","ensayo_walmart_concurrencia.lotes"],
  ["private.walmart_no_show_saldos","ensayo_walmart_concurrencia.saldos"],
  ["private.walmart_no_show_aplicaciones","ensayo_walmart_concurrencia.aplicaciones"],
  ["private.calcular_walmart_no_show_configurado","ensayo_walmart_concurrencia.calcular"],
  ["public.no_show_casos","ensayo_walmart_concurrencia.casos"]
]){
  if(!application.includes(original))throw new Error(`Falta la dependencia esperada: ${original}`);
  application=application.replaceAll(original,replacement);
}
if(application.includes("$funcion_ensayo$")||application.includes("$instalacion_ensayo$"))
  throw new Error("Delimitador SQL en conflicto");

const setup=`-- SOLO EN SUPABASE DE PRUEBAS. Crea un esquema aislado temporal.
-- Contiene datos ficticios aislados; no modifica tablas de la aplicacion.
-- Si ya existe el esquema, se detiene sin cambiarlo.
do $instalacion_ensayo$
begin
  if pg_catalog.to_regnamespace('ensayo_walmart_concurrencia') is not null then
    raise exception 'Ya existe ensayo_walmart_concurrencia; revisa antes de continuar';
  end if;
  create schema ensayo_walmart_concurrencia;
  create table ensayo_walmart_concurrencia.marca(id text primary key);
  insert into ensayo_walmart_concurrencia.marca values ('walmart-no-show-concurrencia-v1');
  create table ensayo_walmart_concurrencia.casos(
    id uuid primary key,estado text,vence_apelacion_en timestamptz,
    pago_penalizacion_id bigint,pago_reversion_id bigint,monto_penalizacion numeric,
    valor_servicio_contratado numeric,proveedor_id bigint,driver_id uuid,
    cedis_id bigint,fecha_servicio date,tipo_unidad text,cuenta text
  );
  create table ensayo_walmart_concurrencia.saldos(
    caso_id uuid primary key,proveedor_id bigint,driver_id uuid,calculo jsonb,
    monto numeric,saldo_pendiente numeric,monto_aplicado numeric,creado_en timestamptz
  );
  create table ensayo_walmart_concurrencia.lotes(
    tipo text,origen_id bigint,proveedor_id bigint,driver_id uuid,disponible numeric,
    aplicado numeric default 0,primary key(tipo,origen_id)
  );
  create table ensayo_walmart_concurrencia.aplicaciones(
    tipo text,origen_id bigint,caso_id uuid,monto numeric,primary key(tipo,origen_id,caso_id)
  );
  execute $funcion_ensayo$
    create function ensayo_walmart_concurrencia.calcular(bigint,date,text,smallint)
    returns jsonb language sql immutable as
    'select ''{"base_servicio":4500,"opcion":1}''::jsonb'
  $funcion_ensayo$;
  execute $funcion_ensayo$
${application}
  $funcion_ensayo$;
  insert into ensayo_walmart_concurrencia.casos values (
    '00000000-0000-0000-0000-000000000001','apelacion_rechazada',now()-interval '1 day',
    null,null,2700,4500,-9223372036854775808,'00000000-0000-0000-0000-000000000002',
    1,date '2026-11-09','3.5T','WALMART'
  );
  insert into ensayo_walmart_concurrencia.saldos values (
    '00000000-0000-0000-0000-000000000001',-9223372036854775808,
    '00000000-0000-0000-0000-000000000002','{"base_servicio":4500,"opcion":1}',
    2700,2700,0,now()
  );
end;
$instalacion_ensayo$;
`;
const sessionA=`-- SOLO EN PRUEBAS. Ejecutar despues del archivo 8.
-- Mientras esta consulta espera, ejecutar el archivo 10 en otra sesion.
do $ensayo$
declare v_resultado jsonb;
begin
  v_resultado:=ensayo_walmart_concurrencia.aplicar(
    'ruta',-9223372036854775807,-9223372036854775808,'00000000-0000-0000-0000-000000000002',2000
  );
  if (v_resultado->>'aplicado')::numeric<>2000 then raise exception 'Sesion A: descuento incorrecto'; end if;
  perform pg_catalog.pg_sleep(45);
end;
$ensayo$;
`;
const sessionB=`-- SOLO EN PRUEBAS. Ejecutar mientras sigue corriendo el archivo 9.
-- Espera a la primera transaccion, reintenta su origen y aplica el remanente.
do $ensayo$
declare v_reintento jsonb; v_otro jsonb; v_inicio timestamptz;
begin
  v_inicio:=pg_catalog.clock_timestamp();
  v_reintento:=ensayo_walmart_concurrencia.aplicar(
    'ruta',-9223372036854775807,-9223372036854775808,'00000000-0000-0000-0000-000000000002',2000
  );
  if pg_catalog.clock_timestamp()-v_inicio<interval '2 seconds' then
    raise exception 'Las sesiones no coincidieron al menos 2 segundos; repite el ensayo';
  end if;
  v_otro:=ensayo_walmart_concurrencia.aplicar(
    'ruta',-9223372036854775806,-9223372036854775808,'00000000-0000-0000-0000-000000000002',2000
  );
  if (v_reintento->>'aplicado')::numeric<>2000 or (v_otro->>'aplicado')::numeric<>700 then
    raise exception 'Sesion B: descuento o reintento incorrecto';
  end if;
end;
$ensayo$;
`;
const verify=`-- SOLO EN PRUEBAS. Ejecutar cuando hayan terminado los archivos 9 y 10.
-- Si no hay error, la verificacion paso y el esquema ficticio se elimino.
-- Si hay error, no se elimina: ejecuta el archivo 12 para limpiarlo.
do $ensayo$
declare v_saldo numeric; v_aplicado numeric; v_casos bigint; v_lotes bigint;
begin
  if not exists (select 1 from ensayo_walmart_concurrencia.marca where id='walmart-no-show-concurrencia-v1') then
    raise exception 'No coincide la marca del esquema de ensayo';
  end if;
  select saldo_pendiente,monto_aplicado into strict v_saldo,v_aplicado
    from ensayo_walmart_concurrencia.saldos;
  select count(*) into v_casos from ensayo_walmart_concurrencia.aplicaciones;
  select count(*) into v_lotes from ensayo_walmart_concurrencia.lotes;
  if v_saldo<>0 or v_aplicado<>2700 or v_casos<>2 or v_lotes<>2
    or not exists (select 1 from ensayo_walmart_concurrencia.lotes where tipo='ruta' and origen_id=-9223372036854775807 and aplicado=2000)
    or not exists (select 1 from ensayo_walmart_concurrencia.lotes where tipo='ruta' and origen_id=-9223372036854775806 and aplicado=700) then
    raise exception 'ENSAYO FALLIDO: saldos o reintentos inconsistentes';
  end if;
  drop schema ensayo_walmart_concurrencia cascade;
end;
$ensayo$;
`;
const cleanup=`-- SOLO EN PRUEBAS. Usar si el ensayo fallo o fue interrumpido.
-- No borra el esquema si su marca no coincide.
do $ensayo$
begin
  if pg_catalog.to_regnamespace('ensayo_walmart_concurrencia') is null then return; end if;
  if pg_catalog.to_regclass('ensayo_walmart_concurrencia.marca') is null then
    raise exception 'Esquema sin marca; no se eliminara';
  end if;
  if not exists (select 1 from ensayo_walmart_concurrencia.marca where id='walmart-no-show-concurrencia-v1') then
    raise exception 'Marca distinta; no se eliminara';
  end if;
  drop schema ensayo_walmart_concurrencia cascade;
end;
$ensayo$;
`;
const files=[
  ["8-concurrencia-preparar.sql",setup],
  ["9-concurrencia-pago-a.sql",sessionA],
  ["10-concurrencia-pago-b.sql",sessionB],
  ["11-concurrencia-verificar.sql",verify],
  ["12-concurrencia-limpiar.sql",cleanup]
];
for(const [name,contents] of files){
  const target=path.join(root,"ensayo-supabase",name);
  if(process.argv.includes("--check")){
    if(!fs.existsSync(target)||fs.readFileSync(target,"utf8")!==contents)
      throw new Error(`${name}: regenerar el ensayo de concurrencia`);
  }else fs.writeFileSync(target,contents);
}
console.log(process.argv.includes("--check")?"Ensayo de concurrencia actualizado":"Ensayo de concurrencia generado");
