const pool = require("../db"); // usa tu conexión a la DB
const bcrypt = require("bcryptjs");

async function rehashPasswords() {
  try {
    // Traer todos los usuarios
    const result = await pool.query("SELECT id, password FROM usuarios");

    for (const user of result.rows) {
      // Si ya está hasheada la contraseña, la saltamos
      if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")) {
        console.log(`🔹 Usuario ${user.id} ya tiene hash, lo salto`);
        continue;
      }

      // Hashear contraseña en texto plano
      const hashedPassword = await bcrypt.hash(user.password, 10);

      // Actualizar en DB
      await pool.query("UPDATE usuarios SET password = $1 WHERE id = $2", [
        hashedPassword,
        user.id,
      ]);

      console.log(`✅ Usuario ${user.id} actualizado`);
    }

    console.log("🎉 Todas las contraseñas han sido convertidas a hash");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error rehasheando contraseñas:", err);
    process.exit(1);
  }
}

rehashPasswords();
