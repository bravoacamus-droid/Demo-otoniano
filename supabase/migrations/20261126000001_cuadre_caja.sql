-- Cuadre de caja (llamada del 26/11): el saldo de todas las cajas explicado como
-- capital de los socios + ventas cobradas − compras pagadas − gastos ± lo demás.
-- Lo comprado a crédito no salió de caja: se muestra aparte (por pagar).
create view v_cuadre_caja with (security_invoker = on) as
with m as (
  select empresa_id, origen,
         sum(case when tipo = 'ingreso' then monto else -monto end) as neto
    from movimientos_caja
   where not anulado
   group by empresa_id, origen
),
cr as (
  select empresa_id,
         coalesce(sum(saldo) filter (where tipo = 'por_pagar'), 0)  as compras_por_pagar,
         coalesce(sum(saldo) filter (where tipo = 'por_cobrar'), 0) as ventas_por_cobrar
    from v_creditos
   where estado = 'registrada'
   group by empresa_id
)
select e.id as empresa_id,
       coalesce(sum(m.neto) filter (where m.origen = 'aporte'), 0)  as aportes,
       coalesce(sum(m.neto) filter (where m.origen = 'venta'), 0)   as ventas,
       coalesce(sum(m.neto) filter (where m.origen = 'compra'), 0)  as compras,
       coalesce(sum(m.neto) filter (where m.origen = 'gasto'), 0)   as gastos,
       coalesce(sum(m.neto) filter (where m.origen = 'retiro'), 0)  as retiros,
       coalesce(sum(m.neto) filter (where m.origen not in ('aporte', 'venta', 'compra', 'gasto', 'retiro')), 0) as otros,
       coalesce(sum(m.neto), 0) as saldo,
       coalesce(max(cr.compras_por_pagar), 0) as compras_por_pagar,
       coalesce(max(cr.ventas_por_cobrar), 0) as ventas_por_cobrar
  from empresas e
  left join m on m.empresa_id = e.id
  left join cr on cr.empresa_id = e.id
 group by e.id;
