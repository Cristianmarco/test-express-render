// === Stock (Refactor) ===
(function(){
  let prodSel = null;

  function el(id){ return document.getElementById(id); }

  async function cargarProductos(filtro=""){
    const tbody = el('tbody-stock-list');
    if(!tbody) return;
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888; padding:10px;"><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>`;
    try{
      const res = await fetch('/api/productos');
      const data = await res.json();
      if(!res.ok) throw new Error('Error productos');
      const lista = Array.isArray(data) ? data : [];
      const t = (filtro||'').toLowerCase();
      const filtrado = t ? lista.filter(p => (p.codigo||'').toLowerCase().includes(t) || (p.descripcion||'').toLowerCase().includes(t)) : lista;
      tbody.innerHTML = '';
      filtrado.forEach(p => {
        const tr = document.createElement('tr');
        tr.dataset.id = p.id;
        tr.innerHTML = `
          <td>${p.codigo || '-'}</td>
          <td>${p.descripcion || '-'}</td>
          <td>${p.stock_total ?? 0}</td>
        `;
        tr.addEventListener('click', ()=> seleccionarProducto(p, tr));
        tbody.appendChild(tr);
      });
    }catch(e){
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#c33; padding:10px;">Error al cargar</td></tr>`;
    }
  }

  function seleccionarProducto(p, tr){
    prodSel = p;
    document.querySelectorAll('#tbody-stock-list tr').forEach(r => r.classList.remove('selected'));
    tr.classList.add('selected');
  }

  async function verMovimientos(){
    if(!prodSel) return alert('Selecciona un producto');
    const modal = el('modal-movimientos');
    const tbody = el('tbody-movimientos');
    if(!modal || !tbody) return;
    modal.style.display = 'flex';
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#888; padding:10px;"><i class='fas fa-spinner fa-spin'></i> Cargando movimientos...</td></tr>`;
    try{
      const res = await fetch(`/api/stock/movimientos/${encodeURIComponent(prodSel.id)}`);
      const data = await res.json();
      if(!res.ok) throw new Error('Error movimientos');
      const lista = Array.isArray(data) ? data : [];
      if(lista.length === 0){
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#666; padding:10px;">Sin movimientos</td></tr>`;
        return;
      }
      tbody.innerHTML = lista.map(m => `
        <tr>
          <td>${m.fecha || '-'}${m.hora ? ` <span class="hora-mov">${m.hora}</span>` : ''}</td>
          <td>${m.tipo || '-'}</td>
          <td>${m.deposito || '-'}</td>
          <td>${m.cantidad ?? '-'}</td>
          <td>${m.id_reparacion || '-'}</td>
          <td>${m.observacion || '-'}</td>
        </tr>
      `).join('');
    }catch(e){
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#c33; padding:10px;">Error al cargar movimientos</td></tr>`;
    }
  }

  function bindUI(){
    const btnBuscar = el('btn-buscar-stock');
    if(btnBuscar) btnBuscar.onclick = ()=> cargarProductos(el('buscar-stock')?.value || '');
    const btnMov = el('btn-ver-movimientos');
    if(btnMov) btnMov.onclick = verMovimientos;
  }

  function initStock(){
    if(!el('tbody-stock-list')) { setTimeout(initStock, 100); return; }
    bindUI();
    cargarProductos();
  }

  if(document.querySelector('.tab-content[data-view="stock"]')) initStock();
  document.addEventListener('view:changed', (e)=>{ if(e.detail==='stock') initStock(); });
})();
