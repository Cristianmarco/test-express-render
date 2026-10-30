// === Cambiar contraseña (ERP y portal) ===
// Boton: cualquier elemento con [data-cambiar-password].
// Si <body data-debe-cambiar="1"> (contraseña blanqueada) el modal se abre solo y no se puede cerrar.
(function () {
  const MIN = 8;
  let modal;

  function crearModal() {
    const style = document.createElement('style');
    style.textContent = `
      #cuenta-password-modal { position: fixed; inset: 0; background: rgba(15,23,42,.55); display: none;
        align-items: center; justify-content: center; z-index: 10000; padding: 16px; }
      #cuenta-password-modal .cp-card { background: #fff; color: #1f2937; border-radius: 10px; width: 100%;
        max-width: 380px; padding: 22px; box-shadow: 0 10px 30px rgba(0,0,0,.25); font-family: inherit; position: relative; }
      #cuenta-password-modal h3 { margin: 0 0 6px; font-size: 18px; }
      #cuenta-password-modal .cp-aviso { font-size: 13px; color: #92400e; background: #fef3c7; border-radius: 6px;
        padding: 8px 10px; margin: 8px 0 4px; }
      #cuenta-password-modal label { display: block; font-size: 13px; margin: 12px 0 4px; color: #374151; }
      #cuenta-password-modal input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #cbd5e1;
        border-radius: 6px; font-size: 14px; }
      #cuenta-password-modal .cp-error { color: #b91c1c; font-size: 13px; min-height: 18px; margin-top: 10px; }
      #cuenta-password-modal .cp-acciones { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
      #cuenta-password-modal button { padding: 8px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; }
      #cuenta-password-modal .cp-guardar { background: #2563eb; color: #fff; }
      #cuenta-password-modal .cp-guardar:disabled { opacity: .6; cursor: default; }
      #cuenta-password-modal .cp-cancelar { background: #e5e7eb; color: #111827; }
    `;
    document.head.appendChild(style);

    modal = document.createElement('div');
    modal.id = 'cuenta-password-modal';
    modal.innerHTML = `
      <form class="cp-card" autocomplete="off">
        <h3><i class="fas fa-key"></i> Cambiar contraseña</h3>
        <div class="cp-aviso" hidden>Tu contraseña fue blanqueada. Elegí una nueva para seguir.</div>
        <label>Contraseña actual</label>
        <input type="password" name="actual" autocomplete="current-password" required>
        <label>Contraseña nueva <small>(mínimo ${MIN} caracteres)</small></label>
        <input type="password" name="nueva" autocomplete="new-password" minlength="${MIN}" required>
        <label>Repetir contraseña nueva</label>
        <input type="password" name="repetir" autocomplete="new-password" minlength="${MIN}" required>
        <div class="cp-error"></div>
        <div class="cp-acciones">
          <button type="button" class="cp-cancelar">Cancelar</button>
          <button type="submit" class="cp-guardar">Guardar</button>
        </div>
      </form>`;
    document.body.appendChild(modal);

    modal.querySelector('.cp-cancelar').addEventListener('click', cerrar);
    modal.querySelector('form').addEventListener('submit', guardar);
  }

  function abrir(forzado) {
    if (!modal) crearModal();
    const form = modal.querySelector('form');
    form.reset();
    modal.dataset.forzado = forzado ? '1' : '';
    modal.querySelector('.cp-aviso').hidden = !forzado;
    modal.querySelector('.cp-cancelar').hidden = !!forzado;
    modal.querySelector('.cp-error').textContent = '';
    modal.style.display = 'flex';
    form.elements.actual.focus();
  }

  function cerrar() {
    if (modal && !modal.dataset.forzado) modal.style.display = 'none';
  }

  async function guardar(e) {
    e.preventDefault();
    const form = e.target;
    const error = modal.querySelector('.cp-error');
    const actual = form.elements.actual.value;
    const nueva = form.elements.nueva.value;
    error.textContent = '';
    if (nueva.length < MIN) { error.textContent = `La contraseña nueva tiene que tener al menos ${MIN} caracteres`; return; }
    if (nueva !== form.elements.repetir.value) { error.textContent = 'Las contraseñas nuevas no coinciden'; return; }

    const btn = form.querySelector('.cp-guardar');
    btn.disabled = true;
    try {
      const res = await fetch('/api/cuenta/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ actual, nueva }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { error.textContent = data.error || 'No se pudo cambiar la contraseña'; return; }
      const forzado = !!modal.dataset.forzado;
      modal.dataset.forzado = '';
      cerrar();
      alert('Contraseña actualizada. Las otras sesiones abiertas con tu usuario se cerraron.');
      if (forzado) window.location.reload();
    } catch (err) {
      error.textContent = 'Error de conexión. Intentá de nuevo.';
    } finally {
      btn.disabled = false;
    }
  }

  window.abrirCambioPassword = abrir;

  function init() {
    document.querySelectorAll('[data-cambiar-password]').forEach(b => b.addEventListener('click', () => abrir(false)));
    if (document.body.dataset.debeCambiar === '1') abrir(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
