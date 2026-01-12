# Figma AI Designer

> Transform AI-generated HTML/CSS into native Figma components instantly.

[![npm version](https://img.shields.io/npm/v/figma-ai-designer.svg)](https://www.npmjs.com/package/figma-ai-designer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Figma AI Designer is an MCP (Model Context Protocol) server that bridges AI assistants like **Claude Desktop**, **Cursor**, or **Claude Code** with Figma. Simply describe your design in natural language, and watch it appear directly in your Figma canvas.

---

## Features

- **Natural Language to Figma** - Describe what you want, AI generates HTML/CSS, and it becomes a Figma component
- **Proper Auto Layout** - Flexbox is converted to Figma's native Auto Layout with correct spacing and alignment
- **Full Styling Support** - Colors, gradients, typography, borders, shadows, and opacity are preserved
- **Real-time Connection** - WebSocket ensures instant communication between AI and Figma
- **Works with Any MCP Client** - Claude Desktop, Cursor, VS Code, Claude Code, and more

---

## How It Works

```
You: "Create a login form with email and password fields"
                    ↓
         AI Assistant (Claude)
                    ↓ generates HTML/CSS
            MCP Server (Node.js)
                    ↓ parses & converts
            Figma Plugin (WebSocket)
                    ↓ creates nodes
             Figma Canvas ✨
```

---

## Quick Start

### Step 1: Install the Figma Plugin

1. Open **Figma Desktop**
2. Go to `Plugins` → `Development` → `Import plugin from manifest...`
3. Select the `manifest.json` file from this repository
4. The plugin will appear in your plugins list

### Step 2: Configure Your AI Client

Add the MCP server to your AI client's configuration:

<details>
<summary><strong>Claude Desktop</strong></summary>

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "figma-ai-designer": {
      "command": "npx",
      "args": ["figma-ai-designer"]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor / VS Code</strong></summary>

Add to your MCP settings:

```json
{
  "figma-ai-designer": {
    "command": "npx",
    "args": ["figma-ai-designer"]
  }
}
```

</details>

<details>
<summary><strong>Claude Code</strong></summary>

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "figma-ai-designer": {
      "command": "npx",
      "args": ["figma-ai-designer"]
    }
  }
}
```

</details>

### Step 3: Start Designing!

1. Open Figma and run the **AI Designer** plugin (`Plugins` → `AI Designer`)
2. Wait for the "Connected" status (green dot)
3. Ask your AI assistant to create designs:

```
"Create a pricing card with a title, price, feature list, and CTA button"
```

---

## Example Prompts

| Prompt | Result |
|--------|--------|
| "Create a button with blue gradient background" | Styled button component |
| "Design a user profile card with avatar, name, and bio" | Profile card with proper layout |
| "Build a navigation bar with logo and menu items" | Horizontal nav component |
| "Make a mobile app screen for a coffee ordering app" | Full mobile UI screen |
| "Create a dashboard widget showing statistics" | Data visualization card |

---

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `create_component_from_html` | Create Figma component from HTML/CSS |
| `get_current_selection` | Get information about selected nodes |
| `list_components` | List all components on current page |
| `get_plugin_status` | Check plugin connection status |

---

## Supported HTML & CSS

### HTML Elements

| HTML | Figma Node |
|------|------------|
| `<div>`, `<section>`, `<article>`, `<header>`, `<footer>`, `<nav>`, `<main>`, `<aside>` | Frame |
| `<span>`, `<p>`, `<h1>`-`<h6>`, `<label>` | Text |
| `<button>` | Frame with Text (styled) |
| `<input>`, `<textarea>` | Frame with Text (input style) |
| `<img>` | Rectangle with placeholder |
| `<a>` | Text with link styling |

### CSS Properties

**Layout**
- `display: flex`
- `flex-direction` (row, column)
- `justify-content` (flex-start, center, flex-end, space-between, space-around)
- `align-items` (flex-start, center, flex-end, stretch)
- `gap`, `row-gap`, `column-gap`
- `flex-grow`, `flex-shrink`

**Sizing**
- `width`, `height`
- `min-width`, `min-height`
- `max-width`, `max-height`

**Spacing**
- `padding` (all directions)
- `margin` (all directions)

**Background**
- `background-color`
- `background: linear-gradient(...)`

**Border**
- `border-radius`
- `border-width`, `border-color`, `border-style`

**Typography**
- `font-size`, `font-weight`, `font-family`
- `color`
- `text-align`
- `line-height`, `letter-spacing`

**Effects**
- `opacity`
- `box-shadow`

---

## Development

### Prerequisites

- Node.js 18+
- Figma Desktop

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/figma-ai-designer.git
cd figma-ai-designer

# Install dependencies
npm install

# Build everything
npm run build:all
```

### Build Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build MCP server |
| `npm run build:plugin` | Build Figma plugin |
| `npm run build:all` | Build both |
| `npm run watch:plugin` | Watch mode for plugin |

### Project Structure

```
figma-ai-designer/
├── plugin/                  # Figma plugin
│   ├── code.ts             # Plugin main code
│   ├── ui.html             # Plugin UI
│   └── html-parser.ts      # HTML → Figma converter
├── mcp-server/             # MCP server
│   ├── index.ts            # Server entry
│   ├── websocket.ts        # WebSocket handler
│   ├── html-parser.ts      # Server-side parser
│   └── tools/              # MCP tool implementations
├── shared/                 # Shared TypeScript types
├── test-files/             # Test HTML files
├── dist/                   # Build output
├── manifest.json           # Figma plugin manifest
└── package.json
```

---

## Troubleshooting

### Plugin shows "Disconnected"

1. Make sure the MCP server is running (check your AI client)
2. Try clicking "Reconnect" in the plugin
3. Restart the AI client to restart the MCP server

### Component not appearing in Figma

1. Check if the plugin shows "Connected" status
2. Look at the Activity Log in the plugin for errors
3. Ensure you have a Figma file open (not just the home screen)

### Timeout errors

For complex HTML, the server may take longer to process. The timeout is set to 120 seconds. If you still get timeouts, try simplifying the HTML or breaking it into smaller components.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FIGMA_AI_DESIGNER_PORT` | `51847` | WebSocket server port |

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- Built with [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- Powered by [Figma Plugin API](https://www.figma.com/plugin-docs/)
