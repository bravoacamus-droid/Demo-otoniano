"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Insignia, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, Select } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { Modal } from "@/components/ui/modal";
import { useNotificar } from "@/components/ui/notificaciones";
import { ETIQUETA_ROL } from "@/lib/formato";
import type { Rol } from "@/lib/tipos";
import type { Cargo } from "./cargos";
import { PermisosCargo } from "./permisos-cargo";
import { actualizarMiembro, editarUsuario, invitarUsuario } from "./acciones";

type Miembro = { user_id: string; rol: Rol; nombre: string | null; email: string | null; activo: boolean; cargo_id: string | null };

/** Cargo elegido + qué pantallas le da (se cambian ahí mismo con «Cambiar permisos») */
function CampoCargo({ cargos, valor, onCambio, deshabilitado }: {
  cargos: Cargo[]; valor: string; onCambio: (id: string) => void; deshabilitado?: boolean;
}) {
  const elegido = cargos.find((c) => c.id === valor);
  return (
    <>
      <Campo etiqueta="Cargo" ayuda={deshabilitado ? "No puede cambiar su propio cargo." : "Entra solo a las pantallas que tiene marcadas su cargo"}>
        <Select name="cargo_id" required value={valor} onChange={(e) => onCambio(e.target.value)} disabled={deshabilitado}>
          <option value="" disabled>Elija el cargo…</option>
          {cargos.filter((c) => c.activo || c.id === valor).map((c) => <option key={c.id} value={c.id}>{c.nombre} — {ETIQUETA_ROL[c.rol]}</option>)}
        </Select>
      </Campo>
      {elegido && <PermisosCargo cargo={elegido} />}
    </>
  );
}

function NuevoUsuario({ cargos, onCerrar }: { cargos: Cargo[]; onCerrar: () => void }) {
  const [cargo, setCargo] = useState("");
  return (
    <Modal abierto onCerrar={onCerrar} titulo="Nuevo usuario">
      <FormularioAccion accion={invitarUsuario} onExito={onCerrar} textoBoton="Crear usuario" mensajeExito="Usuario creado. Ya puede ingresar con su correo y contraseña.">
        <Campo etiqueta="Nombre"><Input name="nombre" required autoFocus /></Campo>
        <Campo etiqueta="Correo"><Input name="email" type="email" required autoComplete="off" /></Campo>
        <Campo etiqueta="Contraseña inicial" ayuda="Mínimo 6 caracteres. Entréguela al usuario; si el correo ya tiene cuenta, conserva la suya.">
          <Input name="password" type="text" minLength={6} required autoComplete="off" />
        </Campo>
        <CampoCargo cargos={cargos} valor={cargo} onCambio={setCargo} />
      </FormularioAccion>
    </Modal>
  );
}

function EditarUsuario({ miembro, cargos, esUsted, onCerrar }: { miembro: Miembro; cargos: Cargo[]; esUsted: boolean; onCerrar: () => void }) {
  const [cargo, setCargo] = useState(miembro.cargo_id ?? "");
  const subeAGerencia = !esUsted && cargo !== (miembro.cargo_id ?? "") && cargos.find((c) => c.id === cargo)?.rol === "dueno";
  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Editar usuario · ${miembro.nombre ?? miembro.email}`}>
      <FormularioAccion accion={editarUsuario} onExito={onCerrar} textoBoton="Guardar cambios" mensajeExito="Usuario actualizado."
        confirmar={subeAGerencia ? `${miembro.nombre ?? miembro.email} tendrá acceso total (capital, socios y configuración). ¿Continuar?` : undefined}>
        <input type="hidden" name="user_id" value={miembro.user_id} />
        <Campo etiqueta="Nombre"><Input name="nombre" required defaultValue={miembro.nombre ?? ""} /></Campo>
        <Campo etiqueta="Correo" ayuda="Con este correo entra al sistema.">
          <Input name="email" type="email" required defaultValue={miembro.email ?? ""} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Nueva contraseña (opcional)" ayuda="Déjela vacía para no cambiarla. Mínimo 6 caracteres.">
          <Input name="password" type="text" minLength={6} autoComplete="off" />
        </Campo>
        {esUsted ? (
          <>
            <input type="hidden" name="cargo_id" value={cargo} />
            <p className="text-sm text-stone-600">Cargo: <b>{cargos.find((c) => c.id === cargo)?.nombre ?? ETIQUETA_ROL[miembro.rol]}</b> (no puede cambiar su propio cargo).</p>
          </>
        ) : (
          <CampoCargo cargos={cargos} valor={cargo} onCambio={setCargo} />
        )}
      </FormularioAccion>
    </Modal>
  );
}

/** Usuarios del sistema: cada uno con su cargo (el cargo define a qué pantallas entra) */
export function Usuarios({ miembros, yo, cargos }: { miembros: Miembro[]; yo: string; cargos: Cargo[] }) {
  const router = useRouter();
  const notificar = useNotificar();
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<Miembro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  async function alternarActivo(m: Miembro) {
    setError(null);
    setGuardando(m.user_id);
    const r = await actualizarMiembro(m.user_id, { activo: !m.activo });
    setGuardando(null);
    if (!r.ok) setError(r.error);
    else notificar({ titulo: m.activo ? "Usuario desactivado" : "Usuario activado", mensaje: m.nombre ?? m.email ?? "" });
    router.refresh();
  }

  return (
    <Tarjeta>
      <TituloTarjeta accion={<Boton tamano="sm" variante="secundario" onClick={() => setNuevo(true)}><Plus className="size-4" /> Usuario</Boton>}>
        Usuarios
      </TituloTarjeta>
      {error && <p className="px-4 pt-2 text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-stone-100">
        {miembros.map((m) => {
          const cargo = cargos.find((c) => c.id === m.cargo_id);
          const usted = m.user_id === yo;
          return (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className={`truncate font-medium ${m.activo ? "" : "text-stone-500"}`}>
                  {m.nombre ?? m.email}{usted && <span className="font-normal text-stone-500"> (usted)</span>}
                  {!m.activo && <span className="ml-1.5"><Insignia>Inactivo</Insignia></span>}
                </p>
                <p className="truncate text-xs text-stone-500">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Insignia tono={m.rol === "dueno" ? "marca" : undefined}>{cargo?.nombre ?? `Sin cargo (${ETIQUETA_ROL[m.rol]})`}</Insignia>
                <button type="button" onClick={() => setEditando(m)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-marca-700 hover:bg-marca-50">
                  <Pencil className="size-3.5" /> Editar
                </button>
                {!usted && (
                  <button type="button" disabled={guardando === m.user_id} onClick={() => alternarActivo(m)}
                    className="rounded-md px-2 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900">
                    {m.activo ? "Desactivar" : "Activar"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {nuevo && <NuevoUsuario cargos={cargos} onCerrar={() => setNuevo(false)} />}
      {editando && <EditarUsuario miembro={editando} cargos={cargos} esUsted={editando.user_id === yo} onCerrar={() => setEditando(null)} />}
    </Tarjeta>
  );
}
