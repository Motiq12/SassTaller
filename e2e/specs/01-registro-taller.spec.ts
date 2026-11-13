// Flujo 1 · Registro de taller (onboarding) desde la web, de punta a punta:
// formulario de dos pasos, slug disponible, alta real por POST /api/onboarding,
// sesión creada y semillas de fábrica en la base.
import { test, expect } from '@playwright/test';
import { abrirDb, una } from '../helpers/db';
import { sello, CLAVE } from '../helpers/motiq';

test('01 · un taller se registra desde la web y nace completo', async ({ page }) => {
  const s = sello();
  const slug = `t${s}r`;               // [a-z0-9][a-z0-9-]{1,38}[a-z0-9]
  const nombre = `Taller E2E ${slug}`;
  const email = `${slug}@prueba.test`;

  await page.goto('/registro-taller');
  await expect(page.getByRole('heading', { name: 'Registrá tu taller' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tu taller', exact: true })).toBeVisible();

  await page.locator('#f-nombre').fill(nombre);
  await page.locator('#f-slug').fill(slug);
  await expect(page.locator('#f-slug-estado')).toContainText('Disponible', { timeout: 15_000 });

  // Tipos de vehículo que atiende: el catálogo público trae "auto" como "Autos".
  const tipos = page.locator('fieldset.tipos', { hasText: '¿Qué vehículos atiende?' });
  await tipos.locator('label.tipo', { hasText: /auto/i }).click();
  await expect(tipos.locator('label.tipo', { hasText: /auto/i }).locator('input')).toBeChecked();

  await page.locator('#f-tel').fill('88881111');
  await page.locator('#f-dir').fill('Liberia Centro');
  await page.locator('#f-provincia').selectOption('Guanacaste');
  await page.locator('#f-canton').selectOption('Liberia');

  await page.getByRole('button', { name: 'Seguir' }).click();

  // Paso 2: la cuenta del administrador.
  await expect(page.locator('#f-anombre')).toBeVisible();
  await page.locator('#f-anombre').fill('Carlos Propietario');
  await page.locator('#f-correo').fill(email);
  await page.locator('#f-clave').fill(CLAVE);
  await page.locator('#f-clave2').fill(CLAVE);
  await page.getByRole('button', { name: 'Crear taller' }).click();

  // Paso 3: confirmación. El código de correo va al mailer simulado; el personal
  // puede entrar sin confirmarlo, así que directo al panel.
  await expect(page.getByRole('heading', { name: 'Confirmá tu correo' })).toBeVisible({ timeout: 45_000 });
  await page.locator('a.crear', { hasText: 'Entrar a mi panel' }).click();
  await expect(page).toHaveURL(/\/admin/);

  const token = await page.evaluate(() => localStorage.getItem('tallerms_token'));
  expect(token, 'el taller entra a su panel con sesión').toBeTruthy();
  const guardado = await page.evaluate(() => localStorage.getItem('tallerms_taller'));
  expect(guardado).toBe(slug);

  // En la base: el taller, su dueño admin y las cuatro semillas de fábrica.
  const db = abrirDb();
  try {
    const t = await una(db, 'SELECT id, nombre FROM tenants WHERE slug = ?', [slug]);
    expect(t, 'el taller quedó en la base').toBeTruthy();
    expect(t.nombre).toBe(nombre);

    const admin = await una(db, 'SELECT rol, activo FROM usuarios WHERE tenant_id = ? AND LOWER(email) = ?', [t.id, email]);
    expect(admin?.rol).toBe('admin');
    expect(Number(admin.activo)).toBe(1);

    for (const tabla of ['configuracion', 'sucursales', 'servicios', 'roles']) {
      const c = await una(db, `SELECT COUNT(*)::int AS n FROM ${tabla} WHERE tenant_id = ?`, [t.id]);
      expect(c.n, `semilla ${tabla}`).toBeGreaterThan(0);
    }
    const sede = await una(db, 'SELECT nombre FROM sucursales WHERE tenant_id = ?', [t.id]);
    expect(String(sede.nombre).length).toBeGreaterThan(0);
  } finally {
    await db.end();
  }
});
