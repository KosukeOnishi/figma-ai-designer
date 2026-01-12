import { z } from 'zod';
import { getWebSocketServer } from '../websocket';
import type { ListComponentsMessage, ResultMessage, ErrorMessage, SerializedNode } from '../../shared/types';

export const listComponentsSchema = z.object({});

export async function listComponents(): Promise<SerializedNode[]> {
  const ws = getWebSocketServer();

  if (!ws.isConnected()) {
    throw new Error(
      'Figma plugin is not connected. Please:\n' +
      '1. Open Figma\n' +
      '2. Open a design file\n' +
      '3. Run the AI Designer plugin (Plugins > AI Designer)'
    );
  }

  const message: ListComponentsMessage = {
    id: ws.generateId(),
    type: 'list_components',
  };

  const response = await ws.send<ResultMessage | ErrorMessage>(message);

  if (response.type === 'error') {
    throw new Error(response.payload.message);
  }

  return response.payload as SerializedNode[];
}

export const listComponentsTool = {
  name: 'list_components',
  description: 'List all components on the current Figma page. Returns an array of component nodes with their properties.',
  inputSchema: listComponentsSchema,
  handler: listComponents,
};
