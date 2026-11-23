-- Valor nuevo del enum (archivo aparte: un valor agregado no puede usarse en la misma transacción)
--  · 'prestamo': dinero prestado a un socio u otra persona (sale de caja y queda por cobrar) y su devolución
alter type origen_mov_caja add value if not exists 'prestamo';
