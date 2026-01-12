import { z } from 'zod';
import { getWebSocketServer } from '../websocket';
import type { GetSelectionMessage, ResultMessage, ErrorMessage, SerializedNode } from '../../shared/types';

export const getSelectionSchema = z.object({});

export async function getSelection(): Promise<SerializedNode[]> {
  const ws = getWebSocketServer();

  if (!ws.isConnected()) {
    throw new Error(
      'Figma plugin is not connected. Please:\n' +
      '1. Open Figma\n' +
      '2. Open a design file\n' +
      '3. Run the AI Designer plugin (Plugins > AI Designer)'
    );
  }

  const message: GetSelectionMessage = {
    id: ws.generateId(),
    type: 'get_selection',
  };

  const response = await ws.send<ResultMessage | ErrorMessage>(message);

  if (response.type === 'error') {
    throw new Error(response.payload.message);
  }

  return response.payload as SerializedNode[];
}

export const getSelectionTool = {
  name: 'get_current_selection',
  description: 'Get information about the currently selected nodes in Figma. Returns an array of selected nodes with their properties including id, name, type, position, and dimensions.',
  inputSchema: getSelectionSchema,
  handler: getSelection,
};
