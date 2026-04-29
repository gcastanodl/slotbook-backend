// ═══════════════════════════════════════════════════════════
console.log('[DEBUG] SlotBook Supabase backend:', new Date().toISOString());
//  SLOTBOOK BACKEND — Express + Supabase
// ═══════════════════════════════════════════════════════════

const express  = require('express');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET      = process.env.JWT_SECRET || 'slotbook_secret_cambiame_en_produccion';
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET; // service_role key

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

// Helper query wrapper
async function q(table) { return supabase.from(table); }

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

// ─── INIT SUPERADMIN ──────────────────────────────────────
async function initSuperAdmin() {
  const { data } = await supabase.from('superadmins').select('id').eq('usuario', 'superadmin').single();
  if (!data) {
    const hash = bcrypt.hashSync('slotbook2024', 10);
    await supabase.from('superadmins').insert({ usuario: 'superadmin', password: hash });
    console.log('[SlotBook] ✓ Superadmin creado');
  }
  console.log('[SlotBook] ✓ Supabase conectado');
}

// ─── HEALTH ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), db: 'supabase' }));

// ─── UPLOAD IMAGEN (Supabase Storage) ────────────────────
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.post('/upload', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    const ext      = req.file.mimetype.split('/')[1] || 'jpg';
    const negocioId = req.user.negocio_id || req.user.id || 'shared';
    const fileName = `${negocioId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { data, error } = await supabase.storage
      .from('fotos')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) return res.status(500).json({ error: error.message });
    const { data: urlData } = supabase.storage.from('fotos').getPublicUrl(fileName);
    res.json({ url: urlData.publicUrl });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ─── DELETE FOTO (Supabase Storage) ─────────────────────
app.delete('/upload', authMiddleware, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url requerida' });
    // Extraer el path del archivo desde la URL pública
    // URL format: https://xxx.supabase.co/storage/v1/object/public/fotos/negocio_id/archivo.jpg
    const match = url.match(/\/fotos\/(.+)$/);
    if (!match) return res.status(400).json({ error: 'URL inválida' });
    const filePath = match[1];
    const { error } = await supabase.storage.from('fotos').remove([filePath]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ─── AUTH ─────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password, usuario } = req.body;
    if (usuario) {
      const { data: sa } = await supabase.from('superadmins').select('*').eq('usuario', usuario).single();
      if (!sa || !bcrypt.compareSync(password, sa.password))
        return res.status(401).json({ error: 'Credenciales incorrectas' });
      const token = jwt.sign({ id: sa.id, role: 'superadmin', usuario }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ token, user: { id: sa.id, nombre: 'SuperAdmin', email: 'superadmin', role: 'superadmin' } });
    }
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    const { data: u } = await supabase.from('usuarios').select('*, negocios(estado)').eq('email', email.toLowerCase().trim()).eq('activo', 1).single();
    if (!u || !bcrypt.compareSync(password, u.password))
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    if (u.negocios?.estado === 'inactivo')
      return res.status(403).json({ error: 'Tu cuenta está suspendida.' });
    const token = jwt.sign({ id: u.id, email: u.email, role: u.role, negocio_id: u.negocio_id }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { id: u.id, nombre: u.nombre, email: u.email, role: u.role, sucursalId: u.sucursal_id, negocio_id: u.negocio_id } });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ─── USUARIOS ─────────────────────────────────────────────
app.get('/users', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const nid = req.query.negocio_id || req.user.negocio_id;
    const { data } = await supabase.from('usuarios').select('id,nombre,email,role,sucursal_id,activo,creado_en').eq('negocio_id', nid);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/users', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, email, password, role, sucursalId, negocio_id } = req.body;
    if (!nombre||!email||!password) return res.status(400).json({ error: 'nombre, email y password requeridos' });
    const { data: exists } = await supabase.from('usuarios').select('id').eq('email', email.toLowerCase()).single();
    if (exists) return res.status(409).json({ error: 'Email ya existe' });
    const hash = bcrypt.hashSync(password, 10);
    const nid  = negocio_id || req.user.negocio_id;
    const { data } = await supabase.from('usuarios').insert({ negocio_id: nid, nombre, email: email.toLowerCase(), password: hash, role: role||'staff', sucursal_id: sucursalId||'' }).select('id').single();
    res.status(201).json({ id: data.id, nombre, email, role: role||'staff' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/users/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    await supabase.from('usuarios').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── EMPLEADOS ────────────────────────────────────────────
app.get('/empleados/:negocio_id', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('empleados').select('*').eq('negocio_id', req.params.negocio_id).eq('activo', 1).order('nombre');
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/empleados', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, iniciales, rol, sucursal, color, tel, email, horario, negocio_id, foto_url } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const nid = negocio_id || req.user.negocio_id;
    const ini = iniciales || nombre.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
    const key = ini + Date.now().toString().slice(-4);
    const { data } = await supabase.from('empleados').insert({ negocio_id: nid, key, nombre, iniciales: ini, rol: rol||'Barbero', sucursal: sucursal||'', color: color||'#6366F1', tel: tel||'', email: email||'', horario: horario||{}, foto_url: foto_url||'' }).select('id').single();
    res.status(201).json({ id: data.id, key, nombre, iniciales: ini, rol: rol||'Barbero', sucursal: sucursal||'', color: color||'#6366F1' });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.put('/empleados/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, rol, sucursal, color, tel, email, iniciales, foto_url } = req.body;
    await supabase.from('empleados').update({ nombre, rol, sucursal, color, tel, email, iniciales, foto_url }).eq('id', req.params.id).eq('negocio_id', req.user.negocio_id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/empleados/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, rol, sucursal, color, tel, email, horario, activo, foto_url } = req.body;
    const update = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (rol !== undefined) update.rol = rol;
    if (sucursal !== undefined) update.sucursal = sucursal;
    if (color !== undefined) update.color = color;
    if (tel !== undefined) update.tel = tel;
    if (email !== undefined) update.email = email;
    if (horario !== undefined) update.horario = horario;
    if (activo !== undefined) update.activo = activo;
    if (foto_url !== undefined) update.foto_url = foto_url;
    await supabase.from('empleados').update(update).eq('id', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/empleados/:id/horario', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { horario } = req.body;
    await supabase.from('empleados').update({ horario }).eq('id', req.params.id).eq('negocio_id', req.user.negocio_id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/empleados/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    await supabase.from('empleados').update({ activo: 0 }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CITAS ────────────────────────────────────────────────
app.get('/citas/:negocio_id', async (req, res) => {
  try {
    const { data } = await supabase.from('citas').select('*').eq('negocio_id', req.params.negocio_id).order('fecha', { ascending: false }).order('hora');
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/citas', async (req, res) => {
  try {
    const c = req.body;
    if (!c.fecha||!c.hora) return res.status(400).json({ error: 'fecha y hora requeridas' });
    const { data } = await supabase.from('citas').insert({
      negocio_id: c.negocio_id||null, cliente: c.cliente||'', cliente_tel: c.cliente_tel||c.clienteTel||'',
      cliente_email: c.cliente_email||'', servicio: c.servicio||'', barbero: c.barbero||'',
      barbero_key: c.barbero_key||c.barberoKey||'', fecha: c.fecha, hora: c.hora,
      sucursal: c.sucursal||'', estado: c.estado||'pendiente', precio: c.precio||'0',
      duracion: c.duracion||'30 min', notas: c.notas||''
    }).select('id').single();
    res.status(201).json({ id: data.id, ...c });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/citas/:id', authMiddleware, async (req, res) => {
  try {
    const { estado, notas, sucursal } = req.body;
    const update = { estado };
    if (notas !== undefined) update.notas = notas;
    if (sucursal !== undefined) update.sucursal = sucursal;
    await supabase.from('citas').update(update).eq('id', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── NEGOCIOS ─────────────────────────────────────────────
app.get('/negocios', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const { data: negocios } = await supabase.from('negocios').select('*').order('creado_en', { ascending: false });
    const result = await Promise.all((negocios||[]).map(async n => {
      const { count } = await supabase.from('citas').select('*', { count: 'exact', head: true }).eq('negocio_id', n.id);
      return { ...n, citas_total: count || 0 };
    }));
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/negocios', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const { nombre, tipo, color, ini, tel, whatsapp, ciudad, direccion, descripcion, plan, sucursales, empleados, rnc, adminNombre, adminEmail, adminPass } = req.body;
    if (!nombre||!adminEmail||!adminPass) return res.status(400).json({ error: 'nombre, adminEmail y adminPass requeridos' });
    const { data: neg } = await supabase.from('negocios').insert({ nombre, tipo: tipo||'otro', color: color||'#6366F1', ini: ini||nombre.substring(0,2).toUpperCase(), tel: tel||'', whatsapp: whatsapp||'', ciudad: ciudad||'', direccion: direccion||'', descripcion: descripcion||'', plan: plan||'starter', sucursales: sucursales||1, empleados: empleados||'1-3', rnc: rnc||'' }).select('id').single();
    const hash = bcrypt.hashSync(adminPass, 10);
    await supabase.from('usuarios').insert({ negocio_id: neg.id, nombre: adminNombre||nombre, email: adminEmail.toLowerCase(), password: hash, role: 'admin', sucursal_id: '' });
    res.status(201).json({ id: neg.id, nombre, plan, adminPass });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/negocios/:id/reset-pass', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const { newPass } = req.body;
    if (!newPass || newPass.length < 4) return res.status(400).json({ error: 'Contraseña muy corta' });
    const hash = bcrypt.hashSync(newPass, 10);
    await supabase.from('usuarios').update({ password: hash }).eq('negocio_id', req.params.id).eq('role', 'admin');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/negocios/:id', authMiddleware, async (req, res) => {
  try {
    const nid = parseInt(req.params.id);
    if (req.user.role !== 'superadmin' && req.user.negocio_id !== nid) return res.status(403).json({ error: 'Sin permiso' });
    const { data } = await supabase.from('negocios').select('*').eq('id', nid).single();
    if (!data) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/negocios/:id', authMiddleware, async (req, res) => {
  try {
    const nid = parseInt(req.params.id);
    if (req.user.role !== 'superadmin' && req.user.negocio_id !== nid) return res.status(403).json({ error: 'Sin permiso' });
    const { nombre, direccion, tel, wasa, whatsapp } = req.body;
    await supabase.from('negocios').update({ nombre, direccion, tel, whatsapp: wasa||whatsapp }).eq('id', nid);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/negocios/:id', authMiddleware, async (req, res) => {
  try {
    const nid = parseInt(req.params.id);
    const isSA = req.user.role === 'superadmin';
    if (!isSA && req.user.negocio_id !== nid) return res.status(403).json({ error: 'Sin permiso' });
    const f = req.body;
    const update = { tel: f.tel||null, whatsapp: f.whatsapp||null, direccion: f.direccion||null, tema: f.tema||null, wa_config: f.wa_config||null, gcal_config: f.gcal_config||null, roles: f.roles||null, horario: f.horario||null };
    if (isSA) { update.nombre = f.nombre; update.tipo = f.tipo; update.color = f.color; update.ini = f.ini; update.ciudad = f.ciudad; update.descripcion = f.descripcion; update.plan = f.plan; update.sucursales = f.sucursales; update.empleados = f.empleados; update.rnc = f.rnc; update.estado = f.estado; }
    Object.keys(update).forEach(k => update[k] === null || update[k] === undefined ? delete update[k] : null);
    await supabase.from('negocios').update(update).eq('id', nid);
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.patch('/negocios/:id/estado', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    const { estado } = req.body;
    if (!['activo','inactivo'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    await supabase.from('negocios').update({ estado }).eq('id', req.params.id);
    res.json({ ok: true, estado });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/negocios/:id/horario', authMiddleware, async (req, res) => {
  try {
    const nid = parseInt(req.params.id);
    if (req.user.role !== 'superadmin' && req.user.negocio_id !== nid) return res.status(403).json({ error: 'Sin permiso' });
    const { horario } = req.body;
    if (!horario) return res.status(400).json({ error: 'horario requerido' });
    await supabase.from('negocios').update({ horario }).eq('id', nid);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/negocios/:id', authMiddleware, soloSuperAdmin, async (req, res) => {
  try {
    await supabase.from('negocios').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── MI NEGOCIO ───────────────────────────────────────────
app.get('/mi-negocio', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('negocios').select('*').eq('id', req.user.negocio_id).single();
    if (!data) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/mi-negocio', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, direccion, tel, wasa } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    await supabase.from('negocios').update({ nombre, direccion: direccion||'', tel: tel||'', whatsapp: wasa||'' }).eq('id', req.user.negocio_id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/mi-negocio/horario', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { horario } = req.body;
    if (!horario) return res.status(400).json({ error: 'Falta horario' });
    await supabase.from('negocios').update({ horario }).eq('id', req.user.negocio_id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/mi-negocio', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const allowed = ['tema','wa_config','gcal_config','nombre','direccion','tel','whatsapp','rnc','horario','roles'];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Sin campos' });
    await supabase.from('negocios').update(update).eq('id', req.user.negocio_id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CLIENTES ─────────────────────────────────────────────
app.get('/clientes/:negocio_id', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('clientes').select('*').eq('negocio_id', req.params.negocio_id).order('nombre');
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/clientes', authMiddleware, async (req, res) => {
  try {
    const { nombre, tel, email, cedula, notas, sucursal, negocio_id } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const nid = negocio_id || req.user.negocio_id;
    const { data } = await supabase.from('clientes').insert({ negocio_id: nid, nombre, tel: tel||'', email: email||'', cedula: cedula||'', notas: notas||'', sucursal: sucursal||'' }).select('id').single();
    res.status(201).json({ id: data.id, nombre });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/clientes/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    await supabase.from('clientes').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── SERVICIOS ────────────────────────────────────────────
app.get('/servicios/:negocio_id', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('servicios').select('*').eq('negocio_id', req.params.negocio_id).eq('activo', 1).order('nombre');
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/servicios', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, duracion, precio, desc, negocio_id } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const nid = negocio_id || req.user.negocio_id;
    const { data } = await supabase.from('servicios').insert({ negocio_id: nid, nombre, duracion: duracion||'30', precio: precio||'0', descripcion: desc||'' }).select('id').single();
    res.status(201).json({ id: data.id, nombre });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/servicios/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, duracion, precio, desc } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    await supabase.from('servicios').update({ nombre, duracion, precio, descripcion: desc }).eq('id', req.params.id).eq('negocio_id', req.user.negocio_id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/servicios/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    await supabase.from('servicios').update({ activo: 0 }).eq('id', req.params.id).eq('negocio_id', req.user.negocio_id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── SUCURSALES ───────────────────────────────────────────
app.get('/sucursales/:negocio_id', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('sucursales').select('*').eq('negocio_id', req.params.negocio_id).order('creado_en');
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/sucursales', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, key, direccion, tel, negocio_id, foto_url } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const nid = negocio_id || req.user.negocio_id;
    const { data } = await supabase.from('sucursales').insert({ negocio_id: nid, nombre, key: key||nombre, direccion: direccion||'', tel: tel||'', foto_url: foto_url||'' }).select('id').single();
    res.status(201).json({ id: data.id, nombre, key: key||nombre });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/sucursales/:id', authMiddleware, soloAdmin, async (req, res) => {
  try {
    const { nombre, direccion, tel, foto_url } = req.body;
    const update = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (direccion !== undefined) update.direccion = direccion;
    if (tel !== undefined) update.tel = tel;
    if (foto_url !== undefined) update.foto_url = foto_url;
    await supabase.from('sucursales').update(update).eq('id', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── FACTURAS ─────────────────────────────────────────────
app.get('/facturas/:negocio_id', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('facturas').select('*').eq('negocio_id', req.params.negocio_id).order('creado_en', { ascending: false });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/facturas', authMiddleware, async (req, res) => {
  try {
    const { negocio_id, numero, negocio, sucursal, cliente, cliente_tel, servicio, barbero, fecha, hora, precio, emitida, cita_id } = req.body;
    const { data } = await supabase.from('facturas').insert({ negocio_id, numero, negocio, sucursal, cliente, cliente_tel: cliente_tel||'', servicio, barbero, fecha, hora, precio, emitida, cita_id: cita_id||null }).select('id').single();
    res.status(201).json({ id: data.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/facturas/:id/numero', authMiddleware, async (req, res) => {
  try {
    const { numero } = req.body;
    await supabase.from('facturas').update({ numero }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ENDPOINTS PÚBLICOS ───────────────────────────────────
app.get('/public/negocio/:id', async (req, res) => {
  try {
    const { data } = await supabase.from('negocios').select('id,nombre,tipo,color,ini,tel,whatsapp,ciudad,direccion,horario').eq('id', req.params.id).single();
    if (!data) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/public/sucursales/:negocio_id', async (req, res) => {
  try {
    const { data } = await supabase.from('sucursales').select('id,nombre,key,direccion,tel,foto_url').eq('negocio_id', req.params.negocio_id).eq('activo', 1).order('creado_en');
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/public/servicios/:negocio_id', async (req, res) => {
  try {
    const { data } = await supabase.from('servicios').select('id,nombre,duracion,precio,descripcion').eq('negocio_id', req.params.negocio_id).eq('activo', 1).order('nombre');
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/public/empleados/:negocio_id', async (req, res) => {
  try {
    const { data } = await supabase.from('empleados').select('id,nombre,key,iniciales,rol,sucursal,color,horario,foto_url').eq('negocio_id', req.params.negocio_id).eq('activo', 1).order('nombre');
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/public/citas/:negocio_id', async (req, res) => {
  try {
    const { fecha } = req.query;
    let query = supabase.from('citas').select('id,barbero,barbero_key,fecha,hora,sucursal,duracion').eq('negocio_id', req.params.negocio_id).not('estado', 'in', '("cancelada","Cancelada")');
    if (fecha) query = query.eq('fecha', fecha);
    const { data } = await query;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── START ────────────────────────────────────────────────
async function start() {
  try {
    await initSuperAdmin();
    app.listen(PORT, () => {
      console.log(`[SlotBook] ✓ Servidor en puerto ${PORT}`);
      console.log(`[SlotBook] Supabase: ${SUPABASE_URL}`);
    });
  } catch(err) {
    console.error('[SlotBook] Error iniciando:', err);
    process.exit(1);
  }
}

start();
