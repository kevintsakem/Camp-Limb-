// =============================================
// SERVEUR CAMP LIMBÉ 2026
// Node.js + Express + PostgreSQL (Supabase)
// =============================================
//
// VARIABLES D'ENVIRONNEMENT REQUISES :
//   DATABASE_URL — Connection string Supabase
//   Format : postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
//
// DÉMARRAGE LOCAL :
//   1. Crée un fichier .env  (voir .env.example)
//   2. npm install
//   3. npm start
//
// =============================================

require('dotenv').config();

const express  = require('express');
const { Pool } = require('pg');
const XLSX     = require('xlsx');
const path     = require('path');
const cors     = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// =============================================
// CONNEXION SUPABASE (PostgreSQL)
// =============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inscriptions (
      id               SERIAL PRIMARY KEY,
      timestamp        TEXT,
      full_name        TEXT NOT NULL,
      gender           TEXT,
      phone            TEXT,
      church           TEXT,
      email            TEXT DEFAULT 'N/A',
      ticket_id        TEXT UNIQUE NOT NULL,
      payment_status   TEXT DEFAULT 'En attente',
      validation_time  TEXT DEFAULT ''
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  await pool.query(`
    INSERT INTO settings (key, value) VALUES ('max_places', '200')
    ON CONFLICT (key) DO NOTHING
  `);
  console.log('✅ Base de données Supabase prête');
}

// =============================================
// MIDDLEWARES
// =============================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// =============================================
// ROUTES API
// =============================================
app.get(['/api', '/'], async (req, res, next) => {
  const action = (req.query.action || '').toLowerCase();

  // Sans action → servir index.html
  if (!action && req.path === '/') return next();

  try {
    if (action === 'register')    return await handleRegister(req.query, res);
    if (action === 'validate')    return await handleValidate(req.query.ticket_id, res);
    if (action === 'list')        return await handleList(res);
    if (action === 'delete')      return await handleDelete(req.query.ticket_id, res);
    if (action === 'deletemany')  return await handleDeleteMany(req.query.ticket_ids, res);
    if (action === 'export')      return await handleExport(res);
    if (action === 'getcapacity') return await handleGetCapacity(res);
    if (action === 'setcapacity') return await handleSetCapacity(req.query.value, res);
    return res.json({ status: 'ok', message: 'Camp Limbé 2026 API v1' });
  } catch (err) {
    console.error('API error:', err);
    return res.json({ status: 'error', message: err.toString() });
  }
});

// =============================================
// CAPACITY
// =============================================
async function getMaxPlaces() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='max_places'");
  return rows.length ? parseInt(rows[0].value) : 200;
}

async function handleGetCapacity(res) {
  const max = await getMaxPlaces();
  const { rows } = await pool.query('SELECT COUNT(*) FROM inscriptions');
  return res.json({ status: 'success', max_places: max, current: parseInt(rows[0].count) });
}

async function handleSetCapacity(value, res) {
  const n = parseInt(value);
  if (!value || isNaN(n) || n < 1)
    return res.json({ status: 'error', message: 'Valeur invalide.' });
  await pool.query("UPDATE settings SET value=$1 WHERE key='max_places'", [String(n)]);
  return res.json({ status: 'success', message: `Capacité mise à jour : ${n} places.`, max_places: n });
}

// =============================================
// REGISTER
// =============================================
async function handleRegister(params, res) {
  const timestamp = params.timestamp ||
    new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala' });

  const maxPlaces = await getMaxPlaces();
  const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM inscriptions');
  if (parseInt(countRows[0].count) >= maxPlaces)
    return res.json({ status: 'full', message: 'Désolé, toutes les places sont prises !' });

  try {
    await pool.query(
      `INSERT INTO inscriptions
         (timestamp, full_name, gender, phone, church, email, ticket_id, payment_status, validation_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'En attente','')`,
      [timestamp, params.full_name||'', params.gender||'', params.phone||'',
       params.church||'', params.email||'N/A', params.ticket_id||'']
    );
    return res.json({ status: 'success', message: 'Inscription enregistrée', ticket_id: params.ticket_id, full_name: params.full_name });
  } catch (err) {
    if (err.code === '23505')
      return res.json({ status: 'error', message: 'Ce ticket ID existe déjà.' });
    throw err;
  }
}

// =============================================
// VALIDATE PAYMENT
// =============================================
async function handleValidate(ticketId, res) {
  if (!ticketId) return res.json({ status: 'error', message: 'ticket_id manquant' });
  const { rows } = await pool.query('SELECT * FROM inscriptions WHERE ticket_id=$1', [ticketId]);
  if (!rows.length) return res.json({ status: 'not_found', message: 'Inscription introuvable.' });
  const row = rows[0];
  if (row.payment_status === 'Validé')
    return res.json({ status: 'already_validated', message: 'Paiement déjà validé.', data: { full_name: row.full_name, ticket_id: row.ticket_id } });

  const validationTime = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala' });
  await pool.query('UPDATE inscriptions SET payment_status=$1, validation_time=$2 WHERE ticket_id=$3',
    ['Validé', validationTime, ticketId]);
  return res.json({ status: 'success', message: 'Paiement validé !', data: { full_name: row.full_name, ticket_id: row.ticket_id } });
}

// =============================================
// LIST
// =============================================
async function handleList(res) {
  const { rows } = await pool.query('SELECT * FROM inscriptions ORDER BY id ASC');
  return res.json({ status: 'success', data: rows.map(r => ({
    timestamp:       r.timestamp,
    full_name:       r.full_name,
    gender:          r.gender,
    phone:           r.phone,
    church:          r.church,
    email:           r.email,
    ticket_id:       r.ticket_id,
    payment_status:  r.payment_status || 'En attente',
    validation_time: r.validation_time || null
  }))});
}

// =============================================
// DELETE
// =============================================
async function handleDelete(ticketId, res) {
  if (!ticketId) return res.json({ status: 'error', message: 'ticket_id manquant' });
  const result = await pool.query('DELETE FROM inscriptions WHERE ticket_id=$1', [ticketId]);
  if (result.rowCount === 0) return res.json({ status: 'error', message: 'Ticket introuvable.' });
  return res.json({ status: 'success', message: 'Inscription supprimée.' });
}

async function handleDeleteMany(ticketIds, res) {
  if (!ticketIds) return res.json({ status: 'error', message: 'ticket_ids manquant' });
  const ids = ticketIds.split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return res.json({ status: 'error', message: 'Aucun ticket fourni.' });
  const result = await pool.query('DELETE FROM inscriptions WHERE ticket_id = ANY($1::text[])', [ids]);
  return res.json({ status: 'success', message: `${result.rowCount} inscription(s) supprimée(s).`, deleted: result.rowCount });
}

// =============================================
// EXPORT EXCEL
// =============================================
async function handleExport(res) {
  const { rows } = await pool.query('SELECT * FROM inscriptions ORDER BY id ASC');
  const wsData = [
    ['Timestamp','Nom Complet','Sexe','Téléphone','Église/Groupe','Email','Ticket ID','Statut Paiement','Heure Validation'],
    ...rows.map(r => [r.timestamp,r.full_name,r.gender,r.phone,r.church,r.email,r.ticket_id,r.payment_status,r.validation_time])
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{wch:20},{wch:28},{wch:10},{wch:16},{wch:22},{wch:26},{wch:20},{wch:14},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws, 'Inscriptions');
  const buffer = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="inscriptions-CampLimbe-${new Date().toISOString().split('T')[0]}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
}

// =============================================
// DÉMARRAGE
// =============================================
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('🏕️  Serveur Camp Limbé 2026 démarré');
    console.log(`   Local   → http://localhost:${PORT}`);
    console.log(`   Admin   → http://localhost:${PORT}/admin.html`);
    console.log('');
  });
}).catch(err => {
  console.error('❌ Erreur connexion Supabase:', err.message);
  console.error('   Vérifie DATABASE_URL dans ton fichier .env');
  process.exit(1);
});
