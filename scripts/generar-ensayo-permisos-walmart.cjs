const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..");
const sources=[
  "walmart-tarifario.sql",
  "walmart-retencion-borrador.sql",
  "walmart-decision-retencion-borrador.sql",
  "walmart-no-show-borrador.sql",
  "walmart-no-show-flujo-borrador.sql",
  "walmart-precierre-no-show-borrador.sql",
  "walmart-liquidacion-borrador.sql",
  "walmart-cancelaciones-pagos-borrador.sql",
  "walmart-plazo-retencion-borrador.sql",
  "walmart-retencion-proveedor-borrador.sql",
  "walmart-bolsa-borrador.sql",
  "walmart-mapeo-tarifas-borrador.sql",
  "walmart-validacion-borrador.sql"
];
const statements=sources.map((name,index)=>{
  const raw=fs.readFileSync(path.join(root,name),"utf8").replace(/\r\n/g,"\n");
  if((raw.match(/^begin;$/gmi)||[]).length!==1||(raw.match(/^commit;$/gmi)||[]).length!==1)
    throw new Error(`${name}: se esperan exactamente BEGIN y COMMIT exteriores`);
  const body=raw.replace(/^begin;$/mi,"").replace(/^commit;$/mi,"");
  const delimiter=`$walmart_fuente_${index}$`;
  if(body.includes(delimiter)||body.includes("$walmart_ensayo$"))throw new Error(`${name}: delimitador en conflicto`);
  return `  -- ${name}\n  execute ${delimiter}\n${body}\n${delimiter};`;
});
const output=`-- ENSAYO REVERSIBLE: ejecutar solo en el proyecto de Supabase de pruebas.
-- Copia TODO el archivo. Es una sola sentencia: el error ENSAYO OK es intencional.
-- Al terminar, PostgreSQL revierte toda esta sentencia; no crea pagos persistentes.
do $walmart_ensayo$
begin
${statements.join("\n")}

  if has_table_privilege('anon','private.walmart_no_show_saldos','select')
    or has_table_privilege('authenticated','private.walmart_no_show_saldos','select')
    or has_table_privilege('authenticated','private.walmart_no_show_reportes','select')
    or has_table_privilege('authenticated','private.walmart_no_show_decisiones','select')
    or has_table_privilege('authenticated','private.walmart_liquidaciones','select')
    or has_table_privilege('authenticated','private.walmart_cancelaciones_pagadas','select')
    or has_table_privilege('anon','private.walmart_liberaciones_proveedor','select')
    or has_table_privilege('authenticated','private.walmart_liberaciones_proveedor','select')
    or has_table_privilege('authenticated','private.walmart_liberaciones_rutas','select')
    or has_table_privilege('authenticated','private.walmart_liberaciones_cancelaciones','select') then
    raise exception 'ENSAYO FALLIDO: un ledger privado tiene acceso directo';
  end if;
  if has_table_privilege('anon','private.walmart_bolsa_decisiones','select')
    or has_table_privilege('authenticated','private.walmart_bolsa_decisiones','select') then
    raise exception 'ENSAYO FALLIDO: las decisiones de bolsa permiten acceso directo';
  end if;
  if has_function_privilege('anon','public.walmart_previsualizar_no_show(bigint,date,text,bigint,smallint)','execute')
    or has_function_privilege('anon','public.walmart_crear_no_show(uuid,uuid,bigint,date,text,bigint,smallint,text,jsonb)','execute')
    or has_function_privilege('anon','public.walmart_resolver_apelacion_no_show(uuid,text,text)','execute')
    or has_function_privilege('anon','public.walmart_consultar_no_show_precierre(uuid,date)','execute')
    or has_function_privilege('anon','public.walmart_aplicar_no_shows_precierre(uuid,date,jsonb)','execute')
    or has_function_privilege('authenticated','public.walmart_aplicar_no_show_precierre(uuid,uuid,date,numeric)','execute')
    or has_function_privilege('anon','public.walmart_validar_ruta(bigint,boolean,boolean,jsonb)','execute')
    or has_function_privilege('anon','public.walmart_validar_cancelacion(bigint,bigint,text,boolean,jsonb)','execute')
    or has_function_privilege('anon','public.walmart_previsualizar_ruta_porcentaje(bigint,bigint,smallint,boolean,boolean)','execute')
    or has_function_privilege('anon','public.walmart_previsualizar_cancelacion_porcentaje(bigint,bigint,text,smallint)','execute')
    or has_function_privilege('anon','public.walmart_consultar_retencion_proveedor(bigint)','execute')
    or has_function_privilege('anon','public.walmart_mis_liberaciones(date)','execute')
    or has_function_privilege('anon','public.walmart_decidir_bolsa(uuid,bigint,jsonb,numeric,text,boolean)','execute')
    or has_function_privilege('anon','public.walmart_mi_bolsa()','execute')
    or has_function_privilege('anon','public.walmart_mis_movimientos_bolsa(date)','execute')
    or has_function_privilege('authenticated','private.walmart_bloqueos_retencion(bigint)','execute')
    or has_function_privilege('anon','private.walmart_registrar_liberacion(uuid,bigint,jsonb,text)','execute')
    or has_function_privilege('authenticated','private.walmart_registrar_liberacion(uuid,bigint,jsonb,text)','execute')
    or has_function_privilege('authenticated','private.walmart_drivers_historicos(bigint)','execute')
    or has_function_privilege('authenticated','private.walmart_saldo_retenido_sin_liberar(bigint)','execute')
    or not has_function_privilege('authenticated','public.walmart_previsualizar_no_show(bigint,date,text,bigint,smallint)','execute')
    or not has_function_privilege('authenticated','public.walmart_crear_no_show(uuid,uuid,bigint,date,text,bigint,smallint,text,jsonb)','execute')
    or not has_function_privilege('authenticated','public.walmart_resolver_apelacion_no_show(uuid,text,text)','execute')
    or not has_function_privilege('authenticated','public.walmart_consultar_no_show_precierre(uuid,date)','execute')
    or not has_function_privilege('authenticated','public.walmart_aplicar_no_shows_precierre(uuid,date,jsonb)','execute')
    or not has_function_privilege('authenticated','public.walmart_validar_ruta(bigint,boolean,boolean,jsonb)','execute')
    or not has_function_privilege('authenticated','public.walmart_validar_cancelacion(bigint,bigint,text,boolean,jsonb)','execute')
    or not has_function_privilege('authenticated','public.walmart_previsualizar_ruta_porcentaje(bigint,bigint,smallint,boolean,boolean)','execute')
    or not has_function_privilege('authenticated','public.walmart_previsualizar_cancelacion_porcentaje(bigint,bigint,text,smallint)','execute')
    or not has_function_privilege('authenticated','public.walmart_consultar_retencion_proveedor(bigint)','execute')
    or not has_function_privilege('authenticated','public.walmart_mis_liberaciones(date)','execute')
    or not has_function_privilege('authenticated','public.walmart_decidir_bolsa(uuid,bigint,jsonb,numeric,text,boolean)','execute')
    or not has_function_privilege('authenticated','public.walmart_mi_bolsa()','execute')
    or not has_function_privilege('authenticated','public.walmart_mis_movimientos_bolsa(date)','execute') then
    raise exception 'ENSAYO FALLIDO: permisos RPC inesperados';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated';
  begin
    perform public.walmart_previsualizar_no_show(1::bigint,current_date,'3.5T',1::bigint,1::smallint);
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario obtuvo acceso';
  exception when raise_exception then
    if sqlerrm<>'Solo el supervisor asignado puede revisar NO SHOW Walmart' then raise; end if;
  end;
  begin
    perform public.walmart_consultar_retencion_proveedor(1::bigint);
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario consulto la retencion';
  exception when raise_exception then
    if sqlerrm<>'Solo el supervisor asignado puede consultar la retencion del proveedor' then raise; end if;
  end;
  begin
    perform public.walmart_mis_liberaciones(current_date);
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario consulto pagos del proveedor';
  exception when raise_exception then
    if sqlerrm<>'Se requiere una sesion y fecha validas para consultar pagos' then raise; end if;
  end;
  begin
    perform public.walmart_decidir_bolsa(
      '00000000-0000-0000-0000-000000000001'::uuid,1::bigint,'{}'::jsonb,0::numeric,null,false
    );
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario decidio sobre la bolsa';
  exception when raise_exception then
    if sqlerrm<>'Solo el coordinador asignado puede decidir sobre la bolsa Walmart' then raise; end if;
  end;
  begin
    perform public.walmart_mi_bolsa();
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario consulto la bolsa';
  exception when raise_exception then
    if sqlerrm<>'Debes iniciar sesion' then raise; end if;
  end;
  begin
    perform public.walmart_mis_movimientos_bolsa(current_date);
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario consulto movimientos de bolsa';
  exception when raise_exception then
    if sqlerrm<>'Se requiere una sesion activa y fecha validas' then raise; end if;
  end;
  execute 'reset role';

  -- Aborta esta sentencia y revierte sus cambios, incluso si el editor no abre
  -- una transaccion explicita. Otros resultados o errores no indican exito.
  raise exception 'ENSAYO OK: permisos declarados y rechazo sin usuario verificados; cambios revertidos';
end;
$walmart_ensayo$;
`;
const target=path.join(root,"ensayo-supabase","5-ensayo-permisos-walmart.sql");
if(process.argv.includes("--check")){
  if(!fs.existsSync(target)||fs.readFileSync(target,"utf8")!==output)
    throw new Error("El ensayo de permisos no coincide con los borradores; vuelve a generarlo");
  console.log("Ensayo de permisos actualizado");
  process.exit(0);
}
fs.writeFileSync(target,output);
console.log("Ensayo generado: ensayo-supabase\\5-ensayo-permisos-walmart.sql");
