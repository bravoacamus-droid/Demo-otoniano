-- Inicio: lo que debemos incluye los préstamos recibidos por devolver (igual que 20261102000004 + prestamos_por_pagar)
create or replace function dashboard(p_empresa uuid)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'caja',               p.caja,
    'stock_costo',        p.stock_costo,
    'stock_precio_venta', p.stock_precio_venta,
    'en_transito',        p.en_transito,
    'por_cobrar',         p.por_cobrar,
    'cuentas_por_cobrar', p.cuentas_por_cobrar,
    'cuentas_por_pagar',  p.cuentas_por_pagar,
    'prestamos_por_pagar', p.prestamos_por_pagar,
    'capital',            p.capital,
    'activos',            p.activos,
    'ganancia_acumulada', p.ganancia_acumulada,
    'periodo',            periodo_de(now()),
    'utilidad_mes',       coalesce(r.utilidad, 0),
    'ventas_mes',         coalesce(r.ventas, 0),
    'compras_mes',        coalesce(r.compras, 0),
    'gastos_mes',         coalesce(r.gastos, 0),
    'merma_mes',          coalesce(r.merma_total, 0),
    'hoy_compras_n',      hc.n, 'hoy_compras_kg', hc.kg, 'hoy_compras_importe', hc.importe,
    'hoy_ventas_n',       hv.n, 'hoy_ventas_kg', hv.kg,
    'ventas_pendientes',  (select count(*) from ventas where empresa_id = p_empresa and estado = 'pendiente'),
    'por_seleccionar',    (select count(*) from v_compras where empresa_id = p_empresa and por_seleccionar),
    'selecciones_retrasadas', (select count(*) from v_compras where empresa_id = p_empresa and retrasada))
  from v_patrimonio p
  left join v_resultado_mes r on r.empresa_id = p.empresa_id and r.periodo = periodo_de(now())
  cross join lateral (
    select count(distinct co.id) as n, coalesce(sum(ci.peso_neto_kg), 0) as kg, coalesce(sum(ci.importe), 0) as importe
      from compras co join compra_items ci on ci.compra_id = co.id
     where co.empresa_id = p_empresa and co.estado = 'registrada'
       and (co.fecha at time zone 'America/Lima')::date = (now() at time zone 'America/Lima')::date) hc
  cross join lateral (
    select count(distinct ve.id) as n, coalesce(sum(vi.peso_salida_kg), 0) as kg
      from ventas ve join venta_items vi on vi.venta_id = ve.id
     where ve.empresa_id = p_empresa and ve.estado <> 'anulada'
       and (ve.fecha at time zone 'America/Lima')::date = (now() at time zone 'America/Lima')::date) hv
  where p.empresa_id = p_empresa
$$;

