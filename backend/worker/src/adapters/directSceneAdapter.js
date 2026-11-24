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

function createRectangle({
  id = nextId("rect"),
  x,
  y,
  width,
  height,
  backgroundColor = "#ffffff",
  strokeColor = "#1e293b",
  fillStyle = "solid",
  strokeWidth = 2,
  roundness = { type: 3 },
  groupIds = [],
}) {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor,
    backgroundColor,
    fillStyle,
    strokeWidth,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds,
    frameId: null,
    roundness,
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
  strokeColor = "#0f172a",
  textAlign = "center",
  verticalAlign = "middle",
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
    roughness: 1,
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
    fontFamily: 1,
    textAlign,
    verticalAlign,
    containerId: null,
    originalText: text,
    autoResize: true,
    lineHeight: 1.25,
  };
}

function createLabeledBox({
  idPrefix,
  x,
  y,
  minWidth = 180,
  paddingX = 20,
  paddingY = 14,
  label,
  fontSize = 18,
  maxCharsPerLine = 24,
  backgroundColor = "#f8fafc",
  strokeColor = "#1e293b",
  textColor = "#0f172a",
}) {
  const lines = wrapText(label, maxCharsPerLine);
  const textContent = lines.join("\n");
  const metrics = estimateTextMetrics(lines, fontSize);
  const width = Math.max(minWidth, metrics.width + paddingX * 2);
  const height = Math.max(54, metrics.height + paddingY * 2);

  const rect = createRectangle({
    id: nextId(idPrefix),
    x,
    y,
    width,
    height,
    backgroundColor,
    strokeColor,
  });

  const textEl = createText({
    id: nextId(`${idPrefix}-lbl`),
    x: x + (width - metrics.width) / 2,
    y: y + (height - metrics.height) / 2,
    width: metrics.width,
    height: metrics.height,
    text: textContent,
    fontSize,
    strokeColor: textColor,
  });

  return { rect, textEl, width, height };
}

function connectBoxes({ fromBox, toBox, fromSide = "right", toSide = "left", strokeColor = "#475569" }) {
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

  const arrow = {
    id: arrowId,
    type: "arrow",
    x: startX,
    y: startY,
    width: Math.abs(dx),
    height: Math.abs(dy),
    angle: 0,
    strokeColor,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 2 },
    seed: idCounter + 300,
    version: 1,
    versionNonce: idCounter + 3000,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    points: [
      [0, 0],
      [dx, dy],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: fromBox.id, focus: 0, gap: 6 },
    endBinding: { elementId: toBox.id, focus: 0, gap: 6 },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };

  fromBox.boundElements.push({ id: arrowId, type: "arrow" });
  toBox.boundElements.push({ id: arrowId, type: "arrow" });
  return arrow;
}

const BRANCH_PALETTE = [
  { bg: "#dbeafe", stroke: "#1d4ed8", childBg: "#eff6ff" },
  { bg: "#dcfce7", stroke: "#15803d", childBg: "#f0fdf4" },
  { bg: "#fef3c7", stroke: "#b45309", childBg: "#fffbeb" },
  { bg: "#fae8ff", stroke: "#86198f", childBg: "#fdf4ff" },
];

/**
 * Deterministic balanced two-sided mind map layout engine.
 */
export function buildMindmapScene(spec) {
  resetAdapterIdCounter();
  const elements = [];

  const branches = spec.branches;
  const mid = Math.ceil(branches.length / 2);
  const rightBranches = branches.slice(0, mid);
  const leftBranches = branches.slice(mid);

  const CHILD_GAP_Y = 18;
  const BRANCH_GAP_Y = 36;
  const HORIZONTAL_GAP = 95;

  function computeSideHeight(sideBranches) {
    let total = 0;
    for (let i = 0; i < sideBranches.length; i++) {
      const childCount = sideBranches[i].children.length;
      total += childCount * 62 + (childCount - 1) * CHILD_GAP_Y;
      if (i < sideBranches.length - 1) total += BRANCH_GAP_Y;
    }
    return total;
  }

  const totalHeight = Math.max(
    180,
    computeSideHeight(rightBranches),
    computeSideHeight(leftBranches)
  );
  const centerY = totalHeight / 2;

  const rootBox = createLabeledBox({
    idPrefix: "mm-root",
    x: 640,
    y: centerY - 35,
    minWidth: 230,
    label: spec.root.label,
    fontSize: 22,
    maxCharsPerLine: 20,
    backgroundColor: "#e0e7ff",
    strokeColor: "#312e81",
  });
  elements.push(rootBox.rect, rootBox.textEl);

  function layoutSide(sideBranches, side, paletteOffset = 0) {
    const sideHeight = computeSideHeight(sideBranches);
    let cursorY = centerY - sideHeight / 2;

    for (let bIdx = 0; bIdx < sideBranches.length; bIdx++) {
      const branch = sideBranches[bIdx];
      const palette = BRANCH_PALETTE[(bIdx + paletteOffset) % BRANCH_PALETTE.length];
      const childrenBlockHeight =
        branch.children.length * 62 + (branch.children.length - 1) * CHILD_GAP_Y;
      const branchCenterY = cursorY + childrenBlockHeight / 2;

      const branchTemp = createLabeledBox({
        idPrefix: "mm-branch",
        x: 0,
        y: 0,
        minWidth: 190,
        label: branch.label,
        fontSize: 18,
        maxCharsPerLine: 20,
        backgroundColor: palette.bg,
        strokeColor: palette.stroke,
      });

      const branchX =
        side === "right"
          ? rootBox.rect.x + rootBox.width + HORIZONTAL_GAP
          : rootBox.rect.x - HORIZONTAL_GAP - branchTemp.width;
      const branchY = branchCenterY - branchTemp.height / 2;

      branchTemp.rect.x = branchX;
      branchTemp.rect.y = branchY;
      branchTemp.textEl.x = branchX + (branchTemp.width - branchTemp.textEl.width) / 2;
      branchTemp.textEl.y = branchY + (branchTemp.height - branchTemp.textEl.height) / 2;

      elements.push(branchTemp.rect, branchTemp.textEl);
      elements.push(
        connectBoxes({
          fromBox: rootBox.rect,
          toBox: branchTemp.rect,
          fromSide: side,
          toSide: side === "right" ? "left" : "right",
          strokeColor: palette.stroke,
        })
      );

      let childY = cursorY;
      for (const child of branch.children) {
        const childTemp = createLabeledBox({
          idPrefix: "mm-child",
          x: 0,
          y: 0,
          minWidth: 170,
          label: child.label,
          fontSize: 16,
          maxCharsPerLine: 22,
          backgroundColor: palette.childBg,
          strokeColor: palette.stroke,
        });

        const childX =
          side === "right"
            ? branchX + branchTemp.width + HORIZONTAL_GAP
            : branchX - HORIZONTAL_GAP - childTemp.width;

        childTemp.rect.x = childX;
        childTemp.rect.y = childY;
        childTemp.textEl.x = childX + (childTemp.width - childTemp.textEl.width) / 2;
        childTemp.textEl.y = childY + (childTemp.height - childTemp.textEl.height) / 2;

        elements.push(childTemp.rect, childTemp.textEl);
        elements.push(
          connectBoxes({
            fromBox: branchTemp.rect,
            toBox: childTemp.rect,
            fromSide: side,
            toSide: side === "right" ? "left" : "right",
            strokeColor: palette.stroke,
          })
        );

        childY += Math.max(62, childTemp.height) + CHILD_GAP_Y;
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

/**
 * Deterministic aligned multi-column comparison board layout engine.
 */
export function buildComparisonScene(spec) {
  resetAdapterIdCounter();
  const elements = [];

  const COLUMN_WIDTH = 310;
  const COLUMN_GAP = 32;
  const START_X = 80;
  const TITLE_Y = 60;
  const HEADER_Y = 140;
  const ROW_START_Y = 225;
  const ROW_GAP = 16;

  const totalBoardWidth =
    spec.columns.length * COLUMN_WIDTH + (spec.columns.length - 1) * COLUMN_GAP;

  const titleLines = wrapText(spec.title, 48);
  const titleMetrics = estimateTextMetrics(titleLines, 26);
  const titleEl = createText({
    id: nextId("cmp-title"),
    x: START_X + (totalBoardWidth - titleMetrics.width) / 2,
    y: TITLE_Y,
    width: titleMetrics.width,
    height: titleMetrics.height,
    text: titleLines.join("\n"),
    fontSize: 26,
    strokeColor: "#0f172a",
  });
  elements.push(titleEl);

  for (let colIdx = 0; colIdx < spec.columns.length; colIdx++) {
    const col = spec.columns[colIdx];
    const palette = BRANCH_PALETTE[colIdx % BRANCH_PALETTE.length];
    const colX = START_X + colIdx * (COLUMN_WIDTH + COLUMN_GAP);

    const headerBox = createLabeledBox({
      idPrefix: "cmp-hdr",
      x: colX,
      y: HEADER_Y,
      minWidth: COLUMN_WIDTH,
      label: col.title,
      fontSize: 20,
      maxCharsPerLine: 26,
      backgroundColor: palette.bg,
      strokeColor: palette.stroke,
    });
    // Enforce uniform column width
    headerBox.rect.width = COLUMN_WIDTH;
    headerBox.textEl.x = colX + (COLUMN_WIDTH - headerBox.textEl.width) / 2;
    elements.push(headerBox.rect, headerBox.textEl);

    let rowY = ROW_START_Y;
    for (const item of col.items) {
      const cardText = `${item.label}: ${item.value}`;
      const lines = wrapText(cardText, 30);
      const metrics = estimateTextMetrics(lines, 16);
      const cardHeight = Math.max(66, metrics.height + 24);

      const cardRect = createRectangle({
        id: nextId("cmp-row"),
        x: colX,
        y: rowY,
        width: COLUMN_WIDTH,
        height: cardHeight,
        backgroundColor: palette.childBg,
        strokeColor: palette.stroke,
        strokeWidth: 1,
      });

      const cardTextEl = createText({
        id: nextId("cmp-row-txt"),
        x: colX + 16,
        y: rowY + (cardHeight - metrics.height) / 2,
        width: COLUMN_WIDTH - 32,
        height: metrics.height,
        text: lines.join("\n"),
        fontSize: 16,
        textAlign: "left",
        strokeColor: "#0f172a",
      });

      elements.push(cardRect, cardTextEl);
      rowY += cardHeight + ROW_GAP;
    }
  }

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
