-- Maquinaria: lo pagado por la compra va aparte de los gastos de uso (reparación, combustible…):
-- «gastos», «gastos_caja» y «gastos_fuera» ya no incluyen la categoría «Compra»; «compra_pagada» la muestra sola.
create or replace view v_maquinas with (security_invoker = on) as
select q.*,
       coalesce(mi.nombre, mi.email) as creado_por_nombre,
       t.gastos, t.gastos_caja, t.gastos_fuera, t.ingresos, t.n_movimientos, t.ultimo_movimiento,
       t.compra_pagada
  from maquinas q
  left join miembros mi on mi.empresa_id = q.empresa_id and mi.user_id = q.creado_por
  cross join lateral (
    select coalesce(sum(monto) filter (where tipo = 'gasto' and categoria <> 'Compra'), 0)                    as gastos,
           coalesce(sum(monto) filter (where tipo = 'gasto' and categoria <> 'Compra' and origen = 'caja'), 0)  as gastos_caja,
           coalesce(sum(monto) filter (where tipo = 'gasto' and categoria <> 'Compra' and origen = 'fuera'), 0) as gastos_fuera,
           coalesce(sum(monto) filter (where tipo = 'ingreso'), 0)                                          as ingresos,
           count(*)                                                                                         as n_movimientos,
           max(fecha)                                                                                       as ultimo_movimiento,
           coalesce(sum(monto) filter (where tipo = 'gasto' and categoria = 'Compra'), 0)                   as compra_pagada
      from v_maquina_movimientos where maquina_id = q.id and estado = 'registrada') t;
