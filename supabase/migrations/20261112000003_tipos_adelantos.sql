-- Valor nuevo del enum (archivo aparte: un valor agregado no puede usarse en la misma transacción)
--  · 'adelanto': dinero que se le da al proveedor antes de que traiga su mercadería
alter type origen_mov_caja add value if not exists 'adelanto';
