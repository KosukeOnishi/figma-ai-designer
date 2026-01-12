/**
 * HTML to Figma conversion parser (MCP Server side)
 * Uses node-html-parser for Node.js environment
 */

import { parse, HTMLElement, TextNode } from 'node-html-parser';
import type { ParsedStyle, ParsedElement, RGBA, BoxShadow, LinearGradient, RadialGradient, GradientStop } from '../shared/types';

// Helper to convert HSL to RGB
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  // Normalize h to 0-360, s and l to 0-1
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  return {
    r: r + m,
    g: g + m,
    b: b + m,
  };
}

// Helper to parse color strings to RGBA
function parseColor(colorStr: string): RGBA | null {
  if (!colorStr) return null;

  // Handle hex colors
  const hexMatch = colorStr.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
        a: 1,
      };
    } else if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: 1,
      };
    } else if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }

  // Handle rgb/rgba colors
  const rgbMatch = colorStr.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10) / 255,
      g: parseInt(rgbMatch[2], 10) / 255,
      b: parseInt(rgbMatch[3], 10) / 255,
      a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    };
  }

  // Handle hsl/hsla colors
  const hslMatch = colorStr.match(/hsla?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]);
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    const a = hslMatch[4] !== undefined ? parseFloat(hslMatch[4]) : 1;
    const { r, g, b } = hslToRgb(h, s, l);
    return { r, g, b, a };
  }

  // Handle named colors (extended list)
  const namedColors: Record<string, RGBA> = {
    // Basic colors
    white: { r: 1, g: 1, b: 1, a: 1 },
    black: { r: 0, g: 0, b: 0, a: 1 },
    red: { r: 1, g: 0, b: 0, a: 1 },
    green: { r: 0, g: 128/255, b: 0, a: 1 },
    blue: { r: 0, g: 0, b: 1, a: 1 },
    yellow: { r: 1, g: 1, b: 0, a: 1 },
    transparent: { r: 0, g: 0, b: 0, a: 0 },
    // Grays
    gray: { r: 128/255, g: 128/255, b: 128/255, a: 1 },
    grey: { r: 128/255, g: 128/255, b: 128/255, a: 1 },
    silver: { r: 192/255, g: 192/255, b: 192/255, a: 1 },
    darkgray: { r: 169/255, g: 169/255, b: 169/255, a: 1 },
    darkgrey: { r: 169/255, g: 169/255, b: 169/255, a: 1 },
    lightgray: { r: 211/255, g: 211/255, b: 211/255, a: 1 },
    lightgrey: { r: 211/255, g: 211/255, b: 211/255, a: 1 },
    // Common colors
    orange: { r: 1, g: 165/255, b: 0, a: 1 },
    purple: { r: 128/255, g: 0, b: 128/255, a: 1 },
    pink: { r: 1, g: 192/255, b: 203/255, a: 1 },
    brown: { r: 165/255, g: 42/255, b: 42/255, a: 1 },
    cyan: { r: 0, g: 1, b: 1, a: 1 },
    aqua: { r: 0, g: 1, b: 1, a: 1 },
    magenta: { r: 1, g: 0, b: 1, a: 1 },
    fuchsia: { r: 1, g: 0, b: 1, a: 1 },
    lime: { r: 0, g: 1, b: 0, a: 1 },
    teal: { r: 0, g: 128/255, b: 128/255, a: 1 },
    navy: { r: 0, g: 0, b: 128/255, a: 1 },
    maroon: { r: 128/255, g: 0, b: 0, a: 1 },
    olive: { r: 128/255, g: 128/255, b: 0, a: 1 },
    // Extended colors
    coral: { r: 1, g: 127/255, b: 80/255, a: 1 },
    salmon: { r: 250/255, g: 128/255, b: 114/255, a: 1 },
    tomato: { r: 1, g: 99/255, b: 71/255, a: 1 },
    gold: { r: 1, g: 215/255, b: 0, a: 1 },
    khaki: { r: 240/255, g: 230/255, b: 140/255, a: 1 },
    violet: { r: 238/255, g: 130/255, b: 238/255, a: 1 },
    indigo: { r: 75/255, g: 0, b: 130/255, a: 1 },
    plum: { r: 221/255, g: 160/255, b: 221/255, a: 1 },
    orchid: { r: 218/255, g: 112/255, b: 214/255, a: 1 },
    turquoise: { r: 64/255, g: 224/255, b: 208/255, a: 1 },
    skyblue: { r: 135/255, g: 206/255, b: 235/255, a: 1 },
    steelblue: { r: 70/255, g: 130/255, b: 180/255, a: 1 },
    royalblue: { r: 65/255, g: 105/255, b: 225/255, a: 1 },
    slateblue: { r: 106/255, g: 90/255, b: 205/255, a: 1 },
    darkblue: { r: 0, g: 0, b: 139/255, a: 1 },
    lightblue: { r: 173/255, g: 216/255, b: 230/255, a: 1 },
    dodgerblue: { r: 30/255, g: 144/255, b: 255/255, a: 1 },
    forestgreen: { r: 34/255, g: 139/255, b: 34/255, a: 1 },
    seagreen: { r: 46/255, g: 139/255, b: 87/255, a: 1 },
    darkgreen: { r: 0, g: 100/255, b: 0, a: 1 },
    lightgreen: { r: 144/255, g: 238/255, b: 144/255, a: 1 },
    limegreen: { r: 50/255, g: 205/255, b: 50/255, a: 1 },
    crimson: { r: 220/255, g: 20/255, b: 60/255, a: 1 },
    firebrick: { r: 178/255, g: 34/255, b: 34/255, a: 1 },
    darkred: { r: 139/255, g: 0, b: 0, a: 1 },
    hotpink: { r: 1, g: 105/255, b: 180/255, a: 1 },
    deeppink: { r: 1, g: 20/255, b: 147/255, a: 1 },
    chocolate: { r: 210/255, g: 105/255, b: 30/255, a: 1 },
    sienna: { r: 160/255, g: 82/255, b: 45/255, a: 1 },
    tan: { r: 210/255, g: 180/255, b: 140/255, a: 1 },
    wheat: { r: 245/255, g: 222/255, b: 179/255, a: 1 },
    beige: { r: 245/255, g: 245/255, b: 220/255, a: 1 },
    ivory: { r: 1, g: 1, b: 240/255, a: 1 },
    snow: { r: 1, g: 250/255, b: 250/255, a: 1 },
    whitesmoke: { r: 245/255, g: 245/255, b: 245/255, a: 1 },
    aliceblue: { r: 240/255, g: 248/255, b: 1, a: 1 },
    ghostwhite: { r: 248/255, g: 248/255, b: 1, a: 1 },
    lavender: { r: 230/255, g: 230/255, b: 250/255, a: 1 },
    mintcream: { r: 245/255, g: 1, b: 250/255, a: 1 },
  };

  return namedColors[colorStr.toLowerCase()] || null;
}

// Parse calc() expression - handles simple cases like calc(100px - 20px)
function parseCalc(value: string, baseFontSize: number = 16): number | null {
  // Extract content inside calc()
  const calcMatch = value.match(/^calc\s*\(\s*(.+)\s*\)$/i);
  if (!calcMatch) return null;

  const expr = calcMatch[1].trim();

  // Parse simple binary expressions: value1 op value2
  // Supports +, -, *, /
  const binaryMatch = expr.match(/^(-?[\d.]+)(px|em|rem)?\s*([\+\-\*\/])\s*(-?[\d.]+)(px|em|rem)?$/);
  if (binaryMatch) {
    const num1 = parseFloat(binaryMatch[1]);
    const unit1 = binaryMatch[2] || 'px';
    const op = binaryMatch[3];
    const num2 = parseFloat(binaryMatch[4]);
    const unit2 = binaryMatch[5] || 'px';

    // Convert to px
    const val1 = unit1 === 'em' || unit1 === 'rem' ? num1 * baseFontSize : num1;
    const val2 = unit2 === 'em' || unit2 === 'rem' ? num2 * baseFontSize : num2;

    switch (op) {
      case '+': return val1 + val2;
      case '-': return val1 - val2;
      case '*': return val1 * val2;
      case '/': return val2 !== 0 ? val1 / val2 : null;
    }
  }

  // If it's just a simple value inside calc(), parse it
  const simpleVal = parseLength(expr, baseFontSize);
  if (simpleVal !== null) return simpleVal;

  return null;
}

// Parse CSS value with unit to number (px, em, rem -> px)
function parseLength(value: string, baseFontSize: number = 16): number | null {
  if (!value) return null;

  // Check for calc() first
  if (value.toLowerCase().startsWith('calc(')) {
    return parseCalc(value, baseFontSize);
  }

  // Support negative values
  const match = value.match(/^(-?[\d.]+)(px|em|rem|%)?$/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  const unit = match[2] || 'px';

  switch (unit) {
    case 'px':
      return num;
    case 'em':
    case 'rem':
      return num * baseFontSize;
    case '%':
      return null; // Percentages need special handling
    default:
      return num;
  }
}

// Parse box-shadow CSS property
function parseBoxShadow(value: string): BoxShadow[] {
  if (!value || value === 'none') return [];

  const shadows: BoxShadow[] = [];
  // Split by comma, but not commas inside parentheses (for rgba, etc.)
  const parts: string[] = [];
  let current = '';
  let parenDepth = 0;
  for (const char of value) {
    if (char === '(') parenDepth++;
    else if (char === ')') parenDepth--;
    else if (char === ',' && parenDepth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    const inset = part.includes('inset');
    const cleanPart = part.replace('inset', '').trim();

    let color: RGBA = { r: 0, g: 0, b: 0, a: 0.25 };
    let numericPart = cleanPart;

    const rgbMatch = cleanPart.match(/rgba?\s*\([^)]+\)/i);
    if (rgbMatch) {
      const parsed = parseColor(rgbMatch[0]);
      if (parsed) color = parsed;
      numericPart = cleanPart.replace(rgbMatch[0], '').trim();
    } else {
      const tokens = cleanPart.split(/\s+/);
      const lastToken = tokens[tokens.length - 1];
      const parsed = parseColor(lastToken);
      if (parsed) {
        color = parsed;
        tokens.pop();
        numericPart = tokens.join(' ');
      }
    }

    const nums = numericPart.split(/\s+/).map(n => parseLength(n) || 0);
    if (nums.length >= 2) {
      shadows.push({
        offsetX: nums[0],
        offsetY: nums[1],
        blur: nums[2] || 0,
        spread: nums[3] || 0,
        color,
        inset,
      });
    }
  }

  return shadows;
}

// Parse linear-gradient CSS property
function parseLinearGradient(value: string): LinearGradient | null {
  // Find linear-gradient and extract content handling nested parentheses
  const startMatch = value.match(/linear-gradient\s*\(/i);
  if (!startMatch) return null;

  // Find the matching closing parenthesis (handles nested rgba(), etc.)
  let depth = 1;
  const start = startMatch.index! + startMatch[0].length;
  let end = start;
  for (let i = start; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (depth !== 0) return null; // Unmatched parentheses

  const content = value.slice(start, end);

  // Parse angle (e.g., "135deg", "to right", etc.)
  let angle = 180; // Default: top to bottom
  let colorStopsStart = 0;

  // Check for angle in degrees
  const degMatch = content.match(/^(\d+(?:\.\d+)?)\s*deg\s*,/i);
  if (degMatch) {
    angle = parseFloat(degMatch[1]);
    colorStopsStart = degMatch[0].length;
  } else {
    // Check for direction keywords
    const dirMatch = content.match(/^to\s+(top|bottom|left|right|top\s+left|top\s+right|bottom\s+left|bottom\s+right)\s*,/i);
    if (dirMatch) {
      const dir = dirMatch[1].toLowerCase().replace(/\s+/g, ' ');
      const dirAngles: Record<string, number> = {
        'top': 0,
        'right': 90,
        'bottom': 180,
        'left': 270,
        'top right': 45,
        'right top': 45,
        'bottom right': 135,
        'right bottom': 135,
        'bottom left': 225,
        'left bottom': 225,
        'top left': 315,
        'left top': 315,
      };
      angle = dirAngles[dir] ?? 180;
      colorStopsStart = dirMatch[0].length;
    }
  }

  // Parse color stops
  const stopsStr = content.slice(colorStopsStart).trim();
  const stops: GradientStop[] = [];

  // Split by commas, but handle rgba() which contains commas
  const stopParts: string[] = [];
  let parenDepth = 0;
  let current = '';
  for (const char of stopsStr) {
    if (char === '(') parenDepth++;
    else if (char === ')') parenDepth--;

    if (char === ',' && parenDepth === 0) {
      stopParts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) stopParts.push(current.trim());

  for (let i = 0; i < stopParts.length; i++) {
    const part = stopParts[i].trim();
    if (!part) continue;

    // Try to extract color and position
    // Format: "color position" or just "color"
    let colorStr = part;
    let position: number | null = null;

    // Check for percentage at the end
    const posMatch = part.match(/\s+(\d+(?:\.\d+)?)\s*%\s*$/);
    if (posMatch) {
      position = parseFloat(posMatch[1]) / 100;
      // Use the match length to correctly slice off the position
      colorStr = part.slice(0, part.length - posMatch[0].length).trim();
    }

    const color = parseColor(colorStr);
    if (color) {
      // If no position specified, distribute evenly
      if (position === null) {
        position = stopParts.length > 1 ? i / (stopParts.length - 1) : 0;
      }
      stops.push({ position, color });
    }
  }

  if (stops.length < 2) return null;

  return { angle, stops };
}

// Parse radial-gradient CSS property
function parseRadialGradient(value: string): RadialGradient | null {
  // Find radial-gradient and extract content handling nested parentheses
  const startMatch = value.match(/radial-gradient\s*\(/i);
  if (!startMatch) return null;

  // Find the matching closing parenthesis (handles nested rgba(), etc.)
  let depth = 1;
  const start = startMatch.index! + startMatch[0].length;
  let end = start;
  for (let i = start; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (depth !== 0) return null; // Unmatched parentheses

  const content = value.slice(start, end);

  // Default values
  let shape: 'circle' | 'ellipse' = 'ellipse';
  let centerX = 0.5;
  let centerY = 0.5;
  let colorStopsStart = 0;

  // Check for shape and position: "circle at 50% 50%", "ellipse at center", etc.
  // Also handle "circle, color1, color2" without "at" keyword
  const shapeMatch = content.match(/^(circle|ellipse)(?:\s+at\s+([^,]+))?\s*,/i);
  if (shapeMatch) {
    shape = shapeMatch[1].toLowerCase() as 'circle' | 'ellipse';
    colorStopsStart = shapeMatch[0].length;

    // Parse position if present
    if (shapeMatch[2]) {
      const posStr = shapeMatch[2].trim();
      // Handle percentage positions: "50% 50%", "0% 0%", etc.
      const posMatch = posStr.match(/(\d+)%\s+(\d+)%/);
      if (posMatch) {
        centerX = parseInt(posMatch[1], 10) / 100;
        centerY = parseInt(posMatch[2], 10) / 100;
      }
      // Handle keyword positions: "center", "top left", etc.
      else if (posStr.includes('center')) {
        centerX = 0.5;
        centerY = 0.5;
      } else if (posStr.includes('top')) {
        centerY = 0;
      } else if (posStr.includes('bottom')) {
        centerY = 1;
      } else if (posStr.includes('left')) {
        centerX = 0;
      } else if (posStr.includes('right')) {
        centerX = 1;
      }
    }
  }

  // Parse color stops
  const stopsStr = content.slice(colorStopsStart).trim();
  const stops: GradientStop[] = [];

  // Split by commas, but handle rgba() which contains commas
  const stopParts: string[] = [];
  let parenDepth = 0;
  let current = '';
  for (const char of stopsStr) {
    if (char === '(') parenDepth++;
    else if (char === ')') parenDepth--;

    if (char === ',' && parenDepth === 0) {
      stopParts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) stopParts.push(current.trim());

  for (let i = 0; i < stopParts.length; i++) {
    const part = stopParts[i].trim();
    if (!part) continue;

    // Try to extract color and position
    let colorStr = part;
    let position: number | null = null;

    // Check for percentage at the end
    const posMatch = part.match(/\s+(\d+(?:\.\d+)?)\s*%\s*$/);
    if (posMatch) {
      position = parseFloat(posMatch[1]) / 100;
      colorStr = part.slice(0, part.length - posMatch[0].length).trim();
    }

    const color = parseColor(colorStr);
    if (color) {
      // If no position specified, distribute evenly
      if (position === null) {
        position = stopParts.length > 1 ? i / (stopParts.length - 1) : 0;
      }
      stops.push({ position, color });
    }
  }

  if (stops.length < 2) return null;

  return { shape, centerX, centerY, stops };
}

// Parse inline style string to ParsedStyle
function parseInlineStyle(styleStr: string): ParsedStyle {
  const style: ParsedStyle = {};
  if (!styleStr) return style;

  const declarations = styleStr.split(';').map(d => d.trim()).filter(Boolean);

  for (const decl of declarations) {
    const colonIndex = decl.indexOf(':');
    if (colonIndex === -1) continue;

    const prop = decl.slice(0, colonIndex).trim().toLowerCase();
    const value = decl.slice(colonIndex + 1).trim();

    switch (prop) {
      // Layout
      case 'display':
        if (['flex', 'inline-flex', 'block', 'inline', 'inline-block', 'none'].includes(value)) {
          style.display = value as ParsedStyle['display'];
        }
        break;
      case 'flex-direction':
        if (['row', 'column', 'row-reverse', 'column-reverse'].includes(value)) {
          style.flexDirection = value as ParsedStyle['flexDirection'];
        }
        break;
      case 'justify-content':
        const justifyMap: Record<string, ParsedStyle['justifyContent']> = {
          'flex-start': 'flex-start',
          'flex-end': 'flex-end',
          'center': 'center',
          'space-between': 'space-between',
          'space-around': 'space-around',
          'space-evenly': 'space-evenly',
        };
        if (justifyMap[value]) style.justifyContent = justifyMap[value];
        break;
      case 'align-items':
        const alignMap: Record<string, ParsedStyle['alignItems']> = {
          'flex-start': 'flex-start',
          'flex-end': 'flex-end',
          'center': 'center',
          'stretch': 'stretch',
          'baseline': 'baseline',
        };
        if (alignMap[value]) style.alignItems = alignMap[value];
        break;
      case 'gap':
        const gapVal = parseLength(value);
        if (gapVal !== null) style.gap = gapVal;
        break;
      case 'flex':
        // Parse flex shorthand: flex-grow [flex-shrink] [flex-basis]
        // Common patterns: "1", "1 1 auto", "0 0 auto", "none"
        if (value === 'none') {
          style.flexGrow = 0;
          style.flexShrink = 0;
        } else {
          const flexParts = value.split(/\s+/);
          const grow = parseFloat(flexParts[0]);
          if (!isNaN(grow)) style.flexGrow = grow;
        }
        break;
      case 'flex-grow':
        const fg = parseFloat(value);
        if (!isNaN(fg)) style.flexGrow = fg;
        break;
      case 'flex-shrink':
        const fsh = parseFloat(value);
        if (!isNaN(fsh)) style.flexShrink = fsh;
        break;
      case 'flex-basis':
        if (value === 'auto') {
          style.flexBasis = 'auto';
        } else {
          const fb = parseLength(value);
          if (fb !== null) style.flexBasis = fb;
        }
        break;
      case 'align-self':
        if (['auto', 'flex-start', 'flex-end', 'center', 'stretch', 'baseline'].includes(value)) {
          style.alignSelf = value as ParsedStyle['alignSelf'];
        }
        break;
      case 'order':
        const ord = parseInt(value, 10);
        if (!isNaN(ord)) style.order = ord;
        break;

      // Positioning
      case 'position':
        if (['static', 'relative', 'absolute', 'fixed'].includes(value)) {
          style.position = value as ParsedStyle['position'];
        }
        break;
      case 'top':
        const topVal = parseLength(value);
        if (topVal !== null) style.top = topVal;
        break;
      case 'right':
        const rightVal = parseLength(value);
        if (rightVal !== null) style.right = rightVal;
        break;
      case 'bottom':
        const bottomVal = parseLength(value);
        if (bottomVal !== null) style.bottom = bottomVal;
        break;
      case 'left':
        const leftVal = parseLength(value);
        if (leftVal !== null) style.left = leftVal;
        break;
      case 'z-index':
        const zVal = parseInt(value, 10);
        if (!isNaN(zVal)) style.zIndex = zVal;
        break;

      // Sizing
      case 'width':
        if (value === 'auto') style.width = 'auto';
        else if (value === '100%') style.width = 'fill';
        else {
          const w = parseLength(value);
          if (w !== null) style.width = w;
        }
        break;
      case 'height':
        if (value === 'auto') style.height = 'auto';
        else if (value === '100%') style.height = 'fill';
        else {
          // Check for percentage values
          const heightPercentMatch = value.match(/^(\d+(?:\.\d+)?)%$/);
          if (heightPercentMatch) {
            style.heightPercent = parseFloat(heightPercentMatch[1]);
          } else {
            const h = parseLength(value);
            if (h !== null) style.height = h;
          }
        }
        break;
      case 'min-width':
        const minW = parseLength(value);
        if (minW !== null) style.minWidth = minW;
        break;
      case 'min-height':
        const minH = parseLength(value);
        if (minH !== null) style.minHeight = minH;
        break;
      case 'max-width':
        const maxW = parseLength(value);
        if (maxW !== null) style.maxWidth = maxW;
        break;
      case 'max-height':
        const maxH = parseLength(value);
        if (maxH !== null) style.maxHeight = maxH;
        break;
      case 'aspect-ratio':
        // aspect-ratio: 1, 1/1, 16/9, auto, etc.
        if (value !== 'auto') {
          const ratioMatch = value.match(/^([\d.]+)(?:\s*\/\s*([\d.]+))?$/);
          if (ratioMatch) {
            const w = parseFloat(ratioMatch[1]);
            const h = ratioMatch[2] ? parseFloat(ratioMatch[2]) : 1;
            if (!isNaN(w) && !isNaN(h) && h !== 0) {
              style.aspectRatio = w / h;
            }
          }
        }
        break;

      // Padding
      case 'padding':
        const padVals = value.split(/\s+/).map(v => parseLength(v));
        if (padVals.length === 1 && padVals[0] !== null) {
          style.padding = padVals[0];
        } else if (padVals.length === 2) {
          style.paddingTop = padVals[0] ?? 0;
          style.paddingBottom = padVals[0] ?? 0;
          style.paddingLeft = padVals[1] ?? 0;
          style.paddingRight = padVals[1] ?? 0;
        } else if (padVals.length === 3) {
          // 3 values: top, left-right, bottom
          style.paddingTop = padVals[0] ?? 0;
          style.paddingLeft = padVals[1] ?? 0;
          style.paddingRight = padVals[1] ?? 0;
          style.paddingBottom = padVals[2] ?? 0;
        } else if (padVals.length === 4) {
          style.paddingTop = padVals[0] ?? 0;
          style.paddingRight = padVals[1] ?? 0;
          style.paddingBottom = padVals[2] ?? 0;
          style.paddingLeft = padVals[3] ?? 0;
        }
        break;
      case 'padding-top':
        const pt = parseLength(value);
        if (pt !== null) style.paddingTop = pt;
        break;
      case 'padding-right':
        const pr = parseLength(value);
        if (pr !== null) style.paddingRight = pr;
        break;
      case 'padding-bottom':
        const pb = parseLength(value);
        if (pb !== null) style.paddingBottom = pb;
        break;
      case 'padding-left':
        const pl = parseLength(value);
        if (pl !== null) style.paddingLeft = pl;
        break;

      // Margin
      case 'margin':
        const marVals = value.split(/\s+/).map(v => parseLength(v));
        if (marVals.length === 1 && marVals[0] !== null) {
          style.margin = marVals[0];
        } else if (marVals.length >= 2) {
          style.marginTop = marVals[0] ?? 0;
          style.marginRight = marVals[1] ?? 0;
          style.marginBottom = marVals.length > 2 ? marVals[2] ?? 0 : marVals[0] ?? 0;
          style.marginLeft = marVals.length > 3 ? marVals[3] ?? 0 : marVals[1] ?? 0;
        }
        break;
      case 'margin-top':
        if (value === 'auto') {
          style.marginTop = 'auto';
        } else {
          const mt = parseLength(value);
          if (mt !== null) style.marginTop = mt;
        }
        break;
      case 'margin-right':
        if (value === 'auto') {
          style.marginRight = 'auto';
        } else {
          const mr = parseLength(value);
          if (mr !== null) style.marginRight = mr;
        }
        break;
      case 'margin-bottom':
        if (value === 'auto') {
          style.marginBottom = 'auto';
        } else {
          const mb = parseLength(value);
          if (mb !== null) style.marginBottom = mb;
        }
        break;
      case 'margin-left':
        if (value === 'auto') {
          style.marginLeft = 'auto';
        } else {
          const ml = parseLength(value);
          if (ml !== null) style.marginLeft = ml;
        }
        break;

      // Background
      case 'background-color':
        const bgc = parseColor(value);
        if (bgc) style.backgroundColor = bgc;
        break;
      case 'background':
        // Check for gradients first
        if (value.includes('linear-gradient')) {
          const gradient = parseLinearGradient(value);
          if (gradient) style.backgroundGradient = gradient;
        } else if (value.includes('radial-gradient')) {
          const radialGradient = parseRadialGradient(value);
          if (radialGradient) style.backgroundRadialGradient = radialGradient;
        } else {
          const bg = parseColor(value);
          if (bg) style.backgroundColor = bg;
        }
        break;

      // Border
      case 'border-radius':
        // Handle percentage values (e.g., 50% for circles)
        const percentMatch = value.match(/^(\d+)%$/);
        if (percentMatch) {
          style.borderRadiusPercent = parseInt(percentMatch[1], 10);
        } else {
          const brVals = value.split(/\s+/).map(v => parseLength(v));
          if (brVals.length === 1 && brVals[0] !== null) {
            style.borderRadius = brVals[0];
          } else if (brVals.length === 2) {
            // 2 values: top-left/bottom-right, top-right/bottom-left
            style.borderTopLeftRadius = brVals[0] ?? 0;
            style.borderTopRightRadius = brVals[1] ?? 0;
            style.borderBottomRightRadius = brVals[0] ?? 0;
            style.borderBottomLeftRadius = brVals[1] ?? 0;
          } else if (brVals.length === 3) {
            // 3 values: top-left, top-right/bottom-left, bottom-right
            style.borderTopLeftRadius = brVals[0] ?? 0;
            style.borderTopRightRadius = brVals[1] ?? 0;
            style.borderBottomRightRadius = brVals[2] ?? 0;
            style.borderBottomLeftRadius = brVals[1] ?? 0;
          } else if (brVals.length === 4) {
            style.borderTopLeftRadius = brVals[0] ?? 0;
            style.borderTopRightRadius = brVals[1] ?? 0;
            style.borderBottomRightRadius = brVals[2] ?? 0;
            style.borderBottomLeftRadius = brVals[3] ?? 0;
          }
        }
        break;
      case 'border-top-left-radius':
        const btlr = parseLength(value);
        if (btlr !== null) style.borderTopLeftRadius = btlr;
        break;
      case 'border-top-right-radius':
        const btrr = parseLength(value);
        if (btrr !== null) style.borderTopRightRadius = btrr;
        break;
      case 'border-bottom-right-radius':
        const bbrr = parseLength(value);
        if (bbrr !== null) style.borderBottomRightRadius = bbrr;
        break;
      case 'border-bottom-left-radius':
        const bblr = parseLength(value);
        if (bblr !== null) style.borderBottomLeftRadius = bblr;
        break;
      case 'border-width':
        const bw = parseLength(value);
        if (bw !== null) style.borderWidth = bw;
        break;
      case 'border-color':
        const bc = parseColor(value);
        if (bc) style.borderColor = bc;
        break;
      case 'border-style':
        if (['solid', 'dashed', 'dotted', 'none'].includes(value)) {
          style.borderStyle = value as ParsedStyle['borderStyle'];
        }
        break;
      case 'border': {
        // Extract rgba/rgb function first (contains spaces)
        const colorFuncMatch = value.match(/rgba?\s*\([^)]+\)/i);
        let colorPart = '';
        let restParts = value;
        if (colorFuncMatch) {
          colorPart = colorFuncMatch[0];
          restParts = value.replace(colorPart, '').trim();
          const bcp = parseColor(colorPart);
          if (bcp) style.borderColor = bcp;
        }
        // Parse remaining parts (width, style, hex color)
        const borderParts = restParts.split(/\s+/).filter(Boolean);
        for (const part of borderParts) {
          const bwp = parseLength(part);
          if (bwp !== null) {
            style.borderWidth = bwp;
          } else if (['solid', 'dashed', 'dotted', 'none'].includes(part)) {
            style.borderStyle = part as ParsedStyle['borderStyle'];
          } else if (!colorPart) {
            // Only try to parse color if we didn't find rgba/rgb
            const bcp = parseColor(part);
            if (bcp) style.borderColor = bcp;
          }
        }
        break;
      }
      case 'border-top':
      case 'border-right':
      case 'border-bottom':
      case 'border-left': {
        // Extract rgba/rgb function first (contains spaces)
        const sideColorFuncMatch = value.match(/rgba?\s*\([^)]+\)/i);
        let sideColorPart = '';
        let sideRestParts = value;
        const side = prop.replace('border-', '');
        if (sideColorFuncMatch) {
          sideColorPart = sideColorFuncMatch[0];
          sideRestParts = value.replace(sideColorPart, '').trim();
          const sbc = parseColor(sideColorPart);
          if (sbc) {
            if (side === 'top') style.borderTopColor = sbc;
            else if (side === 'right') style.borderRightColor = sbc;
            else if (side === 'bottom') style.borderBottomColor = sbc;
            else if (side === 'left') style.borderLeftColor = sbc;
          }
        }
        // Parse remaining parts (width, style, hex color)
        const sideBorderParts = sideRestParts.split(/\s+/).filter(Boolean);
        for (const part of sideBorderParts) {
          const sbw = parseLength(part);
          if (sbw !== null) {
            if (side === 'top') style.borderTopWidth = sbw;
            else if (side === 'right') style.borderRightWidth = sbw;
            else if (side === 'bottom') style.borderBottomWidth = sbw;
            else if (side === 'left') style.borderLeftWidth = sbw;
          } else if (!['solid', 'dashed', 'dotted', 'none'].includes(part) && !sideColorPart) {
            const sbc = parseColor(part);
            if (sbc) {
              if (side === 'top') style.borderTopColor = sbc;
              else if (side === 'right') style.borderRightColor = sbc;
              else if (side === 'bottom') style.borderBottomColor = sbc;
              else if (side === 'left') style.borderLeftColor = sbc;
            }
          }
        }
        break;
      }

      // Typography
      case 'color':
        const textColor = parseColor(value);
        if (textColor) style.color = textColor;
        break;
      case 'font-size':
        const fs = parseLength(value);
        if (fs !== null) style.fontSize = fs;
        break;
      case 'font-weight':
        if (value === 'normal') style.fontWeight = 400;
        else if (value === 'bold') style.fontWeight = 700;
        else {
          const fw = parseInt(value, 10);
          if (!isNaN(fw)) style.fontWeight = fw;
        }
        break;
      case 'font-style':
        if (value === 'italic' || value === 'oblique') {
          style.fontStyle = 'italic';
        } else if (value === 'normal') {
          style.fontStyle = 'normal';
        }
        break;
      case 'font-family':
        style.fontFamily = value.replace(/["']/g, '').split(',')[0].trim();
        break;
      case 'text-align':
        if (['left', 'center', 'right', 'justify'].includes(value)) {
          style.textAlign = value as ParsedStyle['textAlign'];
        }
        break;
      case 'line-height':
        // line-height can be unitless (multiplier) or with unit (px, em)
        const lhMatch = value.match(/^([\d.]+)(px|em|rem)?$/);
        if (lhMatch) {
          const num = parseFloat(lhMatch[1]);
          const unit = lhMatch[2];
          if (unit) {
            // Has unit - parse as length
            const lh = parseLength(value);
            if (lh !== null) style.lineHeight = lh;
          } else {
            // Unitless - store as negative to indicate it's a multiplier
            // Will be converted to px in plugin using fontSize * multiplier
            style.lineHeight = -num; // Negative indicates multiplier
          }
        }
        break;
      case 'letter-spacing':
        const ls = parseLength(value);
        if (ls !== null) style.letterSpacing = ls;
        break;
      case 'text-decoration':
        if (['none', 'underline', 'line-through'].includes(value)) {
          style.textDecoration = value as ParsedStyle['textDecoration'];
        }
        break;
      case 'text-transform':
        if (['none', 'uppercase', 'lowercase', 'capitalize'].includes(value)) {
          style.textTransform = value as ParsedStyle['textTransform'];
        }
        break;
      case 'white-space':
        if (['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line'].includes(value)) {
          style.whiteSpace = value as ParsedStyle['whiteSpace'];
        }
        break;
      case 'text-overflow':
        if (['clip', 'ellipsis'].includes(value)) {
          style.textOverflow = value as ParsedStyle['textOverflow'];
        }
        break;

      // Effects
      case 'opacity':
        const op = parseFloat(value);
        if (!isNaN(op)) style.opacity = Math.max(0, Math.min(1, op));
        break;
      case 'box-shadow':
        style.boxShadow = parseBoxShadow(value);
        break;
      case 'text-shadow':
        style.textShadow = parseBoxShadow(value); // Same format as box-shadow
        break;
      case 'visibility':
        if (['visible', 'hidden'].includes(value)) {
          style.visibility = value as ParsedStyle['visibility'];
        }
        break;
      case 'filter': {
        // Parse filter functions: blur(Xpx), brightness(X), etc.
        const filterObj: ParsedStyle['filter'] = {};
        const blurMatch = value.match(/blur\(\s*([\d.]+)px\s*\)/i);
        if (blurMatch) filterObj.blur = parseFloat(blurMatch[1]);
        const brightnessMatch = value.match(/brightness\(\s*([\d.]+)\s*\)/i);
        if (brightnessMatch) filterObj.brightness = parseFloat(brightnessMatch[1]);
        const contrastMatch = value.match(/contrast\(\s*([\d.]+)\s*\)/i);
        if (contrastMatch) filterObj.contrast = parseFloat(contrastMatch[1]);
        const saturateMatch = value.match(/saturate\(\s*([\d.]+)\s*\)/i);
        if (saturateMatch) filterObj.saturate = parseFloat(saturateMatch[1]);
        if (Object.keys(filterObj).length > 0) style.filter = filterObj;
        break;
      }
      case 'backdrop-filter': {
        // Parse backdrop-filter: blur(Xpx)
        const backdropObj: ParsedStyle['backdropFilter'] = {};
        const backdropBlurMatch = value.match(/blur\(\s*([\d.]+)px\s*\)/i);
        if (backdropBlurMatch) backdropObj.blur = parseFloat(backdropBlurMatch[1]);
        if (Object.keys(backdropObj).length > 0) style.backdropFilter = backdropObj;
        break;
      }

      // Transform
      case 'transform':
        // Parse transform functions
        // rotate(Xdeg)
        const rotateMatch = value.match(/rotate\(\s*(-?[\d.]+)\s*deg\s*\)/i);
        if (rotateMatch) {
          style.rotation = parseFloat(rotateMatch[1]);
        }
        // translateX(Xpx)
        const translateXMatch = value.match(/translateX\(\s*(-?[\d.]+)\s*px\s*\)/i);
        if (translateXMatch) {
          style.translateX = parseFloat(translateXMatch[1]);
        }
        // translateY(Xpx)
        const translateYMatch = value.match(/translateY\(\s*(-?[\d.]+)\s*px\s*\)/i);
        if (translateYMatch) {
          style.translateY = parseFloat(translateYMatch[1]);
        }
        // translate(X, Y)
        const translateMatch = value.match(/translate\(\s*(-?[\d.]+)\s*px\s*,\s*(-?[\d.]+)\s*px\s*\)/i);
        if (translateMatch) {
          style.translateX = parseFloat(translateMatch[1]);
          style.translateY = parseFloat(translateMatch[2]);
        }
        // skewX(Xdeg)
        const skewXMatch = value.match(/skewX\(\s*(-?[\d.]+)\s*deg\s*\)/i);
        if (skewXMatch) {
          style.skewX = parseFloat(skewXMatch[1]);
        }
        // skewY(Xdeg)
        const skewYMatch = value.match(/skewY\(\s*(-?[\d.]+)\s*deg\s*\)/i);
        if (skewYMatch) {
          style.skewY = parseFloat(skewYMatch[1]);
        }
        // scale(X) or scale(X, Y)
        const scaleMatch = value.match(/scale\(\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+))?\s*\)/i);
        if (scaleMatch) {
          style.scaleX = parseFloat(scaleMatch[1]);
          style.scaleY = scaleMatch[2] !== undefined ? parseFloat(scaleMatch[2]) : parseFloat(scaleMatch[1]);
        }
        // scaleX(X)
        const scaleXMatch = value.match(/scaleX\(\s*(-?[\d.]+)\s*\)/i);
        if (scaleXMatch) {
          style.scaleX = parseFloat(scaleXMatch[1]);
        }
        // scaleY(Y)
        const scaleYMatch = value.match(/scaleY\(\s*(-?[\d.]+)\s*\)/i);
        if (scaleYMatch) {
          style.scaleY = parseFloat(scaleYMatch[1]);
        }
        break;

      // Flex wrap
      case 'flex-wrap':
        if (['nowrap', 'wrap', 'wrap-reverse'].includes(value)) {
          style.flexWrap = value as ParsedStyle['flexWrap'];
        }
        break;

      // Overflow
      case 'overflow':
      case 'overflow-x':
      case 'overflow-y':
        if (['visible', 'hidden', 'scroll', 'auto'].includes(value)) {
          style.overflow = value as ParsedStyle['overflow'];
        }
        break;
    }
  }

  return style;
}

// Parse element using node-html-parser
function parseElement(element: HTMLElement): ParsedElement {
  const tagName = element.tagName?.toLowerCase() || 'div';
  const styleAttr = element.getAttribute('style') || '';
  const styles = parseInlineStyle(styleAttr);

  // Get attributes
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(element.attributes)) {
    if (key !== 'style') {
      attributes[key] = value;
    }
  }

  // Get text content (direct text nodes only)
  let textContent: string | undefined;
  for (const child of element.childNodes) {
    if (child instanceof TextNode) {
      const text = child.text?.trim();
      if (text) {
        textContent = (textContent || '') + text;
      }
    }
  }

  // Parse children (only HTMLElements, not text nodes)
  const children: ParsedElement[] = [];
  for (const child of element.childNodes) {
    if (child instanceof HTMLElement) {
      children.push(parseElement(child));
    }
  }

  return {
    tagName,
    styles,
    textContent,
    attributes,
    children,
  };
}

// Parse HTML string to ParsedElement array
export function parseHTML(html: string): ParsedElement[] {
  const root = parse(html, {
    lowerCaseTagName: true,
    comment: false,
  });

  const elements: ParsedElement[] = [];

  // Get direct children that are elements
  for (const child of root.childNodes) {
    if (child instanceof HTMLElement) {
      // Skip html, head, body wrapper tags
      if (['html', 'head', 'body'].includes(child.tagName?.toLowerCase())) {
        // Process children of these wrapper tags
        for (const innerChild of child.childNodes) {
          if (innerChild instanceof HTMLElement) {
            elements.push(parseElement(innerChild));
          }
        }
      } else {
        elements.push(parseElement(child));
      }
    }
  }

  return elements;
}
