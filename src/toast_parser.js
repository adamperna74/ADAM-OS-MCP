/**
 * Toast POS CSV Parser
 * Handles labor, sales summary, and server sales exports.
 */
import { parse } from 'csv-parse/sync'

function detectFormat(headers) {
  const h = headers.map(x => x.toLowerCase().trim())
  if (h.some(x => ['in time','clock in','regular hours','hours worked'].includes(x))) return 'labor'
  if (h.some(x => ['server','cc tips','credit card tips'].includes(x))) return 'server_sales'
  if (h.some(x => ['net sales','covers','gross sales'].includes(x))) return 'sales'
  return 'unknown'
}

function findCol(headers, aliases) {
  const map = {}
  headers.forEach(h => { map[h.toLowerCase().trim()] = h })
  for (const a of aliases) {
    if (map[a.toLowerCase()]) return map[a.toLowerCase()]
  }
  return null
}

function parseNum(val) {
  if (!val) return 0
  return parseFloat(String(val).replace(/[$,()]/g, '').trim()) || 0
}

function parseDate(val) {
  if (!val) return null
  const s = String(val).trim()
  for (const fmt of [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,  // MM/DD/YYYY
    /(\d{4})-(\d{2})-(\d{2})/,          // YYYY-MM-DD
  ]) {
    const m = s.match(fmt)
    if (m) {
      if (fmt.source.startsWith('(\\d{4})')) return `${m[1]}-${m[2]}-${m[3]}`
      return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`
    }
  }
  return s
}

export function parseToastCSV(content, businessName = '') {
  const records = parse(content, { columns: true, skip_empty_lines: true, bom: true })
  if (!records.length) return { format: 'unknown', rows: 0, error: 'Empty file' }

  const headers = Object.keys(records[0])
  const format = detectFormat(headers)

  if (format === 'unknown') {
    return { format, rows: 0, error: `Unrecognized format. Headers: ${headers.slice(0,6).join(', ')}` }
  }

  const importId = `imp_${Date.now()}`
  const results = { format, importId, businessName, rows: records.length, entries: [] }

  if (format === 'labor') {
    results.entries = records.map((r, i) => ({
      id: `${importId}_${i}`,
      import_id: importId,
      business_name: businessName,
      employee_name: r[findCol(headers, ['Employee Name','Employee','Name'])] || '',
      employee_id: r[findCol(headers, ['Employee ID','Employee Id','POS ID'])] || '',
      position: r[findCol(headers, ['Job','Position','Role'])] || '',
      work_date: parseDate(r[findCol(headers, ['Date','Business Date','Work Date'])]),
      regular_hours: parseNum(r[findCol(headers, ['Regular Hours','Reg Hours','Hours Worked'])]),
      overtime_hours: parseNum(r[findCol(headers, ['Overtime Hours','OT Hours','Overtime'])]),
      hourly_rate: parseNum(r[findCol(headers, ['Hourly Rate','Rate','Wage'])]),
      total_pay: parseNum(r[findCol(headers, ['Total Pay','Gross Pay','Total Wages'])]),
    })).filter(e => e.employee_name)
  }

  if (format === 'sales') {
    results.entries = records.map((r, i) => ({
      id: `${importId}_${i}`,
      import_id: importId,
      business_name: businessName,
      sale_date: parseDate(r[findCol(headers, ['Date','Business Date'])]),
      net_sales: parseNum(r[findCol(headers, ['Net Sales','Net Revenue'])]),
      gross_sales: parseNum(r[findCol(headers, ['Gross Sales','Gross Revenue'])]),
      covers: Math.round(parseNum(r[findCol(headers, ['Covers','Guests','Guest Count'])])),
      average_check: parseNum(r[findCol(headers, ['Average Check','Avg Check'])]),
      tips: parseNum(r[findCol(headers, ['Tips','Total Tips','CC Tips'])]),
      tax_amount: parseNum(r[findCol(headers, ['Tax','Total Tax'])]),
      cash_amount: parseNum(r[findCol(headers, ['Cash','Cash Amount'])]),
      credit_card_amount: parseNum(r[findCol(headers, ['Credit Card','Card Sales'])]),
    }))
  }

  if (format === 'server_sales') {
    results.entries = records.map((r, i) => ({
      id: `${importId}_${i}`,
      import_id: importId,
      business_name: businessName,
      employee_name: r[findCol(headers, ['Server','Employee Name','Employee'])] || '',
      net_sales: parseNum(r[findCol(headers, ['Net Sales','Sales'])]),
      covers: Math.round(parseNum(r[findCol(headers, ['Covers','Guests'])])),
      average_check: parseNum(r[findCol(headers, ['Average Check','Avg Check'])]),
      cc_tips: parseNum(r[findCol(headers, ['CC Tips','Credit Card Tips','Tips'])]),
      cash_tips: parseNum(r[findCol(headers, ['Cash Tips'])]),
    })).filter(e => e.employee_name)
  }

  // Date range
  const dates = results.entries.map(e => e.work_date || e.sale_date).filter(Boolean).sort()
  results.date_range_start = dates[0] || null
  results.date_range_end = dates[dates.length - 1] || null

  return results
}
