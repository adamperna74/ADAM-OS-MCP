/**
 * Adam OS MCP Tools
 * All tools that Claude can use to access your business data.
 */
import db from './database.js'
import { parseToastCSV } from './toast_parser.js'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'

const IMPORT_FOLDER = join(homedir(), 'Desktop', 'Toast Imports')

export const tools = [
  // ── LABOR ────────────────────────────────────────────────────────────────
  {
    name: 'get_labor_summary',
    description: 'Get labor hours, cost, and labor percentage for one or both restaurants. Use this for labor analysis, overtime checks, and scheduling questions.',
    inputSchema: {
      type: 'object',
      properties: {
        business: { type: 'string', description: 'Restaurant name or "both"', default: 'both' },
        days: { type: 'number', description: 'Number of days to look back', default: 14 },
      }
    },
    handler: ({ business = 'both', days = 14 }) => {
      const where = business.toLowerCase() === 'both' ? '' : `AND business_name LIKE '%${business}%'`
      const rows = db.prepare(`
        SELECT business_name, position,
               SUM(regular_hours) as reg_hours,
               SUM(overtime_hours) as ot_hours,
               SUM(total_pay) as total_pay,
               COUNT(DISTINCT employee_name) as employee_count
        FROM labor_entries
        WHERE work_date >= date('now', '-${days} days') ${where}
        GROUP BY business_name, position
        ORDER BY business_name, total_pay DESC
      `).all()

      if (!rows.length) {
        return {
          message: 'No labor data found. Import Toast labor CSV files to see real data.',
          mock_data: {
            reading_club: { total_hours: 284, total_labor_cost: 7420, labor_pct: 36.8, target_pct: 32.0 },
            seneca: { total_hours: 218, total_labor_cost: 5480, labor_pct: 30.2, target_pct: 31.0 }
          }
        }
      }

      const summary = {}
      for (const row of rows) {
        if (!summary[row.business_name]) {
          summary[row.business_name] = { positions: [], total_hours: 0, total_pay: 0, employees: 0 }
        }
        summary[row.business_name].positions.push(row)
        summary[row.business_name].total_hours += (row.reg_hours + row.ot_hours)
        summary[row.business_name].total_pay += row.total_pay
        summary[row.business_name].employees += row.employee_count
      }

      return { period_days: days, summary, source: 'toast_import' }
    }
  },

  {
    name: 'get_employee_hours',
    description: 'Get hours for a specific employee or all employees.',
    inputSchema: {
      type: 'object',
      properties: {
        employee_name: { type: 'string', description: 'Employee name (partial match ok)' },
        days: { type: 'number', default: 14 }
      }
    },
    handler: ({ employee_name = '', days = 14 }) => {
      const rows = db.prepare(`
        SELECT employee_name, business_name, position,
               SUM(regular_hours) as reg_hours,
               SUM(overtime_hours) as ot_hours,
               SUM(total_pay) as total_pay,
               MIN(work_date) as first_date,
               MAX(work_date) as last_date
        FROM labor_entries
        WHERE work_date >= date('now', '-${days} days')
        ${employee_name ? `AND employee_name LIKE '%${employee_name}%'` : ''}
        GROUP BY employee_name, business_name, position
        ORDER BY ot_hours DESC, reg_hours DESC
      `).all()
      return { employees: rows, period_days: days }
    }
  },

  // ── SALES ─────────────────────────────────────────────────────────────────
  {
    name: 'get_sales_summary',
    description: 'Get sales data, covers, average check, and tips for one or both restaurants.',
    inputSchema: {
      type: 'object',
      properties: {
        business: { type: 'string', default: 'both' },
        days: { type: 'number', default: 30 }
      }
    },
    handler: ({ business = 'both', days = 30 }) => {
      const where = business.toLowerCase() === 'both' ? '' : `AND business_name LIKE '%${business}%'`
      const rows = db.prepare(`
        SELECT business_name,
               SUM(net_sales) as total_sales,
               SUM(covers) as total_covers,
               AVG(average_check) as avg_check,
               SUM(tips) as total_tips,
               COUNT(*) as days_count
        FROM sales_entries
        WHERE sale_date >= date('now', '-${days} days') ${where}
        GROUP BY business_name
      `).all()

      if (!rows.length) {
        return {
          message: 'No sales data found. Import Toast sales summary CSV to see real data.',
          mock_data: {
            reading_club: { weekly_sales: 54800, covers: 1840, avg_check: 29.78 },
            seneca: { weekly_sales: 44900, covers: 1620, avg_check: 27.72 }
          }
        }
      }
      return { period_days: days, businesses: rows }
    }
  },

  {
    name: 'get_server_sales',
    description: 'Get per-server sales, covers, and tips breakdown for tip pool calculations.',
    inputSchema: {
      type: 'object',
      properties: {
        business: { type: 'string', default: 'both' },
        days: { type: 'number', default: 14 }
      }
    },
    handler: ({ business = 'both', days = 14 }) => {
      const where = business.toLowerCase() === 'both' ? '' : `AND business_name LIKE '%${business}%'`
      const rows = db.prepare(`
        SELECT employee_name, business_name,
               SUM(net_sales) as net_sales,
               SUM(covers) as covers,
               AVG(average_check) as avg_check,
               SUM(cc_tips) as cc_tips,
               SUM(cash_tips) as cash_tips
        FROM server_sales
        WHERE (sale_date >= date('now', '-${days} days') OR sale_date IS NULL) ${where}
        GROUP BY employee_name, business_name
        ORDER BY net_sales DESC
      `).all()
      return { servers: rows, period_days: days }
    }
  },

  // ── TOAST IMPORT ──────────────────────────────────────────────────────────
  {
    name: 'import_toast_csv',
    description: 'Import a Toast POS CSV file. Accepts a file path OR automatically scans the ~/Desktop/Toast Imports folder. Use this when the user says they dropped a file or want to import data.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Full path to CSV file. Leave empty to scan ~/Desktop/Toast Imports folder.' },
        business_name: { type: 'string', description: 'Which restaurant this data is for', default: '' }
      }
    },
    handler: ({ file_path = '', business_name = '' }) => {
      let filePath = file_path

      // Auto-scan import folder if no path given
      if (!filePath) {
        if (!existsSync(IMPORT_FOLDER)) {
          return {
            error: `Import folder not found. Create a folder called "Toast Imports" on your Desktop and drop your CSV files there.`,
            folder: IMPORT_FOLDER
          }
        }
        const csvFiles = readdirSync(IMPORT_FOLDER).filter(f => f.endsWith('.csv') || f.endsWith('.CSV'))
        if (!csvFiles.length) {
          return {
            error: 'No CSV files found in ~/Desktop/Toast Imports. Drop your Toast export there and try again.',
            folder: IMPORT_FOLDER
          }
        }
        // Use most recently modified
        const withStats = csvFiles.map(f => {
          const { mtimeMs } = require('fs').statSync(join(IMPORT_FOLDER, f))
          return { f, mtimeMs }
        }).sort((a, b) => b.mtimeMs - a.mtimeMs)
        filePath = join(IMPORT_FOLDER, withStats[0].f)
      }

      if (!existsSync(filePath)) {
        return { error: `File not found: ${filePath}` }
      }

      const content = readFileSync(filePath, 'utf-8')
      const result = parseToastCSV(content, business_name)

      if (result.format === 'unknown') {
        return { error: result.error, file: filePath }
      }

      // Store in database
      const insertImport = db.prepare(`
        INSERT INTO imports (id, business_name, format, filename, row_count, date_range_start, date_range_end)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      insertImport.run(result.importId, business_name, result.format, filePath.split('/').pop(), result.rows, result.date_range_start, result.date_range_end)

      if (result.format === 'labor') {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO labor_entries (id, import_id, business_name, employee_name, employee_id, position, work_date, regular_hours, overtime_hours, hourly_rate, total_pay)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const insertMany = db.transaction((entries) => {
          for (const e of entries) insert.run(e.id, e.import_id, e.business_name, e.employee_name, e.employee_id, e.position, e.work_date, e.regular_hours, e.overtime_hours, e.hourly_rate, e.total_pay)
        })
        insertMany(result.entries)
      }

      if (result.format === 'sales') {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO sales_entries (id, import_id, business_name, sale_date, net_sales, gross_sales, covers, average_check, tips, tax_amount, cash_amount, credit_card_amount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const insertMany = db.transaction((entries) => {
          for (const e of entries) insert.run(e.id, e.import_id, e.business_name, e.sale_date, e.net_sales, e.gross_sales, e.covers, e.average_check, e.tips, e.tax_amount, e.cash_amount, e.credit_card_amount)
        })
        insertMany(result.entries)
      }

      if (result.format === 'server_sales') {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO server_sales (id, import_id, business_name, employee_name, net_sales, covers, average_check, cc_tips, cash_tips)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const insertMany = db.transaction((entries) => {
          for (const e of entries) insert.run(e.id, e.import_id, e.business_name, e.employee_name, e.net_sales, e.covers, e.average_check, e.cc_tips, e.cash_tips)
        })
        insertMany(result.entries)
      }

      return {
        success: true,
        format: result.format,
        rows_imported: result.rows,
        business: business_name || 'unspecified',
        date_range: { start: result.date_range_start, end: result.date_range_end },
        file: filePath.split('/').pop(),
        message: `Successfully imported ${result.rows} rows of ${result.format} data. You can now ask questions about this data.`
      }
    }
  },

  {
    name: 'list_imports',
    description: 'List all previously imported Toast CSV files.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const rows = db.prepare('SELECT * FROM imports ORDER BY imported_at DESC LIMIT 20').all()
      return { imports: rows, total: rows.length }
    }
  },

  // ── TASKS ─────────────────────────────────────────────────────────────────
  {
    name: 'get_tasks',
    description: 'Get open tasks and to-dos. Can filter by priority, business, or category.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Filter: "open", "done", "high", "today", or "all"', default: 'open' },
        business: { type: 'string', default: 'both' }
      }
    },
    handler: ({ filter = 'open', business = 'both' }) => {
      let where = []
      if (filter === 'open') where.push('done = 0')
      if (filter === 'done') where.push('done = 1')
      if (filter === 'high') where.push("priority = 'high' AND done = 0")
      if (filter === 'today') where.push("(due_date = 'Today' OR due_date = date('now')) AND done = 0")
      if (business.toLowerCase() !== 'both') where.push(`business LIKE '%${business}%'`)

      const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at`
      const rows = db.prepare(sql).all()
      return { tasks: rows, count: rows.length, filter }
    }
  },

  {
    name: 'add_task',
    description: 'Add a new task or to-do item.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], default: 'medium' },
        due_date: { type: 'string' },
        category: { type: 'string', default: 'General' },
        business: { type: 'string', default: 'Both' }
      },
      required: ['title']
    },
    handler: ({ title, priority = 'medium', due_date = '', category = 'General', business = 'Both' }) => {
      const id = `task_${Date.now()}`
      db.prepare('INSERT INTO tasks (id, title, priority, due_date, category, business) VALUES (?, ?, ?, ?, ?, ?)').run(id, title, priority, due_date, category, business)
      return { success: true, task: { id, title, priority, due_date, category, business } }
    }
  },

  {
    name: 'complete_task',
    description: 'Mark a task as done.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id']
    },
    handler: ({ task_id }) => {
      db.prepare('UPDATE tasks SET done = 1 WHERE id = ?').run(task_id)
      return { success: true, message: `Task ${task_id} marked complete.` }
    }
  },

  // ── NOTES ─────────────────────────────────────────────────────────────────
  {
    name: 'save_note',
    description: 'Save a shift note, incident report, observation, or any text note.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        category: { type: 'string', default: 'General' },
        business: { type: 'string', default: 'Both' }
      },
      required: ['title', 'content']
    },
    handler: ({ title, content, category = 'General', business = 'Both' }) => {
      const id = `note_${Date.now()}`
      db.prepare('INSERT INTO notes (id, title, content, category, business) VALUES (?, ?, ?, ?, ?)').run(id, title, content, category, business)
      return { success: true, note_id: id, message: 'Note saved.' }
    }
  },

  {
    name: 'get_notes',
    description: 'Retrieve saved notes, shift notes, or incident reports.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        business: { type: 'string', default: 'both' },
        limit: { type: 'number', default: 10 }
      }
    },
    handler: ({ category = '', business = 'both', limit = 10 }) => {
      let where = []
      if (category) where.push(`category LIKE '%${category}%'`)
      if (business.toLowerCase() !== 'both') where.push(`business LIKE '%${business}%'`)
      const sql = `SELECT * FROM notes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${limit}`
      const rows = db.prepare(sql).all()
      return { notes: rows, count: rows.length }
    }
  },

  // ── BUSINESS OVERVIEW ─────────────────────────────────────────────────────
  {
    name: 'get_business_overview',
    description: 'Get a complete overview of both restaurants including current KPIs, alerts, and status.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const businesses = db.prepare('SELECT * FROM businesses').all()
      const importCount = db.prepare('SELECT COUNT(*) as count FROM imports').get()
      const taskCount = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE done = 0").get()
      const highTaskCount = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE done = 0 AND priority = 'high'").get()

      return {
        owner: 'Adam Perna',
        company: 'Stoic Holdings / CH Projects',
        location: 'San Diego, CA',
        businesses: [
          {
            name: 'The Reading Club',
            type: 'Cocktail Bar & Restaurant',
            address: '4033 30th St, San Diego, CA 92104',
            current_metrics: { weekly_sales: 54800, labor_pct: 36.8, labor_target: 32.0, covers_weekly: 1840, avg_check: 29.78 },
            alerts: ['Labor 4.8pp over target — immediate attention needed']
          },
          {
            name: 'Seneca Trattoria',
            type: 'Italian Restaurant',
            address: '3929 30th St, San Diego, CA 92104',
            current_metrics: { weekly_sales: 44900, labor_pct: 30.2, labor_target: 31.0, covers_weekly: 1620, avg_check: 27.72 },
            alerts: []
          }
        ],
        data_status: {
          toast_imports: importCount.count,
          open_tasks: taskCount.count,
          high_priority_tasks: highTaskCount.count,
          note: importCount.count === 0 ? 'No Toast data imported yet. Use import_toast_csv tool to load real data.' : 'Real data loaded.'
        }
      }
    }
  },

  // ── TIP POOL ──────────────────────────────────────────────────────────────
  {
    name: 'calculate_tip_pool',
    description: 'Calculate tip pool distribution based on server sales and hours worked. Requires server sales data imported from Toast.',
    inputSchema: {
      type: 'object',
      properties: {
        business: { type: 'string' },
        date_range: { type: 'string', description: 'e.g. "last week", "June 2026"', default: 'last 14 days' }
      }
    },
    handler: ({ business = 'both', date_range = 'last 14 days' }) => {
      const servers = db.prepare(`
        SELECT employee_name, SUM(net_sales) as sales, SUM(covers) as covers, SUM(cc_tips) as cc_tips, SUM(cash_tips) as cash_tips
        FROM server_sales
        ${business.toLowerCase() !== 'both' ? `WHERE business_name LIKE '%${business}%'` : ''}
        GROUP BY employee_name ORDER BY sales DESC
      `).all()

      if (!servers.length) {
        return {
          message: 'No server sales data available. Import a Toast server sales report CSV first.',
          example: 'In Toast: Reports → Server Sales → Export CSV, then use import_toast_csv'
        }
      }

      const totalSales = servers.reduce((s, r) => s + r.sales, 0)
      const totalTips = servers.reduce((s, r) => s + r.cc_tips + r.cash_tips, 0)

      const distribution = servers.map(s => ({
        server: s.employee_name,
        sales: s.sales,
        sales_pct: ((s.sales / totalSales) * 100).toFixed(1) + '%',
        covers: s.covers,
        tips_earned: s.cc_tips + s.cash_tips,
        tip_pct: (((s.cc_tips + s.cash_tips) / totalTips) * 100).toFixed(1) + '%'
      }))

      return {
        business,
        date_range,
        total_sales: totalSales,
        total_tips: totalTips,
        server_count: servers.length,
        distribution
      }
    }
  },

  // ── SYSTEM DIAGNOSTIC ─────────────────────────────────────────────────────
  {
    name: 'system_diagnostic',
    description: 'Run a complete diagnostic of Adam OS. Checks all data, connections, and provides a status report.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const tables = ['labor_entries', 'sales_entries', 'server_sales', 'tasks', 'notes', 'imports']
      const counts = {}
      for (const t of tables) {
        counts[t] = db.prepare(`SELECT COUNT(*) as n FROM ${t}`).get().n
      }

      const googleTokens = db.prepare('SELECT * FROM google_tokens WHERE id = "default"').get()
      const recentImport = db.prepare('SELECT * FROM imports ORDER BY imported_at DESC LIMIT 1').get()

      return {
        status: 'operational',
        version: '2.0.0',
        database: {
          location: join(homedir(), '.adam-os', 'adam.db'),
          status: 'connected',
          record_counts: counts
        },
        data_loaded: {
          labor_data: counts.labor_entries > 0,
          sales_data: counts.sales_entries > 0,
          server_sales: counts.server_sales > 0,
          last_import: recentImport ? recentImport.imported_at : 'Never',
        },
        google_integration: {
          connected: !!googleTokens?.access_token,
          status: googleTokens ? 'tokens stored' : 'not connected'
        },
        tools_available: [
          'get_labor_summary', 'get_employee_hours', 'get_sales_summary',
          'get_server_sales', 'import_toast_csv', 'list_imports',
          'get_tasks', 'add_task', 'complete_task',
          'save_note', 'get_notes', 'get_business_overview',
          'calculate_tip_pool', 'system_diagnostic'
        ],
        recommendations: [
          counts.labor_entries === 0 ? '⚠️ Import Toast labor CSV to see real labor data' : '✅ Labor data loaded',
          counts.sales_entries === 0 ? '⚠️ Import Toast sales CSV to see real sales data' : '✅ Sales data loaded',
          counts.server_sales === 0 ? '⚠️ Import Toast server sales CSV for tip pool calculations' : '✅ Server sales loaded',
          '💡 Create ~/Desktop/Toast Imports folder and drop CSVs there for easy importing',
        ]
      }
    }
  }
]
