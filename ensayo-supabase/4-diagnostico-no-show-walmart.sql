-- SOLO LECTURA. Ejecutar completo en el Supabase de pruebas.
-- Cuenta los casos anteriores sin mostrar datos personales ni modificar pagos.
-- Ninguna categoria autoriza migrar o liberar dinero automaticamente.
with casos as (
  select c.*,
    p.id as descuento_encontrado,p.driver_id as descuento_driver,p.proveedor_id as descuento_proveedor,
    p.ruta_id as descuento_ruta,p.concepto as descuento_concepto,p.monto as descuento_monto,
    p.estatus as descuento_estatus,
    r.id as reversion_encontrada,r.driver_id as reversion_driver,r.proveedor_id as reversion_proveedor,
    r.ruta_id as reversion_ruta,r.concepto as reversion_concepto,r.monto as reversion_monto,
    r.estatus as reversion_estatus
  from public.no_show_casos c
  left join public.pagos p on p.id=c.pago_penalizacion_id
  left join public.pagos r on r.id=c.pago_reversion_id
  where upper(btrim(c.cuenta))='WALMART'
    and c.metodo_calculo is distinct from 'walmart_60_saldo'
), clasificados as (
  select estado,
    case
      when cuenta is distinct from 'WALMART' then 'cuenta_no_normalizada'
      when proveedor_id is null then 'sin_proveedor_requiere_revision'
      when monto_penalizacion is null or monto_penalizacion<0 then 'monto_invalido'
      when pago_penalizacion_id is null and pago_reversion_id is null then 'sin_movimiento_requiere_revision'
      when pago_penalizacion_id is null or descuento_encontrado is null then 'descuento_faltante'
      when descuento_driver is distinct from driver_id
        or descuento_proveedor is distinct from proveedor_id
        or descuento_ruta is not null or descuento_concepto is distinct from 'ajuste'
        or descuento_monto is distinct from -monto_penalizacion
        or descuento_estatus not in ('pendiente','pagado') or descuento_estatus is null
        then 'descuento_inconsistente'
      when estado='apelacion_aceptada' and pago_reversion_id is null then 'reversion_faltante'
      when estado<>'apelacion_aceptada' and pago_reversion_id is not null then 'reversion_inesperada'
      when pago_reversion_id is not null and (
        reversion_encontrada is null or reversion_driver is distinct from driver_id
        or reversion_proveedor is distinct from proveedor_id or reversion_ruta is not null
        or reversion_concepto is distinct from 'ajuste'
        or reversion_monto is distinct from monto_penalizacion
        or reversion_estatus not in ('pendiente','pagado') or reversion_estatus is null
      ) then 'reversion_inconsistente'
      when estado='apelacion_aceptada' then 'descuento_y_reversion_existentes'
      when estado='apelado' then 'descuento_con_apelacion_pendiente'
      when estado='reportado' and vence_apelacion_en>now() then 'descuento_con_plazo_abierto'
      when estado in ('reportado','apelacion_rechazada') then 'descuento_existente'
      else 'estado_requiere_revision'
    end as diagnostico
  from casos
)
select diagnostico,estado,count(*) as casos
from clasificados
group by diagnostico,estado
union all
select 'sin_casos_anteriores',null::text,0::bigint
where not exists (select 1 from clasificados)
order by diagnostico,estado;
