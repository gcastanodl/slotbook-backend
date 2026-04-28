// ═══════════════════════════════════════════════════════════
console.log('[DEBUG] index.js version con todas las rutas:', new Date().toISOString());
//  SLOTBOOK BACKEND — Express + PostgreSQL
// ═══════════════════════════════════════════════════════════

const express  = require('express');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'slotbook_secret_cambiame_en_produccion';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    client.release();
  }
}

async function createTables() {
  await query(`CREATE TABLE IF NOT EXISTS negocios (
    id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, tipo TEXT,
    color TEXT DEFAULT '#6366F1', ini TEXT, tel TEXT, whatsapp TEXT,
    ciudad TEXT, direccion TEXT, descripcion TEXT,
    plan TEXT DEFAULT 'starter', sucursales INTEGER DEFAULT 1,
    empleados TEXT DEFAULT '1-3', rnc TEXT, estado TEXT DEFAULT 'activo',
    creado_en TIMESTAMP DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY, negocio_id INTEGER,
    nombre TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff', sucursal_id TEXT DEFAULT 'Centro',
    activo INTEGER DEFAULT 1, creado_en TIMESTAMP DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS citas (
    id SERIAL PRIMARY KEY, negocio_id INTEGER,
    cliente TEXT, cliente_tel TEXT, servicio TEXT, barbero TEXT,
    barbero_key TEXT, fecha TEXT, hora TEXT, sucursal TEXT,
    estado TEXT DEFAULT 'pendiente', precio TEXT, duracion TEXT,
    notas TEXT, creado_en TIMESTAMP DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS superadmins (
    id SERIAL PRIMARY KEY, usuario TEXT NOT NULL UNIQUE, password TEXT NOT NULL
  )`);
  await query(`CREATE TABLE IF NOT EXISTS empleados (
    id SERIAL PRIMARY KEY, negocio_id INTEGER NOT NULL,
    key TEXT, nombre TEXT NOT NULL, iniciales TEXT, rol TEXT,
    sucursal TEXT DEFAULT 'Centro', color TEXT DEFAULT '#6366F1',
    tel TEXT, email TEXT, activo INTEGER DEFAULT 1,
    horario JSONB DEFAULT '{}',
    creado_en TIMESTAMP DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY, negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL, tel TEXT, email TEXT, cedula TEXT,
    notas TEXT, sucursal TEXT DEFAULT 'Centro',
    creado_en TIMESTAMP DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS servicios (
    id SERIAL PRIMARY KEY, negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL, duracion TEXT DEFAULT '30',
    precio TEXT DEFAULT '0', descripcion TEXT,
    activo INTEGER DEFAULT 1,
    creado_en TIMESTAMP DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS sucursales (
    id SERIAL PRIMARY KEY, negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL, key TEXT,
    direccion TEXT, tel TEXT,
    activo INTEGER DEFAULT 1,
    creado_en TIMESTAMP DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS facturas (
    id SERIAL PRIMARY KEY, negocio_id INTEGER NOT NULL,
    numero TEXT NOT NULL, negocio TEXT, sucursal TEXT,
    cliente TEXT, cliente_tel TEXT, servicio TEXT,
    barbero TEXT, fecha TEXT, hora TEXT,
    precio TEXT DEFAULT '0', emitida TEXT,
    cita_id INTEGER, creado_en TIMESTAMP DEFAULT NOW()
  )`);

  await query(`ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS key TEXT`);
  await query(`ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS direccion TEXT DEFAULT ''`);
  await query(`ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS tel TEXT DEFAULT ''`);
  await query(`ALTER TABLE negocios ADD COLUMN IF NOT EXISTS horario JSONB`);
  await query(`ALTER TABLE negocios ADD COLUMN IF NOT EXISTS descripcion TEXT DEFAULT ''`);
  await query(`ALTER TABLE negocios ADD COLUMN IF NOT EXISTS tema TEXT`);
  await query(`ALTER TABLE negocios ADD COLUMN IF NOT EXISTS wa_config JSONB`);
  await query(`ALTER TABLE negocios ADD COLUMN IF NOT EXISTS gcal_config JSONB`);
  await query(`ALTER TABLE negocios ADD COLUMN IF NOT EXISTS roles JSONB`);
  await query(`ALTER TABLE servicios ADD COLUMN IF NOT EXISTS sucursales TEXT DEFAULT 'todas'`);
  await query(`ALTER TABLE servicios ADD COLUMN IF NOT EXISTS barberos TEXT DEFAULT 'todos'`);
  await query(`ALTER TABLE citas ADD COLUMN IF NOT EXISTS cliente_email TEXT DEFAULT ''`);
  await query(`ALTER TABLE empleados ADD COLUMN IF NOT EXISTS foto_url TEXT DEFAULT ''`);
  await query(`ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS foto_url TEXT DEFAULT ''`);

  try { await query(`ALTER TABLE sucursales ALTER COLUMN slug DROP NOT NULL`); } catch(e) {}

  const sa = await query('SELECT id FROM superadmins WHERE usuario = $1', ['superadmin']);
  if (sa.rows.length === 0) {
    const hash = bcrypt.hashSync('slotbook2024', 10);
    await query('INSERT INTO superadmins (usuario, password) VALUES ($1, $2)', ['superadmin', hash]);
    console.log('[SlotBook] ✓ Superadmin creado');
  }
  console.log('[SlotBook] ✓ Tablas listas');
}

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Token inválido' }); }
}
function soloAdmin(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}
function soloSuperAdmin(req, res, next) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Solo superadmin' });
  next();
}

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), db: 'postgresql' }));

// ─── UPLOAD IMAGEN (proxy a ImgBB) ───────────────────────
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.post('/upload', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    const IMGBB_KEY = process.env.IMGBB_KEY;
    if (!IMGBB_KEY) return res.status(500).json({ error: 'IMGBB_KEY no configurada' });
    const FormData = require('form-data');
    const fetch = require('node-fetch');
    const form = new FormData();
    form.append('image', req.file.buffer.toString('base64'));
    const r = await fetch('https://api.imgbb.com/1/upload?key=' + IMGBB_KEY, { method: 'POST', body: form });
    const data = await r.json();
    if (data.success) {
      res.json({ url: data.data.display_url });
    } else {
      res.status(500).json({ error: 'Error ImgBB', detail: data });
    }
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password, usuario } = req.body;
    if (usuario) {
      const sa = await query('SELECT * FROM superadmins WHERE usuario = $1', [usuario]);
      if (sa.rows.length === 0 || !bcrypt.compareSync(password, sa.rows[0].password))
        return res.status(401).json({ error: 'Credenciales incorrectas' });
      const token = jwt.sign({ id: sa.rows[0].id, role: 'superadmin', usuario }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ token, user: { id: sa.rows[0].id, nombre: 'SuperAdmin', email: 'superadmin', role: 'superadmin' } });
    }
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    const u = await query('SELECT u.*, n.estado as negocio_estado FROM usuarios u JOIN negocios n ON u.negocio_id = n.id WHERE u.email = $1 AND u.activo = 1', [email.toLowerCase().trim()]);
    if (u.rows.length === 0 || !bcrypt.compareSync(password, u.rows[0].password))
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    if (u.rows[0].negocio_estado === 'inactivo')
      return res.status(403).json({ error: 'Tu cuenta está suspendida. Contacta al administrador.' });
    const user = u.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, negocio_id: user.negocio_id }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, nombre: user.nombre, email: user.email, role: user.role, sucursalId: user.sucursal_id, negocio_id: user.negocio_id } });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/users', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const nid = req.query.negocio_id || req.user.negocio_id;
    const r = await query('SELECT id,nombre,email,role,sucursal_id,activo,creado_en FROM usuarios WHERE negocio_id = $1', [nid]);
    res.json(r.rows);
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/users', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, email, password, role, sucursalId, negocio_id } = req.body;
    if (!nombre||!email||!password) return res.status(400).json({ error: 'nombre, email y password requeridos' });
    const exists = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length > 0) return res.status(409).json({ error: 'Email ya existe' });
    const hash = bcrypt.hashSync(password, 10);
    const nid  = negocio_id || req.user.negocio_id;
    const r = await query('INSERT INTO usuarios (negocio_id,nombre,email,password,role,sucursal_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [nid, nombre, email.toLowerCase(), hash, role||'staff', sucursalId||'Centro']);
    res.status(201).json({ id: r.rows[0].id, nombre, email, role: role||'staff' });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.delete('/users/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const u = await query('SELECT * FROM usuarios WHERE id = $1', [req.params.id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    if (req.user.role !== 'superadmin' && u.rows[0].negocio_id !== req.user.negocio_id) return res.status(403).json({ error: 'Sin permiso' });
    await query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/empleados/:negocio_id', authMiddleware, async (req, res) => {
  try {
    const r = await query('SELECT * FROM empleados WHERE negocio_id = $1 AND activo = 1 ORDER BY nombre ASC', [req.params.negocio_id]);
    res.json(r.rows);
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/empleados', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, iniciales, rol, sucursal, color, tel, email, horario, negocio_id, foto_url } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const nid = negocio_id || req.user.negocio_id;
    const ini = iniciales || nombre.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
    const key = ini + Date.now().toString().slice(-4);
    const r = await query(
      'INSERT INTO empleados (negocio_id,key,nombre,iniciales,rol,sucursal,color,tel,email,horario,foto_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
      [nid, key, nombre, ini, rol||'Barbero', sucursal||'', color||'#6366F1', tel||'', email||'', JSON.stringify(horario||{}), foto_url||'']
    );
    res.status(201).json({ id: r.rows[0].id, key, nombre, iniciales: ini, rol: rol||'Barbero', sucursal: sucursal||'', color: color||'#6366F1' });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.put('/empleados/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, rol, sucursal, color, tel, email, iniciales, foto_url } = req.body;
    await query(`UPDATE empleados SET
      nombre=COALESCE($1,nombre), rol=COALESCE($2,rol), sucursal=COALESCE($3,sucursal),
      color=COALESCE($4,color), tel=COALESCE($5,tel), email=COALESCE($6,email),
      iniciales=COALESCE($7,iniciales), foto_url=COALESCE($8,foto_url)
      WHERE id=$9 AND negocio_id=$10`,
      [nombre, rol, sucursal, color, tel, email, iniciales, foto_url||null, req.params.id, req.user.negocio_id]);
    res.json({ ok: true });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.patch('/empleados/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, rol, sucursal, color, tel, email, horario, activo, foto_url } = req.body;
    await query(`UPDATE empleados SET
      nombre=COALESCE($1,nombre), rol=COALESCE($2,rol), sucursal=COALESCE($3,sucursal),
      color=COALESCE($4,color), tel=COALESCE($5,tel), email=COALESCE($6,email),
      horario=COALESCE($7,horario), activo=COALESCE($8,activo), foto_url=COALESCE($9,foto_url)
      WHERE id=$10`,
      [nombre, rol, sucursal, color, tel, email, horario ? JSON.stringify(horario) : null, activo, foto_url||null, req.params.id]);
    res.json({ ok: true });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.put('/empleados/:id/horario', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { horario } = req.body;
    await query('UPDATE empleados SET horario=$1 WHERE id=$2 AND negocio_id=$3', [JSON.stringify(horario), req.params.id, req.user.negocio_id]);
    res.json({ ok: true });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.delete('/empleados/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    await query('UPDATE empleados SET activo = 0 WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/citas/:negocio_id', async (req, res) => {
  try {
    const r = await query('SELECT * FROM citas WHERE negocio_id = $1 ORDER BY fecha DESC, hora ASC', [req.params.negocio_id]);
    res.json(r.rows);
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/citas', async (req, res) => {
  try {
    const c = req.body;
    if (!c.fecha||!c.hora) return res.status(400).json({ error: 'fecha y hora requeridas' });
    const r = await query(
      'INSERT INTO citas (negocio_id,cliente,cliente_tel,cliente_email,servicio,barbero,barbero_key,fecha,hora,sucursal,estado,precio,duracion,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id',
      [c.negocio_id||1, c.cliente||'', c.cliente_tel||c.clienteTel||'', c.cliente_email||'',
       c.servicio||'', c.barbero||'', c.barbero_key||c.barberoKey||'',
       c.fecha, c.hora, c.sucursal||'', c.estado||'pendiente', c.precio||'0', c.duracion||'30 min', c.notas||'']);
    res.status(201).json({ id: r.rows[0].id, ...c });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.patch('/citas/:id', authMiddleware, async (req, res) => {
  try {
    const { estado, notas, sucursal } = req.body;
    await query('UPDATE citas SET estado = $1, notas = COALESCE($2, notas), sucursal = CASE WHEN $3::TEXT IS NOT NULL THEN $3 ELSE sucursal END WHERE id = $4', [estado, notas, sucursal||null, req.params.id]);
    res.json({ ok: true });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/negocios', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const r = await query('SELECT * FROM negocios ORDER BY creado_en DESC');
    const negocios = await Promise.all(r.rows.map(async n => {
      const c = await query('SELECT COUNT(*) as t FROM citas WHERE negocio_id = $1', [n.id]);
      return { ...n, citas_total: parseInt(c.rows[0].t) || 0 };
    }));
    res.json(negocios);
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/negocios', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const { nombre, tipo, color, ini, tel, whatsapp, ciudad, direccion, descripcion,
            plan, sucursales, empleados, rnc, adminNombre, adminEmail, adminPass } = req.body;
    if (!nombre||!adminEmail||!adminPass) return res.status(400).json({ error: 'nombre, adminEmail y adminPass requeridos' });
    const neg = await query(
      'INSERT INTO negocios (nombre,tipo,color,ini,tel,whatsapp,ciudad,direccion,descripcion,plan,sucursales,empleados,rnc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
      [nombre, tipo||'otro', color||'#6366F1', ini||nombre.substring(0,2).toUpperCase(),
       tel||'', whatsapp||'', ciudad||'', direccion||'', descripcion||'', plan||'starter', sucursales||1, empleados||'1-3', rnc||'']);
    const hash = bcrypt.hashSync(adminPass, 10);
    await query('INSERT INTO usuarios (negocio_id,nombre,email,password,role,sucursal_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [neg.rows[0].id, adminNombre||nombre, adminEmail.toLowerCase(), hash, 'admin', 'Centro']);
    res.status(201).json({ id: neg.rows[0].id, nombre, plan, adminPass });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/negocios/:id/reset-pass', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const { newPass } = req.body;
    if (!newPass || newPass.length < 4) return res.status(400).json({ error: 'Contraseña muy corta' });
    const hash = bcrypt.hashSync(newPass, 10);
    await query('UPDATE usuarios SET password=$1 WHERE negocio_id=$2 AND role=$3', [hash, req.params.id, 'admin']);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/negocios/:id', authMiddleware, async (req, res) => {
  try {
    const nid = parseInt(req.params.id);
    if (req.user.role !== 'superadmin' && req.user.negocio_id !== nid)
      return res.status(403).json({ error: 'Sin permiso' });
    const r = await query('SELECT * FROM negocios WHERE id = $1', [nid]);
    if (!r.rows.length) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/negocios/:id', authMiddleware, async (req, res) => {
  try {
    const nid = parseInt(req.params.id);
    if (req.user.role !== 'superadmin' && req.user.negocio_id !== nid)
      return res.status(403).json({ error: 'Sin permiso' });
    const { nombre, direccion, tel, wasa, whatsapp } = req.body;
    await query(`UPDATE negocios SET
      nombre=COALESCE($1,nombre), direccion=COALESCE($2,direccion),
      tel=COALESCE($3,tel), whatsapp=COALESCE($4,whatsapp) WHERE id=$5`,
      [nombre||null, direccion||null, tel||null, wasa||whatsapp||null, nid]);
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.patch('/negocios/:id', authMiddleware, async (req, res) => {
  try {
    const nid = parseInt(req.params.id);
    const isSA = req.user.role === 'superadmin';
    if (!isSA && req.user.negocio_id !== nid)
      return res.status(403).json({ error: 'Sin permiso' });
    const f = req.body;
    await query(`UPDATE negocios SET
      nombre=COALESCE($1,nombre), tipo=COALESCE($2,tipo), color=COALESCE($3,color),
      ini=COALESCE($4,ini), tel=COALESCE($5,tel), whatsapp=COALESCE($6,whatsapp),
      ciudad=COALESCE($7,ciudad), direccion=COALESCE($8,direccion), descripcion=COALESCE($9,descripcion),
      plan=COALESCE($10,plan), sucursales=COALESCE($11,sucursales), empleados=COALESCE($12,empleados),
      rnc=COALESCE($13,rnc), estado=COALESCE($14,estado), tema=COALESCE($15,tema),
      wa_config=COALESCE($16,wa_config), gcal_config=COALESCE($17,gcal_config),
      roles=COALESCE($18,roles), horario=COALESCE($19,horario) WHERE id=$20`,
      [f.nombre, isSA?f.tipo:null, isSA?f.color:null, isSA?f.ini:null,
       f.tel||null, f.whatsapp||null, isSA?f.ciudad:null, f.direccion||null,
       isSA?f.descripcion:null, isSA?f.plan:null, isSA?f.sucursales:null,
       isSA?f.empleados:null, isSA?f.rnc:null, isSA?f.estado:null,
       f.tema||null,
       f.wa_config?JSON.stringify(f.wa_config):null,
       f.gcal_config?JSON.stringify(f.gcal_config):null,
       f.roles?JSON.stringify(f.roles):null,
       f.horario?JSON.stringify(f.horario):null, nid]);
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.patch('/negocios/:id/estado', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const { estado } = req.body;
    if (!['activo','inactivo'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    await query('UPDATE negocios SET estado = $1 WHERE id = $2', [estado, req.params.id]);
    res.json({ ok: true, estado });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/negocios/:id/horario', authMiddleware, async (req, res) => {
  try {
    const nid = parseInt(req.params.id);
    if (req.user.role !== 'superadmin' && req.user.negocio_id !== nid)
      return res.status(403).json({ error: 'Sin permiso' });
    const { horario } = req.body;
    if (!horario) return res.status(400).json({ error: 'horario requerido' });
    await query('UPDATE negocios SET horario=$1 WHERE id=$2', [JSON.stringify(horario), nid]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/negocios/:id', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const r = await query('SELECT id FROM negocios WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Negocio no encontrado' });
    await query('DELETE FROM negocios WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/mi-negocio', authMiddleware, async (req, res) => {
  try {
    const nid = req.user.negocio_id;
    if (!nid) return res.status(400).json({ error: 'Sin negocio_id' });
    const r = await query('SELECT * FROM negocios WHERE id = $1', [nid]);
    if (!r.rows.length) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/mi-negocio', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const nid = req.user.negocio_id;
    const { nombre, direccion, tel, wasa } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    await query('UPDATE negocios SET nombre=$1, direccion=$2, tel=$3, whatsapp=$4 WHERE id=$5',
      [nombre, direccion||'', tel||'', wasa||'', nid]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/mi-negocio/horario', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const nid = req.user.negocio_id;
    const { horario } = req.body;
    if (!horario) return res.status(400).json({ error: 'Falta horario' });
    await query('UPDATE negocios SET horario=$1::jsonb WHERE id=$2', [JSON.stringify(horario), nid]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/mi-negocio', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const nid = req.user.negocio_id;
    const allowed = ['tema','wa_config','gcal_config','nombre','direccion','tel','wasa','rnc'];
    const jsonFields = ['wa_config','gcal_config','horario'];
    const fields = [], values = [];
    let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${i}${jsonFields.includes(key) ? '::jsonb' : ''}`);
        values.push(jsonFields.includes(key) ? JSON.stringify(req.body[key]) : req.body[key]);
        i++;
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Sin campos' });
    values.push(nid);
    await query(`UPDATE negocios SET ${fields.join(', ')} WHERE id=$${i}`, values);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/clientes/:negocio_id', authMiddleware, async (req, res) => {
  try {
    const r = await query('SELECT * FROM clientes WHERE negocio_id = $1 ORDER BY nombre ASC', [req.params.negocio_id]);
    res.json(r.rows);
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/clientes', authMiddleware, async (req, res) => {
  try {
    const { nombre, tel, email, cedula, notas, sucursal, negocio_id } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const nid = negocio_id || req.user.negocio_id;
    const r = await query(
      'INSERT INTO clientes (negocio_id,nombre,tel,email,cedula,notas,sucursal) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [nid, nombre, tel||'', email||'', cedula||'', notas||'', sucursal||'']
    );
    res.status(201).json({ id: r.rows[0].id, nombre });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.delete('/clientes/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    await query('DELETE FROM clientes WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/servicios/:negocio_id', authMiddleware, async (req, res) => {
  try {
    const r = await query('SELECT * FROM servicios WHERE negocio_id = $1 AND activo = 1 ORDER BY nombre ASC', [req.params.negocio_id]);
    res.json(r.rows);
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/servicios', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, duracion, precio, desc, negocio_id } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const nid = negocio_id || req.user.negocio_id;
    const r = await query(
      'INSERT INTO servicios (negocio_id,nombre,duracion,precio,descripcion) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [nid, nombre, duracion||'30', precio||'0', desc||'']
    );
    res.status(201).json({ id: r.rows[0].id, nombre });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.put('/servicios/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, duracion, precio, desc } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    await query(`UPDATE servicios SET nombre=$1, duracion=COALESCE($2,duracion), precio=COALESCE($3,precio), descripcion=COALESCE($4,descripcion) WHERE id=$5 AND negocio_id=$6`,
      [nombre, duracion, precio, desc, req.params.id, req.user.negocio_id]);
    res.json({ ok: true });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.delete('/servicios/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    await query('UPDATE servicios SET activo=0 WHERE id=$1 AND negocio_id=$2', [req.params.id, req.user.negocio_id]);
    res.json({ ok: true });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/sucursales/:negocio_id', authMiddleware, async (req, res) => {
  try {
    const r = await query('SELECT * FROM sucursales WHERE negocio_id = $1 ORDER BY creado_en ASC', [req.params.negocio_id]);
    res.json(r.rows);
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/sucursales', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, key, direccion, tel, negocio_id, foto_url } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const nid = negocio_id || req.user.negocio_id;
    const r = await query(
      'INSERT INTO sucursales (negocio_id,nombre,key,direccion,tel,foto_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [nid, nombre, key||nombre, direccion||'', tel||'', foto_url||'']
    );
    res.status(201).json({ id: r.rows[0].id, nombre, key: key||nombre });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.patch('/sucursales/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, direccion, tel, foto_url } = req.body;
    await query(`UPDATE sucursales SET
      nombre=COALESCE($1,nombre), direccion=COALESCE($2,direccion),
      tel=COALESCE($3,tel), foto_url=COALESCE($4,foto_url)
      WHERE id=$5`,
      [nombre||null, direccion||null, tel||null, foto_url||null, req.params.id]);
    res.json({ ok: true });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/facturas/:negocio_id', authMiddleware, async (req, res) => {
  try {
    const r = await query('SELECT * FROM facturas WHERE negocio_id = $1 ORDER BY emitida DESC', [req.params.negocio_id]);
    res.json(r.rows);
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/facturas', authMiddleware, async (req, res) => {
  try {
    const { negocio_id, numero, negocio, sucursal, cliente, cliente_tel, servicio, barbero, fecha, hora, precio, emitida, cita_id } = req.body;
    const r = await query(
      'INSERT INTO facturas (negocio_id,numero,negocio,sucursal,cliente,cliente_tel,servicio,barbero,fecha,hora,precio,emitida,cita_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
      [negocio_id, numero, negocio, sucursal, cliente, cliente_tel||'', servicio, barbero, fecha, hora, precio, emitida, cita_id||null]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch(e) { console.error('[500]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/public/negocio/:id', async (req, res) => {
  try {
    const r = await query('SELECT id,nombre,tipo,color,ini,tel,whatsapp,ciudad,direccion,horario FROM negocios WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/public/negocio/slug/:slug', async (req, res) => {
  try {
    const slug = decodeURIComponent(req.params.slug).toLowerCase().replace(/-/g,' ');
    const r = await query("SELECT id,nombre,tipo,color,ini,tel,whatsapp,ciudad,direccion,horario FROM negocios WHERE LOWER(nombre) LIKE $1 AND estado='activo' LIMIT 1", ['%'+slug+'%']);
    if (!r.rows.length) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/public/sucursales/:negocio_id', async (req, res) => {
  try {
    const r = await query('SELECT id,nombre,key,direccion,tel,foto_url FROM sucursales WHERE negocio_id=$1 ORDER BY creado_en ASC', [req.params.negocio_id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/public/servicios/:negocio_id', async (req, res) => {
  try {
    const r = await query('SELECT id,nombre,duracion,precio,descripcion FROM servicios WHERE negocio_id=$1 AND activo=1 ORDER BY nombre ASC', [req.params.negocio_id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/public/empleados/:negocio_id', async (req, res) => {
  try {
    const r = await query('SELECT id,nombre,key,iniciales,rol,sucursal,color,horario,foto_url FROM empleados WHERE negocio_id=$1 AND activo=1 ORDER BY nombre ASC', [req.params.negocio_id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/public/citas/:negocio_id', async (req, res) => {
  try {
    const { fecha } = req.query;
    let sql = "SELECT id,barbero,barbero_key,fecha,hora,sucursal,duracion FROM citas WHERE negocio_id=$1 AND estado NOT IN ('cancelada','Cancelada')";
    const params = [req.params.negocio_id];
    if (fecha) { sql += ' AND fecha=$2'; params.push(fecha); }
    const r = await query(sql, params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

async function start() {
  try {
    await createTables();
    app.listen(PORT, () => {
      console.log(`[SlotBook] ✓ Servidor en puerto ${PORT}`);
      console.log(`[SlotBook] Health: http://localhost:${PORT}/health`);
    });
  } catch(err) {
    console.error('[SlotBook] Error iniciando:', err);
    process.exit(1);
  }
}

start();
