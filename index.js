const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── PRUEBA ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ mensaje: 'SlotBook API funcionando ✅' });
});

// ── NEGOCIOS ─────────────────────────────────────────
app.get('/negocios', async (req, res) => {
  const result = await pool.query('SELECT * FROM negocios ORDER BY id');
  res.json(result.rows);
});

app.post('/negocios', async (req, res) => {
  const { nombre, slug, whatsapp, color, iniciales } = req.body;
  const result = await pool.query(
    'INSERT INTO negocios (nombre, slug, whatsapp, color, iniciales) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [nombre, slug, whatsapp, color, iniciales]
  );
  res.json(result.rows[0]);
});

// ── CITAS ─────────────────────────────────────────────
app.get('/citas/:negocio_id', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM citas WHERE negocio_id = $1 ORDER BY fecha, hora',
    [req.params.negocio_id]
  );
  res.json(result.rows);
});

app.post('/citas', async (req, res) => {
  const { negocio_id, sucursal_id, cliente, servicio, empleado, fecha, hora, duracion, estado, precio, notas } = req.body;
  const result = await pool.query(
    'INSERT INTO citas (negocio_id, sucursal_id, cliente, servicio, empleado, fecha, hora, duracion, estado, precio, notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
    [negocio_id, sucursal_id, cliente, servicio, empleado, fecha, hora, duracion, estado || 'Pendiente', precio, notas]
  );
  res.json(result.rows[0]);
});

app.put('/citas/:id', async (req, res) => {
  const { estado } = req.body;
  const result = await pool.query(
    'UPDATE citas SET estado = $1 WHERE id = $2 RETURNING *',
    [estado, req.params.id]
  );
  res.json(result.rows[0]);
});

app.delete('/citas/:id', async (req, res) => {
  await pool.query('DELETE FROM citas WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ── EMPLEADOS ─────────────────────────────────────────
app.get('/empleados/:negocio_id', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM empleados WHERE negocio_id = $1 ORDER BY nombre',
    [req.params.negocio_id]
  );
  res.json(result.rows);
});

app.post('/empleados', async (req, res) => {
  const { negocio_id, sucursal_id, nombre, iniciales, rol, telefono, color } = req.body;
  const result = await pool.query(
    'INSERT INTO empleados (negocio_id, sucursal_id, nombre, iniciales, rol, telefono, color) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [negocio_id, sucursal_id, nombre, iniciales, rol, telefono, color]
  );
  res.json(result.rows[0]);
});

// ── SERVICIOS ─────────────────────────────────────────
app.get('/servicios/:negocio_id', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM servicios WHERE negocio_id = $1 ORDER BY nombre',
    [req.params.negocio_id]
  );
  res.json(result.rows);
});

app.post('/servicios', async (req, res) => {
  const { negocio_id, nombre, duracion, precio } = req.body;
  const result = await pool.query(
    'INSERT INTO servicios (negocio_id, nombre, duracion, precio) VALUES ($1,$2,$3,$4) RETURNING *',
    [negocio_id, nombre, duracion, precio]
  );
  res.json(result.rows[0]);
});

// ── CLIENTES ──────────────────────────────────────────
app.get('/clientes/:negocio_id', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM clientes WHERE negocio_id = $1 ORDER BY nombre',
    [req.params.negocio_id]
  );
  res.json(result.rows);
});

app.post('/clientes', async (req, res) => {
  const { negocio_id, nombre, telefono, email, notas } = req.body;
  const result = await pool.query(
    'INSERT INTO clientes (negocio_id, nombre, telefono, email, notas) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [negocio_id, nombre, telefono, email, notas]
  );
  res.json(result.rows[0]);
});

// ── SUCURSALES ────────────────────────────────────────
app.get('/sucursales/:negocio_id', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM sucursales WHERE negocio_id = $1',
    [req.params.negocio_id]
  );
  res.json(result.rows);
});

app.post('/sucursales', async (req, res) => {
  const { negocio_id, nombre, slug, color } = req.body;
  const result = await pool.query(
    'INSERT INTO sucursales (negocio_id, nombre, slug, color) VALUES ($1,$2,$3,$4) RETURNING *',
    [negocio_id, nombre, slug, color]
  );
  res.json(result.rows[0]);
});

// ── USUARIOS (login) ──────────────────────────────────
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query(
    'SELECT * FROM usuarios WHERE email = $1 AND password = $2',
    [email, password]
  );
  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  res.json(result.rows[0]);
});

app.post('/usuarios', async (req, res) => {
  const { negocio_id, nombre, email, password, rol } = req.body;
  const result = await pool.query(
    'INSERT INTO usuarios (negocio_id, nombre, email, password, rol) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [negocio_id, nombre, email, password, rol || 'admin']
  );
  res.json(result.rows[0]);
});

// ── SERVIDOR ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});