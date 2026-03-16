/**
 * Seed inicial de la base de datos
 * Uso: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Iniciando seed...");

  // Áreas base
  const rootArea = await prisma.area.upsert({
    where: { code: "GEN" },
    update: {},
    create: { name: "General", code: "GEN", description: "Área raíz de la organización", color: "#6366f1" },
  });

  const areas = await Promise.all([
    prisma.area.upsert({
      where: { code: "TI" },
      update: {},
      create: { name: "Tecnología de la Información", code: "TI", parentId: rootArea.id, color: "#3b82f6" },
    }),
    prisma.area.upsert({
      where: { code: "RRHH" },
      update: {},
      create: { name: "Recursos Humanos", code: "RRHH", parentId: rootArea.id, color: "#10b981" },
    }),
    prisma.area.upsert({
      where: { code: "OPS" },
      update: {},
      create: { name: "Operaciones", code: "OPS", parentId: rootArea.id, color: "#f59e0b" },
    }),
    prisma.area.upsert({
      where: { code: "FIN" },
      update: {},
      create: { name: "Finanzas", code: "FIN", parentId: rootArea.id, color: "#ef4444" },
    }),
  ]);

  // Super Admin
  const superAdmin = await prisma.user.upsert({
    where: { email: "admin@empresa.local" },
    update: {},
    create: {
      name: "Administrador Sistema",
      email: "admin@empresa.local",
      passwordHash: await bcrypt.hash("Admin123!", 12),
      role: "SUPER_ADMIN",
      areaId: rootArea.id,
      jobTitle: "Administrador del Sistema",
      passwordChangedAt: new Date(),
    },
  });

  // Admin de área TI
  await prisma.user.upsert({
    where: { email: "soporte@empresa.local" },
    update: {},
    create: {
      name: "Jefe Soporte TI",
      email: "soporte@empresa.local",
      passwordHash: await bcrypt.hash("Soporte123!", 12),
      role: "ADMIN_AREA",
      areaId: areas[0].id,
      jobTitle: "Jefe de Soporte TI",
      passwordChangedAt: new Date(),
    },
  });

  // Editor
  await prisma.user.upsert({
    where: { email: "editor@empresa.local" },
    update: {},
    create: {
      name: "Editor Documentos",
      email: "editor@empresa.local",
      passwordHash: await bcrypt.hash("Editor123!", 12),
      role: "EDITOR",
      areaId: areas[0].id,
      jobTitle: "Analista de Procesos",
      passwordChangedAt: new Date(),
    },
  });

  // Visualizador
  await prisma.user.upsert({
    where: { email: "user@empresa.local" },
    update: {},
    create: {
      name: "Usuario Estándar",
      email: "user@empresa.local",
      passwordHash: await bcrypt.hash("User123!", 12),
      role: "VISUALIZADOR",
      areaId: areas[1].id,
      passwordChangedAt: new Date(),
    },
  });

  // Configuración inicial del sistema
  const defaultConfigs = [
    { key: "app.name", value: "Manual del Sistema" },
    { key: "app.company", value: "Mi Empresa S.A." },
    { key: "ai.mode", value: "LOCAL" },
    { key: "ai.daily_summary_limit", value: "20" },
    { key: "ai.daily_chat_limit", value: "50" },
    { key: "upload.max_doc_size_mb", value: "500" },
    { key: "upload.max_video_size_mb", value: "2048" },
    { key: "auth.session_days", value: "7" },
    { key: "auth.max_failed_logins", value: "5" },
    { key: "notify.expiry_days_warning", value: "30,15,7" },
  ];

  for (const config of defaultConfigs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: {},
      create: { key: config.key, value: config.value, updatedBy: superAdmin.id },
    });
  }

  console.log("✓ Seed completado");
  console.log("  Usuarios creados:");
  console.log("  → admin@empresa.local / Admin123! (SUPER_ADMIN)");
  console.log("  → soporte@empresa.local / Soporte123! (ADMIN_AREA)");
  console.log("  → editor@empresa.local / Editor123! (EDITOR)");
  console.log("  → user@empresa.local / User123! (VISUALIZADOR)");
  console.log("  ⚠️  Cambia las contraseñas en producción");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
