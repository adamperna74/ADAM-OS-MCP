# Adam OS — MCP Server

Executive Operating System for Adam Perna · Stoic Holdings · CH Projects · San Diego

## What This Does

Adam OS runs as an MCP server inside Claude Desktop. You talk to it naturally — Claude uses the tools automatically.

## Tools Available

| Tool | What it does |
|------|-------------|
| `get_business_overview` | Full status of both restaurants |
| `get_labor_summary` | Labor hours, cost, % by location |
| `get_employee_hours` | Hours per employee, overtime flags |
| `get_sales_summary` | Sales, covers, avg check by location |
| `get_server_sales` | Per-server breakdown for tip pools |
| `import_toast_csv` | Parse & store any Toast CSV export |
| `list_imports` | Show all previously imported files |
| `calculate_tip_pool` | Tip pool math from server sales data |
| `get_tasks` | Open tasks, filtered by priority |
| `add_task` | Create a new task |
| `complete_task` | Mark task done |
| `save_note` | Save shift notes, incidents, observations |
| `get_notes` | Retrieve saved notes |
| `system_diagnostic` | Full health check of Adam OS |

## Installation

```bash
bash install.sh
```

## Importing Toast Data

1. In Toast: Reports → Labor → Time Entries → Export CSV
2. In Toast: Reports → Sales Summary → Export CSV  
3. In Toast: Reports → Server Sales → Export CSV
4. Drop the files in `~/Desktop/Toast Imports`
5. Tell Claude: "Import my Toast CSV"

## Data Storage

All data stored locally at `~/.adam-os/adam.db` — SQLite, no cloud, no servers.

## Example Conversations

> "What's my labor percentage this week for both restaurants?"

> "Who's close to overtime at Reading Club?"

> "I dropped a Toast CSV on my desktop, can you import it?"

> "Calculate the tip pool for last week at Seneca"

> "Add a high priority task: approve Saturday schedule"

> "Run a system diagnostic"
