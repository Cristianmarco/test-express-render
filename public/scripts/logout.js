// ======= [LOGOUT SCRIPT CARGADO] =======
async function logout() {
  if (!confirm("¿Seguro que deseas salir?")) return;

  try {
    const res = await fetch("/api/logout", {
      method: "POST",
      credentials: "include" // 👈 importante para que se envíe la cookie de sesión
    });

    const data = await res.json();

    if (data.success) {
      // limpiar localStorage
      localStorage.removeItem("rol");
      localStorage.removeItem("username");
      localStorage.removeItem("cliente");

      // redirigir al login
      window.location.href = "/login";
    } else {
      alert("❌ Error al cerrar sesión");
    }
  } catch (err) {
    console.error("❌ Error en logout:", err);
    alert("Error al cerrar sesión");
  }
}


