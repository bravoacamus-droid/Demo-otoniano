-- =============================================================================
-- Valores nuevos de enums (reunión del 06/11). Archivo aparte: un valor agregado
-- no puede usarse en la misma transacción en que se crea.
--  · 'retiro_utilidad': el socio se lleva (parte de) su utilidad. Sale de caja pero NO
--    baja el capital: baja la ganancia acumulada.
--  · 'capitalizacion': el socio deja su utilidad en el negocio. No mueve caja: pasa de
--    ganancia acumulada a capital.
-- =============================================================================
alter type tipo_aporte add value if not exists 'retiro_utilidad';
alter type tipo_aporte add value if not exists 'capitalizacion';
