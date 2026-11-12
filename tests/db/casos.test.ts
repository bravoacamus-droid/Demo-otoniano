// Casos de prueba mínimos de la propuesta (§8) + aislamiento multiempresa (fase 0).
// Corren contra PGlite: pnpm test
import { beforeAll, describe, expect, it } from "vitest";
import { como, crearDb, uno, type Db } from "./harness";

const DUENO_A = "11111111-1111-1111-1111-111111111111";
const DUENO_B = "22222222-2222-2222-2222-222222222222";
const CAJERO_A = "33333333-3333-3333-3333-333333333333";

let db: Db;
let empA: string, empB: string, caja: string, cobre: string, bronce: string, comprador: string;

const num = (v: unknown) => Number(v);

async function stock(metal: string) {
  return como(db, DUENO_A, (tx) =>
    uno<{ kg: string; costo_total: string; costo_promedio: string | null }>(
      tx, `select kg, costo_total, costo_promedio from v_stock_metal where metal_id = $1`, [metal]));
}
async function saldoCaja() {
  return como(db, DUENO_A, (tx) =>
    uno<{ saldo: string }>(tx, `select saldo from v_saldo_caja where caja_id = $1`, [caja])).then((r) => num(r.saldo));
}
async function comprar(metal: string, bruto: string, desc: string, precio: string, user = DUENO_A) {
  return como(db, user, (tx) =>
    uno<{ r: { id: string; total: number } }>(tx,
      `select registrar_compra($1, $2::jsonb, $3) as r`,
      [empA, JSON.stringify([{ metal_id: metal, peso_bruto_kg: bruto, descuento_kg: desc, precio_kg: precio }]), caja],
    )).then((x) => x.r);
}

beforeAll(async () => {
  db = await crearDb();
  await db.query(`insert into auth.users (id, email) values ($1,'a@x.pe'), ($2,'b@x.pe'), ($3,'c@x.pe')`,
    [DUENO_A, DUENO_B, CAJERO_A]);
  empA = (await uno<{ id: string }>(db, `select admin_crear_empresa('Metales A SAC', null, 'a@x.pe') as id`)).id;
  empB = (await uno<{ id: string }>(db, `select admin_crear_empresa('Metales B SAC', null, 'b@x.pe') as id`)).id;
  await db.query(`select admin_agregar_miembro($1, $2, 'cajero', 'Cajero', 'c@x.pe')`, [empA, CAJERO_A]);
  caja = (await uno<{ id: string }>(db, `select id from cajas where empresa_id = $1 and tipo = 'efectivo'`, [empA])).id;

  await como(db, DUENO_A, async (tx) => {
    cobre = (await uno<{ id: string }>(tx,
      `insert into metales (empresa_id, nombre, precio_compra, precio_venta) values ($1, 'Cobre', 30, 34) returning id`, [empA])).id;
    bronce = (await uno<{ id: string }>(tx,
      `insert into metales (empresa_id, nombre, precio_compra, precio_venta) values ($1, 'Bronce', 20, 23) returning id`, [empA])).id;
    comprador = (await uno<{ id: string }>(tx,
      `insert into compradores (empresa_id, ruc, razon_social) values ($1, '20123456789', 'Fundición Lima SAC') returning id`, [empA])).id;
    // Capital inicial para que la caja tenga fondos
    const socio = (await uno<{ id: string }>(tx,
      `insert into socios (empresa_id, nombre, porcentaje) values ($1, 'Socio 1', 100) returning id`, [empA])).id;
    await tx.query(`select registrar_aporte_retiro($1, $2, 'aporte', 20000, $3)`, [empA, socio, caja]);
  });
});

describe("Fase 0 · multiempresa", () => {
  it("un usuario de la empresa B no ve nada de la A", async () => {
    await comprar(cobre, "1", "0", "30");
    const r = await como(db, DUENO_B, async (tx) => ({
      empresas: (await tx.query(`select id from empresas`)).rows,
      metales: (await tx.query(`select id from metales`)).rows,
      compras: (await tx.query(`select id from compras`)).rows,
      caja: (await tx.query(`select id from movimientos_caja`)).rows,
      stock: (await tx.query(`select * from v_stock_metal`)).rows,
      patrimonio: (await tx.query(`select * from v_patrimonio`)).rows,
    }));
    expect(r.empresas.map((e) => (e as { id: string }).id)).toEqual([empB]);
    expect(r.metales).toHaveLength(0);
    expect(r.compras).toHaveLength(0);
    expect(r.caja).toHaveLength(0);
    expect(r.stock).toHaveLength(0);
    expect(r.patrimonio).toHaveLength(1);
  });

  it("B no puede comprar en la empresa A", async () => {
    await expect(como(db, DUENO_B, (tx) =>
      tx.query(`select registrar_compra($1, '[]'::jsonb, $2)`, [empA, caja]))).rejects.toThrow(/No pertenece/);
  });

  it("no se puede escribir directo en compras ni movimientos_caja", async () => {
    await expect(como(db, DUENO_A, (tx) =>
      tx.query(`insert into movimientos_caja (empresa_id, caja_id, tipo, origen, monto) values ($1,$2,'ingreso','ajuste',100)`,
        [empA, caja]))).rejects.toThrow();
  });

  it("el cajero no edita precios del día ni anula", async () => {
    await expect(como(db, CAJERO_A, (tx) =>
      tx.query(`update metales set precio_compra = 1 where id = $1 returning id`, [cobre]).then((r) => {
        if (r.rows.length === 0) throw new Error("sin permiso");
      }))).rejects.toThrow();
    // Por defecto el operario digita el precio; si Gerencia lo restringe, la BD lo bloquea
    await como(db, DUENO_A, (tx) => tx.query(`update empresas set roles_editan_precio = '{dueno}' where id = $1`, [empA]));
    await expect(comprar(cobre, "1", "0", "25", CAJERO_A)).rejects.toThrow(/permiso para cambiar el precio/);
    await como(db, DUENO_A, (tx) => tx.query(
      `update empresas set roles_editan_precio = '{dueno,administrador,cajero,balancero}' where id = $1`, [empA]));
  });
});

describe("Casos de prueba §8", () => {
  it("1. compra 5.250 kg de cobre a S/ 30 con 0.250 de descuento", async () => {
    const s0 = await stock(cobre);
    const c0 = await saldoCaja();
    const r = await comprar(cobre, "5.250", "0.250", "30");
    expect(num(r.total)).toBe(150);
    expect(await saldoCaja()).toBeCloseTo(c0 - 150, 2);
    expect(num((await stock(cobre)).kg)).toBeCloseTo(num(s0.kg) + 5, 3);
  });

  it("2. dos compras a precios distintos → costo promedio ponderado", async () => {
    // bronce: 10 kg a 20 + 30 kg a 24 = 200 + 720 = 920 / 40 = 23
    await comprar(bronce, "10", "0", "20");
    await como(db, DUENO_A, (tx) => tx.query(`update metales set precio_compra = 24 where id = $1`, [bronce]));
    await comprar(bronce, "30", "0", "24");
    const s = await stock(bronce);
    expect(num(s.kg)).toBe(40);
    expect(num(s.costo_promedio)).toBe(23);
  });

  it("3. venta 4.000 kg salida, comprador recibe 3.950 → merma 0.050 valorizada a costo", async () => {
    // Bronce a costo 23: salida 4 kg = 92.00; recibido 3.95 → merma 0.05 × 23 = 1.15
    const v = await como(db, DUENO_A, (tx) =>
      uno<{ r: { id: string; estado: string } }>(tx, `select registrar_venta($1, $2, $3::jsonb) as r`,
        [empA, comprador, JSON.stringify([{ metal_id: bronce, peso_salida_kg: "4.000" }])])).then((x) => x.r);
    expect(v.estado).toBe("pendiente");
    expect(num((await stock(bronce)).kg)).toBe(36);

    const item = await como(db, DUENO_A, (tx) =>
      uno<{ id: string }>(tx, `select id from venta_items where venta_id = $1`, [v.id]));
    const c0 = await saldoCaja();
    await como(db, DUENO_A, (tx) => tx.query(`select confirmar_venta($1, $2::jsonb, $3, 'efectivo')`,
      [v.id, JSON.stringify([{ item_id: item.id, peso_recibido_kg: "3.950", precio_kg: "26" }]), caja]));

    const vi = await como(db, DUENO_A, (tx) =>
      uno<{ merma_kg: string; merma_costo: string; importe: string }>(tx,
        `select merma_kg, merma_costo, importe from venta_items where id = $1`, [item.id]));
    expect(num(vi.merma_kg)).toBe(0.05);
    expect(num(vi.merma_costo)).toBeCloseTo(1.15, 4);
    expect(num(vi.importe)).toBe(102.7);
    expect(await saldoCaja()).toBeCloseTo(c0 + 102.7, 2);
  });

  it("4. vender más que el stock → la BD lo rechaza con mensaje claro", async () => {
    await expect(como(db, DUENO_A, (tx) =>
      tx.query(`select registrar_venta($1, $2, $3::jsonb)`,
        [empA, comprador, JSON.stringify([{ metal_id: bronce, peso_salida_kg: "1000" }])])))
      .rejects.toThrow(/Stock insuficiente de Bronce: hay 36\.000 kg/);
  });

  it("5. anular una compra → caja y stock vuelven; queda quién y por qué", async () => {
    const s0 = await stock(cobre);
    const c0 = await saldoCaja();
    const r = await comprar(cobre, "2", "0", "30");
    await como(db, DUENO_A, (tx) => tx.query(`select anular_compra($1, 'Error de digitación')`, [r.id]));
    expect(await saldoCaja()).toBeCloseTo(c0, 2);
    const s1 = await stock(cobre);
    expect(num(s1.kg)).toBe(num(s0.kg));
    expect(num(s1.costo_total)).toBe(num(s0.costo_total));
    const c = await como(db, DUENO_A, (tx) =>
      uno<{ estado: string; anulado_por: string; motivo_anulacion: string }>(tx,
        `select estado, anulado_por, motivo_anulacion from compras where id = $1`, [r.id]));
    expect(c).toEqual({ estado: "anulada", anulado_por: DUENO_A, motivo_anulacion: "Error de digitación" });
  });

  it("6. cierre de mes → no se puede registrar ni anular en ese mes sin reabrir", async () => {
    const r = await comprar(cobre, "1", "0", "30");
    const periodo = (await uno<{ p: string }>(db, `select periodo_de(now()) as p`)).p;
    await como(db, DUENO_A, (tx) => tx.query(`select cerrar_mes($1, $2)`, [empA, periodo]));
    await expect(comprar(cobre, "1", "0", "30")).rejects.toThrow(/está cerrado/);
    await expect(como(db, DUENO_A, (tx) => tx.query(`select anular_compra($1, 'x')`, [r.id]))).rejects.toThrow(/está cerrado/);
    await como(db, DUENO_A, (tx) => tx.query(`select reabrir_mes($1, $2, 'Corrección')`, [empA, periodo]));
    await comprar(cobre, "1", "0", "30");
  });
});

describe("Despacho · selección en almacén y descuentos", () => {
  let prov: string;
  const porCobrar = () => como(db, DUENO_A, (tx) =>
    uno<{ por_cobrar: string }>(tx, `select por_cobrar from v_patrimonio where empresa_id = $1`, [empA])).then((r) => num(r.por_cobrar));
  const saldoProv = () => como(db, DUENO_A, (tx) =>
    uno<{ saldo: string }>(tx, `select saldo from v_saldo_proveedor where proveedor_id = $1`, [prov])).then((r) => num(r.saldo));
  async function comprarA(metal: string, bruto: string, precio: string, aplicar = false) {
    return como(db, DUENO_A, (tx) => uno<{ r: { id: string; total: number; saldo_aplicado: number } }>(tx,
      `select registrar_compra($1, $2::jsonb, $3, 'efectivo', $4, null, null, null, null, $5) as r`,
      [empA, JSON.stringify([{ metal_id: metal, peso_bruto_kg: bruto, precio_kg: precio }]), caja, prov, aplicar])).then((x) => x.r);
  }
  async function seleccionar(compra: string, kg: string, cobrar = true, motivo: string | null = "Tierra") {
    return como(db, DUENO_A, async (tx) => {
      const ci = await uno<{ id: string }>(tx, `select id from compra_items where compra_id = $1`, [compra]);
      return uno<{ r: { id: string; importe: number } }>(tx, `select registrar_seleccion($1, $2::jsonb, $3, $4) as r`,
        [compra, JSON.stringify(kg === "0" ? [] : [{ compra_item_id: ci.id, kg }]), motivo, cobrar]).then((x) => x.r);
    });
  }

  beforeAll(async () => {
    prov = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `insert into proveedores (empresa_id, tipo_doc, nro_doc, nombre) values ($1, 'DNI', '41234567', 'Prov Selección') returning id`,
      [empA])).then((r) => r.id);
  });

  it("la compra nueva queda por seleccionar; sin descuento solo se marca conforme", async () => {
    const r = await comprarA(cobre, "10", "30");
    const antes = await como(db, DUENO_A, (tx) => uno<{ por_seleccionar: boolean }>(tx, `select por_seleccionar from v_compras where id = $1`, [r.id]));
    expect(antes.por_seleccionar).toBe(true);
    const s0 = await stock(cobre);
    await seleccionar(r.id, "0", true, null);
    expect(num((await stock(cobre)).kg)).toBe(num(s0.kg));
    await expect(seleccionar(r.id, "0")).rejects.toThrow(/ya fue seleccionada/);
  });

  it("descuento cobrable: sale del stock al precio pagado y queda como saldo a favor (no es pérdida)", async () => {
    const r = await comprarA(cobre, "20", "30");
    const s0 = await stock(cobre);
    const pc0 = await porCobrar();
    const sel = await seleccionar(r.id, "1.5");
    expect(num(sel.importe)).toBe(45);
    const s1 = await stock(cobre);
    expect(num(s1.kg)).toBeCloseTo(num(s0.kg) - 1.5, 3);
    expect(num(s1.costo_total)).toBeCloseTo(num(s0.costo_total) - 45, 2);
    expect(await porCobrar()).toBeCloseTo(pc0 + 45, 2);
    expect(await saldoProv()).toBe(45);
    await expect(seleccionar(r.id, "1")).rejects.toThrow(/ya fue seleccionada/);
  });

  it("descuento sin motivo o mayor a lo comprado → rechazado", async () => {
    const r = await comprarA(cobre, "2", "30");
    await expect(seleccionar(r.id, "1", true, null)).rejects.toThrow(/motivo/);
    await expect(seleccionar(r.id, "3")).rejects.toThrow(/no puede ser mayor a lo comprado/);
  });

  it("la siguiente compra descuenta el saldo a favor del pago en caja", async () => {
    const c0 = await saldoCaja();
    const r = await comprarA(cobre, "3", "30", true);
    expect(num(r.total)).toBe(90);
    expect(num(r.saldo_aplicado)).toBe(45);
    expect(await saldoCaja()).toBeCloseTo(c0 - 45, 2);
    expect(await saldoProv()).toBe(0);
  });

  it("con el saldo ya cobrado no se puede anular la selección; devolución en efectivo cuadra la caja", async () => {
    const sel = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `select id from selecciones_compra where proveedor_id = $1 and importe > 0`, [prov]));
    await expect(como(db, DUENO_A, (tx) => tx.query(`select anular_seleccion($1, 'x')`, [sel.id])))
      .rejects.toThrow(/ya se cobró/);

    const r = await comprarA(cobre, "4", "30");
    await seleccionar(r.id, "1");
    expect(await saldoProv()).toBe(30);
    await expect(como(db, DUENO_A, (tx) => tx.query(`select registrar_devolucion_proveedor($1, $2, 31, $3)`, [empA, prov, caja])))
      .rejects.toThrow(/mayor al saldo/);
    const c0 = await saldoCaja();
    await como(db, DUENO_A, (tx) => tx.query(`select registrar_devolucion_proveedor($1, $2, 30, $3)`, [empA, prov, caja]));
    expect(await saldoCaja()).toBeCloseTo(c0 + 30, 2);
    expect(await saldoProv()).toBe(0);
  });

  it("anular una selección devuelve los kilos y el costo al stock; con descuento no se anula la compra antes", async () => {
    const r = await comprarA(cobre, "5", "30");
    await seleccionar(r.id, "2");
    await expect(como(db, DUENO_A, (tx) => tx.query(`select anular_compra($1, 'x')`, [r.id]))).rejects.toThrow(/Anule primero/);
    const s0 = await stock(cobre);
    const sel = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx, `select id from selecciones_compra where compra_id = $1`, [r.id]));
    await como(db, DUENO_A, (tx) => tx.query(`select anular_seleccion($1, 'Error')`, [sel.id]));
    const s1 = await stock(cobre);
    expect(num(s1.kg)).toBeCloseTo(num(s0.kg) + 2, 3);
    expect(num(s1.costo_total)).toBeCloseTo(num(s0.costo_total) + 60, 2);
    await como(db, DUENO_A, (tx) => tx.query(`select anular_compra($1, 'Prueba')`, [r.id]));
  });

  it("descuento asumido (o sin proveedor) es merma y baja la utilidad", async () => {
    const r = await comprarA(cobre, "6", "30");
    const pc0 = await porCobrar();
    const m0 = await como(db, DUENO_A, (tx) => uno<{ m: string }>(tx,
      `select coalesce(sum(merma_ajustes), 0) m from v_resultado_mes where empresa_id = $1`, [empA])).then((x) => num(x.m));
    await seleccionar(r.id, "1", false, "Material contaminado");
    const m1 = await como(db, DUENO_A, (tx) => uno<{ m: string }>(tx,
      `select coalesce(sum(merma_ajustes), 0) m from v_resultado_mes where empresa_id = $1`, [empA])).then((x) => num(x.m));
    expect(m1).toBeCloseTo(m0 + 30, 2);
    expect(await porCobrar()).toBeCloseTo(pc0, 2);
  });

  it("lotes: muestran fecha de llegada, descuento y lo que queda en stock", async () => {
    const lotes = await como(db, DUENO_A, (tx) => tx.query<{ kg_ingresado: string; kg_en_stock: string; por_seleccionar: boolean }>(
      `select kg_ingresado, kg_en_stock, por_seleccionar from v_lotes where metal_id = $1`, [cobre]));
    const st = await stock(cobre);
    const enStock = lotes.rows.reduce((s, l) => s + num(l.kg_en_stock), 0);
    expect(enStock).toBeLessThanOrEqual(num(st.kg) + 0.001);
    expect(lotes.rows.some((l) => l.por_seleccionar)).toBe(true);
  });
});

describe("Ventas · peso recibido", () => {
  it("el comprador no puede recibir más de lo que salió (+2 % de tolerancia)", async () => {
    const v = await como(db, DUENO_A, (tx) =>
      uno<{ r: { id: string } }>(tx, `select registrar_venta($1, $2, $3::jsonb) as r`,
        [empA, comprador, JSON.stringify([{ metal_id: cobre, peso_salida_kg: "1.000" }])])).then((x) => x.r);
    const item = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx, `select id from venta_items where venta_id = $1`, [v.id]));
    await expect(como(db, DUENO_A, (tx) => tx.query(`select confirmar_venta($1, $2::jsonb, $3)`,
      [v.id, JSON.stringify([{ item_id: item.id, peso_recibido_kg: "5", precio_kg: "34" }]), caja]))).rejects.toThrow(/mayor a lo que salió/);
    await como(db, DUENO_A, (tx) => tx.query(`select confirmar_venta($1, $2::jsonb, $3)`,
      [v.id, JSON.stringify([{ item_id: item.id, peso_recibido_kg: "1.010", precio_kg: "34" }]), caja]));
  });
});

describe("Reunión 23/10 · jerarquía, mayorista, merma, corrección y limpieza", () => {
  const ADMIN_A = "55555555-5555-5555-5555-555555555555";
  let alum: string, alumPerfil: string, chatarra: string, mayorista: string, minorista: string;

  const compraCon = (user: string, prov: string | null, items: unknown[], medio: string | null = null) =>
    como(db, user, (tx) => uno<{ r: { id: string; numero: number; total: number } }>(tx,
      `select registrar_compra($1, $2::jsonb, $3, 'efectivo', $4, null, null, null, null, false, $5) as r`,
      [empA, JSON.stringify(items), medio ? null : caja, prov, medio])).then((x) => x.r);
  const lineaDe = (compra: string) => como(db, DUENO_A, (tx) =>
    uno<{ id: string; metal_id: string }>(tx, `select id, metal_id from compra_items where compra_id = $1`, [compra]));
  const utilidad = () => como(db, DUENO_A, (tx) => uno<{ s: string }>(tx,
    `select coalesce(sum(utilidad), 0) s from v_resultado_mes where empresa_id = $1`, [empA])).then((r) => num(r.s));

  beforeAll(async () => {
    await db.query(`insert into auth.users (id, email) values ($1, 'admin@x.pe')`, [ADMIN_A]);
    await db.query(`select admin_agregar_miembro($1, $2, 'administrador', 'Primo', 'admin@x.pe')`, [empA, ADMIN_A]);
    // Administración crea la familia y sus variantes, cada una con precio propio
    await como(db, ADMIN_A, async (tx) => {
      alum = (await uno<{ id: string }>(tx, `insert into metales (empresa_id, nombre, codigo, precio_compra, precio_mayorista, precio_venta)
        values ($1, 'Aluminio', 'al', 5, 6, 7) returning id`, [empA])).id;
      alumPerfil = (await uno<{ id: string }>(tx, `insert into metales (empresa_id, padre_id, nombre, codigo, precio_compra, precio_venta)
        values ($1, $2, 'Perfil', 'AL-PER', 6, 8) returning id`, [empA, alum])).id;
      chatarra = (await uno<{ id: string }>(tx, `insert into metales (empresa_id, nombre, precio_compra, precio_venta)
        values ($1, 'Chatarra', 1, 1.5) returning id`, [empA])).id;
      mayorista = (await uno<{ id: string }>(tx, `insert into proveedores (empresa_id, tipo_doc, nro_doc, nombre, clase)
        values ($1, 'RUC', '20111111111', 'Almacén Norte SAC', 'mayorista') returning id`, [empA])).id;
      minorista = (await uno<{ id: string }>(tx, `insert into proveedores (empresa_id, tipo_doc, nro_doc, nombre)
        values ($1, 'DNI', '45454545', 'Juan Reciclador') returning id`, [empA])).id;
    });
  });

  it("jerarquía: código en mayúsculas, sin ciclos, y el stock del padre suma el de sus variantes", async () => {
    const cod = await como(db, DUENO_A, (tx) => uno<{ codigo: string }>(tx, `select codigo from metales where id = $1`, [alum]));
    expect(cod.codigo).toBe("AL");
    await expect(como(db, ADMIN_A, (tx) => tx.query(`update metales set padre_id = $1 where id = $2`, [alumPerfil, alum])))
      .rejects.toThrow(/propias variantes/);
    await compraCon(DUENO_A, null, [{ metal_id: alum, peso_bruto_kg: "10" }, { metal_id: alumPerfil, peso_bruto_kg: "4" }]);
    const arbol = await como(db, DUENO_A, (tx) => tx.query<{ metal_id: string; kg: string; kg_propio: string; ruta: string; kg_por_limpiar: string }>(
      `select metal_id, kg, kg_propio, ruta, kg_por_limpiar from v_stock_arbol where metal_id in ($1, $2)`, [alum, alumPerfil]));
    const padre = arbol.rows.find((r) => r.metal_id === alum)!;
    const hijo = arbol.rows.find((r) => r.metal_id === alumPerfil)!;
    expect(num(padre.kg)).toBe(14);
    expect(num(padre.kg_propio)).toBe(10);
    expect(num(padre.kg_por_limpiar)).toBe(14);
    expect(hijo.ruta).toBe("Aluminio › Perfil");
  });

  it("precio sugerido: al mayorista se le paga su precio; merma al pesar se descuenta del pago", async () => {
    const r = await compraCon(CAJERO_A, mayorista, [{ metal_id: alum, peso_bruto_kg: "100", descuento_kg: "5" }]);
    expect(num(r.total)).toBe(570); // 95 kg × S/ 6 (mayorista)
    const r2 = await compraCon(CAJERO_A, minorista, [{ metal_id: alum, peso_bruto_kg: "10" }]);
    expect(num(r2.total)).toBe(50);
    const v = await como(db, DUENO_A, (tx) => uno<{ kg_merma_compra: string; proveedor_clase: string }>(tx,
      `select kg_merma_compra, proveedor_clase from v_compras where id = $1`, [r.id]));
    expect(num(v.kg_merma_compra)).toBe(5);
    expect(v.proveedor_clase).toBe("mayorista");
  });

  it("medio de pago configurable: define el tipo y la caja", async () => {
    const yape = await como(db, DUENO_A, (tx) => uno<{ id: string; caja_id: string }>(tx,
      `select id, caja_id from medios_pago where empresa_id = $1 and nombre = 'Yape'`, [empA]));
    const r = await compraCon(DUENO_A, null, [{ metal_id: chatarra, peso_bruto_kg: "10" }], yape.id);
    const c = await como(db, DUENO_A, (tx) => uno<{ medio_pago: string; caja_id: string; medio_nombre: string }>(tx,
      `select medio_pago, caja_id, medio_nombre from v_compras where id = $1`, [r.id]));
    expect(c).toEqual({ medio_pago: "yape", caja_id: yape.caja_id, medio_nombre: "Yape" });
  });

  it("corrección: el almacén no puede; Administración corrige y stock, caja y registro cuadran", async () => {
    const r = await compraCon(CAJERO_A, minorista, [{ metal_id: alum, peso_bruto_kg: "20", precio_kg: "5" }]);
    const li = await lineaDe(r.id);
    const corregir = (user: string, bruto: string, precio: string) => como(db, user, (tx) =>
      uno<{ r: { total: number; diferencia: number } }>(tx, `select corregir_compra($1, $2::jsonb, 'Balanza mal leída') as r`,
        [r.id, JSON.stringify([{ item_id: li.id, peso_bruto_kg: bruto, precio_kg: precio }])])).then((x) => x.r);
    await expect(corregir(CAJERO_A, "18", "5")).rejects.toThrow(/permiso/);

    const s0 = await stock(alum);
    const c0 = await saldoCaja();
    const res = await corregir(ADMIN_A, "18", "5.5"); // 100 → 99
    expect(num(res.total)).toBe(99);
    expect(num(res.diferencia)).toBe(-1);
    expect(await saldoCaja()).toBeCloseTo(c0 + 1, 2);
    const s1 = await stock(alum);
    expect(num(s1.kg)).toBeCloseTo(num(s0.kg) - 2, 3);
    expect(num(s1.costo_total)).toBeCloseTo(num(s0.costo_total) - 1, 2);
    const reg = await como(db, DUENO_A, (tx) => uno<{ creado_por: string; total_antes: string; corregido_por: string }>(tx,
      `select k.creado_por, k.total_antes, c.corregido_por from correcciones_compra k join compras c on c.id = k.compra_id
        where k.compra_id = $1`, [r.id]));
    expect(reg).toEqual({ creado_por: ADMIN_A, total_antes: "100.00", corregido_por: ADMIN_A });
    // Anular después de corregir deja todo como antes de la compra
    await como(db, DUENO_A, (tx) => tx.query(`select anular_compra($1, 'Prueba')`, [r.id]));
    expect(await saldoCaja()).toBeCloseTo(c0 + 100, 2);
    expect(num((await stock(alum)).kg)).toBeCloseTo(num(s0.kg) - 20, 3);
  });

  it("limpieza: repesaje → merma en kg y S/, el fierro separado pasa a chatarra, y la utilidad baja solo lo perdido", async () => {
    // 100 kg de aluminio a S/ 5 → al limpiar: 90 kg limpios, 6 kg de chatarra (vale S/ 1), merma 4 kg
    const r = await compraCon(CAJERO_A, minorista, [{ metal_id: alum, peso_bruto_kg: "100", precio_kg: "5" }]);
    const li = await lineaDe(r.id);
    const sa0 = await stock(alum);
    const sc0 = await stock(chatarra);
    const u0 = await utilidad();
    const limpiar = (lineas: unknown[]) => como(db, CAJERO_A, (tx) =>
      uno<{ r: { numero: number; kg_merma: number; importe_merma: number; kg_traslado: number; pct_merma: number } }>(tx,
        `select registrar_limpieza($1, $2::jsonb) as r`, [r.id, JSON.stringify(lineas)])).then((x) => x.r);
    await expect(limpiar([{ compra_item_id: li.id, kg_limpio: "95", traslados: [{ metal_id: chatarra, kg: "6" }] }]))
      .rejects.toThrow(/supera lo comprado/);
    const l = await limpiar([{ compra_item_id: li.id, kg_limpio: "90", traslados: [{ metal_id: chatarra, kg: "6" }] }]);
    expect(num(l.kg_merma)).toBe(4);
    expect(num(l.importe_merma)).toBe(20);
    expect(num(l.kg_traslado)).toBe(6);
    expect(num(l.pct_merma)).toBe(4);

    const sa1 = await stock(alum);
    const sc1 = await stock(chatarra);
    expect(num(sa1.kg)).toBeCloseTo(num(sa0.kg) - 10, 3);
    expect(num(sc1.kg)).toBeCloseTo(num(sc0.kg) + 6, 3);
    expect(num(sa1.costo_total)).toBeCloseTo(num(sa0.costo_total) - 50, 2);  // 4 merma + 6 separados, a S/ 5
    expect(num(sc1.costo_total)).toBeCloseTo(num(sc0.costo_total) + 6, 2);   // entran a S/ 1 (precio de chatarra)
    // Pérdida = merma (S/ 20) + diferencia de precio de lo separado (6 × 4 = S/ 24)
    expect(await utilidad()).toBeCloseTo(u0 - 44, 2);

    const v = await como(db, DUENO_A, (tx) => uno<{ merma_pct: string; por_seleccionar: boolean; merma_alta: boolean }>(tx,
      `select merma_pct, por_seleccionar, merma_alta from v_compras where id = $1`, [r.id]));
    expect(v).toEqual({ merma_pct: "4.00", por_seleccionar: false, merma_alta: false });
    const rpt = await como(db, DUENO_A, (tx) => tx.query<{ etiqueta: string; merma_kg: string; merma_pct: string; traslado_kg: string }>(
      `select * from rpt_merma_limpieza($1, current_date - 1, current_date + 1)`, [empA]));
    expect(rpt.rows.find((x) => x.etiqueta === "Aluminio")).toMatchObject({ merma_kg: "4.000", traslado_kg: "6.000" });
    await expect(como(db, DUENO_A, (tx) => tx.query(`select corregir_compra($1, $2::jsonb, 'x')`,
      [r.id, JSON.stringify([{ item_id: li.id, precio_kg: "4" }])]))).rejects.toThrow(/Anule primero esa limpieza/);

    // Anular la limpieza deja el stock y la utilidad como antes
    const sel = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx, `select seleccion_id id from v_compras where id = $1`, [r.id]));
    await expect(como(db, CAJERO_A, (tx) => tx.query(`select anular_seleccion($1, 'x')`, [sel.id]))).rejects.toThrow(/permiso/);
    await como(db, ADMIN_A, (tx) => tx.query(`select anular_seleccion($1, 'Se pesó mal')`, [sel.id]));
    expect(num((await stock(alum)).kg)).toBeCloseTo(num(sa0.kg), 3);
    expect(num((await stock(chatarra)).kg)).toBeCloseTo(num(sc0.kg), 3);
    expect(await utilidad()).toBeCloseTo(u0, 2);

    // Merma alta (más del 5 %) queda marcada para Gerencia
    await limpiar([{ compra_item_id: li.id, kg_merma: "8" }]);
    const alta = await como(db, DUENO_A, (tx) => uno<{ merma_alta: boolean }>(tx, `select merma_alta from v_compras where id = $1`, [r.id]));
    expect(alta.merma_alta).toBe(true);
  });

  it("ventas: Administración vende con medio configurado y no se vende más que el stock", async () => {
    const banco = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `select id from medios_pago where empresa_id = $1 and nombre = 'Transferencia'`, [empA]));
    const v = await como(db, ADMIN_A, (tx) => uno<{ r: { estado: string; id: string } }>(tx,
      `select registrar_venta($1, $2, $3::jsonb, null, null, null, null, null, null, null, null, $4) as r`,
      [empA, comprador, JSON.stringify([{ metal_id: chatarra, peso_salida_kg: "5", peso_recibido_kg: "5", precio_kg: "1.5" }]), banco.id]))
      .then((x) => x.r);
    expect(v.estado).toBe("confirmada");
    await expect(como(db, ADMIN_A, (tx) => tx.query(`select registrar_venta($1, $2, $3::jsonb)`,
      [empA, comprador, JSON.stringify([{ metal_id: chatarra, peso_salida_kg: "9999" }])]))).rejects.toThrow(/Stock insuficiente/);
  });

  it("comprobante de la venta: factura solo con RUC, correlativo automático por tipo y no se escribe a mano", async () => {
    const items = JSON.stringify([{ metal_id: chatarra, peso_salida_kg: "1" }]);
    const numeroDe = (id: string) => como(db, DUENO_A, (tx) => uno<{ comprobante_tipo: string; comprobante_numero: string }>(tx,
      `select comprobante_tipo, comprobante_numero from v_ventas where id = $1`, [id]));
    // Lo que se escriba se ignora: la BD pone el siguiente de la serie
    const v = await como(db, DUENO_A, (tx) => uno<{ r: { id: string } }>(tx,
      `select registrar_venta($1, $2, $3::jsonb, p_comprobante_tipo => 'factura', p_comprobante_numero => ' f001-000123 ') as r`,
      [empA, comprador, items])).then((x) => x.r);
    expect(await numeroDe(v.id)).toEqual({ comprobante_tipo: "factura", comprobante_numero: "F001-000001" });

    // Administración continúa su numeración real: serie F002, última emitida la 10 → la próxima es la 11
    await expect(como(db, CAJERO_A, (tx) => tx.query(
      `select configurar_serie_comprobante($1, 'factura', 'F002', 10)`, [empA]))).rejects.toThrow();
    await como(db, ADMIN_A, (tx) => tx.query(`select configurar_serie_comprobante($1, 'factura', ' f002 ', 10)`, [empA]));
    const sig = await como(db, CAJERO_A, (tx) => uno<{ siguiente: string }>(tx,
      `select siguiente from v_series_comprobante where empresa_id = $1 and tipo = 'factura'`, [empA]));
    expect(sig.siguiente).toBe("F002-000011");
    const v2 = await como(db, DUENO_A, (tx) => uno<{ r: { id: string } }>(tx,
      `select registrar_venta($1, $2, $3::jsonb, p_comprobante_tipo => 'factura') as r`, [empA, comprador, items])).then((x) => x.r);
    expect((await numeroDe(v2.id)).comprobante_numero).toBe("F002-000011");
    // Bajar el «último» a un número ya usado no repite: salta al siguiente libre
    await como(db, ADMIN_A, (tx) => tx.query(`select configurar_serie_comprobante($1, 'factura', 'F002', 10)`, [empA]));
    const v3 = await como(db, DUENO_A, (tx) => uno<{ r: { id: string } }>(tx,
      `select registrar_venta($1, $2, $3::jsonb, p_comprobante_tipo => 'factura') as r`, [empA, comprador, items])).then((x) => x.r);
    expect((await numeroDe(v3.id)).comprobante_numero).toBe("F002-000012");

    const sinRuc = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `insert into compradores (empresa_id, razon_social) values ($1, 'Juan Pérez') returning id`, [empA])).then((x) => x.id);
    await expect(como(db, DUENO_A, (tx) => tx.query(
      `select registrar_venta($1, $2, $3::jsonb, p_comprobante_tipo => 'factura')`, [empA, sinRuc, items])))
      .rejects.toThrow(/debe tener RUC/);

    // Boleta: su propia serie. Editar la venta no cambia el número; cambiar el tipo toma el de esa serie
    const b = await como(db, DUENO_A, (tx) => uno<{ r: { id: string } }>(tx,
      `select registrar_venta($1, $2, $3::jsonb, p_comprobante_tipo => 'boleta') as r`, [empA, sinRuc, items])).then((x) => x.r);
    expect((await numeroDe(b.id)).comprobante_numero).toBe("B001-000001");
    await como(db, CAJERO_A, (tx) => tx.query(
      `select actualizar_venta_guia($1, 'T001-9', null, null, null, 'boleta', 'b001-45')`, [b.id]));
    expect((await numeroDe(b.id)).comprobante_numero).toBe("B001-000001");
    await como(db, CAJERO_A, (tx) => tx.query(
      `select actualizar_venta_guia($1, null, null, null, null, 'nota_venta', null)`, [b.id]));
    expect(await numeroDe(b.id)).toEqual({ comprobante_tipo: "nota_venta", comprobante_numero: "NV01-000001" });
    await expect(como(db, DUENO_A, (tx) => tx.query(
      `select actualizar_venta_guia($1, null, null, null, null, 'factura', null)`, [b.id]))).rejects.toThrow(/debe tener RUC/);
  });

  it("historiales y líneas muestran el producto con su familia (Aluminio › Perfil)", async () => {
    const r = await como(db, DUENO_A, (tx) => uno<{ linea: string; historial: string }>(tx,
      `select (select metal_nombre from v_compra_items i join v_productos p on p.id = i.metal_id
                where i.empresa_id = $1 and p.nombre = 'Perfil' limit 1) as linea,
              (select metales from v_compras where empresa_id = $1 and metales like '%Perfil%' limit 1) as historial`, [empA]));
    expect(r.linea).toBe("Aluminio › Perfil");
    expect(r.historial).toContain("Aluminio › Perfil");
  });
});

describe("Créditos (compras y ventas en cuotas)", () => {
  let prov: string;
  const credito = (where: string, id: string) => como(db, DUENO_A, (tx) => uno<Record<string, string>>(tx,
    `select * from v_creditos where ${where} = $1`, [id]));
  const cuotas = (id: string) => como(db, DUENO_A, (tx) => tx.query<{ numero: number; monto: string; pagado: string; situacion: string; vence: string }>(
    `select numero, monto, pagado, situacion, vence::text from v_credito_cuotas where credito_id = $1 order by numero`, [id])).then((r) => r.rows);
  const compraCredito = (metal: string, bruto: string, precio: string, plan: object, proveedor: string | null = prov) =>
    como(db, DUENO_A, (tx) => uno<{ r: { id: string; credito_id: string } }>(tx,
      `select registrar_compra($1, $2::jsonb, $3, p_proveedor => $4, p_credito => $5::jsonb) as r`,
      [empA, JSON.stringify([{ metal_id: metal, peso_bruto_kg: bruto, descuento_kg: "0", precio_kg: precio }]), caja, proveedor,
        JSON.stringify(plan)])).then((x) => x.r);

  beforeAll(async () => {
    prov = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `insert into proveedores (empresa_id, tipo_doc, nro_doc, nombre) values ($1, 'DNI', '45678912', 'Prov Crédito') returning id`,
      [empA])).then((x) => x.id);
  });

  it("compra a crédito: solo la inicial sale de caja, el resto queda en cuotas por pagar", async () => {
    const c0 = await saldoCaja();
    const s0 = num((await stock(cobre)).kg);
    const r = await compraCredito(cobre, "10", "30", { cuotas: 3, frecuencia: "mensual", inicial: "60" });
    expect(await saldoCaja()).toBeCloseTo(c0 - 60, 2);
    expect(num((await stock(cobre)).kg)).toBe(s0 + 10);
    const cr = await credito("compra_id", r.id);
    expect(cr.tipo).toBe("por_pagar");
    expect(num(cr.saldo)).toBe(240);
    expect(cr.situacion).toBe("al_dia");
    const q = await cuotas(r.credito_id);
    expect(q.map((x) => num(x.monto))).toEqual([80, 80, 80]);
    // Cuotas mensuales desde el primer vencimiento
    expect(new Date(q[1].vence).getUTCMonth()).toBe((new Date(q[0].vence).getUTCMonth() + 1) % 12);

    // Cuotas desiguales: la última absorbe los céntimos
    const r2 = await compraCredito(bronce, "5", "20", { cuotas: 3, frecuencia: "semanal" });
    expect((await cuotas(r2.credito_id)).map((x) => num(x.monto))).toEqual([33.33, 33.33, 33.34]);

    await expect(compraCredito(cobre, "1", "30", { cuotas: 2 }, null)).rejects.toThrow(/elija al proveedor/);
    await expect(compraCredito(cobre, "1", "30", { cuotas: 1, inicial: "30" })).rejects.toThrow(/inicial debe ser menor/);
  });

  it("pagos: se aplican a las cuotas en orden, mueven caja y no pasan del saldo; anular devuelve todo", async () => {
    const r = await compraCredito(cobre, "4", "30", { cuotas: 2, frecuencia: "quincenal" });   // 120 → 60 + 60
    const c0 = await saldoCaja();
    await como(db, CAJERO_A, (tx) => tx.query(`select registrar_pago_credito($1, 90, p_caja => $2)`, [r.credito_id, caja]));
    expect(await saldoCaja()).toBeCloseTo(c0 - 90, 2);
    const q = await cuotas(r.credito_id);
    expect(q.map((x) => [num(x.pagado), x.situacion])).toEqual([[60, "pagada"], [30, "parcial"]]);
    expect(num((await credito("compra_id", r.id)).saldo)).toBe(30);

    await expect(como(db, DUENO_A, (tx) => tx.query(`select registrar_pago_credito($1, 31, p_caja => $2)`, [r.credito_id, caja])))
      .rejects.toThrow(/mayor a lo que falta/);
    await expect(como(db, DUENO_A, (tx) => tx.query(`select anular_compra($1, 'prueba')`, [r.id])))
      .rejects.toThrow(/Anule primero esos pagos/);

    const pago = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx, `select id from credito_pagos where credito_id = $1`, [r.credito_id]));
    await expect(como(db, CAJERO_A, (tx) => tx.query(`select anular_pago_credito($1, 'error')`, [pago.id]))).rejects.toThrow();
    await como(db, DUENO_A, (tx) => tx.query(`select anular_pago_credito($1, 'Pago duplicado')`, [pago.id]));
    expect(await saldoCaja()).toBeCloseTo(c0, 2);
    expect(num((await credito("compra_id", r.id)).saldo)).toBe(120);

    // Sin pagos ya se puede anular: el crédito queda anulado con la compra
    await como(db, DUENO_A, (tx) => tx.query(`select anular_compra($1, 'Prueba de crédito')`, [r.id]));
    expect((await credito("compra_id", r.id)).situacion).toBe("anulado");
  });

  it("corregir una compra a crédito rehace las cuotas y no mueve caja", async () => {
    const r = await compraCredito(cobre, "10", "30", { cuotas: 2, inicial: "100" });          // 300 − 100 = 200
    const item = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx, `select id from compra_items where compra_id = $1`, [r.id]));
    const c0 = await saldoCaja();
    await como(db, DUENO_A, (tx) => tx.query(`select corregir_compra($1, $2::jsonb, 'Peso mal digitado')`,
      [r.id, JSON.stringify([{ item_id: item.id, peso_bruto_kg: "12" }])]));                  // 360 − 100 = 260
    expect(await saldoCaja()).toBeCloseTo(c0, 2);
    expect((await cuotas(r.credito_id)).map((x) => num(x.monto))).toEqual([130, 130]);
  });

  it("venta a crédito: se cobra en cuotas; sin pesaje del comprador no se puede dar a crédito", async () => {
    const items = (recibido = true) => JSON.stringify([{ metal_id: cobre, peso_salida_kg: "2",
      ...(recibido ? { peso_recibido_kg: "2", precio_kg: "34" } : {}) }]);
    const c0 = await saldoCaja();
    const v = await como(db, DUENO_A, (tx) => uno<{ r: { id: string; estado: string } }>(tx,
      `select registrar_venta($1, $2, $3::jsonb, p_caja => $4, p_credito => $5::jsonb) as r`,
      [empA, comprador, items(), caja, JSON.stringify({ cuotas: 2, frecuencia: "quincenal" })])).then((x) => x.r);
    expect(v.estado).toBe("confirmada");
    expect(await saldoCaja()).toBeCloseTo(c0, 2);
    const cr = await credito("venta_id", v.id);
    expect([cr.tipo, num(cr.saldo), num(cr.n_cuotas)]).toEqual(["por_cobrar", 68, 2]);

    await como(db, DUENO_A, (tx) => tx.query(`select registrar_pago_credito($1, 68, p_caja => $2)`, [cr.id, caja]));
    expect(await saldoCaja()).toBeCloseTo(c0 + 68, 2);
    expect((await credito("venta_id", v.id)).situacion).toBe("pagado");

    await expect(como(db, DUENO_A, (tx) => tx.query(
      `select registrar_venta($1, $2, $3::jsonb, p_caja => $4, p_credito => '{"cuotas": 1}'::jsonb)`,
      [empA, comprador, items(false), caja]))).rejects.toThrow(/Para vender a crédito/);
  });

  it("pagos: idempotentes, nunca antes de la operación, aparte en el turno; corregir no cambia el patrimonio pasado", async () => {
    const r = await compraCredito(cobre, "5", "30", { cuotas: 3, frecuencia: "semanal" });   // 150
    const clave = "aaaaaaaa-0000-4000-8000-000000000001";
    for (let i = 0; i < 2; i++) {
      await como(db, DUENO_A, (tx) => tx.query(`select registrar_pago_credito($1, 50, p_caja => $2, p_clave => $3)`, [r.credito_id, caja, clave]));
    }
    expect(num((await credito("compra_id", r.id)).saldo)).toBe(100);
    await expect(como(db, DUENO_A, (tx) => tx.query(
      `select registrar_pago_credito($1, 10, p_caja => $2, p_fecha => now() - interval '3 days')`, [r.credito_id, caja])))
      .rejects.toThrow(/anterior a la operación/);

    // El pago sale como «pago_credito» en el resumen del turno de caja
    const turno = await como(db, DUENO_A, (tx) => uno<{ r: { id: string } }>(tx, `select abrir_caja($1, $2, 0) as r`, [empA, caja])).then((x) => x.r.id);
    await como(db, DUENO_A, (tx) => tx.query(`select registrar_pago_credito($1, 20, p_caja => $2)`, [r.credito_id, caja]));
    const res = await como(db, DUENO_A, (tx) => uno<{ r: { detalle: { origen: string; monto: number }[] } }>(tx,
      `select resumen_turno($1) as r`, [turno])).then((x) => x.r);
    expect(res.detalle.some((d) => d.origen === "pago_credito")).toBe(true);
    await como(db, DUENO_A, (tx) => tx.query(`select cerrar_caja($1, 0)`, [turno]));

    // Anular el pago para poder corregir; el patrimonio a una fecha anterior no cambia con la corrección
    await como(db, DUENO_A, (tx) => tx.query(`select anular_pago_credito(id, 'prueba') from credito_pagos where credito_id = $1 and estado = 'registrada'`, [r.credito_id]));
    const t0 = await como(db, DUENO_A, (tx) => uno<{ t: string }>(tx, `select clock_timestamp()::text t`)).then((x) => x.t);
    const antes = await como(db, DUENO_A, (tx) => uno<{ p: Record<string, number> }>(tx, `select patrimonio_al($1, $2::timestamptz) p`, [empA, t0]));
    const item = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx, `select id from compra_items where compra_id = $1`, [r.id]));
    await como(db, DUENO_A, (tx) => tx.query(`select corregir_compra($1, $2::jsonb, 'Peso')`,
      [r.id, JSON.stringify([{ item_id: item.id, peso_bruto_kg: "7" }])]));
    const despues = await como(db, DUENO_A, (tx) => uno<{ p: Record<string, number> }>(tx, `select patrimonio_al($1, $2::timestamptz) p`, [empA, t0]));
    expect(num(despues.p.cuentas_por_pagar)).toBe(num(antes.p.cuentas_por_pagar));
    expect(num(despues.p.ganancia_acumulada)).toBe(num(antes.p.ganancia_acumulada));
  });

  it("patrimonio: las cuentas por cobrar y por pagar son el saldo de los créditos vigentes", async () => {
    const r = await como(db, DUENO_A, async (tx) => ({
      p: await uno<Record<string, string>>(tx, `select * from v_patrimonio where empresa_id = $1`, [empA]),
      c: await uno<{ cxc: string; cxp: string }>(tx, `select
           coalesce(sum(saldo) filter (where tipo = 'por_cobrar' and estado = 'registrada'), 0) cxc,
           coalesce(sum(saldo) filter (where tipo = 'por_pagar' and estado = 'registrada'), 0) cxp
         from v_creditos where empresa_id = $1`, [empA]),
    }));
    expect(num(r.p.cuentas_por_cobrar)).toBeCloseTo(num(r.c.cxc), 2);
    expect(num(r.p.cuentas_por_pagar)).toBeCloseTo(num(r.c.cxp), 2);
    expect(num(r.p.cuentas_por_pagar)).toBeGreaterThan(0);
    // El inicio (dashboard) trae lo mismo
    const d = await como(db, DUENO_A, (tx) => uno<{ d: Record<string, string> }>(tx, `select dashboard($1) d`, [empA]));
    expect(num(d.d.cuentas_por_pagar)).toBeCloseTo(num(r.p.cuentas_por_pagar), 2);
    expect(num(d.d.cuentas_por_cobrar)).toBeCloseTo(num(r.p.cuentas_por_cobrar), 2);
  });
});

describe("Personal: ingreso, cese, asistencia, domingos y horas extras", () => {
  it("registra asistencia, cuenta domingos, separa horas al 25 % y 35 % y solo paga las aprobadas", async () => {
    // Semana del lunes 2026-10-05 al domingo 2026-10-11; sueldo 2400 → valor hora 2400/30/8 = 10
    const trab = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `insert into trabajadores (empresa_id, nombre, dni, cargo, fecha_ingreso, sueldo_mensual)
       values ($1, 'Juan Pérez', '40000001', 'Balanza', '2026-10-01', 2400) returning id`, [empA])).then((x) => x.id);
    const cesado = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `insert into trabajadores (empresa_id, nombre, fecha_ingreso, fecha_cese, motivo_cese)
       values ($1, 'Pedro Cesado', '2026-01-10', '2026-10-06', 'Renuncia') returning id`, [empA])).then((x) => x.id);
    const marcar = (fecha: string, filas: object[], user = DUENO_A) => como(db, user, (tx) =>
      tx.query(`select guardar_asistencia($1, $2::date, $3::jsonb)`, [empA, fecha, JSON.stringify(filas)]));

    await marcar("2026-10-05", [{ trabajador_id: trab, estado: "asistio", entrada: "08:00", salida: "20:00", horas_extra: "3" },
      { trabajador_id: cesado, estado: "asistio" }]);
    await marcar("2026-10-06", [{ trabajador_id: trab, estado: "falta", horas_extra: "5" }]);       // falta: sin horas extras
    await marcar("2026-10-11", [{ trabajador_id: trab, estado: "asistio", horas_extra: "1" }]);     // domingo trabajado
    await expect(marcar("2026-10-07", [{ trabajador_id: cesado, estado: "asistio" }])).rejects.toThrow(/no trabajaba/);
    await expect(marcar("2026-10-07", [{ trabajador_id: trab, estado: "asistio" }], CAJERO_A)).rejects.toThrow();
    await expect(marcar("2999-01-01", [{ trabajador_id: trab, estado: "asistio" }])).rejects.toThrow(/futuros/);

    type Fila = Record<string, string | number | null>;
    const resumen = () => como(db, DUENO_A, (tx) => tx.query<Fila>(
      `select * from resumen_personal($1, '2026-10-05', '2026-10-11')`, [empA])).then((r) => r.rows);
    let juan = (await resumen()).find((r) => r.trabajador_id === trab)!;
    expect([juan.asistencias, juan.faltas, juan.domingos_trabajados, num(juan.horas_extra), num(juan.horas_pendientes)])
      .toEqual([2, 1, 1, 4, 4]);
    expect(juan.dias_por_marcar).toBe(4);                 // mar–sáb sin marcar: 7, 8, 9, 10 (el 6 es falta)
    expect(num(juan.monto_horas)).toBe(0);                // nada aprobado todavía
    expect(num(juan.monto_domingos)).toBe(80);            // 10 × 8 h × 100 %

    // Gerencia aprueba; Administración no puede
    await expect(como(db, "55555555-5555-5555-5555-555555555555", (tx) => tx.query(`select aprobar_horas_extra($1, '2026-10-05', '2026-10-11')`, [empA]))).rejects.toThrow();
    await como(db, DUENO_A, (tx) => tx.query(`select aprobar_horas_extra($1, '2026-10-05', '2026-10-11', $2)`, [empA, trab]));
    juan = (await resumen()).find((r) => r.trabajador_id === trab)!;
    // Lunes 3 h → 2 al 25 % + 1 al 35 %; domingo 1 h al 25 %  ⇒ 3 h×12.5 + 1 h×13.5 = 51
    expect([num(juan.horas_25), num(juan.horas_35), num(juan.monto_horas), num(juan.monto_total)]).toEqual([3, 1, 51, 131]);

    // Si cambian las horas, vuelven a quedar por aprobar
    await marcar("2026-10-05", [{ trabajador_id: trab, estado: "asistio", horas_extra: "2" }]);
    juan = (await resumen()).find((r) => r.trabajador_id === trab)!;
    expect(num(juan.horas_pendientes)).toBe(2);

    const pedro = (await resumen()).find((r) => r.trabajador_id === cesado)!;
    expect([pedro.situacion, pedro.dias_por_marcar]).toEqual(["cesado", 1]);  // trabajó 5 y 6; falta marcar el 6
    // No se puede adelantar el cese dejando asistencias fuera del periodo
    await expect(como(db, DUENO_A, (tx) => tx.query(`update trabajadores set fecha_cese = '2026-10-04' where id = $1`, [cesado])))
      .rejects.toThrow(/fuera de esas fechas/);
    // Aprobar solo lo visto: con una hora anterior al último cambio no aprueba nada
    const n = await como(db, DUENO_A, (tx) => uno<{ n: number }>(tx,
      `select aprobar_horas_extra($1, '2026-10-05', '2026-10-11', $2, now() - interval '1 hour') n`, [empA, trab]));
    expect(n.n).toBe(0);
    // El cajero (Almacén) no ve sueldos ni asistencia
    const vistos = await como(db, CAJERO_A, (tx) => tx.query(`select * from trabajadores`)).then((r) => r.rows);
    expect(vistos).toHaveLength(0);
    // Personal es solo de Gerencia: Administración tampoco ve ni marca
    const ADMIN = "55555555-5555-5555-5555-555555555555";
    const deAdmin = await como(db, ADMIN, (tx) => tx.query(`select * from trabajadores`)).then((r) => r.rows);
    expect(deAdmin).toHaveLength(0);
    await expect(marcar("2026-10-07", [{ trabajador_id: trab, estado: "asistio" }], ADMIN)).rejects.toThrow();
    await expect(como(db, ADMIN, (tx) => tx.query(
      `insert into trabajadores (empresa_id, nombre, fecha_ingreso) values ($1, 'Intruso', '2026-10-01')`, [empA]))).rejects.toThrow();
  });
});

describe("Patrimonio y resultado", () => {
  it("patrimonio = caja + stock a costo + en tránsito; ganancia = patrimonio − capital", async () => {
    const r = await como(db, DUENO_A, async (tx) => ({
      p: await uno<Record<string, string>>(tx, `select * from v_patrimonio where empresa_id = $1`, [empA]),
      caja: await uno<{ s: string }>(tx, `select sum(saldo) s from v_saldo_caja where empresa_id = $1`, [empA]),
      stock: await uno<{ s: string }>(tx, `select sum(valor_costo) s from v_stock_metal where empresa_id = $1`, [empA]),
      res: await uno<{ s: string }>(tx, `select sum(utilidad) s from v_resultado_mes where empresa_id = $1`, [empA]),
    }));
    expect(num(r.p.caja)).toBeCloseTo(num(r.caja.s), 2);
    expect(num(r.p.stock_costo)).toBeCloseTo(num(r.stock.s), 2);
    expect(num(r.p.capital)).toBe(20000);
    // La ganancia acumulada coincide con la suma de utilidades mensuales
    expect(num(r.p.ganancia_acumulada).toFixed(2)).toBe(num(r.res.s).toFixed(2));
  });

  it("la curva S (acumulado diario) termina en la misma utilidad que el resultado del rango", async () => {
    const r = await como(db, DUENO_A, async (tx) => ({
      serie: await uno<{ d: { dias: { utilidad_acum: number }[]; meses: { utilidad: number }[] } }>(tx,
        `select dashboard_serie($1, (now() at time zone 'America/Lima')::date - 40, (now() at time zone 'America/Lima')::date) d`, [empA]),
      rango: await uno<{ d: { utilidad: number } }>(tx,
        `select dashboard_rango($1, (now() at time zone 'America/Lima')::date - 40, (now() at time zone 'America/Lima')::date) d`, [empA]),
    }));
    expect(r.serie.d.dias).toHaveLength(41);
    expect(num(r.serie.d.dias.at(-1)!.utilidad_acum).toFixed(2)).toBe(num(r.rango.d.utilidad).toFixed(2));
    const sumaMeses = r.serie.d.meses.reduce((s, m) => s + num(m.utilidad), 0);
    expect(sumaMeses.toFixed(2)).toBe(num(r.rango.d.utilidad).toFixed(2));
  });
});

describe("Caja · apertura y cierre (turnos)", () => {
  type Resumen = { numero: number; saldo_apertura: string; ingresos: string; egresos: string; esperado: string;
    saldo_sistema: string; contado_cierre: string; diferencia_cierre: string; otros: string; ajustado: boolean;
    detalle: { origen: string; tipo: string; cantidad: number; monto: string }[] };
  const abrir = (user: string, contado: string) => como(db, user, (tx) =>
    uno<{ r: { id: string; numero: number; saldo_apertura: string; diferencia: string } }>(tx,
      `select abrir_caja($1, $2, $3) as r`, [empA, caja, contado])).then((x) => x.r);
  const cerrar = (user: string, turno: string, contado: string, ajustar = false) => como(db, user, (tx) =>
    uno<{ r: Resumen }>(tx, `select cerrar_caja($1, $2, null, $3) as r`, [turno, contado, ajustar])).then((x) => x.r);

  it("abre, resume lo del turno y cierra con la diferencia contra lo contado", async () => {
    const inicio = await saldoCaja();
    const t = await abrir(CAJERO_A, String(inicio));
    expect(num(t.saldo_apertura)).toBe(inicio);
    expect(num(t.diferencia)).toBe(0);
    await expect(abrir(CAJERO_A, "0")).rejects.toThrow(/ya está abierta/);

    await comprar(cobre, "1", "0", "30");
    const parcial = await como(db, CAJERO_A, (tx) => uno<{ r: Resumen }>(tx, `select resumen_turno($1) as r`, [t.id])).then((x) => x.r);
    expect(num(parcial.egresos)).toBe(30);
    expect(num(parcial.esperado)).toBe(inicio - 30);
    expect(parcial.detalle).toEqual([expect.objectContaining({ origen: "compra", tipo: "egreso", cantidad: 1 })]);

    await expect(cerrar(CAJERO_A, t.id, "0", true)).rejects.toThrow(/Solo el dueño/);
    const r = await cerrar(CAJERO_A, t.id, String(inicio - 35));
    expect(num(r.saldo_sistema)).toBe(inicio - 30);
    expect(num(r.otros)).toBe(0);
    expect(num(r.diferencia_cierre)).toBe(-5);
    expect(await saldoCaja()).toBe(inicio - 30); // sin ajuste la caja no cambia
    await expect(cerrar(CAJERO_A, t.id, "0")).rejects.toThrow(/ya está cerrado/);

    // Empresa B no ve los turnos de A
    const ajenos = await como(db, DUENO_B, (tx) => tx.query(`select id from turnos_caja`));
    expect(ajenos.rows).toHaveLength(0);
  });

  it("el dueño puede cerrar ajustando la caja a lo contado", async () => {
    const inicio = await saldoCaja();
    const t = await abrir(DUENO_A, String(inicio));
    const r = await cerrar(DUENO_A, t.id, String(inicio + 2), true);
    expect(num(r.diferencia_cierre)).toBe(2);
    expect(r.ajustado).toBe(true);
    expect(await saldoCaja()).toBe(inicio + 2);
  });
});

describe("Reunión 06/11: capital con voucher, utilidad por socio, conteo, corrección de venta y reporte del mes", () => {
  let socio2: string;
  const capital = (s: string) => como(db, DUENO_A, (tx) =>
    uno<{ capital: string; capitalizado: string; utilidad_entregada: string }>(tx,
      `select capital, capitalizado, utilidad_entregada from v_capital_socio where socio_id = $1`, [s]));
  const patrimonio = () => como(db, DUENO_A, (tx) =>
    uno<{ capital: string; ganancia_acumulada: string }>(tx,
      `select capital, ganancia_acumulada from v_patrimonio where empresa_id = $1`, [empA]));
  const periodo = () => uno<{ p: string }>(db, `select periodo_de(now()) as p`).then((x) => x.p);

  beforeAll(async () => {
    socio2 = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `insert into socios (empresa_id, nombre, porcentaje) values ($1, 'Socio 2', 0) returning id`, [empA])).then((x) => x.id);
  });

  it("aporte con voucher, ajuste de capital sin caja y utilidad entregada/capitalizada", async () => {
    const c0 = await saldoCaja();
    const id = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `select registrar_movimiento_socio($1, $2, 'aporte', 1000, $3, p_voucher_numero => ' OP-123 ',
              p_voucher_url => 'x/vouchers/a.jpg') as id`, [empA, socio2, caja])).then((x) => x.id);
    expect(await saldoCaja()).toBeCloseTo(c0 + 1000, 2);
    const v = await como(db, DUENO_A, (tx) => uno<{ voucher_numero: string }>(tx,
      `select voucher_numero from v_aportes_retiros where id = $1`, [id]));
    expect(v.voucher_numero).toBe("OP-123");

    // «Editar» el capital: la diferencia queda como movimiento; sin caja no mueve dinero y exige motivo
    await expect(como(db, DUENO_A, (tx) => tx.query(`select ajustar_capital_socio($1, $2, 1500, null)`, [empA, socio2])))
      .rejects.toThrow(/motivo/);
    const p0 = await patrimonio();
    await como(db, DUENO_A, (tx) => tx.query(`select ajustar_capital_socio($1, $2, 1500, 'Aporte en material')`, [empA, socio2]));
    expect(num((await capital(socio2)).capital)).toBe(1500);
    expect(await saldoCaja()).toBeCloseTo(c0 + 1000, 2);
    const p1 = await patrimonio();
    expect(num(p1.capital) - num(p0.capital)).toBeCloseTo(500, 2);
    expect(num(p1.ganancia_acumulada) - num(p0.ganancia_acumulada)).toBeCloseTo(-500, 2);

    // Utilidad: entregarla baja la caja y la ganancia, NO el capital; capitalizarla sube el capital sin mover caja
    const per = await periodo();
    await como(db, DUENO_A, (tx) => tx.query(
      `select registrar_movimiento_socio($1, $2, 'retiro_utilidad', 100, $3, p_periodo => $4)`, [empA, socio2, caja, per]));
    await como(db, DUENO_A, (tx) => tx.query(
      `select registrar_movimiento_socio($1, $2, 'capitalizacion', 50, p_periodo => $3)`, [empA, socio2, per]));
    await expect(como(db, DUENO_A, (tx) => tx.query(
      `select registrar_movimiento_socio($1, $2, 'retiro_utilidad', 10, $3)`, [empA, socio2, caja]))).rejects.toThrow(/qué mes/);
    const c = await capital(socio2);
    expect([num(c.capital), num(c.capitalizado), num(c.utilidad_entregada)]).toEqual([1550, 50, 100]);
    expect(await saldoCaja()).toBeCloseTo(c0 + 900, 2);
    const p2 = await patrimonio();
    expect(num(p2.capital) - num(p1.capital)).toBeCloseTo(50, 2);
    expect(num(p2.ganancia_acumulada) - num(p1.ganancia_acumulada)).toBeCloseTo(-150, 2);

    const s = await como(db, DUENO_A, (tx) => uno<{ pendiente: string; utilidad_socio: string }>(tx,
      `select pendiente, utilidad_socio from v_utilidad_socio_saldo where socio_id = $1 and periodo = $2`, [socio2, per]));
    expect(num(s.pendiente)).toBeCloseTo(num(s.utilidad_socio) - 150, 2);
  });

  it("conteo físico: guarda sistema, contado y faltante; sin motivo no deja ajustar", async () => {
    await comprar(bronce, "50", "0", "20");
    const s0 = num((await stock(bronce)).kg);
    await expect(como(db, DUENO_A, (tx) => tx.query(`select registrar_conteo($1, $2, $3)`, [empA, bronce, s0 - 5])))
      .rejects.toThrow(/faltante de 5/);
    const r = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `select registrar_conteo($1, $2, $3, 'Venta sin registrar') as id`, [empA, bronce, s0 - 5]));
    const a = await como(db, DUENO_A, (tx) => uno<{ kg: string; kg_sistema: string; kg_contado: string; costo_total: string }>(tx,
      `select kg, kg_sistema, kg_contado, costo_total from v_ajustes where id = $1`, [r.id]));
    expect([num(a.kg), num(a.kg_sistema), num(a.kg_contado)]).toEqual([-5, s0, s0 - 5]);
    expect(num(a.costo_total)).toBeLessThan(0);
    expect(num((await stock(bronce)).kg)).toBe(s0 - 5);
  });

  it("corregir venta: motivo obligatorio, ajusta caja y deja registro; el almacén no puede", async () => {
    await comprar(cobre, "10", "0", "30");
    const v = await como(db, DUENO_A, (tx) => uno<{ r: { id: string } }>(tx,
      `select registrar_venta($1, $2, $3::jsonb, p_caja => $4) as r`,
      [empA, comprador, JSON.stringify([{ metal_id: cobre, peso_salida_kg: "4", peso_recibido_kg: "4", precio_kg: "34" }]), caja]))
      .then((x) => x.r);
    const item = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx, `select id from venta_items where venta_id = $1`, [v.id]));
    const cambio = JSON.stringify([{ item_id: item.id, peso_recibido_kg: "3.9", precio_kg: "35" }]);
    await expect(como(db, DUENO_A, (tx) => tx.query(`select corregir_venta($1, $2::jsonb, ' ')`, [v.id, cambio]))).rejects.toThrow(/motivo/);
    await expect(como(db, CAJERO_A, (tx) => tx.query(`select corregir_venta($1, $2::jsonb, 'x')`, [v.id, cambio]))).rejects.toThrow(/no tiene permiso/);
    const c0 = await saldoCaja();
    const r = await como(db, DUENO_A, (tx) => uno<{ r: { total: string; diferencia: string } }>(tx,
      `select corregir_venta($1, $2::jsonb, 'Precio acordado 35') as r`, [v.id, cambio])).then((x) => x.r);
    expect(num(r.total)).toBe(136.5);                       // 3.9 × 35
    expect(num(r.diferencia)).toBe(0.5);                    // antes 4 × 34 = 136
    expect(await saldoCaja()).toBeCloseTo(c0 + 0.5, 2);
    const reg = await como(db, DUENO_A, (tx) => uno<{ motivo: string; total_antes: string }>(tx,
      `select motivo, total_antes from v_correcciones_venta where venta_id = $1`, [v.id]));
    expect([reg.motivo, num(reg.total_antes)]).toEqual(["Precio acordado 35", 136]);
  });

  it("reporte del mes: caja, material por producto, compras, ventas y utilidad; el cierre lo guarda", async () => {
    type Rep = { estado: string; stock: { costo: number }[]; compras: unknown[]; ventas: unknown[];
      patrimonio: { stock_costo: number }; resultado: { utilidad: number } };
    const per = await periodo();
    const rep = await como(db, DUENO_A, (tx) => uno<{ r: Rep }>(tx, `select reporte_mes($1, $2) as r`, [empA, per])).then((x) => x.r);
    expect(rep.estado).not.toBe("cerrado");   // abierto o reabierto (caso 6)
    expect(rep.compras.length).toBeGreaterThan(0);
    expect(rep.ventas.length).toBeGreaterThan(0);
    // El material por producto suma lo mismo que el stock a costo del patrimonio
    expect(rep.stock.reduce((s, x) => s + num(x.costo), 0)).toBeCloseTo(num(rep.patrimonio.stock_costo), 1);
    await expect(como(db, CAJERO_A, (tx) => tx.query(`select reporte_mes($1, $2)`, [empA, per]))).rejects.toThrow(/no tiene permiso/);

    await como(db, DUENO_A, (tx) => tx.query(`select cerrar_mes($1, $2)`, [empA, per]));
    const cerrado = await como(db, DUENO_A, (tx) => uno<{ r: Rep }>(tx, `select reporte_mes($1, $2) as r`, [empA, per])).then((x) => x.r);
    expect(cerrado.estado).toBe("cerrado");
    expect(num(cerrado.resultado.utilidad)).toBeCloseTo(num(rep.resultado.utilidad), 2);
    await como(db, DUENO_A, (tx) => tx.query(`select reabrir_mes($1, $2, 'Prueba')`, [empA, per]));
  });
});

describe("Cargos y permisos (12/11)", () => {
  it("cada empresa arranca con sus cargos; el cargo da el nivel al usuario y solo Gerencia los edita", async () => {
    const nombres = await como(db, DUENO_A, (tx) => tx.query<{ nombre: string }>(
      `select nombre from cargos where empresa_id = $1 order by nombre`, [empA])).then((r) => r.rows.map((x) => x.nombre));
    expect(nombres).toEqual(["Administración", "Auxiliar", "Balanza", "Gerente"]);

    const guardar = (id: string | null, nombre: string, rol: string, secciones: string[] | null, activo = true, user = DUENO_A) =>
      como(db, user, (tx) => uno<{ id: string }>(tx, `select guardar_cargo($1, $2, $3, $4::rol_miembro, $5, $6) as id`,
        [empA, id, nombre, rol, secciones, activo])).then((x) => x.id);
    await expect(guardar(null, "Chofer", "cajero", ["/compras"], true, CAJERO_A)).rejects.toThrow(/permiso/);
    const chofer = await guardar(null, "Chofer", "cajero", ["/compras"]);
    await expect(guardar(null, "chofer ", "cajero", null)).rejects.toThrow(/Ya existe/);

    const rolCajero = () => como(db, DUENO_A, (tx) => uno<{ rol: string; cargo_id: string | null }>(tx,
      `select rol, cargo_id from miembros where empresa_id = $1 and user_id = $2`, [empA, CAJERO_A]));
    await como(db, DUENO_A, (tx) => tx.query(`select asignar_cargo_miembro($1, $2, $3)`, [empA, CAJERO_A, chofer]));
    expect(await rolCajero()).toEqual({ rol: "cajero", cargo_id: chofer });

    // Subir el nivel del cargo sube a sus usuarios; Gerencia no lleva lista de pantallas (ve todo)
    await guardar(chofer, "Chofer", "administrador", ["/compras"]);
    expect((await rolCajero()).rol).toBe("administrador");
    await guardar(chofer, "Chofer", "cajero", ["/compras"]);
    expect((await rolCajero()).rol).toBe("cajero");
    const gerente = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx, `select id from cargos where empresa_id = $1 and nombre = 'Gerente'`, [empA])).then((x) => x.id);
    await guardar(gerente, "Gerente", "dueno", ["/compras"]);
    expect(await como(db, DUENO_A, (tx) => uno<{ secciones: string[] | null }>(tx, `select secciones from cargos where id = $1`, [gerente]))).toEqual({ secciones: null });

    await expect(guardar(chofer, "Chofer", "cajero", null, false)).rejects.toThrow(/usuarios activos/);
    await expect(como(db, DUENO_A, (tx) => tx.query(`select asignar_cargo_miembro($1, $2, $3)`, [empA, DUENO_A, chofer]))).rejects.toThrow(/propio/);
    // Otra empresa no ve los cargos de A
    const ajenos = await como(db, DUENO_B, (tx) => tx.query(`select 1 from cargos where empresa_id = $1`, [empA]));
    expect(ajenos.rows).toHaveLength(0);
  });
});

describe("Tareo mensual y horas extras de Gerencia (12/11)", () => {
  it("marca casillas sin tocar horario; las horas extras las anota Gerencia ya aprobadas", async () => {
    const trab = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `insert into trabajadores (empresa_id, nombre, dni, fecha_ingreso) values ($1, 'Rosa Tareo', '40000077', '2026-09-01') returning id`, [empA])).then((x) => x.id);
    const tareo = (celdas: object[], user = DUENO_A) => como(db, user, (tx) =>
      uno<{ n: number }>(tx, `select guardar_tareo($1, $2::jsonb) n`, [empA, JSON.stringify(celdas)])).then((x) => x.n);
    const dia = (fecha: string) => como(db, DUENO_A, (tx) => uno<Record<string, unknown>>(tx,
      `select estado, horas_extra, extra_aprobada from asistencias where trabajador_id = $1 and fecha = $2`, [trab, fecha]));

    expect(await tareo([{ trabajador_id: trab, fecha: "2026-09-02", estado: "asistio" }, { trabajador_id: trab, fecha: "2026-09-03", estado: "falta" }])).toBe(2);
    expect(await tareo([{ trabajador_id: trab, fecha: "2026-09-02", estado: "asistio" }])).toBe(0);   // sin cambio
    await expect(tareo([{ trabajador_id: trab, fecha: "2026-08-31", estado: "asistio" }])).rejects.toThrow(/no trabajaba/);
    await expect(tareo([{ trabajador_id: trab, fecha: "2026-09-04", estado: "asistio" }], CAJERO_A)).rejects.toThrow();

    await como(db, DUENO_A, (tx) => tx.query(`select registrar_horas_extra($1, $2, '2026-09-02', 2.5)`, [empA, trab]));
    expect(await dia("2026-09-02")).toEqual({ estado: "asistio", horas_extra: "2.50", extra_aprobada: true });
    // Pasar ese día a falta quita las horas extras
    await tareo([{ trabajador_id: trab, fecha: "2026-09-02", estado: "falta" }]);
    expect(await dia("2026-09-02")).toEqual({ estado: "falta", horas_extra: "0.00", extra_aprobada: false });
    await expect(como(db, CAJERO_A, (tx) => tx.query(`select registrar_horas_extra($1, $2, '2026-09-02', 1)`, [empA, trab]))).rejects.toThrow();
  });
});

describe("Adelantos a proveedores (12/11)", () => {
  it("el adelanto sale de caja como saldo a favor y se va descontando en las compras", async () => {
    const prov = await como(db, DUENO_A, (tx) => uno<{ id: string }>(tx,
      `insert into proveedores (empresa_id, tipo_doc, nro_doc, nombre) values ($1, 'DNI', '47770001', 'Prov Adelanto') returning id`, [empA])).then((x) => x.id);
    const saldo = () => como(db, DUENO_A, (tx) => uno<{ saldo: string; adelantos: string }>(tx,
      `select saldo, adelantos from v_saldo_proveedor where proveedor_id = $1`, [prov])).then((r) => [num(r.saldo), num(r.adelantos)]);
    const ganancia = () => como(db, DUENO_A, (tx) => uno<{ g: string }>(tx,
      `select ganancia_acumulada g from v_patrimonio where empresa_id = $1`, [empA])).then((r) => num(r.g));
    const compra = (kg: string) => como(db, DUENO_A, (tx) => uno<{ r: { id: string; saldo_aplicado: string } }>(tx,
      `select registrar_compra(p_empresa => $1, p_items => $2::jsonb, p_caja => $3, p_proveedor => $4, p_aplicar_saldo => true) r`,
      [empA, JSON.stringify([{ metal_id: cobre, peso_bruto_kg: kg, precio_kg: "20" }]), caja, prov])).then((x) => x.r);

    const g0 = await ganancia();
    const c0 = await saldoCaja();
    await expect(como(db, CAJERO_A, (tx) => tx.query(`select registrar_adelanto_proveedor($1, $2, 0, null, $3)`, [empA, prov, caja]))).rejects.toThrow(/mayor a cero/);
    const ad = await como(db, CAJERO_A, (tx) => uno<{ r: { id: string } }>(tx,
      `select registrar_adelanto_proveedor($1, $2, 500, null, $3, 'Para chatarra de la semana') r`, [empA, prov, caja])).then((x) => x.r.id);
    expect(await saldo()).toEqual([500, 500]);
    expect(await saldoCaja()).toBeCloseTo(c0 - 500, 2);
    expect(await ganancia()).toBeCloseTo(g0, 2);                    // la plata pasa de caja a «por cobrar»

    // Trae menos (S/ 200): no sale nada de caja y quedan 300
    expect(num((await compra("10")).saldo_aplicado)).toBe(200);
    expect(await saldoCaja()).toBeCloseTo(c0 - 500, 2);
    expect((await saldo())[0]).toBe(300);
    // Ya se usó: no se puede anular
    await expect(como(db, DUENO_A, (tx) => tx.query(`select anular_adelanto_proveedor($1, 'error')`, [ad]))).rejects.toThrow(/ya se descontó/);
    // Trae más (S/ 400): se descuentan los 300 y se paga la diferencia
    expect(num((await compra("20")).saldo_aplicado)).toBe(300);
    expect(await saldoCaja()).toBeCloseTo(c0 - 600, 2);
    expect((await saldo())[0]).toBe(0);
    expect(await ganancia()).toBeCloseTo(g0, 2);

    // Un adelanto sin usar se anula y la plata vuelve a la caja
    const ad2 = await como(db, CAJERO_A, (tx) => uno<{ r: { id: string } }>(tx,
      `select registrar_adelanto_proveedor($1, $2, 50, null, $3) r`, [empA, prov, caja])).then((x) => x.r.id);
    await expect(como(db, CAJERO_A, (tx) => tx.query(`select anular_adelanto_proveedor($1, 'error')`, [ad2]))).rejects.toThrow();
    await como(db, DUENO_A, (tx) => tx.query(`select anular_adelanto_proveedor($1, 'Monto equivocado')`, [ad2]));
    expect(await saldoCaja()).toBeCloseTo(c0 - 600, 2);
    expect((await saldo())[0]).toBe(0);
  });
});
