/**
 * Shared types between MCP server and Figma plugin
 */

// WebSocket message types
export type MessageType =
  | 'create_component'
  | 'get_selection'
  | 'list_components'
  | 'update_component'
  | 'get_status'
  | 'result'
  | 'error'
  | 'connected'
  | 'ping'
  | 'pong';

export interface BaseMessage {
  id: string;
  type: MessageType;
}

// Request messages (MCP Server -> Plugin)
export interface CreateComponentMessage extends BaseMessage {
  type: 'create_component';
  payload: {
    elements: ParsedElement[];
    name?: string;
    parentId?: string;
  };
}

export interface GetSelectionMessage extends BaseMessage {
  type: 'get_selection';
}

export interface ListComponentsMessage extends BaseMessage {
  type: 'list_components';
}

export interface UpdateComponentMessage extends BaseMessage {
  type: 'update_component';
  payload: {
    nodeId: string;
    html: string;
  };
}

export interface GetStatusMessage extends BaseMessage {
  type: 'get_status';
}

export interface PingMessage extends BaseMessage {
  type: 'ping';
}

// Response messages (Plugin -> MCP Server)
export interface ResultMessage extends BaseMessage {
  type: 'result';
  payload: unknown;
}

export interface ErrorMessage extends BaseMessage {
  type: 'error';
  payload: {
    message: string;
    code?: string;
  };
}

export interface ConnectedMessage extends BaseMessage {
  type: 'connected';
  payload: {
    pluginVersion: string;
    figmaVersion: string;
  };
}

export interface PongMessage extends BaseMessage {
  type: 'pong';
}

export type RequestMessage =
  | CreateComponentMessage
  | GetSelectionMessage
  | ListComponentsMessage
  | UpdateComponentMessage
  | GetStatusMessage
  | PingMessage;

export type ResponseMessage =
  | ResultMessage
  | ErrorMessage
  | ConnectedMessage
  | PongMessage;

export type Message = RequestMessage | ResponseMessage;

// Figma node representation for serialization
export interface SerializedNode {
  id: string;
  name: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: SerializedNode[];
}

// HTML to Figma conversion types
export interface ParsedStyle {
  // Layout
  display?: 'flex' | 'inline-flex' | 'block' | 'inline' | 'inline-block' | 'none';
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  gap?: number;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | 'auto';
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  order?: number;

  // Positioning
  position?: 'static' | 'relative' | 'absolute' | 'fixed';
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  zIndex?: number;

  // Sizing
  width?: number | 'auto' | 'fill';
  height?: number | 'auto' | 'fill';
  heightPercent?: number; // percentage value (e.g., 45 for 45%)
  aspectRatio?: number; // width/height ratio (e.g., 1 for square, 16/9 for widescreen)
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;

  // Spacing
  padding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  margin?: number;
  marginTop?: number | 'auto';
  marginRight?: number | 'auto';
  marginBottom?: number | 'auto';
  marginLeft?: number | 'auto';

  // Background
  backgroundColor?: RGBA;
  backgroundImage?: string;
  backgroundGradient?: LinearGradient;
  backgroundRadialGradient?: RadialGradient;

  // Border
  borderRadius?: number;
  borderRadiusPercent?: number; // percentage value (e.g., 50 for 50% = circle)
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderWidth?: number;
  borderTopWidth?: number;
  borderRightWidth?: number;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  borderColor?: RGBA;
  borderTopColor?: RGBA;
  borderRightColor?: RGBA;
  borderBottomColor?: RGBA;
  borderLeftColor?: RGBA;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';

  // Text
  color?: RGBA;
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic' | 'oblique';
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  letterSpacing?: number;
  textDecoration?: 'none' | 'underline' | 'line-through';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  whiteSpace?: 'normal' | 'nowrap' | 'pre' | 'pre-wrap' | 'pre-line';
  textOverflow?: 'clip' | 'ellipsis';

  // Effects
  opacity?: number;
  boxShadow?: BoxShadow[];
  textShadow?: BoxShadow[];
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
  visibility?: 'visible' | 'hidden';
  filter?: {
    blur?: number;
    brightness?: number;
    contrast?: number;
    saturate?: number;
  };
  backdropFilter?: {
    blur?: number;
  };

  // Transform
  rotation?: number; // degrees
  translateX?: number;
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number; // degrees
  skewY?: number; // degrees

  // Flex wrap (for grid-like layouts)
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface BoxShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: RGBA;
  inset?: boolean;
}

export interface GradientStop {
  position: number; // 0-1
  color: RGBA;
}

export interface LinearGradient {
  angle: number; // degrees (e.g., 135 for 135deg)
  stops: GradientStop[];
}

export interface RadialGradient {
  shape: 'circle' | 'ellipse';
  centerX: number; // 0-1 (default 0.5)
  centerY: number; // 0-1 (default 0.5)
  stops: GradientStop[];
}

export interface ParsedElement {
  tagName: string;
  styles: ParsedStyle;
  textContent?: string;
  attributes: Record<string, string>;
  children: ParsedElement[];
}

// Component creation result
export interface ComponentCreationResult {
  nodeId: string;
  name: string;
  width: number;
  height: number;
}

// Plugin status
export interface PluginStatus {
  connected: boolean;
  documentName?: string;
  pageName?: string;
  selectionCount?: number;
}
