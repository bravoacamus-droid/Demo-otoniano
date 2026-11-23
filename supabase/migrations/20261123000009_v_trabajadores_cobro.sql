-- v_trabajadores se creó con t.*: se vuelve a crear para que tome los datos de cobro (20261123000008)
drop view v_trabajadores;
create view v_trabajadores with (security_invoker = on) as
select t.*,
       case when t.fecha_cese is not null and t.fecha_cese < (now() at time zone 'America/Lima')::date
            then 'cesado' else 'activo' end as situacion,
       coalesce(t.fecha_cese, (now() at time zone 'America/Lima')::date) - t.fecha_ingreso as dias_en_empresa
  from trabajadores t;
