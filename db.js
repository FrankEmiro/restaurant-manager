const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'restaurant.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    x REAL DEFAULT 0,
    y REAL DEFAULT 0,
    shape TEXT DEFAULT 'round',
    status TEXT DEFAULT 'free',
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    price REAL NOT NULL,
    description TEXT,
    available INTEGER DEFAULT 1,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    guests INTEGER NOT NULL,
    table_id INTEGER REFERENCES tables(id),
    notes TEXT,
    status TEXT DEFAULT 'confirmed',
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS takeaway_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    pickup_date TEXT NOT NULL,
    pickup_time TEXT NOT NULL,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    total REAL,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES takeaway_orders(id),
    menu_item_id INTEGER REFERENCES menu_items(id),
    item_name TEXT,
    item_price REAL,
    quantity INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS allergens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT
  );
`);

// Seed data if empty
const tableCount = db.prepare('SELECT COUNT(*) as c FROM tables').get().c;
if (tableCount === 0) {
  const insertTable = db.prepare(`
    INSERT INTO tables (number, capacity, x, y, shape, status) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const tables = [
    ['T1', 2, 10, 15, 'round', 'free'],
    ['T2', 4, 30, 15, 'round', 'free'],
    ['T3', 4, 50, 15, 'square', 'free'],
    ['T4', 6, 70, 15, 'square', 'free'],
    ['T5', 2, 10, 45, 'round', 'free'],
    ['T6', 4, 30, 45, 'round', 'free'],
    ['T7', 8, 55, 50, 'square', 'free'],
    ['T8', 4, 75, 50, 'round', 'free'],
    ['Terrazza 1', 4, 15, 75, 'round', 'free'],
    ['Terrazza 2', 6, 45, 75, 'square', 'free'],
  ];
  for (const t of tables) insertTable.run(...t);
}

const menuCount = db.prepare('SELECT COUNT(*) as c FROM menu_items').get().c;
if (menuCount === 0) {
  const insertMenu = db.prepare(`
    INSERT INTO menu_items (name, category, price, description, available, created_at) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  const items = [
    ['Bruschette al pomodoro', 'Antipasti', 6.5, 'Pane tostato con pomodoro fresco e basilico', 1, now],
    ['Tagliere misto', 'Antipasti', 14.0, 'Salumi e formaggi locali con miele e marmellata', 1, now],
    ['Carpaccio di manzo', 'Antipasti', 12.0, 'Con rucola, scaglie di parmigiano e olio EVO', 1, now],
    ['Spaghetti alla carbonara', 'Primi', 13.0, 'Ricetta tradizionale romana', 1, now],
    ['Pappardelle al ragù', 'Primi', 14.0, 'Ragù di carne macinata con pomodoro San Marzano', 1, now],
    ['Risotto ai funghi porcini', 'Primi', 15.0, 'Con porcini freschi di stagione', 1, now],
    ['Gnocchi al pesto', 'Primi', 12.0, 'Gnocchi fatti in casa con pesto genovese', 1, now],
    ['Tagliata di manzo', 'Secondi', 22.0, 'Con rucola e scaglie di parmigiano', 1, now],
    ['Filetto di branzino', 'Secondi', 20.0, 'Con verdure grigliate e salsa al limone', 1, now],
    ['Pollo alla cacciatora', 'Secondi', 16.0, 'Con olive, capperi e pomodori', 1, now],
    ['Tiramisù', 'Dolci', 7.0, 'Ricetta tradizionale con mascarpone e savoiardi', 1, now],
    ['Panna cotta', 'Dolci', 6.0, 'Con coulis di fragole', 1, now],
    ['Cannolo siciliano', 'Dolci', 6.5, 'Con ricotta di pecora e pistacchi', 1, now],
    ['Acqua naturale 0.5L', 'Bevande', 2.0, '', 1, now],
    ['Acqua frizzante 0.5L', 'Bevande', 2.0, '', 1, now],
    ['Vino rosso della casa (0.25L)', 'Bevande', 5.0, 'Selezione del giorno', 1, now],
    ['Vino bianco della casa (0.25L)', 'Bevande', 5.0, 'Selezione del giorno', 1, now],
    ['Birra artigianale', 'Bevande', 5.5, '33cl, selezione locale', 1, now],
    ['Coca Cola', 'Bevande', 3.5, '33cl', 1, now],
    ['Caffè espresso', 'Bevande', 1.5, '', 1, now],
  ];
  for (const item of items) insertMenu.run(...item);
}

const allergenCount = db.prepare('SELECT COUNT(*) as c FROM allergens').get().c;
if (allergenCount === 0) {
  const insertAllergen = db.prepare(`INSERT INTO allergens (name, description, created_at) VALUES (?, ?, ?)`);
  const now = new Date().toISOString();
  const allergens = [
    ['Glutine',         'Cereali contenenti glutine: grano, segale, orzo, avena e varietà ibridate'],
    ['Crostacei',       'Granchi, gamberi, aragoste, scampi e prodotti derivati'],
    ['Uova',            'Uova e prodotti a base di uova'],
    ['Pesce',           'Pesce e prodotti a base di pesce'],
    ['Arachidi',        'Arachidi e prodotti a base di arachidi'],
    ['Soia',            'Soia e prodotti a base di soia'],
    ['Latte',           'Latte e latticini (incluso lattosio)'],
    ['Frutta a guscio', 'Mandorle, nocciole, noci, anacardi, noci pecan, pistacchi, noci macadamia'],
    ['Sedano',          'Sedano e prodotti a base di sedano'],
    ['Senape',          'Senape e prodotti a base di senape'],
    ['Semi di sesamo',  'Semi di sesamo e prodotti a base di semi di sesamo'],
    ['Solfiti',         'Anidride solforosa e solfiti in concentrazioni superiori a 10mg/kg'],
    ['Lupino',          'Lupino e prodotti a base di lupino'],
    ['Molluschi',       'Cozze, vongole, ostriche, capesante, polpo, calamari e prodotti derivati'],
  ];
  for (const [name, description] of allergens) insertAllergen.run(name, description, now);
}

// Helper for manual transactions (node:sqlite has no .transaction() helper)
db.withTransaction = function(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

module.exports = db;
