import { z } from 'zod';
import { getWebSocketServer } from '../websocket';
import { parseHTML } from '../html-parser';
import type { CreateComponentMessage, ResultMessage, ErrorMessage, ComponentCreationResult } from '../../shared/types';

export const createComponentSchema = z.object({
  html: z.string().describe('The HTML code to convert to a Figma component. Can include inline styles or a <style> tag.'),
  name: z.string().optional().describe('Optional name for the created component. Defaults to "AI Component".'),
  parentId: z.string().optional().describe('Optional Figma node ID to place the component inside.'),
});

export type CreateComponentInput = z.infer<typeof createComponentSchema>;

export async function createComponent(input: CreateComponentInput): Promise<ComponentCreationResult> {
  const ws = getWebSocketServer();

  if (!ws.isConnected()) {
    throw new Error(
      'Figma plugin is not connected. Please:\n' +
      '1. Open Figma\n' +
      '2. Open a design file\n' +
      '3. Run the AI Designer plugin (Plugins > AI Designer)'
    );
  }

  // Parse HTML on the server side
  const elements = parseHTML(input.html);

  if (elements.length === 0) {
    throw new Error('No valid HTML elements found in the provided HTML');
  }

  const message: CreateComponentMessage = {
    id: ws.generateId(),
    type: 'create_component',
    payload: {
      elements,
      name: input.name,
      parentId: input.parentId,
    },
  };

  // Use longer timeout (120s) for complex HTML that takes time to render in Figma
  const COMPONENT_CREATION_TIMEOUT = 120000;

  try {
    const response = await ws.send<ResultMessage | ErrorMessage>(message, COMPONENT_CREATION_TIMEOUT);

    if (response.type === 'error') {
      throw new Error(response.payload.message);
    }

    return response.payload as ComponentCreationResult;
  } catch (error) {
    if (error instanceof Error && error.message === 'Request timed out') {
      throw new Error(
        'Request timed out after 120 seconds. However, the component may have been created in Figma.\n' +
        'Please check your Figma canvas - if the component appears, the operation was successful.\n' +
        'For complex HTML, Figma may take longer to process all the elements.'
      );
    }
    throw error;
  }
}

export const createComponentTool = {
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

Example usage:
\`\`\`html
<div style="display: flex; flex-direction: column; gap: 16px; padding: 24px; background-color: #ffffff; border-radius: 12px;">
  <h2 style="font-size: 24px; font-weight: 600; color: #1a1a1a;">Card Title</h2>
  <p style="font-size: 14px; color: #666666;">Card description goes here.</p>
  <button style="padding: 12px 24px; background-color: #3b82f6; color: white; border-radius: 8px; font-weight: 500;">
    Click me
  </button>
</div>
\`\`\``,
  inputSchema: createComponentSchema,
  handler: createComponent,
};
