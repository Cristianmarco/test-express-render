// === Usuarios (Refactor) ===
(function(){
  let tbody, seleccionado = null, secciones = [];
  function el(id){ return document.getElementById(id); }
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

  const fechaHora = (v) => new Date(v).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

  const MOTIVOS_ACCESO = {
    password: 'Contraseña incorrecta',
    usuario_inexistente: 'Usuario inexistente',
    bloqueado: 'Bloqueado por intentos',
    blanqueo: 'Contraseña blanqueada',
  };

  let accesos = [];
  function renderAccesos(){
    const tb = el('tbody-accesos');
    if (!tb) return;
    const q = el('accesos-buscar').value.trim().toLowerCase();
    const soloFallidos = el('accesos-solo-fallidos').checked;
    const filas = accesos.filter(a =>
      (!soloFallidos || !a.ok) &&
      (!q || String(a.email).toLowerCase().includes(q) || String(a.ip || '').includes(q) || String(a.nombre || '').toLowerCase().includes(q))
    );
    if (!filas.length) {
      tb.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:10px; color:#888">Sin registros</td></tr>`;
      return;
    }
    tb.innerHTML = filas.map(a => {
      const resultado = a.ok
        ? `<span class="acceso-ok"><i class="fas fa-check"></i> ${a.motivo ? esc(MOTIVOS_ACCESO[a.motivo] || a.motivo) : 'Ingresó'}</span>`
        : `<span class="acceso-fallido"><i class="fas fa-xmark"></i> ${esc(MOTIVOS_ACCESO[a.motivo] || a.motivo || 'Fallido')}</span>`;
      return `<tr>
        <td>${esc(fechaHora(a.creado_at))}</td>
        <td>${esc(a.nombre ? `${a.nombre} (${a.email})` : a.email)}</td>
        <td>${resultado}</td>
        <td>${esc(a.ip || '-')}</td>
        <td class="acceso-ua" title="${esc(a.user_agent || '')}">${esc(a.user_agent || '-')}</td>
      </tr>`;
    }).join('');
  }

  async function abrirAccesos(){
    el('modal-accesos').style.display = 'flex';
    el('tbody-accesos').innerHTML = `<tr><td colspan="5" style="text-align:center; padding:10px; color:#888"><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>`;
    try{
      const res = await fetch('/api/usuarios/accesos?limit=500', { credentials: 'include' });
      if (!res.ok) throw new Error('Error al cargar');
      accesos = await res.json();
      renderAccesos();
    }catch(e){
      console.error(e);
      el('tbody-accesos').innerHTML = `<tr><td colspan="5" style="text-align:center; padding:10px; color:#c33">Error al cargar</td></tr>`;
    }
  }

  const AYUDA_ROL = {
    admin: 'Ve y modifica todo, incluida esta pantalla de usuarios.',
    interno: 'Ve solo las secciones que tildes abajo.',
    cliente: 'Entra solo al portal de clientes y ve únicamente sus equipos.',
  };

  async function cargarSecciones(){
    if (!secciones.length) {
      try{
        const res = await fetch('/api/usuarios/secciones', { credentials: 'include' });
        if (res.ok) secciones = await res.json();
      }catch(e){ console.error(e); }
    }
    const grid = el('user-permisos-grid');
    if (grid) grid.innerHTML = secciones.map(s =>
      `<label><input type="checkbox" name="permisos" value="${esc(s.id)}"> ${esc(s.label)}</label>`
    ).join('');
  }

  function textoAcceso(u){
    if (u.rol === 'admin') return '<span class="user-chip">Acceso total</span>';
    if (u.rol === 'cliente') return `Portal · cliente ${esc(u.cliente_codigo || '-')}`;
    const lista = Array.isArray(u.permisos) ? u.permisos : [];
    if (!lista.length) return '<span style="color:#a33">Sin secciones</span>';
    const nombres = new Map(secciones.map(s => [s.id, s.label]));
    return lista.map(id => `<span class="user-chip">${esc(nombres.get(id) || id)}</span>`).join('');
  }

  async function cargar(){
    if(!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:#888"><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>`;
    try{
      await cargarSecciones();
      const res = await fetch('/api/usuarios', { credentials: 'include' });
      const data = await res.json();
      if(!res.ok) throw new Error('Error al listar');
      tbody.innerHTML = '';
      seleccionado = null;
      (Array.isArray(data) ? data : []).forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${esc(u.id ?? '-')}</td>
          <td>${esc(u.nombre || '-')}</td>
          <td>${esc(u.email ?? '-')}</td>
          <td>${esc(u.rol ?? '-')}</td>
          <td>${textoAcceso(u)}</td>
          <td>${u.ultimo_login ? esc(fechaHora(u.ultimo_login)) : '<span style="color:#999">Nunca</span>'}</td>
        `;
        tr.addEventListener('click', ()=>{
          seleccionado = u;
          tbody.querySelectorAll('tr').forEach(r=>r.classList.remove('selected'));
          tr.classList.add('selected');
        });
        tr.addEventListener('dblclick', ()=> abrirModal(true));
        tbody.appendChild(tr);
      });
    }catch(e){
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:#c33">Error al cargar</td></tr>`;
    }
  }

  // Muestra las secciones solo para el rol interno y el cliente solo para el rol cliente
  function actualizarSegunRol(){
    const rol = el('user-rol').value;
    el('user-permisos').style.display = rol === 'interno' ? '' : 'none';
    el('user-cliente-wrap').style.display = rol === 'cliente' ? '' : 'none';
    el('user-rol-ayuda').textContent = AYUDA_ROL[rol] || '';
  }

  function marcarPermisos(lista){
    const set = new Set(lista || []);
    el('form-usuario').querySelectorAll('input[name="permisos"]').forEach(c => { c.checked = set.has(c.value); });
  }

  function abrirModal(edit){
    const modal = el('modal-usuario');
    const form = el('form-usuario');
    if(!modal || !form) return;
    el('modal-user-title').innerHTML = `<i class="fas fa-user"></i> ${edit ? 'Editar' : 'Nuevo'} usuario`;
    form.reset();
    delete form.dataset.email;
    marcarPermisos([]);
    if(edit && seleccionado){
      form.elements.nombre.value = seleccionado.nombre || '';
      form.elements.email.value = seleccionado.email || '';
      form.elements.rol.value = seleccionado.rol || '';
      form.elements.cliente_codigo.value = seleccionado.cliente_codigo || '';
      marcarPermisos(seleccionado.permisos);
      form.dataset.email = seleccionado.email;
    }
    actualizarSegunRol();
    modal.style.display='flex';
  }

  async function guardar(e){
    e.preventDefault();
    const form = e.target;
    const datos = Object.fromEntries(new FormData(form).entries());
    datos.permisos = Array.from(form.querySelectorAll('input[name="permisos"]:checked')).map(c => c.value);
    const edit = !!form.dataset.email;
    if(!edit && !datos.password){
      alert('La contraseña es obligatoria al crear un usuario');
      return;
    }
    if(datos.rol === 'interno' && !datos.permisos.length &&
       !confirm('No tildaste ninguna sección: el usuario solo va a ver Inicio. ¿Guardar igual?')) return;
    if(edit && !datos.password) delete datos.password;
    // El navegador puede autocompletar la contraseña guardada sin que se note
    if(edit && datos.password &&
       !confirm(`Vas a CAMBIAR la contraseña de ${form.dataset.email}.\n\nSi no querías cambiarla, cancelá y dejá el campo Contraseña vacío.`)) return;
    const url = edit ? `/api/usuarios/${encodeURIComponent(form.dataset.email)}` : '/api/usuarios';
    const method = edit ? 'PUT' : 'POST';
    try{
      const res = await fetch(url, { method, headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(datos)});
      const payload = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(payload.error || (payload.errors && payload.errors[0] && payload.errors[0].msg) || 'Revisá los datos ingresados');
      el('modal-usuario').style.display='none';
      await cargar();
    }catch(err){
      console.error(err);
      alert('No se pudo guardar: ' + err.message);
    }
  }

  async function eliminar(){
    if(!seleccionado) return alert('Selecciona un usuario');
    if(!confirm(`¿Eliminar ${seleccionado.email}?`)) return;
    try{
      const res = await fetch(`/api/usuarios/${encodeURIComponent(seleccionado.email)}`, { method:'DELETE', credentials:'include' });
      const payload = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(payload.error || 'Error al eliminar');
      seleccionado = null;
      await cargar();
    }catch(e){
      console.error(e);
      alert('No se pudo eliminar: ' + e.message);
    }
  }

  // Genera una contraseña temporal; el usuario la cambia al entrar
  async function blanquear(){
    if(!seleccionado) return alert('Selecciona un usuario');
    if(!confirm(`¿Blanquear la contraseña de ${seleccionado.email}?\n\nSe le cierran las sesiones abiertas y al entrar con la temporal va a tener que elegir una nueva.`)) return;
    try{
      const res = await fetch(`/api/usuarios/${encodeURIComponent(seleccionado.email)}/blanquear`, { method:'POST', credentials:'include' });
      const payload = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(payload.error || 'Error al blanquear');
      prompt(`Contraseña temporal de ${seleccionado.email} (copiala y pasásela):`, payload.password);
    }catch(e){
      console.error(e);
      alert('No se pudo blanquear: ' + e.message);
    }
  }

  function init(){
    const container = document.querySelector('.tab-content[data-view="usuarios"]');
    if(!container){ setTimeout(init,100); return; }
    tbody = el('tbody-usuarios');
    // Toggle ojo contraseña
    const toggle = el('toggle-user-password');
    const pwd = el('user-password');
    if (toggle && pwd) {
      toggle.addEventListener('click', () => {
        const icon = toggle.querySelector('i');
        const isHidden = pwd.type === 'password';
        pwd.type = isHidden ? 'text' : 'password';
        if (icon) {
          icon.classList.toggle('fa-eye', !isHidden);
          icon.classList.toggle('fa-eye-slash', isHidden);
        }
      });
    }
    el('btn-user-agregar').onclick = ()=> abrirModal(false);
    el('btn-user-modificar').onclick = ()=> {
      if(!seleccionado) return alert('Selecciona un usuario');
      abrirModal(true);
    };
    el('btn-user-eliminar').onclick = eliminar;
    el('btn-user-blanquear').onclick = blanquear;
    el('btn-user-accesos').onclick = abrirAccesos;
    el('accesos-buscar').oninput = renderAccesos;
    el('accesos-solo-fallidos').onchange = renderAccesos;
    el('form-usuario').onsubmit = guardar;
    el('user-rol').onchange = actualizarSegunRol;
    el('user-permisos-todas').onclick = ()=> marcarPermisos(secciones.map(s => s.id));
    el('user-permisos-ninguna').onclick = ()=> marcarPermisos([]);
    cargar();
  }

  if(document.querySelector('.tab-content[data-view="usuarios"]')) init();
  document.addEventListener('view:changed', (e)=>{ if(e.detail==='usuarios') init(); });
})();
