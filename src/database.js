/**
 * Adam OS — SQLite database using sql.js (pure JavaScript, no compilation needed)
 */
import initSqlJs from 'sql.js'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs'

const DATA_DIR = join(homedir(), '.adam-os')
mkdirSync(DATA_DIR, { recursive: true })
const DB_PATH = join(DATA_DIR, 'adam.db')

const SQL = await initSqlJs()

// Load existing DB or create new
let db
if (existsSync(DB_PATH)) {
  const fileBuffer = readFileSync(DB_PATH)
  db = new SQL.Database(fileBuffer)
} else {
  db = new SQL.Database()
}

function save() {
  const data = db.export()
  writeFileSync(DB_PATH, Buffer.from(data))
}

function run(sql, params = []) {
  db.run(sql, params)
  save()
}

function all(sql, params = []) {
  try {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject())
    }
    stmt.free()
    return rows
  } catch(e) {
    return []
  }
}

function get(sql, params = []) {
  const rows = all(sql, params)
  return rows[0] || null
}

// Initialize schema
db.run(`
  CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'restaurant',
    address TEXT
  );

  CREATE TABLE IF NOT EXISTS labor_entries (
    id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    employee_id TEXT,
    position TEXT,
    work_date TEXT,
    regular_hours REAL DEFAULT 0,
    overtime_hours REAL DEFAULT 0,
    hourly_rate REAL DEFAULT 0,
    total_pay REAL DEFAULT 0,
    import_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales_entries (
    id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    sale_date TEXT,
    net_sales REAL DEFAULT 0,
    gross_sales REAL DEFAULT 0,
    covers INTEGER DEFAULT 0,
    average_check REAL DEFAULT 0,
    tips REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    cash_amount REAL DEFAULT 0,
    credit_card_amount REAL DEFAULT 0,
    import_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS server_sales (
    id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    sale_date TEXT,
    net_sales REAL DEFAULT 0,
    covers INTEGER DEFAULT 0,
    average_check REAL DEFAULT 0,
    cc_tips REAL DEFAULT 0,
    cash_tips REAL DEFAULT 0,
    import_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY,
    business_name TEXT,
    format TEXT NOT NULL,
    filename TEXT NOT NULL,
    row_count INTEGER DEFAULT 0,
    date_range_start TEXT,
    date_range_end TEXT,
    imported_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    priority TEXT DEFAULT 'medium',
    due_date TEXT,
    category TEXT DEFAULT 'General',
    business TEXT DEFAULT 'Both',
    done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    business TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

// Seed data
db.run(`INSERT OR IGNORE INTO businesses (id, name, type, address) VALUES 
  ('rc', 'The Reading Club', 'cocktail_bar', '4033 30th St, San Diego, CA 92104'),
  ('sen', 'Seneca Trattoria', 'italian_restaurant', '3929 30th St, San Diego, CA 92104')`)

db.run(`INSERT OR IGNORE INTO tasks (id, title, priority, due_date, category, business) VALUES
  ('t1', 'Approve Saturday schedule — Reading Club', 'high', 'Today', 'Operations', 'Reading Club'),
  ('t2', 'Respond to Pacific Linen invoice ($2,400 overdue)', 'high', 'Today', 'Finance', 'Both'),
  ('t3', 'Update server training manual v3.3', 'medium', '2026-06-28', 'Training', 'Both'),
  ('t4', 'Review Period 6 P&L draft', 'medium', '2026-06-30', 'Finance', 'Both'),
  ('t5', 'Post job listing — line cook Seneca', 'medium', '2026-07-01', 'Hiring', 'Seneca Trattoria')`)

save()

export default { run, all, get, save }
