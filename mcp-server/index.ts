#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getWebSocketServer } from './websocket';
import { createComponent } from './tools/create-component';
import { getSelection } from './tools/get-selection';
import { listComponents } from './tools/list-components';
import { getStatus } from './tools/get-status';

const WS_PORT = parseInt(process.env.FIGMA_AI_DESIGNER_PORT || '51847', 10);

// Tool definitions
const tools = [
  {
    name: 'create_component_from_html',
    description: `Create a Figma component from HTML/CSS code. The HTML will be parsed and converted to Figma nodes with Auto Layout, colors, typography, and other styles preserved.

Supported HTML elements:
- <div>, <section>, <article>, <header>, <footer>, <main>, <nav>, <aside> → Frame
- <span>, <p>, <h1>-<h6>, <label> → Text
- <button> → Frame with Text (styled as button)
- <input>, <textarea> → Frame with Text (styled as input)
- <img> → Rectangle with Image Fill (placeholder)
- <a> → Text with link styling

Supported CSS properties:
- Layout: display (flex), flex-direction, justify-content, align-items, gap
- Sizing: width, height, min-width, min-height, max-width, max-height
- Spacing: padding, margin (all directions)
- Background: background-color, background (solid colors)
- Border: border-radius, border-width, border-color, border-style
- Typography: font-size, font-weight, font-family, color, text-align, line-height, letter-spacing
- Effects: opacity, box-shadow

Example:
<div style="display: flex; flex-direction: column; gap: 16px; padding: 24px; background-color: #ffffff; border-radius: 12px;">
  <h2 style="font-size: 24px; font-weight: 600; color: #1a1a1a;">Card Title</h2>
  <p style="font-size: 14px; color: #666666;">Card description goes here.</p>
  <button style="padding: 12px 24px; background-color: #3b82f6; color: white; border-radius: 8px; font-weight: 500;">
    Click me
  </button>
</div>`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        html: {
          type: 'string',
          description: 'The HTML code to convert to a Figma component. Can include inline styles.',
        },
        name: {
          type: 'string',
          description: 'Optional name for the created component. Defaults to "AI Component".',
        },
        parentId: {
          type: 'string',
          description: 'Optional Figma node ID to place the component inside.',
        },
      },
      required: ['html'],
    },
  },
  {
    name: 'get_current_selection',
    description: 'Get information about the currently selected nodes in Figma. Returns an array of selected nodes with their properties including id, name, type, position, and dimensions.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_components',
    description: 'List all components on the current Figma page. Returns an array of component nodes with their properties.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_plugin_status',
    description: 'Check if the Figma plugin is connected and get information about the current document and page.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

async function main() {
  // Start WebSocket server for Figma plugin communication
  const wsServer = getWebSocketServer(WS_PORT);
  await wsServer.start();

  // Create MCP server
  const server = new Server(
    {
      name: 'figma-ai-designer',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle call tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'create_component_from_html':
          result = await createComponent({
            html: (args as { html: string; name?: string; parentId?: string }).html,
            name: (args as { html: string; name?: string; parentId?: string }).name,
            parentId: (args as { html: string; name?: string; parentId?: string }).parentId,
          });
          break;
        case 'get_current_selection':
          result = await getSelection();
          break;
        case 'list_components':
          result = await listComponents();
          break;
        case 'get_plugin_status':
          result = await getStatus();
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP] Figma AI Designer server started');
  console.error(`[MCP] WebSocket server running on ws://localhost:${WS_PORT}`);
  console.error('[MCP] Waiting for Figma plugin connection...');
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
