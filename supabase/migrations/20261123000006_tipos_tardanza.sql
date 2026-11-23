-- Valor nuevo del enum (archivo aparte: un valor agregado no puede usarse en la misma transacción)
--  · 'tardanza': asistió pero llegó tarde (cuenta como día trabajado y descuenta los minutos de retraso)
alter type estado_asistencia add value if not exists 'tardanza' after 'asistio';
