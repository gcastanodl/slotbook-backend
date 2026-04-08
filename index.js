// ═══════════════════════════════════════════════════════════
//  SLOTBOOK BACKEND — Express + SQLite
//  Desplegado en Railway → https://slotbook-backend-production.up.railway.app
//
//  ENDPOINTS:
//    GET  /health              → status del servidor
//    POST /auth/login          → login (admin / staff / superadmin)
//    GET  /users               → listar usuarios del negocio
//    POST /users               → crear usuario
//    DELETE /users/:id         → eliminar usuario
//    GET  /citas/:negocio_id   → citas de un negocio
//    POST /citas               → crear cita
//    PATCH /citas/:id          → actualizar estado de cita
//    GET  /negocios            → listar negocios (solo superadmin)
//    POST /negocios            → crear negocio (solo superadmin)
//    PATCH /negocios/:id       → editar negocio (solo superadmin)
// ═══════════════════════════════════════════════════════════

const express    = require('express');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const path       = require('path');
const fs         = require('fs');

const initSqlJs  = require('sql.js');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'slotbook_secret_cambiame_en_produccion';
const DB_FILE    = path.join(__dirname, 'slotbook.db.json');

let db;
let SQL;

async function initDB() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = new SQL.Database(Buffer.from(saved, 'base64'));
      console.log('[SlotBook] ✓ BD cargada desde archivo');
    } catch {
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log('[SlotBook] ✓ BD nueva creada');
  }

  global.saveDB = () => {
    const data = Buffer.from(db.export()).toString('base64');
    fs.writeFileSync(DB_FILE, JSON.stringify(data));
  };

  createTables();
  seedData();
}

function run(sql, params = []) {
  db.run(sql, params);
  global.saveDB();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function runInsert(sql, params = []) {
  db.run(sql, params);
  const idRow = get('SELECT last_insert_rowid() as id');
  global.saveDB();
  return { lastInsertRowid: idRow?.id };
}

function createTables() {
  db.run(`CREATE TABLE IF NOT EXISTS negocios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, tipo TEXT,
    color TEXT DEFAULT '#6366F1', ini TEXT, tel TEXT, whatsapp TEXT,
    ciudad TEXT, direccion TEXT, descripcion TEXT,
    plan TEXT DEFAULT 'starter', sucursales INTEGER DEFAULT 1,
    empleados TEXT DEFAULT '1-3', rnc TEXT, estado TEXT DEFAULT 'activo',
    creado_en TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, negocio_id INTEGER,
    nombre TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff', sucursal_id TEXT DEFAULT 'Centro',
    activo INTEGER DEFAULT 1, creado_en TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS citas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, negocio_id INTEGER,
    cliente TEXT, cliente_tel TEXT, servicio TEXT, barbero TEXT,
    barbero_key TEXT, fecha TEXT, hora TEXT, sucursal TEXT,
    estado TEXT DEFAULT 'pendiente', precio TEXT, duracion TEXT,
    notas TEXT, creado_en TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS superadmins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE, password TEXT NOT NULL
  )`);
  global.saveDB();
  console.log('[SlotBook] ✓ Tablas listas');
}

function seedData() {
  const existeSA = get('SELECT id FROM superadmins WHERE usuario = ?', ['superadmin']);
  if (!existeSA) {
    const hash = bcrypt.hashSync('slotbook2024', 10);
    runInsert('INSERT INTO superadmins (usuario, password) VALUES (?, ?)', ['superadmin', hash]);
    console.log('[SlotBook] ✓ Superadmin creado: superadmin / slotbook2024');
  }

  const existeDemo = get('SELECT id FROM negocios WHERE nombre = ?', ['Barbería Elite Santiago']);
  if (!existeDemo) {
    const neg = runInsert(
      'INSERT INTO negocios (nombre, tipo, color, ini, tel, ciudad, plan, estado) VALUES (?,?,?,?,?,?,?,?)',
      ['Barbería Elite Santiago','barberia','#6366F1','BE','+1 829 555 1000','Santiago','pro','activo']
    );
    const adminHash = bcrypt.hashSync('1234', 10);
    runInsert('INSERT INTO usuarios (negocio_id,nombre,email,password,role,sucursal_id) VALUES (?,?,?,?,?,?)',
      [neg.lastInsertRowid,'Admin Principal','admin@negocio.com',adminHash,'admin','Centro']);
    const staffHash = bcrypt.hashSync('1234', 10);
    runInsert('INSERT INTO usuarios (negocio_id,nombre,email,password,role,sucursal_id) VALUES (?,?,?,?,?,?)',
      [neg.lastInsertRowid,'Staff Demo','staff@negocio.com',staffHash,'staff','Centro']);
    console.log('[SlotBook] ✓ Demo: admin@negocio.com/1234 y staff@negocio.com/1234');
  }
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

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.post('/auth/login', (req, res) => {
  const { email, password, usuario } = req.body;

  if (usuario) {
    const sa = get('SELECT * FROM superadmins WHERE usuario = ?', [usuario]);
    if (!sa || !bcrypt.compareSync(password, sa.password))
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    const token = jwt.sign({ id: sa.id, role: 'superadmin', usuario: sa.usuario }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token, user: { id: sa.id, nombre: 'SuperAdmin', email: 'superadmin', role: 'superadmin' } });
  }

  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  const user = get('SELECT * FROM usuarios WHERE email = ? AND activo = 1', [email.toLowerCase().trim()]);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Credenciales incorrectas' });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, negocio_id: user.negocio_id }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, nombre: user.nombre, email: user.email, role: user.role, sucursalId: user.sucursal_id, negocio_id: user.negocio_id } });
});

app.get('/users', authMiddleware, soloAdmin, (req, res) => {
  const nid = req.query.negocio_id || req.user.negocio_id;
  res.json(all('SELECT id,nombre,email,role,sucursal_id,activo,creado_en FROM usuarios WHERE negocio_id = ?', [nid]));
});

app.post('/users', authMiddleware, soloAdmin, (req, res) => {
  const { nombre, email, password, role, sucursalId, negocio_id } = req.body;
  if (!nombre||!email||!password) return res.status(400).json({ error: 'nombre, email y password requeridos' });
  if (get('SELECT id FROM usuarios WHERE email = ?', [email.toLowerCase()])) return res.status(409).json({ error: 'Email ya existe' });
  const hash = bcrypt.hashSync(password, 10);
  const nid  = negocio_id || req.user.negocio_id;
  const r = runInsert('INSERT INTO usuarios (negocio_id,nombre,email,password,role,sucursal_id) VALUES (?,?,?,?,?,?)',
    [nid, nombre, email.toLowerCase(), hash, role||'staff', sucursalId||'Centro']);
  res.status(201).json({ id: r.lastInsertRowid, nombre, email, role: role||'staff' });
});

app.delete('/users/:id', authMiddleware, soloAdmin, (req, res) => {
  const u = get('SELECT * FROM usuarios WHERE id = ?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  if (req.user.role !== 'superadmin' && u.negocio_id !== req.user.negocio_id) return res.status(403).json({ error: 'Sin permiso' });
  run('DELETE FROM usuarios WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.get('/citas/:negocio_id', (req, res) => {
  res.json(all('SELECT * FROM citas WHERE negocio_id = ? ORDER BY fecha DESC, hora ASC', [req.params.negocio_id]));
});

app.post('/citas', (req, res) => {
  const c = req.body;
  if (!c.fecha||!c.hora) return res.status(400).json({ error: 'fecha y hora requeridas' });
  const r = runInsert('INSERT INTO citas (negocio_id,cliente,cliente_tel,servicio,barbero,barbero_key,fecha,hora,sucursal,estado,precio,duracion,notas) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [c.negocio_id||1, c.cliente||'', c.clienteTel||'', c.servicio||'', c.barbero||'', c.barberoKey||'',
     c.fecha, c.hora, c.sucursal||'Centro', c.estado||'pendiente', c.precio||'0', c.duracion||'30 min', c.notas||'']);
  res.status(201).json({ id: r.lastInsertRowid, ...c });
});

app.patch('/citas/:id', authMiddleware, (req, res) => {
  const { estado, notas } = req.body;
  run('UPDATE citas SET estado = ?, notas = COALESCE(?, notas) WHERE id = ?', [estado, notas, req.params.id]);
  res.json({ ok: true });
});

app.get('/negocios', authMiddleware, soloSuperAdmin, (req, res) => {
  const negocios = all('SELECT * FROM negocios ORDER BY creado_en DESC');
  res.json(negocios.map(n => ({
    ...n, citas_total: get('SELECT COUNT(*) as t FROM citas WHERE negocio_id = ?', [n.id])?.t || 0
  })));
});

app.post('/negocios', authMiddleware, soloSuperAdmin, (req, res) => {
  const { nombre, tipo, color, ini, tel, whatsapp, ciudad, direccion, descripcion,
          plan, sucursales, empleados, rnc, adminNombre, adminEmail, adminPass } = req.body;
  if (!nombre||!adminEmail||!adminPass) return res.status(400).json({ error: 'nombre, adminEmail y adminPass requeridos' });
  const neg = runInsert('INSERT INTO negocios (nombre,tipo,color,ini,tel,whatsapp,ciudad,direccion,descripcion,plan,sucursales,empleados,rnc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [nombre, tipo||'otro', color||'#6366F1', ini||nombre.substring(0,2).toUpperCase(),
     tel||'', whatsapp||'', ciudad||'', direccion||'', descripcion||'', plan||'starter', sucursales||1, empleados||'1-3', rnc||'']);
  const hash = bcrypt.hashSync(adminPass, 10);
  runInsert('INSERT INTO usuarios (negocio_id,nombre,email,password,role,sucursal_id) VALUES (?,?,?,?,?,?)',
    [neg.lastInsertRowid, adminNombre||nombre, adminEmail.toLowerCase(), hash, 'admin', 'Centro']);
  res.status(201).json({ id: neg.lastInsertRowid, nombre, plan });
});

app.patch('/negocios/:id', authMiddleware, soloSuperAdmin, (req, res) => {
  const f = req.body;
  run(`UPDATE negocios SET nombre=COALESCE(?,nombre),tipo=COALESCE(?,tipo),color=COALESCE(?,color),
    ini=COALESCE(?,ini),tel=COALESCE(?,tel),whatsapp=COALESCE(?,whatsapp),ciudad=COALESCE(?,ciudad),
    direccion=COALESCE(?,direccion),descripcion=COALESCE(?,descripcion),plan=COALESCE(?,plan),
    sucursales=COALESCE(?,sucursales),empleados=COALESCE(?,empleados),rnc=COALESCE(?,rnc),estado=COALESCE(?,estado)
    WHERE id=?`,
    [f.nombre,f.tipo,f.color,f.ini,f.tel,f.whatsapp,f.ciudad,f.direccion,
     f.descripcion,f.plan,f.sucursales,f.empleados,f.rnc,f.estado,req.params.id]);
  res.json({ ok: true });
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[SlotBook] ✓ Servidor en puerto ${PORT}`);
    console.log(`[SlotBook] Health: http://localhost:${PORT}/health`);
  });
}).catch(err => {
  console.error('[SlotBook] Error iniciando BD:', err);
  process.exit(1);
});