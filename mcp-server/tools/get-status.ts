import { z } from 'zod';
import { getWebSocketServer } from '../websocket';
import type { GetStatusMessage, ResultMessage, ErrorMessage, PluginStatus } from '../../shared/types';

export const getStatusSchema = z.object({});

export async function getStatus(): Promise<PluginStatus> {
  const ws = getWebSocketServer();

  if (!ws.isConnected()) {
    return {
      connected: false,
    };
  }

  const message: GetStatusMessage = {
    id: ws.generateId(),
    type: 'get_status',
  };

  try {
    const response = await ws.send<ResultMessage | ErrorMessage>(message, 5000);

    if (response.type === 'error') {
      return {
        connected: false,
      };
    }

    return {
      connected: true,
      ...(response.payload as Omit<PluginStatus, 'connected'>),
    };
  } catch {
    return {
      connected: false,
    };
  }
}

export const getStatusTool = {
  name: 'get_plugin_status',
  description: 'Check if the Figma plugin is connected and get information about the current document and page.',
  inputSchema: getStatusSchema,
  handler: getStatus,
};
