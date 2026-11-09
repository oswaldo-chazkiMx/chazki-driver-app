const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("revalidacion-correo-48h.sql").split("-- Ejecuta como maximo un reenvio cada 30 minutos")[0];

test("claims one eligible driver after 48 hours and sends only one automatic retry", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema private;
      create table auth.users(
        id uuid primary key,email text,created_at timestamptz,email_confirmed_at timestamptz
      );
      create table public.drivers(id uuid primary key,rol text);
      create table public.invitaciones_red(
        id bigint primary key,email text,cedis_id bigint,estatus text,creado_en timestamptz default now()
      );
      create table public.asignaciones_operativas(cedis_id bigint,supervisor_id uuid);
      create table public.notificaciones(
        usuario uuid,titulo text,cuerpo text,tipo text,ref_tipo text,ref_id bigint
      );
    `);
    await db.exec(migration);

    const supervisor = "11111111-1111-4111-8111-111111111111";
    const oldDriver = "22222222-2222-4222-8222-222222222222";
    const newDriver = "33333333-3333-4333-8333-333333333333";
    const verifiedDriver = "44444444-4444-4444-8444-444444444444";
    await db.query("insert into public.asignaciones_operativas values (7, $1)", [supervisor]);
    await db.exec(`
      insert into public.invitaciones_red(id,email,cedis_id,estatus) values
        (1,'old@example.test',7,'aceptada'),
        (2,'new@example.test',7,'enviada'),
        (3,'verified@example.test',7,'aceptada');
    `);
    await db.query("insert into public.drivers values ($1,'driver'),($2,'driver'),($3,'driver')", [oldDriver,newDriver,verifiedDriver]);
    await db.query(`
      insert into auth.users values
        ($1,'old@example.test',now()-interval '50 hours',null),
        ($2,'new@example.test',now()-interval '30 hours',null),
        ($3,'verified@example.test',now()-interval '60 hours',now()-interval '1 hour')
    `, [oldDriver,newDriver,verifiedDriver]);

    const first = await db.query("select * from public.reclamar_revalidaciones_correo_48h()");
    assert.deepEqual(first.rows.map(row => row.email), ["old@example.test"]);
    await db.query(
      "select public.finalizar_revalidacion_correo_48h($1,true,null)",
      [oldDriver]
    );
    assert.equal((await db.query("select estado from private.revalidaciones_correo_48h where user_id=$1", [oldDriver])).rows[0].estado, "reenviado");
    assert.equal((await db.query("select count(*)::int as n from public.notificaciones")).rows[0].n, 0);

    const second = await db.query("select * from public.reclamar_revalidaciones_correo_48h()");
    assert.equal(second.rows.length, 0);
    await db.exec(`
      insert into public.invitaciones_red(id,email,cedis_id,estatus) values
        (4,'failed@example.test',7,'aceptada');
    `);
    await db.exec("insert into public.drivers values ('55555555-5555-4555-8555-555555555555','driver')");
    await db.exec(`
      insert into auth.users values
        ('55555555-5555-4555-8555-555555555555','failed@example.test',now()-interval '49 hours',null)
    `);
    const failed = await db.query("select * from public.reclamar_revalidaciones_correo_48h()");
    assert.deepEqual(failed.rows.map(row => row.email), ["failed@example.test"]);
    await db.query(
      "select public.finalizar_revalidacion_correo_48h($1,false,'rate limit')",
      ["55555555-5555-4555-8555-555555555555"]
    );
    assert.equal((await db.query("select estado from private.revalidaciones_correo_48h where user_id=$1", ["55555555-5555-4555-8555-555555555555"])).rows[0].estado, "alerta_supervisor");
    const alert = (await db.query("select usuario,titulo,cuerpo from public.notificaciones")).rows[0];
    assert.equal(alert.usuario, supervisor);
    assert.match(alert.titulo, /Validacion de correo pendiente/);
    assert.match(alert.cuerpo, /desde Supabase Auth/);
  } finally {
    await db.close();
  }
});

test("scheduled function protects its endpoint and sends Supabase Auth signup resends", () => {
  const source = read("supabase/functions/revalidar-correos-48h/index.ts");
  assert.match(source, /isAuthorized\(request, secret\)/);
  assert.match(source, /\/auth\/v1\/resend/);
  assert.match(source, /type: "signup"/);
  assert.match(source, /finalizar_revalidacion_correo_48h/);
  assert.match(source, /alertas_supervisor/);
});
