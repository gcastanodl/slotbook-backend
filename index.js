// ═══════════════════════════════════════════════════════════
//  SLOTBOOK BACKEND — Express + PostgreSQL
//  Desplegado en Railway
// ═══════════════════════════════════════════════════════════

const express  = require('express');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'slotbook_secret_cambiame_en_produccion';

// ─── CONEXIÓN POSTGRESQL ──────────────────────────────────
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

// ─── CREAR TABLAS ────────────────────────────────────────
async function createTables() {
  await query(`CREATE TABLE IF NOT EXISTS negocios (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    tipo TEXT,
    color TEXT DEFAULT '#6366F1',
    ini TEXT,
    tel TEXT,
    whatsapp TEXT,
    ciudad TEXT,
    direccion TEXT,
    descripcion TEXT,
    plan TEXT DEFAULT 'starter',
    sucursales INTEGER DEFAULT 1,
    empleados TEXT DEFAULT '1-3',
    rnc TEXT,
    estado TEXT DEFAULT 'activo',
    creado_en TIMESTAMP DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    sucursal_id TEXT DEFAULT 'Centro',
    activo INTEGER DEFAULT 1,
    creado_en TIMESTAMP DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS citas (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER,
    cliente TEXT,
    cliente_tel TEXT,
    servicio TEXT,
    barbero TEXT,
    barbero_key TEXT,
    fecha TEXT,
    hora TEXT,
    sucursal TEXT,
    estado TEXT DEFAULT 'pendiente',
    precio TEXT,
    duracion TEXT,
    notas TEXT,
    creado_en TIMESTAMP DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS superadmins (
    id SERIAL PRIMARY KEY,
    usuario TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  )`);

  console.log('[SlotBook] ✓ Tablas listas');
}

// ─── DATOS INICIALES ─────────────────────────────────────
async function seedData() {
  const sa = await query('SELECT id FROM superadmins WHERE usuario = $1', ['superadmin']);
  if (sa.rows.length === 0) {
    const hash = bcrypt.hashSync('slotbook2024', 10);
    await query('INSERT INTO superadmins (usuario, password) VALUES ($1, $2)', ['superadmin', hash]);
    console.log('[SlotBook] ✓ Superadmin creado: superadmin / slotbook2024');
  }

  const demo = await query("SELECT id FROM negocios WHERE nombre = $1", ['Barbería Elite Santiago']);
  if (demo.rows.length === 0) {
    const neg = await query(
      'INSERT INTO negocios (nombre, tipo, color, ini, tel, ciudad, plan, estado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      ['Barbería Elite Santiago','barberia','#6366F1','BE','+1 829 555 1000','Santiago','pro','activo']
    );
    const negId = neg.rows[0].id;
    const adminHash = bcrypt.hashSync('1234', 10);
    await query('INSERT INTO usuarios (negocio_id,nombre,email,password,role,sucursal_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [negId,'Admin Principal','admin@negocio.com',adminHash,'admin','Centro']);
    const staffHash = bcrypt.hashSync('1234', 10);
    await query('INSERT INTO usuarios (negocio_id,nombre,email,password,role,sucursal_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [negId,'Staff Demo','staff@negocio.com',staffHash,'staff','Centro']);
    console.log('[SlotBook] ✓ Demo: admin@negocio.com/1234 y staff@negocio.com/1234');
  }
}

// ─── MIDDLEWARES ──────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════
//  ENDPOINTS
// ═══════════════════════════════════════════════════════════

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), db: 'postgresql' }));

// ─── LOGIN ────────────────────────────────────────────────
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
    const u = await query('SELECT * FROM usuarios WHERE email = $1 AND activo = 1', [email.toLowerCase().trim()]);
    if (u.rows.length === 0 || !bcrypt.compareSync(password, u.rows[0].password))
      return res.status(401).json({ error: 'Credenciales incorrectas' });

    const user = u.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, negocio_id: user.negocio_id }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, nombre: user.nombre, email: user.email, role: user.role, sucursalId: user.sucursal_id, negocio_id: user.negocio_id } });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── USUARIOS ─────────────────────────────────────────────
app.get('/users', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const nid = req.query.negocio_id || req.user.negocio_id;
    const r = await query('SELECT id,nombre,email,role,sucursal_id,activo,creado_en FROM usuarios WHERE negocio_id = $1', [nid]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: 'Error del servidor' }); }
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
  } catch(e) { res.status(500).json({ error: 'Error del servidor' }); }
});

app.delete('/users/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const u = await query('SELECT * FROM usuarios WHERE id = $1', [req.params.id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    if (req.user.role !== 'superadmin' && u.rows[0].negocio_id !== req.user.negocio_id) return res.status(403).json({ error: 'Sin permiso' });
    await query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error del servidor' }); }
});

// ─── CITAS ────────────────────────────────────────────────
app.get('/citas/:negocio_id', async (req, res) => {
  try {
    const r = await query('SELECT * FROM citas WHERE negocio_id = $1 ORDER BY fecha DESC, hora ASC', [req.params.negocio_id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: 'Error del servidor' }); }
});

app.post('/citas', async (req, res) => {
  try {
    const c = req.body;
    if (!c.fecha||!c.hora) return res.status(400).json({ error: 'fecha y hora requeridas' });
    const r = await query('INSERT INTO citas (negocio_id,cliente,cliente_tel,servicio,barbero,barbero_key,fecha,hora,sucursal,estado,precio,duracion,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
      [c.negocio_id||1, c.cliente||'', c.clienteTel||'', c.servicio||'', c.barbero||'', c.barberoKey||'',
       c.fecha, c.hora, c.sucursal||'Centro', c.estado||'pendiente', c.precio||'0', c.duracion||'30 min', c.notas||'']);
    res.status(201).json({ id: r.rows[0].id, ...c });
  } catch(e) { res.status(500).json({ error: 'Error del servidor' }); }
});

app.patch('/citas/:id', authMiddleware, async (req, res) => {
  try {
    const { estado, notas } = req.body;
    await query('UPDATE citas SET estado = $1, notas = COALESCE($2, notas) WHERE id = $3', [estado, notas, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error del servidor' }); }
});

// ─── NEGOCIOS (superadmin) ────────────────────────────────
app.get('/negocios', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const r = await query('SELECT * FROM negocios ORDER BY creado_en DESC');
    const negocios = await Promise.all(r.rows.map(async n => {
      const c = await query('SELECT COUNT(*) as t FROM citas WHERE negocio_id = $1', [n.id]);
      return { ...n, citas_total: parseInt(c.rows[0].t) || 0 };
    }));
    res.json(negocios);
  } catch(e) { res.status(500).json({ error: 'Error del servidor' }); }
});

app.post('/negocios', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const { nombre, tipo, color, ini, tel, whatsapp, ciudad, direccion, descripcion,
            plan, sucursales, empleados, rnc, adminNombre, adminEmail, adminPass } = req.body;
    if (!nombre||!adminEmail||!adminPass) return res.status(400).json({ error: 'nombre, adminEmail y adminPass requeridos' });
    const neg = await query('INSERT INTO negocios (nombre,tipo,color,ini,tel,whatsapp,ciudad,direccion,descripcion,plan,sucursales,empleados,rnc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
      [nombre, tipo||'otro', color||'#6366F1', ini||nombre.substring(0,2).toUpperCase(),
       tel||'', whatsapp||'', ciudad||'', direccion||'', descripcion||'', plan||'starter', sucursales||1, empleados||'1-3', rnc||'']);
    const hash = bcrypt.hashSync(adminPass, 10);
    await query('INSERT INTO usuarios (negocio_id,nombre,email,password,role,sucursal_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [neg.rows[0].id, adminNombre||nombre, adminEmail.toLowerCase(), hash, 'admin', 'Centro']);
    res.status(201).json({ id: neg.rows[0].id, nombre, plan });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.patch('/negocios/:id', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const f = req.body;
    await query(`UPDATE negocios SET 
      nombre=COALESCE($1,nombre), tipo=COALESCE($2,tipo), color=COALESCE($3,color),
      ini=COALESCE($4,ini), tel=COALESCE($5,tel), whatsapp=COALESCE($6,whatsapp),
      ciudad=COALESCE($7,ciudad), direccion=COALESCE($8,direccion),
      descripcion=COALESCE($9,descripcion), plan=COALESCE($10,plan),
      sucursales=COALESCE($11,sucursales), empleados=COALESCE($12,empleados),
      rnc=COALESCE($13,rnc), estado=COALESCE($14,estado)
      WHERE id=$15`,
      [f.nombre,f.tipo,f.color,f.ini,f.tel,f.whatsapp,f.ciudad,f.direccion,
       f.descripcion,f.plan,f.sucursales,f.empleados,f.rnc,f.estado,req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error del servidor' }); }
});

// ─── ARRANCAR ─────────────────────────────────────────────
async function start() {
  try {
    await createTables();
    await seedData();
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