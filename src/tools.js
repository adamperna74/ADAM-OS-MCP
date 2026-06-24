/**
 * Adam OS MCP Tools — all business data tools
 */
import db from './database.js'
import { parseToastCSV } from './toast_parser.js'
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const IMPORT_FOLDER = join(homedir(), 'Desktop', 'Toast Imports')

export const tools = [
  {
    name: 'get_business_overview',
    description: 'Get a complete overview of both restaurants — Reading Club and Seneca Trattoria — including current KPIs, alerts, and data status.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const importCount = db.get('SELECT COUNT(*) as count FROM imports')
      const taskCount = db.get('SELECT COUNT(*) as count FROM tasks WHERE done = 0')
      const highTasks = db.get("SELECT COUNT(*) as count FROM tasks WHERE done = 0 AND priority = 'high'")
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
            alerts: ['⚠️ Labor 4.8pp over target — reduce hours or cut overtime']
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
          toast_imports: importCount?.count || 0,
          open_tasks: taskCount?.count || 0,
          high_priority_tasks: highTasks?.count || 0,
          toast_import_folder: IMPORT_FOLDER,
          note: (importCount?.count || 0) === 0
            ? 'No Toast data imported yet. Drop CSV files in ~/Desktop/Toast Imports and say "import my Toast CSV"'
            : `${importCount.count} Toast import(s) on file`
        }
      }
    }
  },

  {
    name: 'get_labor_summary',
    description: 'Get labor hours, cost, and labor percentage. Works with real Toast data if imported, otherwise shows current known metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        business: { type: 'string', description: 'Restaurant name or "both"', default: 'both' },
        days: { type: 'number', default: 14 }
      }
    },
    handler: ({ business = 'both', days = 14 }) => {
      const filter = business.toLowerCase() === 'both' ? '' : `AND business_name LIKE '%${business}%'`
      const rows = db.all(`
        SELECT business_name, position,
               SUM(regular_hours) as reg_hours,
               SUM(overtime_hours) as ot_hours,
               SUM(total_pay) as total_pay,
               COUNT(DISTINCT employee_name) as employee_count
        FROM labor_entries
        WHERE date(work_date) >= date('now', '-${days} days') ${filter}
        GROUP BY business_name, position
        ORDER BY business_name, total_pay DESC
      `)

      if (!rows.length) {
        return {
          source: 'estimated',
          note: 'No imported Toast data. These are current known metrics — import Toast CSV for exact figures.',
          reading_club: {
            total_hours_estimated: 284, labor_cost_estimated: 7420,
            labor_pct: 36.8, target: 32.0, variance: '+4.8pp',
            action_required: true
          },
          seneca: {
            total_hours_estimated: 218, labor_cost_estimated: 5480,
            labor_pct: 30.2, target: 31.0, variance: '-0.8pp',
            action_required: false
          }
        }
      }

      const summary = {}
      for (const r of rows) {
        if (!summary[r.business_name]) summary[r.business_name] = { positions: [], total_hours: 0, total_pay: 0 }
        summary[r.business_name].positions.push(r)
        summary[r.business_name].total_hours += (r.reg_hours + r.ot_hours)
        summary[r.business_name].total_pay += r.total_pay
      }
      return { source: 'toast_import', period_days: days, summary }
    }
  },

  {
    name: 'get_employee_hours',
    description: 'Get hours and pay for employees. Flags overtime. Use to check if anyone is approaching overtime threshold.',
    inputSchema: {
      type: 'object',
      properties: {
        employee_name: { type: 'string', description: 'Employee name (partial ok). Leave empty for all.' },
        days: { type: 'number', default: 7 }
      }
    },
    handler: ({ employee_name = '', days = 7 }) => {
      const nameFilter = employee_name ? `AND employee_name LIKE '%${employee_name}%'` : ''
      const rows = db.all(`
        SELECT employee_name, business_name, position,
               SUM(regular_hours) as reg_hours,
               SUM(overtime_hours) as ot_hours,
               SUM(total_pay) as total_pay
        FROM labor_entries
        WHERE date(work_date) >= date('now', '-${days} days') ${nameFilter}
        GROUP BY employee_name, business_name, position
        ORDER BY ot_hours DESC, reg_hours DESC
      `)
      if (!rows.length) return { message: 'No labor data imported yet. Use import_toast_csv first.', employees: [] }
      const withFlags = rows.map(r => ({
        ...r,
        total_hours: r.reg_hours + r.ot_hours,
        overtime_flag: r.ot_hours > 0 || r.reg_hours > 35
      }))
      return { employees: withFlags, period_days: days, overtime_count: withFlags.filter(e => e.overtime_flag).length }
    }
  },

  {
    name: 'get_sales_summary',
    description: 'Get sales, covers, and average check data from imported Toast reports.',
    inputSchema: {
      type: 'object',
      properties: {
        business: { type: 'string', default: 'both' },
        days: { type: 'number', default: 30 }
      }
    },
    handler: ({ business = 'both', days = 30 }) => {
      const filter = business.toLowerCase() === 'both' ? '' : `AND business_name LIKE '%${business}%'`
      const rows = db.all(`
        SELECT business_name,
               SUM(net_sales) as total_sales, SUM(covers) as total_covers,
               AVG(average_check) as avg_check, SUM(tips) as total_tips,
               COUNT(*) as days_count
        FROM sales_entries
        WHERE date(sale_date) >= date('now', '-${days} days') ${filter}
        GROUP BY business_name
      `)
      if (!rows.length) return {
        source: 'estimated',
        note: 'Import Toast sales summary CSV for real data.',
        reading_club: { weekly_sales: 54800, covers: 1840, avg_check: 29.78 },
        seneca: { weekly_sales: 44900, covers: 1620, avg_check: 27.72 }
      }
      return { source: 'toast_import', period_days: days, businesses: rows }
    }
  },

  {
    name: 'get_server_sales',
    description: 'Get per-server sales, covers, and tips. Used for tip pool calculations.',
    inputSchema: {
      type: 'object',
      properties: {
        business: { type: 'string', default: 'both' },
        days: { type: 'number', default: 14 }
      }
    },
    handler: ({ business = 'both', days = 14 }) => {
      const filter = business.toLowerCase() === 'both' ? '' : `AND business_name LIKE '%${business}%'`
      const rows = db.all(`
        SELECT employee_name, business_name,
               SUM(net_sales) as net_sales, SUM(covers) as covers,
               AVG(average_check) as avg_check,
               SUM(cc_tips) as cc_tips, SUM(cash_tips) as cash_tips
        FROM server_sales
        WHERE date(sale_date) >= date('now', '-${days} days') ${filter}
        GROUP BY employee_name, business_name
        ORDER BY net_sales DESC
      `)
      if (!rows.length) return { message: 'Import Toast server sales report CSV for this data.', servers: [] }
      return { servers: rows, period_days: days }
    }
  },

  {
    name: 'calculate_tip_pool',
    description: 'Calculate tip pool distribution based on imported server sales data.',
    inputSchema: {
      type: 'object',
      properties: {
        business: { type: 'string', default: 'both' }
      }
    },
    handler: ({ business = 'both' }) => {
      const filter = business.toLowerCase() === 'both' ? '' : `WHERE business_name LIKE '%${business}%'`
      const servers = db.all(`
        SELECT employee_name, SUM(net_sales) as sales, SUM(cc_tips) as cc_tips, SUM(cash_tips) as cash_tips
        FROM server_sales ${filter}
        GROUP BY employee_name ORDER BY sales DESC
      `)
      if (!servers.length) return { message: 'Import Toast server sales CSV first. Then run tip pool calculation.' }
      const totalSales = servers.reduce((s, r) => s + r.sales, 0)
      const totalTips = servers.reduce((s, r) => s + r.cc_tips + r.cash_tips, 0)
      return {
        total_sales: totalSales, total_tips: totalTips, server_count: servers.length,
        distribution: servers.map(s => ({
          server: s.employee_name,
          sales: s.sales,
          sales_pct: ((s.sales / totalSales) * 100).toFixed(1) + '%',
          tips: s.cc_tips + s.cash_tips,
          tip_share_pct: (((s.cc_tips + s.cash_tips) / totalTips) * 100).toFixed(1) + '%'
        }))
      }
    }
  },

  {
    name: 'import_toast_csv',
    description: 'Import a Toast POS CSV export. Auto-scans ~/Desktop/Toast Imports folder if no path given. Accepts labor, sales summary, or server sales reports.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Full path to CSV. Leave empty to auto-scan ~/Desktop/Toast Imports' },
        business_name: { type: 'string', description: 'Restaurant name for this data', default: '' }
      }
    },
    handler: ({ file_path = '', business_name = '' }) => {
      let filePath = file_path
      if (!filePath) {
        if (!existsSync(IMPORT_FOLDER)) {
          return {
            error: 'Import folder not found.',
            action: `Create a folder called "Toast Imports" on your Desktop and drop your Toast CSV files there.`,
            folder_to_create: IMPORT_FOLDER
          }
        }
        const csvFiles = readdirSync(IMPORT_FOLDER)
          .filter(f => f.toLowerCase().endsWith('.csv'))
          .map(f => ({ f, mtime: statSync(join(IMPORT_FOLDER, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)

        if (!csvFiles.length) {
          return { error: 'No CSV files found in ~/Desktop/Toast Imports. Drop your Toast export there and try again.' }
        }
        filePath = join(IMPORT_FOLDER, csvFiles[0].f)
      }

      if (!existsSync(filePath)) return { error: `File not found: ${filePath}` }

      const content = readFileSync(filePath, 'utf-8')
      const result = parseToastCSV(content, business_name)

      if (result.format === 'unknown') return { error: result.error }

      // Store import record
      db.run(`INSERT OR REPLACE INTO imports (id, business_name, format, filename, row_count, date_range_start, date_range_end)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [result.importId, business_name, result.format, filePath.split('/').pop(), result.rows, result.date_range_start, result.date_range_end])

      // Store entries
      for (const e of result.entries) {
        if (result.format === 'labor') {
          db.run(`INSERT OR REPLACE INTO labor_entries (id, import_id, business_name, employee_name, employee_id, position, work_date, regular_hours, overtime_hours, hourly_rate, total_pay)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [e.id, e.import_id, e.business_name, e.employee_name, e.employee_id, e.position, e.work_date, e.regular_hours, e.overtime_hours, e.hourly_rate, e.total_pay])
        }
        if (result.format === 'sales') {
          db.run(`INSERT OR REPLACE INTO sales_entries (id, import_id, business_name, sale_date, net_sales, gross_sales, covers, average_check, tips, tax_amount, cash_amount, credit_card_amount)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [e.id, e.import_id, e.business_name, e.sale_date, e.net_sales, e.gross_sales, e.covers, e.average_check, e.tips, e.tax_amount, e.cash_amount, e.credit_card_amount])
        }
        if (result.format === 'server_sales') {
          db.run(`INSERT OR REPLACE INTO server_sales (id, import_id, business_name, employee_name, net_sales, covers, average_check, cc_tips, cash_tips)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [e.id, e.import_id, e.business_name, e.employee_name, e.net_sales, e.covers, e.average_check, e.cc_tips, e.cash_tips])
        }
      }

      return {
        success: true,
        format: result.format,
        rows_imported: result.rows,
        file: filePath.split('/').pop(),
        business: business_name || 'not specified',
        date_range: { start: result.date_range_start, end: result.date_range_end },
        message: `✅ Imported ${result.rows} rows of ${result.format} data. You can now ask questions about this data.`
      }
    }
  },

  {
    name: 'list_imports',
    description: 'List all previously imported Toast CSV files.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const rows = db.all('SELECT * FROM imports ORDER BY imported_at DESC LIMIT 20')
      return { imports: rows, total: rows.length }
    }
  },

  {
    name: 'get_tasks',
    description: 'Get tasks and to-dos. Filter by priority or status.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: '"open", "high", "done", or "all"', default: 'open' }
      }
    },
    handler: ({ filter = 'open' }) => {
      const conditions = {
        open: 'WHERE done = 0',
        high: "WHERE done = 0 AND priority = 'high'",
        done: 'WHERE done = 1',
        all: ''
      }
      const rows = db.all(`SELECT * FROM tasks ${conditions[filter] || 'WHERE done = 0'} ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`)
      return { tasks: rows, count: rows.length, filter }
    }
  },

  {
    name: 'add_task',
    description: 'Add a new task or action item.',
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
      db.run('INSERT INTO tasks (id, title, priority, due_date, category, business) VALUES (?, ?, ?, ?, ?, ?)',
        [id, title, priority, due_date, category, business])
      return { success: true, message: `Task added: "${title}"`, id }
    }
  },

  {
    name: 'complete_task',
    description: 'Mark a task as complete.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id']
    },
    handler: ({ task_id }) => {
      db.run('UPDATE tasks SET done = 1 WHERE id = ?', [task_id])
      return { success: true, message: `Task ${task_id} marked complete.` }
    }
  },

  {
    name: 'save_note',
    description: 'Save a shift note, incident report, or any observation.',
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
      db.run('INSERT INTO notes (id, title, content, category, business) VALUES (?, ?, ?, ?, ?)',
        [id, title, content, category, business])
      return { success: true, note_id: id, message: `Note saved: "${title}"` }
    }
  },

  {
    name: 'get_notes',
    description: 'Get saved shift notes, incidents, or observations.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        business: { type: 'string', default: 'both' },
        limit: { type: 'number', default: 10 }
      }
    },
    handler: ({ category = '', business = 'both', limit = 10 }) => {
      const filters = []
      if (category) filters.push(`category LIKE '%${category}%'`)
      if (business.toLowerCase() !== 'both') filters.push(`business LIKE '%${business}%'`)
      const where = filters.length ? 'WHERE ' + filters.join(' AND ') : ''
      const rows = db.all(`SELECT * FROM notes ${where} ORDER BY created_at DESC LIMIT ${limit}`)
      return { notes: rows, count: rows.length }
    }
  },

  {
    name: 'system_diagnostic',
    description: 'Run a complete health check of Adam OS. Check all data, tools, and status.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const counts = {}
      for (const t of ['labor_entries', 'sales_entries', 'server_sales', 'tasks', 'notes', 'imports']) {
        counts[t] = db.get(`SELECT COUNT(*) as n FROM ${t}`)?.n || 0
      }
      return {
        status: '✅ operational',
        version: '2.0.0',
        database: { status: 'connected', records: counts },
        tools: tools.map(t => t.name),
        import_folder: IMPORT_FOLDER,
        recommendations: [
          counts.labor_entries === 0 ? '⚠️ No labor data — export from Toast → Reports → Labor → Time Entries' : `✅ ${counts.labor_entries} labor records`,
          counts.sales_entries === 0 ? '⚠️ No sales data — export from Toast → Reports → Sales Summary' : `✅ ${counts.sales_entries} sales records`,
          counts.server_sales === 0 ? '⚠️ No server sales — export from Toast → Reports → Server Sales' : `✅ ${counts.server_sales} server records`,
          `📁 Drop Toast CSV files in: ${IMPORT_FOLDER}`,
        ]
      }
    }
  }
]
