const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const crearTablas = async () => {
  await pool.query(`

    CREATE TABLE IF NOT EXISTS negocios (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      whatsapp TEXT,
      color TEXT DEFAULT '#6366F1',
      iniciales TEXT,
      creado_en TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      negocio_id INTEGER REFERENCES negocios(id),
      nombre TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT DEFAULT 'admin',
      creado_en TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sucursales (
      id SERIAL PRIMARY KEY,
      negocio_id INTEGER REFERENCES negocios(id),
      nombre TEXT NOT NULL,
      slug TEXT NOT NULL,
      color TEXT DEFAULT '#2563EB',
      activa BOOLEAN DEFAULT true,
      creado_en TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      negocio_id INTEGER REFERENCES negocios(id),
      nombre TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS empleados (
      id SERIAL PRIMARY KEY,
      negocio_id INTEGER REFERENCES negocios(id),
      sucursal_id INTEGER REFERENCES sucursales(id),
      nombre TEXT NOT NULL,
      iniciales TEXT,
      rol TEXT,
      telefono TEXT,
      email TEXT,
      color TEXT DEFAULT '#6366F1',
      activo BOOLEAN DEFAULT true,
      creado_en TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS horarios_empleados (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER REFERENCES empleados(id),
      dia TEXT NOT NULL,
      activo BOOLEAN DEFAULT true,
      hora_inicio TEXT DEFAULT '08:00',
      hora_fin TEXT DEFAULT '20:00'
    );

    CREATE TABLE IF NOT EXISTS servicios (
      id SERIAL PRIMARY KEY,
      negocio_id INTEGER REFERENCES negocios(id),
      nombre TEXT NOT NULL,
      duracion INTEGER DEFAULT 30,
      precio INTEGER DEFAULT 0,
      activo BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      negocio_id INTEGER REFERENCES negocios(id),
      nombre TEXT NOT NULL,
      telefono TEXT,
      email TEXT,
      notas TEXT,
      creado_en TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS citas (
      id SERIAL PRIMARY KEY,
      negocio_id INTEGER REFERENCES negocios(id),
      sucursal_id INTEGER REFERENCES sucursales(id),
      cliente TEXT NOT NULL,
      servicio TEXT,
      empleado TEXT,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      duracion TEXT,
      estado TEXT DEFAULT 'Pendiente',
      precio INTEGER DEFAULT 0,
      notas TEXT,
      creado_en TIMESTAMP DEFAULT NOW()
    );

  `);
  console.log('¡Todas las tablas creadas! ✅');
  pool.end();
};

crearTablas().catch(console.error);
```

Guarda con `Ctrl + S` y corre:
```
node db.js