-- BORRADOR: no ejecutar ni publicar. Falta integrar autorizaciones y pagos.
-- El disponible se debe obtener despues de aplicar los descuentos prioritarios.
begin;

create or replace function private.postvalorizacion_fiscal(
  p_base numeric, p_registro text, p_retencion numeric, p_comision numeric, p_iva numeric
) returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  v_retencion numeric := 0;
  v_neto numeric;
  v_iva numeric := 0;
  v_comision numeric := 0;
begin
  if p_base is null or p_base::text in ('NaN','Infinity','-Infinity')
    or p_base < 0 or p_base > 9999999999.99 or p_base <> round(p_base,2)
    or p_registro is null or p_registro not in ('FACTURA','SIN FACTURA')
    or p_retencion is null or p_retencion::text in ('NaN','Infinity','-Infinity')
    or p_retencion < 0 or p_retencion >= 1
    or p_comision is null or p_comision::text in ('NaN','Infinity','-Infinity')
    or p_comision not between 0 and 1
    or p_iva is null or p_iva::text in ('NaN','Infinity','-Infinity')
    or p_iva not between 0 and 1 then
    raise exception 'Datos fiscales invalidos para la post valorizacion';
  end if;
  if p_registro='SIN FACTURA' then v_retencion:=round(p_base*p_retencion,2); end if;
  v_neto:=p_base-v_retencion;
  if p_registro='SIN FACTURA' then v_comision:=round(v_neto*p_comision,2); end if;
  if p_registro='FACTURA' then v_iva:=round(v_neto*p_iva,2); end if;
  return jsonb_build_object(
    'base',p_base,'retencion_fiscal',v_retencion,'neto',v_neto,
    'comision',v_comision,'iva',v_iva,'pago_proveedor',v_neto+v_iva
  );
end;
$$;
revoke all on function private.postvalorizacion_fiscal(numeric,text,numeric,numeric,numeric)
  from public, anon, authenticated;

create or replace function private.postvalorizacion_calcular(
  p_cuenta text, p_tipo text, p_base numeric, p_disponible numeric,
  p_registro text, p_retencion numeric, p_comision numeric, p_iva numeric
) returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  v_aplicado numeric;
  v_fiscal jsonb;
  v_bajo numeric;
  v_alto numeric;
  v_medio numeric;
  v_signo integer;
begin
  if p_cuenta is null or p_cuenta not in ('COPPEL','WALMART')
    or p_tipo is null or p_tipo not in ('abono','descuento')
    or p_base is null or p_base::text in ('NaN','Infinity','-Infinity')
    or p_base <= 0 or p_base > 9999999999.99 or p_base <> round(p_base,2)
    or p_disponible is null or p_disponible::text in ('NaN','Infinity','-Infinity')
    or p_disponible < 0 or p_disponible > 9999999999.99
    or p_disponible <> round(p_disponible,2) then
    raise exception 'Datos invalidos para la post valorizacion';
  end if;
  v_fiscal:=private.postvalorizacion_fiscal(p_base,p_registro,p_retencion,p_comision,p_iva);
  v_aplicado:=p_base;
  if p_tipo='descuento' then
    v_bajo:=0;
    v_alto:=case when p_disponible=0 then 0 else p_base*100 end;
    while v_bajo<v_alto loop
      v_medio:=floor((v_bajo+v_alto+1)/2);
      v_fiscal:=private.postvalorizacion_fiscal(v_medio/100,p_registro,p_retencion,p_comision,p_iva);
      if (v_fiscal->>'pago_proveedor')::numeric<=p_disponible then
        v_bajo:=v_medio;
      else
        v_alto:=v_medio-1;
      end if;
    end loop;
    v_aplicado:=v_bajo/100;
    v_fiscal:=private.postvalorizacion_fiscal(v_aplicado,p_registro,p_retencion,p_comision,p_iva);
  end if;
  v_signo:=case when p_tipo='descuento' then -1 else 1 end;
  return jsonb_build_object(
    'cuenta',p_cuenta,'tipo',p_tipo,'base_solicitada',p_base,
    'base_aplicada',v_aplicado,'base_pendiente',p_base-v_aplicado,
    'efecto_pago',v_signo*(v_fiscal->>'pago_proveedor')::numeric,
    'efecto_semanal',v_signo*(v_fiscal->>'pago_proveedor')::numeric,
    'efecto_saldo_retenido',0,'fiscal',v_fiscal
  );
end;
$$;
revoke all on function private.postvalorizacion_calcular(text,text,numeric,numeric,text,numeric,numeric,numeric)
  from public, anon, authenticated;

commit;
