// === Clientes (Refactor) ===
(function(){
  let clienteSel = null;
  function el(id){ return document.getElementById(id); }

  function mapClienteRow(c){
    return {
      codigo: c.codigo,
      razon_social: c.razon_social || '',
      fantasia: c.fantasia || '',
      domicilio: c.domicilio || '',
      localidad: c.localidad || '',
      provincia: c.provincia || '',
      telefono: c.telefono || '',
      mail: c.mail || '',
      documento: c.documento || '',
      web: c.web || '',
      contacto: c.contacto || '',
      categoria: c.categoria || (c.codigo === 'DOTA' ? 'interno' : 'externo')
    };
  }

  async function cargarClientes(filtro=""){
    const tbody = el('tbody-clientes-ref');
    if(!tbody) return;
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888; padding:10px;"><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>`;
    try{
      const res = await fetch('/api/clientes');
      const data = await res.json();
      if(!res.ok) throw new Error('Error al cargar clientes');
      const lista = (Array.isArray(data)?data:[]).map(mapClienteRow);
      const t = (filtro||'').toLowerCase();
      const filtrado = t ? lista.filter(c =>
        (c.codigo||'').toLowerCase().includes(t) ||
        (c.fantasia||'').toLowerCase().includes(t) ||
        (c.razon_social||'').toLowerCase().includes(t)
      ) : lista;
      tbody.innerHTML = '';
      filtrado.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${c.codigo}</td>
          <td>${c.fantasia || '-'}</td>
          <td>${c.razon_social || '-'}</td>
        `;
        tr.addEventListener('click', ()=> seleccionar(c, tr));
        tbody.appendChild(tr);
      });
    }catch(e){
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#c33; padding:10px;">Error al cargar</td></tr>`;
    }
  }

  function seleccionar(c, tr){
    clienteSel = c;
    document.querySelectorAll('#tbody-clientes-ref tr').forEach(r=>r.classList.remove('selected'));
    tr.classList.add('selected');
    el('cli-codigo').textContent = c.codigo || '-';
    el('cli-fantasia').textContent = c.fantasia || '-';
    el('cli-razon').textContent = c.razon_social || '-';
    el('cli-direccion').textContent = c.domicilio || '-';
    el('cli-localidad').textContent = c.localidad || '-';
    el('cli-provincia').textContent = c.provincia || '-';
    el('cli-telefono').textContent = c.telefono || '-';
    el('cli-mail').textContent = c.mail || '-';
    el('cli-cuit').textContent = c.documento || '-';
    el('cli-contacto').textContent = c.contacto || '-';
    el('cli-web').textContent = c.web ? c.web : '-';
    el('cli-categoria').textContent = c.categoria || '-';
  }

  function bindAcciones(){
    const btnBuscar = el('btn-buscar-cliente');
    if(btnBuscar) btnBuscar.onclick = ()=> cargarClientes(el('buscar-cliente')?.value || '');

    const btnAgregar = el('btn-cli-agregar');
    if(btnAgregar) btnAgregar.onclick = ()=>{ clienteSel=null; const f=el('form-cliente-ref'); if(f) f.reset(); el('modal-cliente-ref').style.display='flex'; };

    const btnEditar = el('btn-cli-modificar');
    if(btnEditar) btnEditar.onclick = ()=>{
      if(!clienteSel) return alert('Selecciona un cliente');
      const f = el('form-cliente-ref');
      if(!f) return;
      Object.entries(clienteSel).forEach(([k,v])=>{ if(f[k]!==undefined) f[k].value = v || ''; });
      el('modal-cliente-ref').style.display='flex';
    };

    const btnEliminar = el('btn-cli-eliminar');
    if(btnEliminar) btnEliminar.onclick = async ()=>{
      if(!clienteSel) return alert('Selecciona un cliente');
      if(!confirm('¿Eliminar cliente?')) return;
      try{
        const resp = await fetch(`/api/clientes/${encodeURIComponent(clienteSel.codigo)}`, { method:'DELETE' });
        if(!resp.ok) throw new Error('Error al eliminar');
        clienteSel = null;
        await cargarClientes(el('buscar-cliente')?.value || '');
      }catch(e){ console.error(e); alert('No se pudo eliminar'); }
    };
  }

  function bindForm(){
    const form = el('form-cliente-ref');
    if(!form) return;
    form.onsubmit = async (e)=>{
      e.preventDefault();
      const datos = Object.fromEntries(new FormData(form).entries());
      const edit = !!(clienteSel && clienteSel.codigo);
      const method = edit ? 'PUT' : 'POST';
      const url = edit ? `/api/clientes/${encodeURIComponent(clienteSel.codigo)}` : '/api/clientes';
      try{
        const resp = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(datos) });
        const payload = await resp.json().catch(()=>({}));
        if(!resp.ok) throw new Error(payload.error || 'Error al guardar');
        el('modal-cliente-ref').style.display='none';
        form.reset();
        await cargarClientes(el('buscar-cliente')?.value || '');
      }catch(e){ console.error(e); alert('No se pudo guardar'); }
    };
  }

  function initClientes(){
    if(!el('tbody-clientes-ref')){ setTimeout(initClientes, 100); return; }
    bindAcciones();
    bindForm();
    cargarClientes();
  }

  if(document.querySelector('.tab-content[data-view="clientes"]')) initClientes();
  document.addEventListener('view:changed', (e)=>{ if(e.detail==='clientes') initClientes(); });
})();

