/**
 * HTML to Figma conversion
 * Creates Figma nodes from parsed HTML elements (parsing is done on MCP server side)
 */

import type { ParsedStyle, ParsedElement } from '../shared/types';

// Helper to apply text-transform to text content
function applyTextTransform(text: string, transform: ParsedStyle['textTransform']): string {
  if (!transform || transform === 'none') return text;
  switch (transform) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/\b\w/g, char => char.toUpperCase());
    default:
      return text;
  }
}

// Track pending layout sizing styles (can only be applied after node is added to auto-layout parent)
type LayoutSizing = 'FIXED' | 'FILL' | 'HUG';
const pendingLayoutSizing = new WeakMap<FrameNode, {
  horizontal?: LayoutSizing;
  height?: LayoutSizing;
}>();

// Safe helper to set layoutSizingHorizontal (only works if frame is child of auto-layout parent)
function safeSetLayoutSizingHorizontal(frame: FrameNode, value: LayoutSizing): void {
  try {
    frame.layoutSizingHorizontal = value;
  } catch {
    // Silently ignore - frame is not in an auto-layout parent
  }
}

// Safe helper to set layoutSizingVertical (only works if frame is child of auto-layout parent)
function safeSetLayoutSizingVertical(frame: FrameNode, value: LayoutSizing): void {
  try {
    frame.layoutSizingVertical = value;
  } catch {
    // Silently ignore - frame is not in an auto-layout parent
  }
}

// Track intended fixed width for space-between frames (need to restore after children added)
const intendedFixedWidth = new WeakMap<FrameNode, number>();

// Track frames with explicit align-items set (non-stretch)
// CSS default is stretch, but if explicitly set to flex-start/center/flex-end, children should NOT stretch
const explicitAlignItems = new WeakMap<FrameNode, boolean>();

// Track flex-grow values for nested recalculation
const nestedFlexGrowMap = new WeakMap<SceneNode, number>();

// Recalculate nested flex children after parent's width is determined
// This fixes the timing issue where flex:1 children inside a flex:1 parent
// don't know the parent's final width when they're first created
function recalculateNestedFlex(frame: FrameNode, newWidth: number): void {
  if (frame.children.length === 0) return;

  // For HORIZONTAL layouts, recalculate flex-grow children
  if (frame.layoutMode === 'HORIZONTAL') {
    let totalFlexGrow = 0;
    let fixedSize = 0;
    let gapCount = 0;

    for (const child of frame.children) {
      if (child.name === 'spacer' || child.name === 'margin-spacer' || child.name === 'margin-wrapper') continue;
      if (child.name === 'margin-left' || child.name === 'margin-right') continue;

      const flexGrow = nestedFlexGrowMap.get(child);
      if (flexGrow !== undefined && flexGrow > 0) {
        totalFlexGrow += flexGrow;
      } else {
        fixedSize += child.width;
      }
      gapCount++;
    }

    if (totalFlexGrow > 0) {
      const paddingStart = frame.paddingLeft;
      const paddingEnd = frame.paddingRight;
      const totalGaps = gapCount > 1 ? (gapCount - 1) * frame.itemSpacing : 0;
      const availableSpace = newWidth - paddingStart - paddingEnd - fixedSize - totalGaps;

      if (availableSpace > 0) {
        for (const child of frame.children) {
          if (child.name === 'spacer' || child.name === 'margin-spacer' || child.name === 'margin-wrapper') continue;
          if (child.name === 'margin-left' || child.name === 'margin-right') continue;

          const flexGrow = nestedFlexGrowMap.get(child);
          if (flexGrow !== undefined && flexGrow > 0) {
            const proportion = flexGrow / totalFlexGrow;
            const calculatedSize = availableSpace * proportion;

            (child as FrameNode).resize(calculatedSize, child.height);
            safeSetLayoutSizingHorizontal(child as FrameNode, 'FIXED');

            // Recursively process this child
            if ('layoutMode' in child) {
              recalculateNestedFlex(child as FrameNode, calculatedSize);
            }
          }
        }
      }
    }
  }

  // For VERTICAL layouts, update space-between children to fill parent width
  // This fixes the issue where space-between rows inside flex:1 cards don't know the parent width
  if (frame.layoutMode === 'VERTICAL') {
    const paddingStart = frame.paddingLeft;
    const paddingEnd = frame.paddingRight;
    const contentWidth = newWidth - paddingStart - paddingEnd;

    for (const child of frame.children) {
      if (!('layoutMode' in child)) continue;
      if (child.name === 'spacer' || child.name === 'margin-spacer' || child.name === 'margin-wrapper') continue;

      const childFrame = child as FrameNode;

      // If child is HORIZONTAL with SPACE_BETWEEN, it needs to fill parent width
      if (childFrame.layoutMode === 'HORIZONTAL' && childFrame.primaryAxisAlignItems === 'SPACE_BETWEEN') {
        // Resize to fill parent content width
        childFrame.resize(contentWidth, childFrame.height);
        safeSetLayoutSizingHorizontal(childFrame, 'FIXED');
        childFrame.primaryAxisSizingMode = 'FIXED';

        // Force recalculation of space-between layout
        childFrame.primaryAxisAlignItems = 'MIN';
        childFrame.primaryAxisAlignItems = 'SPACE_BETWEEN';
      }
    }
  }

  // For ALL layouts (including VERTICAL), recursively check children
  // This ensures nested HORIZONTAL containers inside VERTICAL parents get recalculated
  for (const child of frame.children) {
    if (!('layoutMode' in child)) continue;
    if (child.name === 'spacer' || child.name === 'margin-spacer' || child.name === 'margin-wrapper') continue;

    const childFrame = child as FrameNode;

    // Skip if this child was just resized by flex-grow calculation above
    const flexGrow = nestedFlexGrowMap.get(child);
    if (flexGrow !== undefined && flexGrow > 0 && frame.layoutMode === 'HORIZONTAL') continue;

    // Pass the child's current width (may have been set during creation or inherited)
    recalculateNestedFlex(childFrame, childFrame.width);
  }
}

// Apply styles to a Figma frame node
export function applyFrameStyles(frame: FrameNode, styles: ParsedStyle, parentWidth?: number): void {
  // Auto Layout
  if (styles.display === 'flex') {
    frame.layoutMode = styles.flexDirection === 'column' || styles.flexDirection === 'column-reverse'
      ? 'VERTICAL'
      : 'HORIZONTAL';

    // Justify content
    switch (styles.justifyContent) {
      case 'flex-start':
        frame.primaryAxisAlignItems = 'MIN';
        break;
      case 'flex-end':
        frame.primaryAxisAlignItems = 'MAX';
        break;
      case 'center':
        frame.primaryAxisAlignItems = 'CENTER';
        break;
      case 'space-between':
      case 'space-around':
      case 'space-evenly':
        // Figma only supports SPACE_BETWEEN, use as approximation
        frame.primaryAxisAlignItems = 'SPACE_BETWEEN';
        // DEBUG: Add info to name (will be updated at end)
        frame.name = `SB parentW=${parentWidth}`;
        break;
    }

    // Align items
    switch (styles.alignItems) {
      case 'flex-start':
        frame.counterAxisAlignItems = 'MIN';
        explicitAlignItems.set(frame, true); // Track that align-items was explicitly set (children should NOT stretch)
        break;
      case 'flex-end':
        frame.counterAxisAlignItems = 'MAX';
        explicitAlignItems.set(frame, true);
        break;
      case 'center':
        frame.counterAxisAlignItems = 'CENTER';
        explicitAlignItems.set(frame, true);
        break;
    }

    // Gap
    if (styles.gap !== undefined) {
      frame.itemSpacing = styles.gap;
    }

    // Flex wrap (must be set after layoutMode)
    if (styles.flexWrap === 'wrap' || styles.flexWrap === 'wrap-reverse') {
      frame.layoutWrap = 'WRAP';
      // For wrap to work, Figma needs primaryAxisSizingMode = FIXED
      // The width will be set later in the sizing section
      frame.primaryAxisSizingMode = 'FIXED';
    }
  }

  // Sizing - account for CSS box-sizing: content-box (default)
  // In CSS content-box, width/height specify content area, padding is added outside
  // In Figma, frame size includes padding, so we need to add padding to width/height
  if (typeof styles.width === 'number') {
    let totalWidth = styles.width;
    // Add padding to width (content-box behavior)
    if (styles.padding !== undefined) {
      totalWidth += styles.padding * 2;
    } else {
      totalWidth += (styles.paddingLeft ?? 0) + (styles.paddingRight ?? 0);
    }
    frame.resize(totalWidth, frame.height);
    // Set fixed sizing for explicit width in auto-layout frames (deferred until added to parent)
    const pending = pendingLayoutSizing.get(frame) || {};
    pending.horizontal = 'FIXED';
    pendingLayoutSizing.set(frame, pending);
    // Also set the frame's own sizing mode to FIXED
    // For VERTICAL layout, width is the counter axis
    // For HORIZONTAL layout, width is the primary axis
    if (frame.layoutMode === 'VERTICAL') {
      frame.counterAxisSizingMode = 'FIXED';
    } else if (frame.layoutMode === 'HORIZONTAL') {
      frame.primaryAxisSizingMode = 'FIXED';
    }
  } else if (styles.width === 'fill') {
    // FILL can only be set after frame is added to an auto-layout parent
    // This will be handled in createFigmaNode after appendChild
    const pending = pendingLayoutSizing.get(frame) || {};
    pending.horizontal = 'FILL';
    pendingLayoutSizing.set(frame, pending);
  } else if (styles.width === 'auto') {
    // HUG can only be set after frame is added to an auto-layout parent
    const pending = pendingLayoutSizing.get(frame) || {};
    pending.horizontal = 'HUG';
    pendingLayoutSizing.set(frame, pending);
  } else if (parentWidth !== undefined && styles.width === undefined) {
    // CSS block elements fill parent width by default
    // BUT NOT for absolute/fixed positioned elements (they size to content)
    // BUT NOT for inline elements (span, a, label, etc.) - they hug content
    // BUT NOT for inline-flex/inline-block/inline display - they hug content
    // EXCEPT: absolute elements with both left AND right should stretch between them
    const isAbsolutePositioned = styles.position === 'absolute' || styles.position === 'fixed';
    const hasLeftAndRight = styles.left !== undefined && styles.right !== undefined;
    const isInlineDisplay = styles.display === 'inline' || styles.display === 'inline-flex' || styles.display === 'inline-block';

    if (!isAbsolutePositioned && !isInlineDisplay) {
      // Regular block elements: fill parent width
      // In CSS, block elements without explicit width take 100% of parent content area
      // Padding is INSIDE this width, not added to it (unlike explicit width with content-box)
      const marginLeft = typeof styles.marginLeft === 'number' ? styles.marginLeft : 0;
      const marginRight = typeof styles.marginRight === 'number' ? styles.marginRight : 0;
      const availableWidth = parentWidth - marginLeft - marginRight;
      if (availableWidth > 0) {
        frame.resize(availableWidth, frame.height);
        // Set FIXED sizing so the frame doesn't expand to hug content (deferred until added to parent)
        const pending = pendingLayoutSizing.get(frame) || {};
        pending.horizontal = 'FIXED';
        pendingLayoutSizing.set(frame, pending);
        // For HORIZONTAL layout, also set primaryAxisSizingMode to FIXED
        if (frame.layoutMode === 'HORIZONTAL') {
          frame.primaryAxisSizingMode = 'FIXED';
          // Store intended width to restore after children are added
          // (Figma may expand frame despite FIXED when children are added)
          if (styles.justifyContent === 'space-between' || styles.justifyContent === 'space-around' || styles.justifyContent === 'space-evenly') {
            intendedFixedWidth.set(frame, availableWidth);
          }
        }
        // DEBUG: Update name if space-between
        if (frame.name.startsWith('SB ')) {
          frame.name = `SB avail=${availableWidth} w=${frame.width} pAS=${frame.primaryAxisSizingMode}`;
        }
      }
    } else if (hasLeftAndRight) {
      // Absolute positioned with both left and right: stretch between constraints
      // NOTE: For left+right constraints, padding is INSIDE the width (not added)
      const availableWidth = parentWidth - (styles.left ?? 0) - (styles.right ?? 0);
      if (availableWidth > 0) {
        frame.resize(availableWidth, frame.height);
      }
    }
    // else: absolute positioned without both left+right -> hug content (default)
  }

  if (typeof styles.height === 'number') {
    let totalHeight = styles.height;
    // Add padding to height (content-box behavior)
    if (styles.padding !== undefined) {
      totalHeight += styles.padding * 2;
    } else {
      totalHeight += (styles.paddingTop ?? 0) + (styles.paddingBottom ?? 0);
    }
    frame.resize(frame.width, totalHeight);
    // Set fixed sizing for explicit height in auto-layout frames (deferred until added to parent)
    const pending = pendingLayoutSizing.get(frame) || {};
    pending.height = 'FIXED';
    pendingLayoutSizing.set(frame, pending);
    // Also set the frame's own sizing mode to FIXED
    // For HORIZONTAL layout, height is the counter axis
    // For VERTICAL layout, height is the primary axis
    if (frame.layoutMode === 'HORIZONTAL') {
      frame.counterAxisSizingMode = 'FIXED';
    } else if (frame.layoutMode === 'VERTICAL') {
      frame.primaryAxisSizingMode = 'FIXED';
    }
  } else if (styles.height === 'fill') {
    // FILL can only be set after frame is added to an auto-layout parent
    // This will be handled in createFigmaNode after appendChild
    const pending = pendingLayoutSizing.get(frame) || {};
    pending.height = 'FILL';
    pendingLayoutSizing.set(frame, pending);
  } else if (styles.height === 'auto') {
    // HUG can only be set after frame is added to an auto-layout parent
    const pending = pendingLayoutSizing.get(frame) || {};
    pending.height = 'HUG';
    pendingLayoutSizing.set(frame, pending);
  }

  // Min/Max size
  if (styles.minWidth !== undefined) frame.minWidth = styles.minWidth;
  if (styles.minHeight !== undefined) frame.minHeight = styles.minHeight;
  if (styles.maxWidth !== undefined) frame.maxWidth = styles.maxWidth;
  if (styles.maxHeight !== undefined) frame.maxHeight = styles.maxHeight;

  // Padding
  if (styles.padding !== undefined) {
    frame.paddingTop = styles.padding;
    frame.paddingRight = styles.padding;
    frame.paddingBottom = styles.padding;
    frame.paddingLeft = styles.padding;
  }
  if (styles.paddingTop !== undefined) frame.paddingTop = styles.paddingTop;
  if (styles.paddingRight !== undefined) frame.paddingRight = styles.paddingRight;
  if (styles.paddingBottom !== undefined) frame.paddingBottom = styles.paddingBottom;
  if (styles.paddingLeft !== undefined) frame.paddingLeft = styles.paddingLeft;

  // Background
  if (styles.backgroundGradient) {
    // Convert CSS angle to Figma gradient transform
    // CSS: 0deg = to top, 90deg = to right, 135deg = to bottom-right
    // Figma uses a 2x3 transform matrix for gradient direction
    const gradient = styles.backgroundGradient;
    const angleRad = (gradient.angle - 90) * (Math.PI / 180); // CSS to Figma angle conversion

    // Calculate gradient transform matrix
    // The transform maps from gradient space (0,0 to 1,1) to the frame
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    // Center the gradient and apply rotation
    const gradientTransform: [[number, number, number], [number, number, number]] = [
      [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
      [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
    ];

    frame.fills = [{
      type: 'GRADIENT_LINEAR',
      gradientStops: gradient.stops.map(stop => ({
        position: stop.position,
        color: {
          r: stop.color.r,
          g: stop.color.g,
          b: stop.color.b,
          a: stop.color.a,
        },
      })),
      gradientTransform,
    }];
  } else if (styles.backgroundRadialGradient) {
    // Radial gradient support
    const gradient = styles.backgroundRadialGradient;

    // Figma radial gradient transform matrix
    // The transform positions and scales the gradient
    // For a centered circle, we use identity-like matrix centered at centerX, centerY
    const cx = gradient.centerX;
    const cy = gradient.centerY;

    // Scale factor for the gradient (1.0 = gradient covers the frame)
    // For radial gradients, we want to cover from center to edges
    const scale = 0.5;

    const gradientTransform: [[number, number, number], [number, number, number]] = [
      [scale, 0, cx - scale * 0.5],
      [0, scale, cy - scale * 0.5]
    ];

    frame.fills = [{
      type: 'GRADIENT_RADIAL',
      gradientStops: gradient.stops.map(stop => ({
        position: stop.position,
        color: {
          r: stop.color.r,
          g: stop.color.g,
          b: stop.color.b,
          a: stop.color.a,
        },
      })),
      gradientTransform,
    }];
  } else if (styles.backgroundColor) {
    frame.fills = [{
      type: 'SOLID',
      color: { r: styles.backgroundColor.r, g: styles.backgroundColor.g, b: styles.backgroundColor.b },
      opacity: styles.backgroundColor.a,
    }];
  }

  // Border radius
  if (styles.borderRadiusPercent !== undefined) {
    // Percentage-based border radius: calculate based on smaller dimension
    const minDimension = Math.min(frame.width, frame.height);
    frame.cornerRadius = (styles.borderRadiusPercent / 100) * minDimension;
  } else if (styles.borderRadius !== undefined) {
    frame.cornerRadius = styles.borderRadius;
  }
  if (styles.borderTopLeftRadius !== undefined) frame.topLeftRadius = styles.borderTopLeftRadius;
  if (styles.borderTopRightRadius !== undefined) frame.topRightRadius = styles.borderTopRightRadius;
  if (styles.borderBottomRightRadius !== undefined) frame.bottomRightRadius = styles.borderBottomRightRadius;
  if (styles.borderBottomLeftRadius !== undefined) frame.bottomLeftRadius = styles.borderBottomLeftRadius;

  // Border
  if (styles.borderWidth && styles.borderStyle !== 'none') {
    frame.strokeWeight = styles.borderWidth;
    frame.strokeAlign = 'INSIDE'; // CSS border is inside the element
    if (styles.borderColor) {
      frame.strokes = [{
        type: 'SOLID',
        color: { r: styles.borderColor.r, g: styles.borderColor.g, b: styles.borderColor.b },
        opacity: styles.borderColor.a,
      }];
    }
    // Dashed border
    if (styles.borderStyle === 'dashed') {
      frame.dashPattern = [styles.borderWidth * 2, styles.borderWidth];
    } else if (styles.borderStyle === 'dotted') {
      frame.dashPattern = [styles.borderWidth, styles.borderWidth];
    }
  }

  // Individual border sides (border-top, border-bottom, etc.)
  const hasIndividualBorders = styles.borderTopWidth !== undefined ||
    styles.borderRightWidth !== undefined ||
    styles.borderBottomWidth !== undefined ||
    styles.borderLeftWidth !== undefined;

  if (hasIndividualBorders) {
    // Determine border color (use individual colors or fall back to general borderColor)
    const topColor = styles.borderTopColor || styles.borderColor || { r: 0.886, g: 0.906, b: 0.925, a: 1 };
    const rightColor = styles.borderRightColor || styles.borderColor || { r: 0.886, g: 0.906, b: 0.925, a: 1 };
    const bottomColor = styles.borderBottomColor || styles.borderColor || { r: 0.886, g: 0.906, b: 0.925, a: 1 };
    const leftColor = styles.borderLeftColor || styles.borderColor || { r: 0.886, g: 0.906, b: 0.925, a: 1 };

    // Use the first defined color for the stroke (Figma only supports one stroke color)
    const strokeColor = styles.borderBottomColor || styles.borderTopColor ||
                        styles.borderLeftColor || styles.borderRightColor ||
                        styles.borderColor || { r: 0.886, g: 0.906, b: 0.925, a: 1 };

    // Set stroke color first
    frame.strokes = [{
      type: 'SOLID',
      color: { r: strokeColor.r, g: strokeColor.g, b: strokeColor.b },
      opacity: strokeColor.a,
    }];

    // CSS border is inside the element
    frame.strokeAlign = 'INSIDE';

    // Set a base strokeWeight first (required before setting individual weights)
    const maxWeight = Math.max(
      styles.borderTopWidth ?? 0,
      styles.borderRightWidth ?? 0,
      styles.borderBottomWidth ?? 0,
      styles.borderLeftWidth ?? 0
    );
    frame.strokeWeight = maxWeight;

    // Now set individual stroke weights (0 means no border on that side)
    frame.strokeTopWeight = styles.borderTopWidth ?? 0;
    frame.strokeRightWeight = styles.borderRightWidth ?? 0;
    frame.strokeBottomWeight = styles.borderBottomWidth ?? 0;
    frame.strokeLeftWeight = styles.borderLeftWidth ?? 0;
  }

  // Opacity
  if (styles.opacity !== undefined) {
    frame.opacity = styles.opacity;
  }

  // Build effects array (box-shadow, filter, backdrop-filter)
  const effects: Effect[] = [];

  // Box shadow
  if (styles.boxShadow && styles.boxShadow.length > 0) {
    for (const shadow of styles.boxShadow) {
      effects.push({
        type: shadow.inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
        color: {
          r: shadow.color.r,
          g: shadow.color.g,
          b: shadow.color.b,
          a: shadow.color.a,
        },
        offset: { x: shadow.offsetX, y: shadow.offsetY },
        radius: shadow.blur,
        spread: shadow.spread,
        visible: true,
        blendMode: 'NORMAL',
      });
    }
  }

  // Filter: blur (layer blur)
  if (styles.filter?.blur !== undefined) {
    effects.push({
      type: 'LAYER_BLUR',
      radius: styles.filter.blur,
      visible: true,
    });
  }

  // Backdrop-filter: blur (background blur)
  if (styles.backdropFilter?.blur !== undefined) {
    effects.push({
      type: 'BACKGROUND_BLUR',
      radius: styles.backdropFilter.blur,
      visible: true,
    });
  }

  if (effects.length > 0) {
    frame.effects = effects;
  }

  // Visibility
  if (styles.visibility === 'hidden') {
    frame.visible = false;
  }

  // Rotation (CSS degrees to Figma degrees)
  if (styles.rotation !== undefined) {
    frame.rotation = -styles.rotation; // CSS positive is clockwise, Figma positive is counter-clockwise
  }

  // Scale transform - resize frame to simulate scale
  // Note: CSS scale doesn't change layout size, but in Figma we resize for practical use
  if (styles.scaleX !== undefined || styles.scaleY !== undefined) {
    const scaleX = styles.scaleX ?? 1;
    const scaleY = styles.scaleY ?? 1;
    const newWidth = frame.width * scaleX;
    const newHeight = frame.height * scaleY;
    frame.resize(newWidth, newHeight);
  }

  // Overflow - set clipsContent
  // In CSS, overflow:hidden clips content including absolutely positioned children
  // In Figma, clipsContent clips everything including children's shadows
  // Always enable clipsContent for overflow:hidden to properly clip absolute children
  if (styles.overflow === 'hidden' || styles.overflow === 'scroll' || styles.overflow === 'auto') {
    frame.clipsContent = true;
  }

  // Text alignment for frames (affects child alignment)
  // In CSS, text-align on a block element centers inline children
  // In Figma, we achieve this by setting alignment on the frame
  if (styles.textAlign) {
    // For frames, set default VERTICAL layout if not already set
    // (block elements stack vertically and text-align affects horizontal positioning)
    if (frame.layoutMode === 'NONE') {
      frame.layoutMode = 'VERTICAL';
      frame.primaryAxisSizingMode = 'AUTO';
      // Use FIXED counter axis - the frame width is already set by resize() above
      frame.counterAxisSizingMode = 'FIXED';
    }

    // Set horizontal alignment based on text-align
    if (frame.layoutMode === 'VERTICAL') {
      // In VERTICAL layout, text-align affects the counter axis (horizontal)
      switch (styles.textAlign) {
        case 'center':
          frame.counterAxisAlignItems = 'CENTER';
          break;
        case 'right':
          frame.counterAxisAlignItems = 'MAX';
          break;
        case 'left':
          frame.counterAxisAlignItems = 'MIN';
          break;
      }
    } else if (frame.layoutMode === 'HORIZONTAL') {
      // In HORIZONTAL layout, text-align affects the primary axis
      switch (styles.textAlign) {
        case 'center':
          frame.primaryAxisAlignItems = 'CENTER';
          break;
        case 'right':
          frame.primaryAxisAlignItems = 'MAX';
          break;
        case 'left':
          frame.primaryAxisAlignItems = 'MIN';
          break;
      }
    }
  }

}

// Apply styles to a Figma text node
export function applyTextStyles(text: TextNode, styles: ParsedStyle): void {
  // Text color
  if (styles.color) {
    text.fills = [{
      type: 'SOLID',
      color: { r: styles.color.r, g: styles.color.g, b: styles.color.b },
      opacity: styles.color.a,
    }];
  }

  // Font size
  if (styles.fontSize !== undefined) {
    text.fontSize = styles.fontSize;
  }

  // Font weight and family (simplified - uses Inter as default)
  const fontFamily = styles.fontFamily || 'Inter';
  let fontStyle = 'Regular';
  const isItalic = styles.fontStyle === 'italic' || styles.fontStyle === 'oblique';
  if (styles.fontWeight) {
    const weight = typeof styles.fontWeight === 'number' ? styles.fontWeight :
      (styles.fontWeight === 'bold' ? 700 : 400);
    if (weight >= 700) fontStyle = isItalic ? 'Bold Italic' : 'Bold';
    else if (weight >= 600) fontStyle = isItalic ? 'Semi Bold Italic' : 'Semi Bold';
    else if (weight >= 500) fontStyle = isItalic ? 'Medium Italic' : 'Medium';
    else if (weight <= 300) fontStyle = isItalic ? 'Light Italic' : 'Light';
    else fontStyle = isItalic ? 'Italic' : 'Regular';
  } else if (isItalic) {
    fontStyle = 'Italic';
  }

  // Try to load the font (async operation wrapped)
  try {
    text.fontName = { family: fontFamily, style: fontStyle };
  } catch {
    // Fallback to Inter if font not available
    text.fontName = { family: 'Inter', style: fontStyle };
  }

  // Text alignment
  if (styles.textAlign) {
    const alignMap: Record<string, TextNode['textAlignHorizontal']> = {
      left: 'LEFT',
      center: 'CENTER',
      right: 'RIGHT',
      justify: 'JUSTIFIED',
    };
    text.textAlignHorizontal = alignMap[styles.textAlign] || 'LEFT';
  }

  // Line height
  if (styles.lineHeight !== undefined) {
    text.lineHeight = { value: styles.lineHeight, unit: 'PIXELS' };
  }

  // Letter spacing
  if (styles.letterSpacing !== undefined) {
    text.letterSpacing = { value: styles.letterSpacing, unit: 'PIXELS' };
  }

  // Text decoration
  if (styles.textDecoration === 'underline') {
    text.textDecoration = 'UNDERLINE';
  } else if (styles.textDecoration === 'line-through') {
    text.textDecoration = 'STRIKETHROUGH';
  }

  // Opacity
  if (styles.opacity !== undefined) {
    text.opacity = styles.opacity;
  }
}

// Create Figma nodes from parsed elements
export async function createFigmaNode(
  element: ParsedElement,
  parent: FrameNode | GroupNode | PageNode,
  parentWidth?: number,
  parentHeight?: number,
  inheritedColor?: { r: number; g: number; b: number; a: number }
): Promise<SceneNode> {
  const { tagName, styles, textContent, children } = element;

  // Determine effective text color (own color or inherited from parent)
  // CSS color property is inherited, so children without explicit color use parent's color
  const effectiveColor = styles.color || inheritedColor;

  // Text elements (only if no children - pure text nodes)
  // EXCEPT: if element has flex properties, create as frame to support layoutGrow
  // EXCEPT: if element has padding/background/border, create as frame to show those styles
  const textTags = ['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'a'];
  const hasFlexProperties = styles.flexGrow !== undefined && styles.flexGrow > 0;
  const hasFrameStyles = styles.padding !== undefined ||
    styles.paddingTop !== undefined || styles.paddingRight !== undefined ||
    styles.paddingBottom !== undefined || styles.paddingLeft !== undefined ||
    styles.backgroundColor !== undefined || styles.backgroundGradient !== undefined ||
    styles.borderRadius !== undefined || styles.borderWidth !== undefined ||
    styles.boxShadow !== undefined;
  if (textTags.includes(tagName) && textContent && children.length === 0 && !hasFlexProperties && !hasFrameStyles) {
    const textNode = figma.createText();

    // Determine font style based on weight and italic
    const fontFamily = styles.fontFamily || 'Inter';
    let fontStyle = 'Regular';
    const isItalic = styles.fontStyle === 'italic' || styles.fontStyle === 'oblique';
    if (styles.fontWeight) {
      const weight = typeof styles.fontWeight === 'number' ? styles.fontWeight :
        (styles.fontWeight === 'bold' ? 700 : 400);
      if (weight >= 700) fontStyle = isItalic ? 'Bold Italic' : 'Bold';
      else if (weight >= 600) fontStyle = isItalic ? 'Semi Bold Italic' : 'Semi Bold';
      else if (weight >= 500) fontStyle = isItalic ? 'Medium Italic' : 'Medium';
      else if (weight <= 300) fontStyle = isItalic ? 'Light Italic' : 'Light';
      else fontStyle = isItalic ? 'Italic' : 'Regular';
    } else if (isItalic) {
      fontStyle = 'Italic';
    }

    // Apply default styles based on tag
    if (tagName.startsWith('h')) {
      fontStyle = isItalic ? 'Bold Italic' : 'Bold';
    }

    // Load and set font BEFORE setting characters
    // Try custom font first, fallback to Inter if not available
    try {
      await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
      textNode.fontName = { family: fontFamily, style: fontStyle };
    } catch {
      // Fallback to Inter with same style
      try {
        await figma.loadFontAsync({ family: 'Inter', style: fontStyle });
        textNode.fontName = { family: 'Inter', style: fontStyle };
      } catch {
        // Final fallback to Inter Regular
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        textNode.fontName = { family: 'Inter', style: 'Regular' };
      }
    }
    // Apply text-transform before setting characters
    const transformedText = applyTextTransform(textContent, styles.textTransform);
    textNode.characters = transformedText;

    // Apply heading sizes
    if (tagName.startsWith('h')) {
      const level = parseInt(tagName[1], 10);
      const sizes = [32, 28, 24, 20, 18, 16];
      textNode.fontSize = sizes[level - 1] || 16;
    }

    // Apply other text styles (color, fontSize, etc.)
    // Use effectiveColor (own color or inherited from parent)
    if (effectiveColor) {
      textNode.fills = [{
        type: 'SOLID',
        color: { r: effectiveColor.r, g: effectiveColor.g, b: effectiveColor.b },
        opacity: effectiveColor.a,
      }];
      // Emojis don't use fill color - apply opacity to node instead
      // Detect emoji: characters with code points > 0x1F000 or surrogate pairs
      const isEmoji = /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]/u.test(textContent);
      if (isEmoji && effectiveColor.a < 1 && styles.opacity === undefined) {
        textNode.opacity = effectiveColor.a;
      }
    }
    if (styles.fontSize !== undefined) {
      textNode.fontSize = styles.fontSize;
    }
    if (styles.textAlign) {
      const alignMap: Record<string, TextNode['textAlignHorizontal']> = {
        left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED',
      };
      textNode.textAlignHorizontal = alignMap[styles.textAlign] || 'LEFT';
    }
    // Apply line-height (use browser default ~1.2 if not specified)
    const fontSize = styles.fontSize ?? 16;
    if (styles.lineHeight !== undefined) {
      if (styles.lineHeight < 0) {
        // Negative value indicates multiplier (e.g., -1.5 means 1.5x font-size)
        textNode.lineHeight = { value: fontSize * Math.abs(styles.lineHeight), unit: 'PIXELS' };
      } else {
        textNode.lineHeight = { value: styles.lineHeight, unit: 'PIXELS' };
      }
    } else {
      // Browser default line-height is approximately 1.2 times font-size
      textNode.lineHeight = { value: fontSize * 1.2, unit: 'PIXELS' };
    }
    if (styles.letterSpacing !== undefined) {
      textNode.letterSpacing = { value: styles.letterSpacing, unit: 'PIXELS' };
    }
    if (styles.opacity !== undefined) {
      textNode.opacity = styles.opacity;
    }

    // Text decoration (underline, strikethrough)
    if (styles.textDecoration === 'underline') {
      textNode.textDecoration = 'UNDERLINE';
    } else if (styles.textDecoration === 'line-through') {
      textNode.textDecoration = 'STRIKETHROUGH';
    }

    // Text shadow (glow effect)
    if (styles.textShadow && styles.textShadow.length > 0) {
      textNode.effects = styles.textShadow.map(shadow => ({
        type: 'DROP_SHADOW' as const,
        color: {
          r: shadow.color.r,
          g: shadow.color.g,
          b: shadow.color.b,
          a: shadow.color.a,
        },
        offset: { x: shadow.offsetX, y: shadow.offsetY },
        radius: shadow.blur,
        spread: shadow.spread || 0,
        visible: true,
        blendMode: 'NORMAL' as const,
      }));
    }

    // Enable text wrapping for text tags when parent has a fixed width
    // BUT: if parent has alignment (CENTER/MAX), keep text at natural width so alignment works
    // AND: if parent has SPACE_BETWEEN, keep text at natural width so distribution works
    // AND: if parent is HORIZONTAL layout, keep text at natural width (children should HUG in horizontal flex)
    // AND: if parent is in HUG mode, keep text at natural width
    const parentFrame = parent as FrameNode;
    const parentHasAlignment = 'counterAxisAlignItems' in parentFrame &&
      (parentFrame.layoutMode === 'VERTICAL' || parentFrame.layoutMode === 'HORIZONTAL') &&
      (parentFrame.counterAxisAlignItems === 'CENTER' || parentFrame.counterAxisAlignItems === 'MAX');
    const parentHasSpaceBetween = 'primaryAxisAlignItems' in parentFrame &&
      parentFrame.primaryAxisAlignItems === 'SPACE_BETWEEN';
    const parentIsHorizontal = 'layoutMode' in parentFrame && parentFrame.layoutMode === 'HORIZONTAL';
    const parentIsHugging = 'layoutSizingHorizontal' in parentFrame &&
      parentFrame.layoutSizingHorizontal === 'HUG';

    // white-space: nowrap prevents text wrapping
    const noWrap = styles.whiteSpace === 'nowrap' || styles.whiteSpace === 'pre';
    const hasEllipsis = styles.textOverflow === 'ellipsis';

    if (hasEllipsis && parentWidth) {
      // For ellipsis to work, text needs fixed width and NONE or HEIGHT resize mode
      textNode.textAutoResize = 'NONE';
      textNode.resize(parentWidth, textNode.height);
      textNode.textTruncation = 'ENDING';
    } else if (parentWidth && !parentHasAlignment && !parentHasSpaceBetween && !parentIsHorizontal && !parentIsHugging && !noWrap) {
      textNode.textAutoResize = 'HEIGHT';
      textNode.resize(parentWidth, textNode.height);
    } else if (noWrap) {
      textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
    }

    parent.appendChild(textNode);
    textNode.name = tagName;

    // Apply rotation to text node
    if (styles.rotation !== undefined) {
      textNode.rotation = -styles.rotation; // CSS positive is clockwise, Figma positive is counter-clockwise
    }

    // Apply translate to text node (adjust position)
    if (styles.translateX !== undefined) {
      textNode.x += styles.translateX;
    }
    if (styles.translateY !== undefined) {
      textNode.y += styles.translateY;
    }

    return textNode;
  }

  // Frame elements (div, section, button, etc.)
  const frame = figma.createFrame();
  frame.name = tagName;

  // Allow content to overflow (CSS default is overflow: visible)
  // This allows shadows and other effects to extend outside the frame
  frame.clipsContent = false;

  // Clear default fill
  frame.fills = [];

  // Set up auto layout - always enable for frames with children or flex display
  const hasChildren = children.length > 0 || textContent;
  const isFlexDisplay = styles.display === 'flex' || styles.display === 'inline-flex';
  if (isFlexDisplay || hasChildren) {
    // Determine layout direction
    // For explicit flex: use flex-direction (default row)
    // For non-flex elements with children: use VERTICAL (block behavior in HTML)
    let layoutMode: 'HORIZONTAL' | 'VERTICAL' = 'VERTICAL'; // Default to vertical (block)

    if (isFlexDisplay) {
      // Explicit flex/inline-flex: use flex-direction (default is row = HORIZONTAL)
      const isColumn = styles.flexDirection === 'column' || styles.flexDirection === 'column-reverse';
      layoutMode = isColumn ? 'VERTICAL' : 'HORIZONTAL';
    }
    // Non-flex elements default to VERTICAL (HTML block behavior)

    frame.layoutMode = layoutMode;

    // Default sizing mode - hug content
    frame.primaryAxisSizingMode = 'AUTO';
    frame.counterAxisSizingMode = 'AUTO';
  }

  // Apply all styles
  applyFrameStyles(frame, styles, parentWidth);

  // Handle percentage height (needs parent height)
  if (styles.heightPercent !== undefined && parentHeight !== undefined) {
    const calculatedHeight = (styles.heightPercent / 100) * parentHeight;
    frame.resize(frame.width, calculatedHeight);
    // Set FIXED sizing (deferred until added to parent)
    const pending = pendingLayoutSizing.get(frame) || {};
    pending.height = 'FIXED';
    pendingLayoutSizing.set(frame, pending);
  }

  // Handle aspect-ratio (calculate height based on width)
  // aspect-ratio: 1 means height = width (square)
  // aspect-ratio: 16/9 means height = width / (16/9) = width * 9/16
  if (styles.aspectRatio !== undefined && styles.aspectRatio > 0) {
    // For width: 'fill' (100%), the frame.width is not yet set correctly
    // because FILL is applied after appendChild. Use parentWidth instead.
    let effectiveWidth = frame.width;
    if (styles.width === 'fill' && parentWidth !== undefined) {
      // For fill width, the element will fill parentWidth
      // Account for padding if content-box (padding is inside the fill area)
      effectiveWidth = parentWidth;
    }
    const calculatedHeight = effectiveWidth / styles.aspectRatio;
    frame.resize(effectiveWidth, calculatedHeight);
    // Set FIXED sizing (deferred until added to parent)
    const pendingAspect = pendingLayoutSizing.get(frame) || {};
    pendingAspect.height = 'FIXED';
    pendingLayoutSizing.set(frame, pendingAspect);
  }

  // Handle buttons with special styling
  if (tagName === 'button') {
    // Ensure button has auto layout for centering
    if (frame.layoutMode === 'NONE') {
      frame.layoutMode = 'HORIZONTAL';
      frame.primaryAxisSizingMode = 'AUTO';
      frame.counterAxisSizingMode = 'AUTO';
    }
    // Center content in button
    frame.primaryAxisAlignItems = 'CENTER';
    frame.counterAxisAlignItems = 'CENTER';

    if (!styles.backgroundColor) {
      frame.fills = [{ type: 'SOLID', color: { r: 0.23, g: 0.51, b: 0.97 } }];
    }
    if (styles.borderRadius === undefined) {
      frame.cornerRadius = 6;
    }
    if (styles.padding === undefined && styles.paddingTop === undefined) {
      frame.paddingTop = 8;
      frame.paddingRight = 16;
      frame.paddingBottom = 8;
      frame.paddingLeft = 16;
    }
  }

  // Handle input elements
  if (tagName === 'input' || tagName === 'textarea') {
    if (!styles.backgroundColor) {
      frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    }
    if (!styles.borderWidth) {
      frame.strokeWeight = 1;
      frame.strokes = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
    }
    if (styles.borderRadius === undefined) {
      frame.cornerRadius = 4;
    }
    if (styles.padding === undefined && styles.paddingTop === undefined) {
      frame.paddingTop = 8;
      frame.paddingRight = 12;
      frame.paddingBottom = 8;
      frame.paddingLeft = 12;
    }
  }

  parent.appendChild(frame);

  // Apply pending layout sizing now that frame is attached to parent
  // layoutSizingHorizontal/Vertical can only be set on children of auto-layout frames
  if ('layoutMode' in parent && parent.layoutMode !== 'NONE') {
    const pending = pendingLayoutSizing.get(frame);
    if (pending?.horizontal) {
      safeSetLayoutSizingHorizontal(frame, pending.horizontal);
    }
    if (pending?.height) {
      safeSetLayoutSizingVertical(frame, pending.height);
    }
  }

  // After adding to parent, apply CSS default align-items: stretch behavior
  // In CSS flexbox, children stretch to fill the cross-axis by default
  // EXCEPT: inline-flex, inline-block, inline elements should NOT fill (they hug content)
  // EXCEPT: absolute/fixed positioned elements don't participate in auto-layout
  // EXCEPT: inline tags (span, a, label) should hug content like inline-block
  const isInlineDisplay = styles.display === 'inline-flex' || styles.display === 'inline-block' || styles.display === 'inline';
  const isAbsolutePositioned = styles.position === 'absolute' || styles.position === 'fixed';
  const inlineTags = ['span', 'a', 'label', 'strong', 'em', 'b', 'i', 'small', 'code'];
  const isInlineTag = inlineTags.includes(tagName);
  const parentHasWrap = 'layoutWrap' in parent && (parent as FrameNode).layoutWrap === 'WRAP';

  if ('layoutMode' in parent && parent.layoutMode !== 'NONE' && !isInlineDisplay && !isAbsolutePositioned && !isInlineTag) {
    if (parent.layoutMode === 'VERTICAL') {
      // Vertical parent: children stretch horizontally (cross-axis)
      // BUT if parent has explicit align-items (flex-start, center, flex-end), don't stretch
      // AND don't override if element needs fixed width for space-between/around/evenly
      const parentHasExplicitAlign = explicitAlignItems.get(parent as FrameNode) || false;
      const needsFixedWidth = styles.justifyContent === 'space-between' ||
                              styles.justifyContent === 'space-around' ||
                              styles.justifyContent === 'space-evenly';
      if (!parentHasExplicitAlign && !needsFixedWidth && (styles.width === undefined || styles.width === 'fill')) {
        safeSetLayoutSizingHorizontal(frame, 'FILL');
      } else if (needsFixedWidth && styles.width === undefined) {
        // Re-apply FIXED sizing after appendChild for space-between/around/evenly
        // (appendChild may reset layoutSizingHorizontal)
        safeSetLayoutSizingHorizontal(frame, 'FIXED');
        frame.primaryAxisSizingMode = 'FIXED';
      }
    } else if (parent.layoutMode === 'HORIZONTAL') {
      // Horizontal parent: children stretch vertically (cross-axis) by default
      // This is CSS flexbox default align-items: stretch behavior
      // Don't override if element has explicit height or heightPercent
      // Don't fill if parent has wrap - let children size naturally for proper wrapping
      // BUT if parent has explicit align-items (flex-start, center, flex-end), don't stretch
      const parentHasExplicitAlign = explicitAlignItems.get(parent as FrameNode) || false;
      if (!parentHasExplicitAlign && (styles.height === undefined || styles.height === 'fill') && styles.heightPercent === undefined && !parentHasWrap) {
        safeSetLayoutSizingVertical(frame, 'FILL');
      }
      // Horizontal parent: children should HUG content on primary axis (horizontal)
      // unless they have explicit width or flex-grow
      if (styles.width === undefined && styles.flexGrow === undefined) {
        safeSetLayoutSizingHorizontal(frame, 'HUG');
      }
    }
  } else if ((isInlineTag || isInlineDisplay) && 'layoutMode' in parent && parent.layoutMode !== 'NONE') {
    // Inline elements should HUG content on both axes (only if parent is auto-layout)
    safeSetLayoutSizingHorizontal(frame, 'HUG');
    safeSetLayoutSizingVertical(frame, 'HUG');
  }

  // Apply flex-grow: allows element to expand to fill available space
  // Figma only supports 0 or 1 for layoutGrow, so we clamp the value
  if (styles.flexGrow !== undefined && styles.flexGrow > 0) {
    frame.layoutGrow = 1; // Figma only supports 0 or 1
    // When flex-grow is set, the element should fill along the primary axis
    // Also fill cross-axis to match CSS align-items: stretch (default behavior)
    // BUT if parent has explicit align-items (flex-start, center, flex-end), don't fill cross-axis
    if ('layoutMode' in parent && parent.layoutMode !== 'NONE') {
      const parentHasExplicitAlign = explicitAlignItems.get(parent as FrameNode) || false;
      if (parent.layoutMode === 'VERTICAL') {
        safeSetLayoutSizingVertical(frame, 'FILL');
        // CSS default: align-items: stretch means fill horizontally too
        // But not if parent has explicit align-items
        if (styles.width === undefined && !parentHasExplicitAlign) {
          // Store the current width before changing to FILL
          // This is needed for correct child layout calculations when this frame is HORIZONTAL
          if (frame.layoutMode === 'HORIZONTAL' && frame.width > 100) {
            intendedFixedWidth.set(frame, frame.width);
          }
          safeSetLayoutSizingHorizontal(frame, 'FILL');
        }
      } else if (parent.layoutMode === 'HORIZONTAL') {
        safeSetLayoutSizingHorizontal(frame, 'FILL');
        // CSS default: align-items: stretch means fill vertically too
        // But don't override if heightPercent is set or parent has explicit align-items
        if (styles.height === undefined && styles.heightPercent === undefined && !parentHasExplicitAlign) {
          safeSetLayoutSizingVertical(frame, 'FILL');
        }
      }
    }
  }

  // Apply align-self: overrides parent's align-items for this element
  if (styles.alignSelf && styles.alignSelf !== 'auto' && 'layoutMode' in parent && parent.layoutMode !== 'NONE') {
    const alignSelfMap: Record<string, 'MIN' | 'CENTER' | 'MAX' | 'STRETCH'> = {
      'flex-start': 'MIN',
      'flex-end': 'MAX',
      'center': 'CENTER',
      'stretch': 'STRETCH',
    };
    const layoutAlign = alignSelfMap[styles.alignSelf];
    if (layoutAlign) {
      frame.layoutAlign = layoutAlign;
      // If align-self is not stretch, set sizing to HUG on the cross-axis
      if (layoutAlign !== 'STRETCH') {
        if ((parent as FrameNode).layoutMode === 'HORIZONTAL') {
          safeSetLayoutSizingVertical(frame, 'HUG');
        } else if ((parent as FrameNode).layoutMode === 'VERTICAL') {
          safeSetLayoutSizingHorizontal(frame, 'HUG');
        }
      }
    }
  }

  // Calculate effective width for children (for text wrapping)
  // In CSS content-box, styles.width IS the content area width, so children can use it directly
  // When no explicit width, element fills parent but children get space minus our padding
  let childParentWidth: number | undefined;

  // Calculate padding for width calculations
  let ourPadding = 0;
  if (styles.padding !== undefined) {
    ourPadding = styles.padding * 2;
  } else {
    ourPadding = (styles.paddingLeft ?? 0) + (styles.paddingRight ?? 0);
  }

  // If this frame is HUG mode, don't pass childParentWidth (children should also HUG)
  const frameIsHugging = frame.layoutSizingHorizontal === 'HUG';

  if (typeof styles.width === 'number') {
    // styles.width is content area in content-box, use it directly
    childParentWidth = styles.width;
  } else if (styles.maxWidth !== undefined) {
    // If max-width is set, use it for text wrapping purposes
    // This ensures text wraps at the max-width boundary
    childParentWidth = styles.maxWidth - ourPadding;
  } else if (parentWidth && !frameIsHugging) {
    // Element fills parentWidth, but children get parentWidth minus our padding
    // This is because our frame takes the full parentWidth, but content area is smaller
    // BUT: if frame is HUG mode, don't pass parent width to children
    childParentWidth = parentWidth - ourPadding;
  }

  // For HORIZONTAL layout, we still need to know the parent width for nested flex calculations
  // The HUG behavior for direct children is handled by layoutSizingHorizontal settings
  // But nested flex:1 children need to know the available space
  // Use frame.width if we have a stored intended width, otherwise use the current frame width
  if (frame.layoutMode === 'HORIZONTAL' && !frameIsHugging) {
    const storedWidth = intendedFixedWidth.get(frame);
    if (storedWidth) {
      childParentWidth = storedWidth - ourPadding;
    } else if (frame.width > 100) {
      // Use actual frame width minus padding
      childParentWidth = frame.width - ourPadding;
    }
    // If frame.width is default (100px or less), keep childParentWidth from earlier calculation
  }

  // Calculate effective height for children (for percentage height calculations)
  let childParentHeight: number | undefined;
  if (typeof styles.height === 'number') {
    childParentHeight = styles.height;
  } else if (parentHeight) {
    childParentHeight = parentHeight;
  }

  // Add text content if present (for frames with text like buttons)
  if (textContent) {
    const textNode = figma.createText();

    // Determine font style based on weight and italic
    const fontFamily = styles.fontFamily || 'Inter';
    let fontStyle = 'Regular';
    const isItalic = styles.fontStyle === 'italic' || styles.fontStyle === 'oblique';
    if (styles.fontWeight) {
      const weight = typeof styles.fontWeight === 'number' ? styles.fontWeight :
        (styles.fontWeight === 'bold' ? 700 : 400);
      if (weight >= 700) fontStyle = isItalic ? 'Bold Italic' : 'Bold';
      else if (weight >= 600) fontStyle = isItalic ? 'Semi Bold Italic' : 'Semi Bold';
      else if (weight >= 500) fontStyle = isItalic ? 'Medium Italic' : 'Medium';
      else fontStyle = isItalic ? 'Italic' : 'Regular';
    } else if (isItalic) {
      fontStyle = 'Italic';
    }

    // Load and set font BEFORE setting characters
    // Try custom font first, fallback to Inter if not available
    try {
      await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
      textNode.fontName = { family: fontFamily, style: fontStyle };
    } catch {
      // Fallback to Inter with same style
      try {
        await figma.loadFontAsync({ family: 'Inter', style: fontStyle });
        textNode.fontName = { family: 'Inter', style: fontStyle };
      } catch {
        // Final fallback to Inter Regular
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        textNode.fontName = { family: 'Inter', style: 'Regular' };
      }
    }
    // Apply text-transform before setting characters
    const frameTransformedText = applyTextTransform(textContent, styles.textTransform);
    textNode.characters = frameTransformedText;

    // Apply text color (use effectiveColor - own color or inherited from parent)
    if (effectiveColor) {
      textNode.fills = [{
        type: 'SOLID',
        color: { r: effectiveColor.r, g: effectiveColor.g, b: effectiveColor.b },
        opacity: effectiveColor.a,
      }];
      // Emojis don't use fill color - apply opacity to node instead
      const isEmoji = /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]/u.test(frameTransformedText);
      if (isEmoji && effectiveColor.a < 1 && styles.opacity === undefined) {
        textNode.opacity = effectiveColor.a;
      }
    } else if (tagName === 'button') {
      textNode.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    }

    if (styles.fontSize) textNode.fontSize = styles.fontSize;

    // Text decoration (underline, strikethrough)
    if (styles.textDecoration === 'underline') {
      textNode.textDecoration = 'UNDERLINE';
    } else if (styles.textDecoration === 'line-through') {
      textNode.textDecoration = 'STRIKETHROUGH';
    }

    // Letter spacing
    if (styles.letterSpacing !== undefined) {
      textNode.letterSpacing = { value: styles.letterSpacing, unit: 'PIXELS' };
    }

    // Line height
    if (styles.lineHeight !== undefined) {
      if (styles.lineHeight < 0) {
        // Negative value indicates a multiplier
        const fontSize = styles.fontSize || 16;
        textNode.lineHeight = { value: fontSize * Math.abs(styles.lineHeight), unit: 'PIXELS' };
      } else {
        textNode.lineHeight = { value: styles.lineHeight, unit: 'PIXELS' };
      }
    }

    // Text shadow (glow effect)
    if (styles.textShadow && styles.textShadow.length > 0) {
      textNode.effects = styles.textShadow.map(shadow => ({
        type: 'DROP_SHADOW' as const,
        color: {
          r: shadow.color.r,
          g: shadow.color.g,
          b: shadow.color.b,
          a: shadow.color.a,
        },
        offset: { x: shadow.offsetX, y: shadow.offsetY },
        radius: shadow.blur,
        spread: shadow.spread || 0,
        visible: true,
        blendMode: 'NORMAL' as const,
      }));
    }

    // Apply text alignment
    if (styles.textAlign) {
      const alignMap: Record<string, TextNode['textAlignHorizontal']> = {
        left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED',
      };
      textNode.textAlignHorizontal = alignMap[styles.textAlign] || 'LEFT';
    }

    // Text wrapping: if frame has a fixed width, allow text to wrap
    // Otherwise, let text expand horizontally
    // Inline tags (span, a, etc.) should NOT wrap text - they hug content
    // white-space: nowrap prevents text wrapping
    const frameIsInlineTag = inlineTags.includes(tagName);
    const frameHasFixedWidth = typeof styles.width === 'number';
    const frameNoWrap = styles.whiteSpace === 'nowrap' || styles.whiteSpace === 'pre';
    const frameHasEllipsis = styles.textOverflow === 'ellipsis';

    // Calculate available width inside the frame (accounting for padding)
    const paddingLeft = styles.paddingLeft ?? styles.padding ?? 0;
    const paddingRight = styles.paddingRight ?? styles.padding ?? 0;
    const availableWidth = frame.width - paddingLeft - paddingRight;

    if (frameHasEllipsis && frameHasFixedWidth && availableWidth > 0) {
      // For ellipsis to work, text needs fixed width and NONE resize mode
      textNode.textAutoResize = 'NONE';
      textNode.resize(availableWidth, textNode.height);
      textNode.textTruncation = 'ENDING';
    } else if (frameHasFixedWidth && !frameIsInlineTag && !frameNoWrap) {
      textNode.textAutoResize = 'HEIGHT';
      if (availableWidth > 0) {
        textNode.resize(availableWidth, textNode.height);
      }
    } else {
      textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
    }

    frame.appendChild(textNode);
    textNode.name = 'text';

    // For text-align: center, also center the text within the frame
    if (styles.textAlign === 'center') {
      if (frame.layoutMode === 'VERTICAL') {
        // In vertical layout, horizontal centering is on counter axis
        frame.counterAxisAlignItems = 'CENTER';
      } else if (frame.layoutMode === 'HORIZONTAL') {
        // In horizontal layout, horizontal centering is on primary axis
        frame.primaryAxisAlignItems = 'CENTER';
      }
    }
  }

  // Separate children into regular and absolute/fixed positioned
  // CSS z-index affects stacking: absolute elements with lower z-index appear behind regular content
  const regularChildren: ParsedElement[] = [];
  const absoluteChildren: { element: ParsedElement; originalIndex: number }[] = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const isAbsolute = child.styles.position === 'absolute' || child.styles.position === 'fixed';

    if (isAbsolute) {
      absoluteChildren.push({ element: child, originalIndex: i });
    } else {
      // Regular children (including position: relative with z-index) maintain DOM order
      // They participate in auto-layout and are stacked above absolute background layers
      regularChildren.push(child);
    }
  }

  // Sort absolute children by z-index (lower z-index first, so higher z-index renders on top)
  // If z-index is the same, maintain original HTML order (later elements on top)
  absoluteChildren.sort((a, b) => {
    const zIndexA = a.element.styles.zIndex ?? 0;
    const zIndexB = b.element.styles.zIndex ?? 0;
    if (zIndexA !== zIndexB) {
      return zIndexA - zIndexB;
    }
    return a.originalIndex - b.originalIndex;
  });

  // Determine where to insert absolute children based on z-index
  // Absolute children with z-index < 1 should appear BEFORE regular content (background layers)
  // Absolute children with z-index >= 1 should appear AFTER regular content (overlay layers)
  // This handles the common pattern: background (z-index: 0 or negative) vs content (z-index: 1+)
  const absoluteBeforeContent: typeof absoluteChildren = [];
  const absoluteAfterContent: typeof absoluteChildren = [];

  for (const absChild of absoluteChildren) {
    const zIndex = absChild.element.styles.zIndex ?? 0;
    if (zIndex < 1) {
      absoluteBeforeContent.push(absChild);
    } else {
      absoluteAfterContent.push(absChild);
    }
  }

  // Track flex-grow values for proportional distribution
  const flexGrowMap = new Map<SceneNode, number>();

  // Track position: relative elements that need offset after layout
  const relativePositionedNodes: { node: SceneNode; styles: ParsedStyle }[] = [];

  // Helper function to create absolute positioned children
  async function createAbsoluteChild(child: ParsedElement) {
    const childNode = await createFigmaNode(child, frame, childParentWidth, childParentHeight, effectiveColor);

    // Set absolute positioning in Figma
    if ('layoutPositioning' in childNode) {
      (childNode as FrameNode).layoutPositioning = 'ABSOLUTE';

      // Position the element based on top/right/bottom/left
      const parentW = frame.width;
      const parentH = frame.height;

      // Handle width stretching for left+right constraints
      const hasLeftAndRight = child.styles.left !== undefined && child.styles.right !== undefined;
      if (hasLeftAndRight && 'resize' in childNode) {
        const calculatedWidth = parentW - (child.styles.left ?? 0) - (child.styles.right ?? 0);
        if (calculatedWidth > 0) {
          (childNode as FrameNode).resize(calculatedWidth, childNode.height);
          safeSetLayoutSizingHorizontal(childNode as FrameNode, 'FIXED');
        }
      }

      // Handle height stretching for top+bottom constraints
      const hasTopAndBottom = child.styles.top !== undefined && child.styles.bottom !== undefined;
      if (hasTopAndBottom && 'resize' in childNode) {
        const calculatedHeight = parentH - (child.styles.top ?? 0) - (child.styles.bottom ?? 0);
        if (calculatedHeight > 0) {
          (childNode as FrameNode).resize(childNode.width, calculatedHeight);
          safeSetLayoutSizingVertical(childNode as FrameNode, 'FIXED');
        }
      }

      const childWidth = childNode.width;
      const childHeight = childNode.height;

      // Calculate x position
      if (child.styles.left !== undefined) {
        childNode.x = child.styles.left;
      } else if (child.styles.right !== undefined) {
        childNode.x = parentW - childWidth - child.styles.right;
      }

      // Calculate y position
      if (child.styles.top !== undefined) {
        childNode.y = child.styles.top;
      } else if (child.styles.bottom !== undefined) {
        childNode.y = parentH - childHeight - child.styles.bottom;
      }

      // Apply translateX/translateY to adjust position
      if (child.styles.translateX !== undefined) {
        childNode.x += child.styles.translateX;
      }
      if (child.styles.translateY !== undefined) {
        childNode.y += child.styles.translateY;
      }

      // Set constraints for responsive behavior
      if ('constraints' in childNode) {
        const constraints: Constraints = {
          horizontal: child.styles.left !== undefined ? 'MIN' :
                      child.styles.right !== undefined ? 'MAX' : 'MIN',
          vertical: child.styles.top !== undefined ? 'MIN' :
                    child.styles.bottom !== undefined ? 'MAX' : 'MIN',
        };
        (childNode as FrameNode).constraints = constraints;
      }
    }
    return childNode;
  }

  // Create absolute positioned children that should appear BEHIND regular content (z-index < 1)
  // These are added first so they appear at the bottom of the stacking order
  for (const { element: child } of absoluteBeforeContent) {
    await createAbsoluteChild(child);
  }

  // Create regular child nodes
  for (const child of regularChildren) {
    // Expand margin shorthand into individual margin properties if not already set
    if (child.styles.margin !== undefined) {
      if (child.styles.marginTop === undefined) child.styles.marginTop = child.styles.margin;
      if (child.styles.marginRight === undefined) child.styles.marginRight = child.styles.margin;
      if (child.styles.marginBottom === undefined) child.styles.marginBottom = child.styles.margin;
      if (child.styles.marginLeft === undefined) child.styles.marginLeft = child.styles.margin;
    }

    // Handle margin-top: auto by inserting a spacer before the element
    // This pushes the element to the bottom in a vertical flex container
    if (child.styles.marginTop === 'auto' && frame.layoutMode === 'VERTICAL') {
      const spacer = figma.createFrame();
      spacer.name = 'spacer';
      spacer.fills = [];
      spacer.layoutMode = 'NONE';
      spacer.resize(1, 1); // Minimal size, will grow
      frame.appendChild(spacer);
      spacer.layoutGrow = 1; // Fill available space
      safeSetLayoutSizingHorizontal(spacer, 'FILL');
    }

    // Handle numeric margin-top by inserting a fixed-height spacer before
    // Only applies in VERTICAL layout - in HORIZONTAL layout, margin-top doesn't affect flow
    if (typeof child.styles.marginTop === 'number' && child.styles.marginTop > 0 && frame.layoutMode === 'VERTICAL') {
      const spacer = figma.createFrame();
      spacer.name = 'margin-spacer';
      spacer.fills = [];
      spacer.resize(1, child.styles.marginTop);
      frame.appendChild(spacer);
      safeSetLayoutSizingHorizontal(spacer, 'FILL');
    }

    // Check for horizontal margins
    const marginLeft = typeof child.styles.marginLeft === 'number' ? child.styles.marginLeft : 0;
    const marginRight = typeof child.styles.marginRight === 'number' ? child.styles.marginRight : 0;
    const hasHorizontalMargin = marginLeft > 0 || marginRight > 0;

    // Handle horizontal margins in HORIZONTAL layout (using spacers directly)
    if (frame.layoutMode === 'HORIZONTAL' && marginLeft > 0) {
      const spacer = figma.createFrame();
      spacer.name = 'margin-left';
      spacer.fills = [];
      spacer.resize(marginLeft, 1);
      frame.appendChild(spacer);
      safeSetLayoutSizingVertical(spacer, 'FILL');
    }

    // For VERTICAL parent with horizontal margins: use wrapper with spacers
    if (frame.layoutMode === 'VERTICAL' && hasHorizontalMargin) {
      // Create a horizontal wrapper to hold margin spacers and the child
      const wrapper = figma.createFrame();
      wrapper.name = 'margin-wrapper';
      wrapper.fills = [];
      wrapper.clipsContent = false; // Allow child shadows to extend beyond
      wrapper.layoutMode = 'HORIZONTAL';
      wrapper.primaryAxisSizingMode = 'FIXED';
      wrapper.counterAxisSizingMode = 'AUTO';
      wrapper.itemSpacing = 0;

      frame.appendChild(wrapper);
      safeSetLayoutSizingHorizontal(wrapper, 'FILL');

      // Add left margin spacer
      if (marginLeft > 0) {
        const leftSpacer = figma.createFrame();
        leftSpacer.name = 'margin-left';
        leftSpacer.fills = [];
        leftSpacer.resize(marginLeft, 1);
        wrapper.appendChild(leftSpacer);
        safeSetLayoutSizingVertical(leftSpacer, 'FILL');
      }

      // Create the child inside the wrapper
      const childWithoutHMargins = { ...child, styles: { ...child.styles } };
      delete childWithoutHMargins.styles.marginLeft;
      delete childWithoutHMargins.styles.marginRight;
      const childNode = await createFigmaNode(childWithoutHMargins, wrapper, childParentWidth ? childParentWidth - marginLeft - marginRight : undefined, childParentHeight, effectiveColor);

      // Child should FILL the remaining space in the wrapper (between margin spacers)
      // This is needed because the wrapper is HORIZONTAL, and by default HORIZONTAL children HUG
      if ('layoutSizingHorizontal' in childNode) {
        safeSetLayoutSizingHorizontal(childNode as FrameNode, 'FILL');
      }

      // Add right margin spacer
      if (marginRight > 0) {
        const rightSpacer = figma.createFrame();
        rightSpacer.name = 'margin-right';
        rightSpacer.fills = [];
        rightSpacer.resize(marginRight, 1);
        wrapper.appendChild(rightSpacer);
        safeSetLayoutSizingVertical(rightSpacer, 'FILL');
      }
    } else if (frame.layoutMode === 'NONE' && hasHorizontalMargin) {
      // For NONE parent with horizontal margins: create child and set x position
      // Width is already calculated in createNodeFromElement considering margins
      const childNode = await createFigmaNode(child, frame, childParentWidth, childParentHeight, effectiveColor);
      // Set x position for left margin
      if (marginLeft > 0) {
        childNode.x = marginLeft;
      }
      // Track flex-grow for proportional distribution
      if (child.styles.flexGrow !== undefined && child.styles.flexGrow > 0) {
        flexGrowMap.set(childNode, child.styles.flexGrow);
        nestedFlexGrowMap.set(childNode, child.styles.flexGrow); // Also track for nested recalculation
      }
    } else {
      const childNode = await createFigmaNode(child, frame, childParentWidth, childParentHeight, effectiveColor);
      // Track flex-grow for proportional distribution
      if (child.styles.flexGrow !== undefined && child.styles.flexGrow > 0) {
        flexGrowMap.set(childNode, child.styles.flexGrow);
        nestedFlexGrowMap.set(childNode, child.styles.flexGrow); // Also track for nested recalculation
      }
      // Track position: relative elements for offset application
      if (child.styles.position === 'relative' &&
          (child.styles.top !== undefined || child.styles.left !== undefined ||
           child.styles.bottom !== undefined || child.styles.right !== undefined)) {
        relativePositionedNodes.push({ node: childNode, styles: child.styles });
      }
    }

    // Handle horizontal margins in HORIZONTAL layout (marginRight - using spacer after)
    if (frame.layoutMode === 'HORIZONTAL' && marginRight > 0) {
      const spacer = figma.createFrame();
      spacer.name = 'margin-right';
      spacer.fills = [];
      spacer.resize(marginRight, 1);
      frame.appendChild(spacer);
      safeSetLayoutSizingVertical(spacer, 'FILL');
    }

    // Handle margin-bottom by inserting a fixed-height spacer after the element
    // This creates space between this element and the next sibling
    // Only applies in VERTICAL layout - in HORIZONTAL layout, margin-bottom doesn't affect flow
    if (typeof child.styles.marginBottom === 'number' && child.styles.marginBottom > 0 && frame.layoutMode === 'VERTICAL') {
      const spacer = figma.createFrame();
      spacer.name = 'margin-spacer';
      spacer.fills = [];
      spacer.resize(1, child.styles.marginBottom);
      frame.appendChild(spacer);
      safeSetLayoutSizingHorizontal(spacer, 'FILL');
    }
  }

  // Apply position: relative offsets
  // CSS position: relative keeps the element in flow but offsets it visually
  // In Figma, we need to:
  // 1. Create a placeholder to maintain flow position
  // 2. Convert the element to ABSOLUTE and apply offset
  for (const { node, styles } of relativePositionedNodes) {
    if ('layoutPositioning' in node && node.parent && 'insertChild' in node.parent) {
      const parent = node.parent as FrameNode;

      // Get position and size BEFORE any changes
      const relTransform = node.relativeTransform;
      const baseX = relTransform[0][2];
      const baseY = relTransform[1][2];
      const nodeWidth = node.width;
      const nodeHeight = node.height;

      // Find the node's index in parent
      const nodeIndex = parent.children.indexOf(node);

      // Create a placeholder to maintain the flow position
      const placeholder = figma.createFrame();
      placeholder.name = 'relative-placeholder';
      placeholder.fills = [];
      placeholder.resize(nodeWidth, nodeHeight);

      // Insert placeholder at the same position
      parent.insertChild(nodeIndex, placeholder);

      // Copy layout sizing from original node
      if ('layoutSizingHorizontal' in node) {
        placeholder.layoutSizingHorizontal = (node as FrameNode).layoutSizingHorizontal;
        placeholder.layoutSizingVertical = (node as FrameNode).layoutSizingVertical;
      }

      // Convert the original node to absolute positioning
      (node as FrameNode).layoutPositioning = 'ABSOLUTE';

      // Apply offsets (negative top moves up, positive left moves right)
      let offsetX = 0;
      let offsetY = 0;

      if (styles.top !== undefined) {
        offsetY = styles.top;
      } else if (styles.bottom !== undefined) {
        offsetY = -styles.bottom;
      }

      if (styles.left !== undefined) {
        offsetX = styles.left;
      } else if (styles.right !== undefined) {
        offsetX = -styles.right;
      }

      // Set position with offset from original flow position
      node.x = baseX + offsetX;
      node.y = baseY + offsetY;

      // Move to front so it renders on top of other elements
      const savedX = node.x;
      const savedY = node.y;
      parent.appendChild(node);
      node.x = savedX;
      node.y = savedY;
    }
  }

  // Create absolute positioned children that should appear ON TOP of regular content (z-index >= 1)
  // These are added last so they appear at the top of the stacking order
  for (const { element: child } of absoluteAfterContent) {
    await createAbsoluteChild(child);
  }

  // Handle flex-grow proportional distribution
  // Figma only supports layoutGrow 0 or 1, so we calculate exact widths for proper ratios
  if (flexGrowMap.size > 0 && frame.layoutMode !== 'NONE') {
    const isHorizontal = frame.layoutMode === 'HORIZONTAL';

    // Calculate total flex-grow units and fixed size
    let totalFlexGrow = 0;
    let fixedSize = 0;
    let gapCount = 0;

    for (const child of frame.children) {
      if ('layoutPositioning' in child && (child as FrameNode).layoutPositioning === 'ABSOLUTE') continue;
      if (child.name === 'spacer' || child.name === 'margin-spacer' || child.name === 'margin-wrapper') continue;
      if (child.name === 'margin-left' || child.name === 'margin-right') continue;

      const flexGrow = flexGrowMap.get(child);
      if (flexGrow !== undefined && flexGrow > 0) {
        totalFlexGrow += flexGrow;
      } else {
        fixedSize += isHorizontal ? child.width : child.height;
      }
      gapCount++;
    }

    if (totalFlexGrow > 0 && gapCount > 1) {
      // Use stored intended width if available (for FILL frames that were set from a known width)
      const storedWidth = intendedFixedWidth.get(frame);
      const containerSize = isHorizontal ? (storedWidth ?? frame.width) : frame.height;
      const paddingStart = isHorizontal ? frame.paddingLeft : frame.paddingTop;
      const paddingEnd = isHorizontal ? frame.paddingRight : frame.paddingBottom;
      const totalGaps = (gapCount - 1) * frame.itemSpacing;
      const availableSpace = containerSize - paddingStart - paddingEnd - fixedSize - totalGaps;

      if (availableSpace > 0) {
        // Distribute space proportionally based on flex-grow values
        for (const [childNode, flexGrow] of flexGrowMap) {
          const proportion = flexGrow / totalFlexGrow;
          const calculatedSize = availableSpace * proportion;

          if (isHorizontal) {
            (childNode as FrameNode).resize(calculatedSize, childNode.height);
            safeSetLayoutSizingHorizontal(childNode as FrameNode, 'FIXED');

            // Recalculate nested flex children now that we know the actual width
            recalculateNestedFlex(childNode as FrameNode, calculatedSize);
          } else {
            (childNode as FrameNode).resize(childNode.width, calculatedSize);
            safeSetLayoutSizingVertical(childNode as FrameNode, 'FIXED');
          }
        }
      }
    }
  }

  // Handle space-around: calculate proper itemSpacing and edge padding
  // space-around = equal space around each item, so edges get half the inter-item space
  if (styles.justifyContent === 'space-around' && frame.layoutMode !== 'NONE') {
    const isHorizontal = frame.layoutMode === 'HORIZONTAL';

    // Calculate total size of non-absolute children
    let totalChildrenSize = 0;
    let childCount = 0;
    for (const child of frame.children) {
      // Skip absolute positioned children and spacers
      if ('layoutPositioning' in child && (child as FrameNode).layoutPositioning === 'ABSOLUTE') continue;
      if (child.name === 'spacer' || child.name === 'margin-spacer' || child.name === 'margin-wrapper') continue;
      if (child.name === 'margin-left' || child.name === 'margin-right') continue;

      totalChildrenSize += isHorizontal ? child.width : child.height;
      childCount++;
    }

    if (childCount > 1) {
      const containerSize = isHorizontal ? frame.width : frame.height;
      const existingPaddingStart = isHorizontal ? frame.paddingLeft : frame.paddingTop;
      const existingPaddingEnd = isHorizontal ? frame.paddingRight : frame.paddingBottom;
      const contentSize = containerSize - existingPaddingStart - existingPaddingEnd;
      const remainingSpace = contentSize - totalChildrenSize;

      if (remainingSpace > 0) {
        // space-around: N items create N portions of space (N-1 between + 2 half at edges)
        const gapSize = remainingSpace / childCount;
        const edgePadding = gapSize / 2;

        // Set itemSpacing and add edge padding
        frame.itemSpacing = gapSize;
        frame.primaryAxisAlignItems = 'MIN';

        if (isHorizontal) {
          frame.paddingLeft = existingPaddingStart + edgePadding;
          frame.paddingRight = existingPaddingEnd + edgePadding;
        } else {
          frame.paddingTop = existingPaddingStart + edgePadding;
          frame.paddingBottom = existingPaddingEnd + edgePadding;
        }
      }
    }
  }

  // Restore intended fixed width for space-between frames
  // Figma may have expanded the frame when children were added
  const storedWidth = intendedFixedWidth.get(frame);
  if (storedWidth !== undefined && frame.width !== storedWidth) {
    frame.resize(storedWidth, frame.height);
    frame.primaryAxisSizingMode = 'FIXED';

    // Force recalculation of space-between layout by toggling alignment
    // This ensures children are repositioned after the resize
    if (frame.primaryAxisAlignItems === 'SPACE_BETWEEN') {
      frame.primaryAxisAlignItems = 'MIN';
      frame.primaryAxisAlignItems = 'SPACE_BETWEEN';
    }

    // DEBUG: Update name
    if (frame.name.startsWith('SB ')) {
      frame.name = `SB RESTORED w=${storedWidth}`;
    }
    intendedFixedWidth.delete(frame);
  }

  return frame;
}
