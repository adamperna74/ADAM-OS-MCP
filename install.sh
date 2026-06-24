#!/bin/bash
set -e

echo "============================================"
echo "Adam OS MCP — Installing"
echo "============================================"

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install from nodejs.org first."
  exit 1
fi

NODE_VER=$(node --version | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node --version)"
  exit 1
fi

echo "✅ Node.js $(node --version)"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Create import folder
mkdir -p ~/Desktop/"Toast Imports"
echo "✅ Created ~/Desktop/Toast Imports folder"

# Get Claude Desktop config path
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
MCP_PATH="$(pwd)/src/index.js"

# Build config entry
MCP_CONFIG=$(cat << JSON
{
  "mcpServers": {
    "adam-os": {
      "command": "node",
      "args": ["$MCP_PATH"],
      "env": {}
    }
  }
}
JSON
)

echo ""
echo "============================================"
echo "✅ Adam OS MCP installed successfully!"
echo "============================================"
echo ""
echo "NEXT STEP — Add to Claude Desktop:"
echo ""
echo "1. Open Claude Desktop"
echo "2. Click Claude menu → Settings → Developer"  
echo "3. Click 'Edit Config' and paste this:"
echo ""
echo "$MCP_CONFIG"
echo ""
echo "4. Save and restart Claude Desktop"
echo "5. Look for the hammer icon (🔨) in Claude — that means Adam OS is connected"
echo ""
echo "USING ADAM OS:"
echo "  • 'What's my labor this week?' — asks for labor data"
echo "  • 'Import my Toast CSV' — scans ~/Desktop/Toast Imports"
echo "  • 'Run a system diagnostic' — checks everything"
echo "  • 'What are my open tasks?' — shows your task list"
echo "  • 'Add task: review P6 P&L, high priority' — creates a task"
echo ""
echo "Drop Toast CSV exports in: ~/Desktop/Toast Imports"
echo "============================================"
