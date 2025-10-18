// === Usuarios (Refactor) ===
(function(){
  let tbody, seleccionado = null;
  function el(id){ return document.getElementById(id); }

  async function cargar(){
    if(!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:10px; color:#888"><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>`;
    try{
      const res = await fetch('/api/usuarios', { credentials: 'include' });
      const data = await res.json();
      if(!res.ok) throw new Error('Error al listar');
      tbody.innerHTML = '';
      (Array.isArray(data) ? data : []).forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${u.id ?? '-'}</td>
          <td>${u.email ?? '-'}</td>
          <td>${u.rol ?? '-'}</td>
          <td>${u.cliente_codigo ?? '-'}</td>
        `;
        tr.addEventListener('click', ()=>{
          seleccionado = u;
          tbody.querySelectorAll('tr').forEach(r=>r.classList.remove('selected'));
          tr.classList.add('selected');
        });
        tbody.appendChild(tr);
      });
    }catch(e){
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:10px; color:#c33">Error al cargar</td></tr>`;
    }
  }

  function abrirModal(edit){
    const modal = el('modal-usuario');
    const form = el('form-usuario');
    if(!modal || !form) return;
    el('modal-user-title').innerHTML = `<i class="fas fa-user"></i> ${edit ? 'Editar' : 'Nuevo'} usuario`;
    form.reset();
    delete form.dataset.email;
    if(edit && seleccionado){
      form.elements.email.value = seleccionado.email || '';
      form.elements.rol.value = seleccionado.rol || '';
      form.elements.cliente_codigo.value = seleccionado.cliente_codigo || '';
      form.dataset.email = seleccionado.email;
    }
    modal.style.display='flex';
  }

  async function guardar(e){
    e.preventDefault();
    const form = e.target;
    const datos = Object.fromEntries(new FormData(form).entries());
    const edit = !!form.dataset.email;
    if(!edit && !datos.password){
      alert('La contraseña es obligatoria al crear un usuario');
      return;
    }
    if(edit && !datos.password) delete datos.password;
    const url = edit ? `/api/usuarios/${encodeURIComponent(form.dataset.email)}` : '/api/usuarios';
    const method = edit ? 'PUT' : 'POST';
    try{
      const res = await fetch(url, { method, headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(datos)});
      const payload = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(payload.error || 'Error al guardar');
      el('modal-usuario').style.display='none';
      await cargar();
    }catch(err){
      console.error(err);
      alert('No se pudo guardar');
    }
  }

  async function eliminar(){
    if(!seleccionado) return alert('Selecciona un usuario');
    if(!confirm(`¿Eliminar ${seleccionado.email}?`)) return;
    try{
      const res = await fetch(`/api/usuarios/${encodeURIComponent(seleccionado.email)}`, { method:'DELETE', credentials:'include' });
      const payload = await res.json().catch(()=>({}));
      if(!res.ok && !payload.success) throw new Error(payload.error || 'Error al eliminar');
      seleccionado = null;
      await cargar();
    }catch(e){
      console.error(e);
      alert('No se pudo eliminar');
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
    el('form-usuario').onsubmit = guardar;
    cargar();
  }

  if(document.querySelector('.tab-content[data-view="usuarios"]')) init();
  document.addEventListener('view:changed', (e)=>{ if(e.detail==='usuarios') init(); });
})();
