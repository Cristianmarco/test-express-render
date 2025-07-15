async function loginUser(event) {
  event.preventDefault(); // Evita submit por defecto

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();

  // Validación básica
  if (!email || !password) {
    showError('Por favor, completa todos los campos.');
    return;
  }

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.error || data.mensaje || "Error al iniciar sesión");
      return;
    }

    // Guardar datos en localStorage
    localStorage.setItem('rol', data.rol);
    localStorage.setItem('username', data.email);
    if (data.cliente) {
      localStorage.setItem('cliente', data.cliente);
    } else {
      localStorage.removeItem('cliente');
    }

    // Redirigir al main
    window.location.href = '/main';

  } catch (error) {
    console.error("Error en login:", error);
    showError("Error al iniciar sesión");
  }
}

// Función para mostrar errores
function showError(mensaje) {
  const errorDiv = document.getElementById('error-message');
  errorDiv.textContent = mensaje;
  errorDiv.style.display = 'block';
}

// Función para mostrar/ocultar contraseña
function togglePasswordVisibility() {
  const passwordInput = document.getElementById('password');
  const icon = document.querySelector('.toggle-password');

  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    passwordInput.type = 'password';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
}

