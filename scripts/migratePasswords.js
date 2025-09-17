// scripts/migratePasswords.js
const pool = require("../db"); // usa tu conexión existente a Supabase
const bcrypt = require("bcryptjs");

(async () => {
  try {
    // Traer todos los usuarios
    const { rows } = await pool.query("SELECT id, email, password FROM usuarios");

console.log("📊 Usuarios encontrados:", rows.length);

for (const user of rows) {
  console.log("➡️ Usuario:", user.email, "| Password:", user.password);

  if (user.password.startsWith("$2b$")) {
    console.log(`✅ ${user.email} ya está encriptado`);
    continue;
  }

  const hashedPassword = await bcrypt.hash(user.password, 10);

  await pool.query("UPDATE usuarios SET password = $1 WHERE id = $2", [
    hashedPassword,
    user.id,
  ]);

  console.log(`🔐 Contraseña encriptada para: ${user.email}`);
}


    console.log("🎉 Migración completada con éxito.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error en migración:", err);
    process.exit(1);
  }
})();
