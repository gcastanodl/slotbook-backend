const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const crearTablas = async () => {
  await pool.query(`

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

    CREATE TABLE IF NOT EXISTS horarios_empleados (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER REFERENCES empleados(id),
      dia TEXT NOT NULL,
      activo BOOLEAN DEFAULT true,
      hora_inicio TEXT DEFAULT '08:00',
      hora_fin TEXT DEFAULT '20:00'
    );

  `);
  console.log('Tablas faltantes creadas ✅');
  pool.end();
};

crearTablas().catch(console.error);