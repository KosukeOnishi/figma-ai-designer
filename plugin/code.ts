/**
 * AI Designer - Figma Plugin
 * Main plugin code that handles Figma API operations
 */

import type {
  Message,
  RequestMessage,
  ResultMessage,
  ErrorMessage,
  ConnectedMessage,
  PongMessage,
  SerializedNode,
  PluginStatus,
  ComponentCreationResult,
  ParsedElement,
} from '../shared/types';
import { createFigmaNode, applyFrameStyles, applyTextStyles } from './html-parser';

const PLUGIN_VERSION = '0.1.0';

// Show UI
figma.showUI(__html__, {
  width: 320,
  height: 400,
  title: 'AI Designer',
});

// Serialize a Figma node for transmission
function serializeNode(node: SceneNode): SerializedNode {
  const serialized: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if ('x' in node) serialized.x = node.x;
  if ('y' in node) serialized.y = node.y;
  if ('width' in node) serialized.width = node.width;
  if ('height' in node) serialized.height = node.height;

  if ('children' in node && node.children) {
    serialized.children = node.children.map(child => serializeNode(child as SceneNode));
  }

  return serialized;
}

// Create component from parsed elements (HTML is parsed on MCP server side)
async function handleCreateComponent(payload: {
  elements: ParsedElement[];
  name?: string;
  parentId?: string;
}): Promise<ComponentCreationResult> {
  const { elements, name = 'AI Component', parentId } = payload;

  if (!elements || elements.length === 0) {
    throw new Error('No valid HTML elements found');
  }

  // Determine parent node
  let parent: FrameNode | GroupNode | PageNode = figma.currentPage;
  if (parentId) {
    const parentNode = figma.getNodeById(parentId);
    if (parentNode && ('children' in parentNode)) {
      parent = parentNode as FrameNode | GroupNode;
    }
  }

  // Create root frame for the component
  const rootFrame = figma.createFrame();
  rootFrame.name = name;
  rootFrame.layoutMode = 'VERTICAL';
  rootFrame.primaryAxisSizingMode = 'AUTO';
  rootFrame.counterAxisSizingMode = 'AUTO';
  rootFrame.fills = [];

  // Create nodes from parsed elements
  for (const element of elements) {
    await createFigmaNode(element, rootFrame);
  }

  // Add to parent
  parent.appendChild(rootFrame);

  // Position in viewport
  const viewport = figma.viewport.center;
  rootFrame.x = viewport.x - rootFrame.width / 2;
  rootFrame.y = viewport.y - rootFrame.height / 2;

  // Select and zoom to the new component
  figma.currentPage.selection = [rootFrame];
  figma.viewport.scrollAndZoomIntoView([rootFrame]);

  return {
    nodeId: rootFrame.id,
    name: rootFrame.name,
    width: rootFrame.width,
    height: rootFrame.height,
  };
}

// Get current selection
function handleGetSelection(): SerializedNode[] {
  return figma.currentPage.selection.map(node => serializeNode(node));
}

// List components on current page
function handleListComponents(): SerializedNode[] {
  const components: SerializedNode[] = [];

  function findComponents(node: SceneNode | PageNode) {
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      components.push(serializeNode(node as SceneNode));
    }
    if ('children' in node) {
      for (const child of node.children) {
        findComponents(child as SceneNode);
      }
    }
  }

  findComponents(figma.currentPage);
  return components;
}

// Get plugin status
function handleGetStatus(): PluginStatus {
  return {
    connected: true,
    documentName: figma.root.name,
    pageName: figma.currentPage.name,
    selectionCount: figma.currentPage.selection.length,
  };
}

// Handle messages from UI
figma.ui.onmessage = async (msg: Message) => {
  if (msg.type === 'ping') {
    const response: PongMessage = {
      id: msg.id,
      type: 'pong',
    };
    figma.ui.postMessage(response);
    return;
  }

  if (msg.type === 'connected') {
    console.log('UI connected to MCP server');
    return;
  }

  const request = msg as RequestMessage;
  let response: ResultMessage | ErrorMessage;

  try {
    let result: unknown;

    switch (request.type) {
      case 'create_component':
        result = await handleCreateComponent(request.payload);
        break;
      case 'get_selection':
        result = handleGetSelection();
        break;
      case 'list_components':
        result = handleListComponents();
        break;
      case 'get_status':
        result = handleGetStatus();
        break;
      default:
        throw new Error(`Unknown message type: ${(request as Message).type}`);
    }

    response = {
      id: request.id,
      type: 'result',
      payload: result,
    };
  } catch (error) {
    response = {
      id: request.id,
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }

  figma.ui.postMessage(response);
};

// Send connected message when UI is ready
figma.ui.postMessage({
  type: 'plugin_ready',
  payload: {
    pluginVersion: PLUGIN_VERSION,
    figmaVersion: figma.editorType,
  },
});

// Keep plugin running
// Don't call figma.closePlugin() to maintain connection

// Re-export for inline use
export { createFigmaNode, applyFrameStyles, applyTextStyles };
