const fs = require('fs');
let c = fs.readFileSync('index.js', 'utf8');

const nuevasRutas = `
// GET /negocios/:id
app.get('/negocios/:id', authMiddleware, async (req, res) => {
  try {
    const r = await query('SELECT * FROM negocios WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /negocios/:id
app.put('/negocios/:id', authMiddleware, async (req, res) => {
  try {
    const { nombre, direccion, tel, wasa } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const r = await query(
      'UPDATE negocios SET nombre=COALESCE($1,nombre),direccion=COALESCE($2,direccion),tel=COALESCE($3,tel),wasa=COALESCE($4,wasa) WHERE id=$5 RETURNING id',
      [nombre, direccion, tel, wasa, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /negocios/:id/horario
app.put('/negocios/:id/horario', authMiddleware, async (req, res) => {
  try {
    const { horario } = req.body;
    if (!horario) return res.status(400).json({ error: 'Falta horario' });
    const r = await query(
      'UPDATE negocios SET horario=$1::jsonb WHERE id=$2 RETURNING id',
      [JSON.stringify(horario), req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /negocios/:id (campos individuales: tema, wa_config, gcal_config, etc)
app.patch('/negocios/:id', authMiddleware, async (req, res) => {
  try {
    const allowed = ['tema','wa_config','gcal_config','estado','plan','nombre','direccion','tel','wasa','ciudad','rnc'];
    const jsonFields = ['wa_config','gcal_config','horario'];
    const fields = [], values = [];
    let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(key + ' = $' + i + (jsonFields.includes(key) ? '::jsonb' : ''));
        values.push(jsonFields.includes(key) ? JSON.stringify(req.body[key]) : req.body[key]);
        i++;
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Sin campos' });
    values.push(req.params.id);
    const r = await query('UPDATE negocios SET ' + fields.join(', ') + ' WHERE id=$' + i + ' RETURNING id', values);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

`;

// Insertar antes del primer app.patch('/negocios/:id'
const target = "app.patch('/negocios/:id', authMiddleware, soloSuperAdmin";
if (c.includes(target)) {
  c = c.replace(target, nuevasRutas + target);
  fs.writeFileSync('index.js', c);
  console.log('LISTO - rutas agregadas correctamente');
} else {
  console.log('ERROR - no se encontro el punto de insercion');
}
