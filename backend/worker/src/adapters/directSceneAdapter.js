import { BRANCH_ROLES, SEMANTIC_PALETTE, resolveDiagramStyle, rolePaletteFor } from "./diagramTheme.js";

let idCounter = 0;

function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function resetAdapterIdCounter() {
  idCounter = 0;
}

function wrapText(text, maxCharsPerLine = 26) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function estimateTextMetrics(lines, fontSize) {
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
  const charWidth = fontSize * 0.56;
  const lineHeightPx = fontSize * 1.25;
  return {
    width: Math.max(40, Math.ceil(longest * charWidth)),
    height: Math.max(fontSize * 1.25, Math.ceil(lines.length * lineHeightPx)),
  };
}

function createShape({
  type = "rectangle",
  id = nextId(type === "ellipse" ? "ellipse" : "rect"),
  x,
  y,
  width,
  height,
  backgroundColor = "#ffffff",
  strokeColor = "#1e293b",
  fillStyle = "solid",
  strokeWidth = 2,
  strokeStyle = "solid",
  roughness = 1,
  roundness = { type: 3 },
  groupIds = [],
}) {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor,
    backgroundColor,
    fillStyle,
    strokeWidth,
    strokeStyle,
    roughness,
    opacity: 100,
    groupIds,
    frameId: null,
    roundness: type === "ellipse" ? { type: 2 } : roundness,
    seed: idCounter + 100,
    version: 1,
    versionNonce: idCounter + 1000,
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
  };
}

function createText({
  id = nextId("text"),
  x,
  y,
  width,
  height,
  text,
  fontSize = 18,
  fontFamily = 1,
  strokeColor = "#0f172a",
  textAlign = "center",
  verticalAlign = "middle",
  containerId = null,
  groupIds = [],
}) {
  return {
    id,
    type: "text",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds,
    frameId: null,
    roundness: null,
    seed: idCounter + 200,
    version: 1,
    versionNonce: idCounter + 2000,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    text,
    fontSize,
    fontFamily,
    textAlign,
    verticalAlign,
    containerId,
    originalText: text,
    autoResize: true,
    lineHeight: 1.25,
  };
}

/**
 * Creates a container shape with properly container-bound text so dragging the
 * shape in Excalidraw keeps the label attached inside it.
 */
function createLabeledBox({
  idPrefix,
  shapeType = "rectangle",
  x,
  y,
  minWidth = 180,
  fixedWidth = null,
  minHeight = 54,
  paddingX = 20,
  paddingY = 14,
  label,
  fontSize = 18,
  fontFamily = 1,
  maxCharsPerLine = 24,
  backgroundColor = "#f8fafc",
  strokeColor = "#1e293b",
  textColor = "#0f172a",
  fillStyle = "solid",
  strokeWidth = 2,
  strokeStyle = "solid",
  roughness = 1,
  textAlign = "center",
  verticalAlign = "middle",
}) {
  const lines = wrapText(label, maxCharsPerLine);
  const textContent = lines.join("\n");
  const metrics = estimateTextMetrics(lines, fontSize);
  const width = fixedWidth ?? Math.max(minWidth, metrics.width + paddingX * 2);
  const height = Math.max(minHeight, metrics.height + paddingY * 2);

  const rect = createShape({
    type: shapeType,
    id: nextId(idPrefix),
    x,
    y,
    width,
    height,
    backgroundColor,
    strokeColor,
    fillStyle,
    strokeWidth,
    strokeStyle,
    roughness,
  });

  const textWidth = Math.min(width - paddingX, metrics.width);
  const textX = textAlign === "left" ? x + paddingX : x + (width - textWidth) / 2;
  const textY = y + (height - metrics.height) / 2;

  const textEl = createText({
    id: nextId(`${idPrefix}-lbl`),
    x: textX,
    y: textY,
    width: textWidth,
    height: metrics.height,
    text: textContent,
    fontSize,
    fontFamily,
    strokeColor: textColor,
    textAlign,
    verticalAlign,
    containerId: rect.id,
  });

  rect.boundElements.push({ id: textEl.id, type: "text" });
  return { rect, textEl, width, height };
}

function reparentTextToBox(box, textEl, { align = "center", paddingX = 16 } = {}) {
  textEl.x = align === "left" ? box.x + paddingX : box.x + (box.width - textEl.width) / 2;
  textEl.y = box.y + (box.height - textEl.height) / 2;
}

function connectBoxes({
  fromBox,
  toBox,
  fromSide = "right",
  toSide = "left",
  strokeColor = "#475569",
  strokeWidth = 2,
  roughness = 1,
  fontFamily = 1,
  curved = true,
  label = null,
}) {
  const startX =
    fromSide === "right"
      ? fromBox.x + fromBox.width
      : fromSide === "left"
        ? fromBox.x
        : fromBox.x + fromBox.width / 2;
  const startY =
    fromSide === "bottom"
      ? fromBox.y + fromBox.height
      : fromSide === "top"
        ? fromBox.y
        : fromBox.y + fromBox.height / 2;

  const endX =
    toSide === "left"
      ? toBox.x
      : toSide === "right"
        ? toBox.x + toBox.width
        : toBox.x + toBox.width / 2;
  const endY =
    toSide === "top"
      ? toBox.y
      : toSide === "bottom"
        ? toBox.y + toBox.height
        : toBox.y + toBox.height / 2;

  const dx = endX - startX;
  const dy = endY - startY;
  const arrowId = nextId("arrow");

  const points =
    curved && Math.abs(dy) > 12 && Math.abs(dx) > 24
      ? [
          [0, 0],
          [Math.round(dx * 0.5), Math.round(dy * 0.15)],
          [dx, dy],
        ]
      : [
          [0, 0],
          [dx, dy],
        ];

  const arrow = {
    id: arrowId,
    type: "arrow",
    x: startX,
    y: startY,
    width: Math.max(1, Math.abs(dx)),
    height: Math.max(1, Math.abs(dy)),
    angle: 0,
    strokeColor,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth,
    strokeStyle: "solid",
    roughness,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 2 },
    seed: idCounter + 300,
    version: 1,
    versionNonce: idCounter + 3000,
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    points,
    lastCommittedPoint: null,
    startBinding: { elementId: fromBox.id, focus: 0, gap: 4 },
    endBinding: { elementId: toBox.id, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };

  fromBox.boundElements.push({ id: arrowId, type: "arrow" });
  toBox.boundElements.push({ id: arrowId, type: "arrow" });

  let labelEl = null;
  if (label) {
    const metrics = estimateTextMetrics([label], 13);
    labelEl = createText({
      id: nextId("arrow-lbl"),
      x: startX + dx / 2 - metrics.width / 2,
      y: startY + dy / 2 - metrics.height / 2,
      width: metrics.width,
      height: metrics.height,
      text: label,
      fontSize: 13,
      fontFamily,
      strokeColor: "#334155",
      containerId: arrowId,
    });
    arrow.boundElements.push({ id: labelEl.id, type: "text" });
  }

  return labelEl ? [arrow, labelEl] : [arrow];
}

const BRANCH_ROLE_NAMES = ["branch_a", "branch_b", "branch_d", "branch_c"];

/**
 * Deterministic balanced two-sided mind map layout engine with bound labels,
 * curved organic connectors, central hero card, and semantic branch colors.
 */
export function buildMindmapScene(spec, { visualStyle = "hand_drawn_clean" } = {}) {
  resetAdapterIdCounter();
  const style = resolveDiagramStyle(visualStyle);
  const corePal = rolePaletteFor("core", style);
  const elements = [];

  const branches = spec.branches;
  const mid = Math.ceil(branches.length / 2);
  const rightBranches = branches.slice(0, mid);
  const leftBranches = branches.slice(mid);

  const CHILD_GAP_Y = 20;
  const BRANCH_GAP_Y = 44;
  const HORIZONTAL_GAP = 105;

  function computeSideHeight(sideBranches) {
    let total = 0;
    for (let i = 0; i < sideBranches.length; i++) {
      const childCount = sideBranches[i].children.length;
      total += childCount * 58 + (childCount - 1) * CHILD_GAP_Y;
      if (i < sideBranches.length - 1) total += BRANCH_GAP_Y;
    }
    return total;
  }

  const totalHeight = Math.max(
    220,
    computeSideHeight(rightBranches),
    computeSideHeight(leftBranches)
  );
  const centerY = totalHeight / 2;

  const rootBox = createLabeledBox({
    idPrefix: "mm-root",
    x: 640,
    y: centerY - 40,
    minWidth: 240,
    minHeight: 74,
    label: spec.root.label,
    fontSize: 22,
    fontFamily: style.fontFamily,
    maxCharsPerLine: 20,
    backgroundColor: corePal.fill,
    strokeColor: corePal.stroke,
    textColor: corePal.ink,
    fillStyle: style.headerFillStyle,
    strokeWidth: 3,
    roughness: style.roughness,
  });
  elements.push(rootBox.rect, rootBox.textEl);

  const rootTag = createText({
    id: nextId("mm-root-tag"),
    x: rootBox.rect.x,
    y: rootBox.rect.y - 24,
    width: rootBox.width,
    height: 18,
    text: "CENTRAL TOPIC",
    fontSize: 12,
    fontFamily: style.fontFamily,
    strokeColor: corePal.stroke,
    textAlign: "center",
    verticalAlign: "top",
  });
  elements.push(rootTag);

  function layoutSide(sideBranches, side, paletteOffset = 0) {
    const sideHeight = computeSideHeight(sideBranches);
    let cursorY = centerY - sideHeight / 2;

    for (let bIdx = 0; bIdx < sideBranches.length; bIdx++) {
      const branch = sideBranches[bIdx];
      const roleName = BRANCH_ROLE_NAMES[(bIdx + paletteOffset) % BRANCH_ROLE_NAMES.length];
      const pal = rolePaletteFor(roleName, style);
      const fallbackPal = BRANCH_ROLES[(bIdx + paletteOffset) % BRANCH_ROLES.length];
      const childrenBlockHeight =
        branch.children.length * 58 + (branch.children.length - 1) * CHILD_GAP_Y;
      const branchCenterY = cursorY + childrenBlockHeight / 2;

      const branchTemp = createLabeledBox({
        idPrefix: "mm-branch",
        x: 0,
        y: 0,
        minWidth: 196,
        minHeight: 56,
        label: branch.label,
        fontSize: 18,
        fontFamily: style.fontFamily,
        maxCharsPerLine: 20,
        backgroundColor: pal.fill,
        strokeColor: pal.stroke,
        textColor: pal.ink,
        fillStyle: style.fillStyle,
        strokeWidth: style.strokeWidth,
        roughness: style.roughness,
      });

      const branchX =
        side === "right"
          ? rootBox.rect.x + rootBox.width + HORIZONTAL_GAP
          : rootBox.rect.x - HORIZONTAL_GAP - branchTemp.width;
      const branchY = branchCenterY - branchTemp.height / 2;

      branchTemp.rect.x = branchX;
      branchTemp.rect.y = branchY;
      reparentTextToBox(branchTemp.rect, branchTemp.textEl);

      elements.push(branchTemp.rect, branchTemp.textEl);
      elements.push(
        ...connectBoxes({
          fromBox: rootBox.rect,
          toBox: branchTemp.rect,
          fromSide: side,
          toSide: side === "right" ? "left" : "right",
          strokeColor: fallbackPal.stroke,
          strokeWidth: 2.5,
          roughness: style.roughness,
          fontFamily: style.fontFamily,
          curved: true,
        })
      );

      let childY = cursorY;
      for (const child of branch.children) {
        const childTemp = createLabeledBox({
          idPrefix: "mm-child",
          x: 0,
          y: 0,
          minWidth: 176,
          minHeight: 48,
          paddingX: 16,
          paddingY: 11,
          label: child.label,
          fontSize: 15,
          fontFamily: style.fontFamily,
          maxCharsPerLine: 24,
          backgroundColor: pal.childFill,
          strokeColor: pal.stroke,
          textColor: pal.ink,
          fillStyle: "solid",
          strokeWidth: 1.5,
          roughness: style.roughness,
        });

        const childX =
          side === "right"
            ? branchX + branchTemp.width + HORIZONTAL_GAP
            : branchX - HORIZONTAL_GAP - childTemp.width;

        childTemp.rect.x = childX;
        childTemp.rect.y = childY;
        reparentTextToBox(childTemp.rect, childTemp.textEl);

        elements.push(childTemp.rect, childTemp.textEl);
        elements.push(
          ...connectBoxes({
            fromBox: branchTemp.rect,
            toBox: childTemp.rect,
            fromSide: side,
            toSide: side === "right" ? "left" : "right",
            strokeColor: fallbackPal.stroke,
            strokeWidth: 1.5,
            roughness: style.roughness,
            fontFamily: style.fontFamily,
            curved: true,
          })
        );

        childY += Math.max(58, childTemp.height) + CHILD_GAP_Y;
      }

      cursorY = childY + BRANCH_GAP_Y - CHILD_GAP_Y;
    }
  }

  layoutSide(rightBranches, "right", 0);
  if (leftBranches.length > 0) {
    layoutSide(leftBranches, "left", rightBranches.length);
  }

  return {
    type: "excalidraw",
    version: 2,
    source: "visualify-direct-mindmap-adapter",
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
    },
    files: {},
  };
}

const COMPARISON_ROLES = ["core", "branch_b", "branch_a", "branch_c"];

/**
 * Deterministic aligned multi-column comparison board with semantic column headers,
 * equalized row heights, center VS divider badge, and Key Takeaway callout banner.
 */
export function buildComparisonScene(spec, { visualStyle = "hand_drawn_clean" } = {}) {
  resetAdapterIdCounter();
  const style = resolveDiagramStyle(visualStyle);
  const calloutPal = SEMANTIC_PALETTE.callout;
  const elements = [];

  const COLUMN_WIDTH = 320;
  const COLUMN_GAP = 56;
  const START_X = 80;
  const TITLE_Y = 48;
  const HEADER_Y = 128;
  const ROW_START_Y = 216;
  const ROW_GAP = 16;

  const totalBoardWidth =
    spec.columns.length * COLUMN_WIDTH + (spec.columns.length - 1) * COLUMN_GAP;

  const titleLines = wrapText(spec.title, 50);
  const titleMetrics = estimateTextMetrics(titleLines, 26);
  const titleEl = createText({
    id: nextId("cmp-title"),
    x: START_X + (totalBoardWidth - titleMetrics.width) / 2,
    y: TITLE_Y,
    width: titleMetrics.width,
    height: titleMetrics.height,
    text: titleLines.join("\n"),
    fontSize: 26,
    fontFamily: style.fontFamily,
    strokeColor: "#0f172a",
  });
  elements.push(titleEl);

  // Equalize row heights across columns so comparable attributes align horizontally.
  const maxItems = Math.max(...spec.columns.map((c) => c.items.length));
  const rowHeights = [];
  for (let rowIdx = 0; rowIdx < maxItems; rowIdx++) {
    let maxH = 70;
    for (const col of spec.columns) {
      const item = col.items[rowIdx];
      if (!item) continue;
      const lines = wrapText(`${item.label}\n${item.value}`, 32);
      const metrics = estimateTextMetrics(lines, 15);
      maxH = Math.max(maxH, metrics.height + 28);
    }
    rowHeights.push(maxH);
  }

  for (let colIdx = 0; colIdx < spec.columns.length; colIdx++) {
    const col = spec.columns[colIdx];
    const roleName = COMPARISON_ROLES[colIdx % COMPARISON_ROLES.length];
    const pal = rolePaletteFor(roleName, style);
    const colX = START_X + colIdx * (COLUMN_WIDTH + COLUMN_GAP);

    const headerBox = createLabeledBox({
      idPrefix: "cmp-hdr",
      x: colX,
      y: HEADER_Y,
      fixedWidth: COLUMN_WIDTH,
      minHeight: 62,
      label: col.title,
      fontSize: 20,
      fontFamily: style.fontFamily,
      maxCharsPerLine: 26,
      backgroundColor: pal.fill,
      strokeColor: pal.stroke,
      textColor: pal.ink,
      fillStyle: style.headerFillStyle,
      strokeWidth: 2.5,
      roughness: style.roughness,
    });
    elements.push(headerBox.rect, headerBox.textEl);

    if (colIdx < spec.columns.length - 1) {
      const dividerX = colX + COLUMN_WIDTH + COLUMN_GAP / 2;
      const vsBox = createLabeledBox({
        idPrefix: "cmp-vs",
        shapeType: "ellipse",
        x: dividerX - 20,
        y: HEADER_Y + 11,
        fixedWidth: 40,
        minHeight: 40,
        paddingX: 4,
        paddingY: 4,
        label: spec.columns.length === 2 ? "VS" : "·",
        fontSize: 13,
        fontFamily: style.fontFamily,
        backgroundColor: calloutPal.fill,
        strokeColor: calloutPal.stroke,
        textColor: calloutPal.ink,
        fillStyle: "solid",
        strokeWidth: 1.5,
        roughness: 0,
      });
      elements.push(vsBox.rect, vsBox.textEl);
    }

    let rowY = ROW_START_Y;
    for (let rowIdx = 0; rowIdx < col.items.length; rowIdx++) {
      const item = col.items[rowIdx];
      const cardHeight = rowHeights[rowIdx];
      const cardText = `${item.label.toUpperCase()}\n${item.value}`;
      const isAlt = rowIdx % 2 === 1;

      const cardBox = createLabeledBox({
        idPrefix: "cmp-row",
        x: colX,
        y: rowY,
        fixedWidth: COLUMN_WIDTH,
        minHeight: cardHeight,
        paddingX: 16,
        paddingY: 12,
        label: cardText,
        fontSize: 15,
        fontFamily: style.fontFamily,
        maxCharsPerLine: 32,
        backgroundColor: isAlt ? "#ffffff" : pal.childFill,
        strokeColor: pal.stroke,
        textColor: pal.ink,
        fillStyle: "solid",
        strokeWidth: 1.5,
        roughness: style.roughness,
        textAlign: "left",
      });
      // Preserve explicit line break between item label and value
      const wrappedValue = wrapText(item.value, 32).join("\n");
      const fullText = `${item.label}:\n${wrappedValue}`;
      const metrics = estimateTextMetrics(fullText.split("\n"), 15);
      cardBox.textEl.text = fullText;
      cardBox.textEl.originalText = fullText;
      cardBox.textEl.height = metrics.height;
      cardBox.textEl.y = rowY + (cardHeight - metrics.height) / 2;

      elements.push(cardBox.rect, cardBox.textEl);
      rowY += cardHeight + ROW_GAP;
    }
  }

  // Bottom "Key Takeaway" callout banner summarizing the comparison
  const rowsBottom = ROW_START_Y + rowHeights.reduce((a, b) => a + b + ROW_GAP, 0);
  const colNames = spec.columns.map((c) => c.title).join(" vs ");
  const firstDim = spec.columns[0]?.items[0]?.label;
  const takeawayLabel = firstDim
    ? `Key Takeaway: Choose between ${colNames} based on ${firstDim.toLowerCase()} and trade-offs above.`
    : `Key Takeaway: Weigh trade-offs across ${colNames}.`;
  const takeawayBox = createLabeledBox({
    idPrefix: "cmp-takeaway",
    x: START_X,
    y: rowsBottom + 8,
    fixedWidth: totalBoardWidth,
    minHeight: 58,
    paddingX: 20,
    paddingY: 12,
    label: takeawayLabel,
    fontSize: 15,
    fontFamily: style.fontFamily,
    maxCharsPerLine: 72,
    backgroundColor: calloutPal.fill,
    strokeColor: calloutPal.stroke,
    textColor: calloutPal.ink,
    fillStyle: "solid",
    strokeWidth: 1.5,
    strokeStyle: "dashed",
    roughness: style.roughness,
  });
  elements.push(takeawayBox.rect, takeawayBox.textEl);

  return {
    type: "excalidraw",
    version: 2,
    source: "visualify-direct-comparison-adapter",
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
    },
    files: {},
  };
}
