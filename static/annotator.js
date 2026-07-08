/* ────────────────────────────────────────────────────────────────
   AnnotateLessAnalyseMore – Annotation Canvas
   ──────────────────────────────────────────────────────────────── */

// ── Default label schema (CoNSeP / PanNuke convention) ─────────
const DEFAULT_LABELS = [
  { name: 'Background',   color: '#ffffff' },
  { name: 'Neoplastic',   color: '#ff0000' },
  { name: 'Inflammatory', color: '#0000ff' },
  { name: 'Connective',   color: '#00ff00' },
  { name: 'Dead',         color: '#808080' },
  { name: 'Epithelial',   color: '#ffff00' },
];

// ── State ──────────────────────────────────────────────────────
let labels        = [];          // [{name, color}]
let annotations   = [];          // [{id, label, color, points:[x,y]}]
let history       = [];          // undo stack of annotation snapshots
let future        = [];          // redo stack
let lastSavedAnns = '[]';        // JSON snapshot of last saved/loaded state
let isDirty       = false;
let currentImage  = null;
let currentLabel  = null;
let tool          = 'draw';      // 'draw' | 'freehand' | 'edit' | 'pan'
let prevTool      = 'draw';

// camera
let scale = 1, panX = 0, panY = 0;

// display settings
let showOverlay  = true;
let showOutline  = true;
let overlayAlpha = 0.18;   // base fill opacity for unselected annotations (0–1)
let outlineAlpha = 1.0;    // stroke opacity (0–1)
let showAnnIds   = true;
let annIdFontSize = 12;    // canvas px

// polygon draw state
let drawPts       = [];
let nearFirst     = false;
const SNAP_PX     = 12;

// freehand draw state
let freehandPts   = [];
let isDrawingFH   = false;
let fhPointerId   = null;
let fhFromBarrel  = false;  // true when freehand was started via stylus barrel button in edit mode

// multi-touch / pinch state
const activePointers = new Map(); // pointerId → {x, y}
let lastPinch = null;             // { dist, cx, cy } snapshot of previous two-finger frame

// label-row drag-and-drop state
let _dragSrcIdx   = null;

// theme
let theme      = 'dark';
let checkerA   = '#1a1a1a';
let checkerB   = '#141414';

// edit state
let selAnn        = -1;          // primary selected annotation (vertex editing, toolbar sync)
let selAnns       = new Set();   // all selected annotation indices
let selAnchor     = -1;          // anchor index for shift-click range
let selVertex     = -1;
let draggingVtx   = false;
let hoverEdge     = null;

// pan state
let panning       = false;
let lastMx        = 0, lastMy = 0;
let mouseCx       = 0, mouseCy = 0;
let touchStart    = null;   // { x, y } canvas coords — touch tap detection
let rubberBand    = null;   // { x1, y1, x2, y2, ctrl } image coords — drag multi-select

// image
let img           = null;
let imgW          = 0, imgH = 0;

const canvas      = document.getElementById('canvas');
const ctx         = canvas.getContext('2d');

// ── Coordinate helpers ─────────────────────────────────────────
const toImg = (cx, cy) => ({ x: (cx - panX) / scale, y: (cy - panY) / scale });
const toCvs = (ix, iy) => ({ x: ix * scale + panX, y: iy * scale + panY });

function canvasMouse(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function dist(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function polyCenter(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

function ptOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: ax, y: ay, t: 0, d: dist(px, py, ax, ay) };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { x: cx, y: cy, t, d: dist(px, py, cx, cy) };
}

function pointInPoly(ix, iy, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > iy) !== (yj > iy) && ix < ((xj - xi) * (iy - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── RDP polyline simplification ────────────────────────────────
function ptLineDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function getPinchState() {
  const pts = [...activePointers.values()];
  const [a, b] = pts;
  return {
    dist: Math.hypot(b.x - a.x, b.y - a.y),
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
  };
}

function simplifyRDP(pts, tolerance) {
  if (pts.length <= 2) return pts;
  let maxD = 0, maxI = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = ptLineDistance(pts[i][0], pts[i][1], ax, ay, bx, by);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > tolerance) {
    const L = simplifyRDP(pts.slice(0, maxI + 1), tolerance);
    const R = simplifyRDP(pts.slice(maxI), tolerance);
    return L.slice(0, -1).concat(R);
  }
  return [pts[0], pts[pts.length - 1]];
}

// ── Canvas resize ──────────────────────────────────────────────
function resizeCanvas() {
  const area   = document.getElementById('canvas-area');
  const tb     = document.getElementById('toolbar');
  const sb     = document.getElementById('statusbar');
  canvas.width  = area.clientWidth;
  canvas.height = area.clientHeight - tb.offsetHeight - sb.offsetHeight;
  render();
}

window.addEventListener('resize', resizeCanvas);

// ── Render ─────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // checkerboard background
  const ts = 16;
  for (let y = 0; y < canvas.height; y += ts) {
    for (let x = 0; x < canvas.width; x += ts) {
      ctx.fillStyle = ((x / ts + y / ts) % 2 === 0) ? checkerA : checkerB;
      ctx.fillRect(x, y, ts, ts);
    }
  }

  if (!img) return;

  ctx.drawImage(img, panX, panY, imgW * scale, imgH * scale);

  // annotations
  annotations.forEach((ann, i) => {
    if (ann.points.length < 2) return;
    const isSel   = i === selAnn;
    const isInSel = selAnns.has(i);
    const fillA   = showOverlay ? (isInSel ? Math.min(1, overlayAlpha * 2.5) : overlayAlpha) : 0;
    const strokeA = showOutline ? outlineAlpha : 0;
    drawPoly(ann.points, ann.color, fillA, strokeA, isInSel ? 2.5 : 1.5);

    if (showAnnIds) {
      const [cx, cy] = polyCenter(ann.points);
      const c = toCvs(cx, cy);
      ctx.save();
      ctx.font = `bold ${annIdFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(String(i + 1), c.x, c.y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(i + 1), c.x, c.y);
      ctx.restore();
    }

    // vertices for selected
    if (isSel && tool === 'edit') {
      ann.points.forEach((p, vi) => {
        const c = toCvs(p[0], p[1]);
        const isSelVtx = vi === selVertex;
        ctx.beginPath();
        ctx.arc(c.x, c.y, isSelVtx ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isSelVtx ? '#fff' : ann.color;
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // edge add-vertex hint
      if (hoverEdge && hoverEdge.annIdx === i) {
        const a = ann.points[hoverEdge.edgeIdx];
        const b = ann.points[(hoverEdge.edgeIdx + 1) % ann.points.length];
        const im = toImg(mouseCx, mouseCy);
        const closest = ptOnSegment(im.x, im.y, a[0], a[1], b[0], b[1]);
        const c = toCvs(closest.x, closest.y);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fill();
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  });

  // freehand stroke in progress (also covers pen-in-draw-mode auto-capture)
  if (isDrawingFH && freehandPts.length > 1) {
    const lbl = currentLabel || { color: '#ffffff' };
    ctx.save();
    ctx.strokeStyle = lbl.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    const f = toCvs(freehandPts[0][0], freehandPts[0][1]);
    ctx.moveTo(f.x, f.y);
    for (let i = 1; i < freehandPts.length; i++) {
      const p = toCvs(freehandPts[i][0], freehandPts[i][1]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // polygon draw in progress
  if (drawPts.length > 0) {
    const lbl = currentLabel || { color: '#ffffff' };
    ctx.strokeStyle = lbl.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    const f = toCvs(drawPts[0][0], drawPts[0][1]);
    ctx.moveTo(f.x, f.y);
    for (let i = 1; i < drawPts.length; i++) {
      const p = toCvs(drawPts[i][0], drawPts[i][1]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(mouseCx, mouseCy);
    ctx.stroke();
    ctx.setLineDash([]);

    drawPts.forEach((p, i) => {
      const c = toCvs(p[0], p[1]);
      ctx.beginPath();
      const r = (i === 0 && nearFirst) ? 10 : (i === 0 ? 6 : 4);
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = (i === 0 && nearFirst) ? '#fff' : lbl.color;
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  // rubber band multi-select rect
  if (rubberBand) {
    const a = toCvs(rubberBand.x1, rubberBand.y1);
    const b = toCvs(rubberBand.x2, rubberBand.y2);
    const rx = Math.min(a.x, b.x), ry = Math.min(a.y, b.y);
    const rw = Math.abs(b.x - a.x),  rh = Math.abs(b.y - a.y);
    ctx.save();
    ctx.fillStyle = 'rgba(88,101,242,0.12)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = 'rgba(88,101,242,0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawPoly(pts, color, fillAlpha, strokeAlpha, strokeW) {
  ctx.beginPath();
  const f = toCvs(pts[0][0], pts[0][1]);
  ctx.moveTo(f.x, f.y);
  for (let i = 1; i < pts.length; i++) {
    const p = toCvs(pts[i][0], pts[i][1]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  if (fillAlpha > 0) {
    ctx.fillStyle = hexToRgba(color, fillAlpha);
    ctx.fill();
  }
  if (strokeAlpha > 0 && strokeW > 0) {
    ctx.strokeStyle = hexToRgba(color, strokeAlpha);
    ctx.lineWidth = strokeW;
    ctx.stroke();
  }
}

// ── Canvas pointer events (covers mouse, stylus/pen, touch) ────
canvas.addEventListener('pointerdown',   onPointerDown);
canvas.addEventListener('pointermove',   onPointerMove);
canvas.addEventListener('pointerup',     onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('dblclick',      onDblClick);
canvas.addEventListener('wheel',         onWheel, { passive: false });
canvas.addEventListener('contextmenu',   onRightClick);

function onPointerDown(e) {
  const m = canvasMouse(e);

  // Track all active pointers for pinch detection
  activePointers.set(e.pointerId, { x: m.x, y: m.y });

  // Two touch fingers → pinch mode (takes priority over everything)
  if (activePointers.size >= 2) {
    lastPinch = getPinchState();
    panning = false;
    if (isDrawingFH) { isDrawingFH = false; fhPointerId = null; freehandPts = []; }
    return;
  }

  // Single touch finger → pan; record start for tap detection
  if (e.pointerType === 'touch') {
    lastMx = m.x; lastMy = m.y;
    panning = true;
    touchStart = { x: m.x, y: m.y };
    canvas.style.cursor = 'grabbing';
    return;
  }

  // Mouse or pen: existing tool logic
  lastMx = m.x; lastMy = m.y;

  // freehand: capture pointer so stroke tracks even off-element
  if (tool === 'freehand' && e.button === 0) {
    canvas.setPointerCapture(e.pointerId);
    fhPointerId = e.pointerId;
    isDrawingFH = true;
    const im = toImg(m.x, m.y);
    freehandPts = [[im.x, im.y]];
    return;
  }

  // pen/stylus in draw mode → capture as freehand stroke (auto-switch on release if long enough)
  if (tool === 'draw' && e.pointerType === 'pen' && e.button === 0) {
    canvas.setPointerCapture(e.pointerId);
    fhPointerId = e.pointerId;
    isDrawingFH = true;
    const im = toImg(m.x, m.y);
    freehandPts = [[im.x, im.y]];
    return;
  }

  // stylus barrel button in edit mode → freehand draw stroke; stays in edit mode on release
  if (tool === 'edit' && e.pointerType === 'pen' && e.button === 2) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    fhPointerId = e.pointerId;
    isDrawingFH = true;
    fhFromBarrel = true;
    const im = toImg(m.x, m.y);
    freehandPts = [[im.x, im.y]];
    return;
  }

  // middle-button or pan tool
  if (e.button === 1 || tool === 'pan') { panning = true; canvas.style.cursor = 'grabbing'; return; }

  if (e.button === 0 && tool === 'draw') {
    const im = toImg(m.x, m.y);
    if (drawPts.length >= 3 && nearFirst) { closePolygon(); return; }
    drawPts.push([im.x, im.y]);
    render();
    return;
  }

  if (e.button === 0 && tool === 'edit') {
    // try to grab a vertex
    if (selAnn >= 0) {
      const ann = annotations[selAnn];
      for (let vi = 0; vi < ann.points.length; vi++) {
        const c = toCvs(ann.points[vi][0], ann.points[vi][1]);
        if (dist(c.x, c.y, m.x, m.y) <= 10) {
          selVertex = vi; draggingVtx = true; return;
        }
      }

      // try add vertex on edge
      if (hoverEdge && hoverEdge.annIdx === selAnn) {
        const a   = ann.points[hoverEdge.edgeIdx];
        const b   = ann.points[(hoverEdge.edgeIdx + 1) % ann.points.length];
        const im  = toImg(m.x, m.y);
        const cp  = ptOnSegment(im.x, im.y, a[0], a[1], b[0], b[1]);
        if (cp.d * scale < 12) {
          pushHistory();
          ann.points.splice(hoverEdge.edgeIdx + 1, 0, [cp.x, cp.y]);
          selVertex = hoverEdge.edgeIdx + 1;
          draggingVtx = true;
          render();
          return;
        }
      }
    }

    // click to select annotation
    let found = -1;
    for (let i = annotations.length - 1; i >= 0; i--) {
      const im = toImg(m.x, m.y);
      if (pointInPoly(im.x, im.y, annotations[i].points)) { found = i; break; }
    }
    if (found >= 0) {
      selectAnnotation(found, e);
    } else {
      // start rubber band drag-to-select
      const im2 = toImg(m.x, m.y);
      rubberBand = { x1: im2.x, y1: im2.y, x2: im2.x, y2: im2.y, ctrl: e.ctrlKey || e.metaKey };
      if (!(e.ctrlKey || e.metaKey)) {
        selAnn = -1; selAnns = new Set(); selAnchor = -1; selVertex = -1;
        refreshAnnList();
      }
      render();
    }
  }
}

function onPointerMove(e) {
  const m = canvasMouse(e);

  // Update pointer position for pinch tracking
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: m.x, y: m.y });
  }

  // Two-finger pinch: zoom + pan simultaneously
  if (activePointers.size >= 2) {
    const pinch = getPinchState();
    if (lastPinch) {
      const ds = pinch.dist / lastPinch.dist;
      const ns = Math.max(0.05, Math.min(40, scale * ds));
      panX = pinch.cx - (pinch.cx - panX) * (ns / scale) + (pinch.cx - lastPinch.cx);
      panY = pinch.cy - (pinch.cy - panY) * (ns / scale) + (pinch.cy - lastPinch.cy);
      scale = ns;
      document.getElementById('zoom-label').textContent = Math.round(scale * 100) + '%';
      render();
    }
    lastPinch = pinch;
    return;
  }

  mouseCx = m.x; mouseCy = m.y;

  if (img) {
    const im = toImg(m.x, m.y);
    const ix = Math.round(im.x), iy = Math.round(im.y);
    document.getElementById('cursor-pos').textContent =
      (ix >= 0 && iy >= 0 && ix <= imgW && iy <= imgH) ? `x:${ix} y:${iy}` : '';
  }

  // freehand tracking — only the capturing pointer (covers freehand tool + pen-in-draw-mode)
  if (isDrawingFH && e.pointerId === fhPointerId) {
    const im = toImg(m.x, m.y);
    const last = freehandPts[freehandPts.length - 1];
    if (Math.hypot(im.x - last[0], im.y - last[1]) > 1.5 / scale) {
      freehandPts.push([im.x, im.y]);
    }
    render(); return;
  }

  if (panning) {
    if (touchStart && Math.hypot(m.x - touchStart.x, m.y - touchStart.y) > 8) touchStart = null;
    panX += m.x - lastMx; panY += m.y - lastMy;
    lastMx = m.x; lastMy = m.y;
    render(); return;
  }

  if (draggingVtx && selAnn >= 0 && selVertex >= 0) {
    const im = toImg(m.x, m.y);
    annotations[selAnn].points[selVertex] = [im.x, im.y];
    render(); return;
  }

  if (rubberBand) {
    const im = toImg(m.x, m.y);
    rubberBand.x2 = im.x; rubberBand.y2 = im.y;
    render(); return;
  }

  if (tool === 'draw' && drawPts.length > 0) {
    const f = toCvs(drawPts[0][0], drawPts[0][1]);
    nearFirst = drawPts.length >= 3 && dist(f.x, f.y, m.x, m.y) <= SNAP_PX;
    render(); return;
  }

  if (tool === 'edit' && selAnn >= 0) {
    const ann = annotations[selAnn];
    const im  = toImg(m.x, m.y);
    let bestEdge = null, bestDist = 14 / scale;
    for (let i = 0; i < ann.points.length; i++) {
      const a = ann.points[i], b = ann.points[(i + 1) % ann.points.length];
      const r = ptOnSegment(im.x, im.y, a[0], a[1], b[0], b[1]);
      if (r.d < bestDist) { bestDist = r.d; bestEdge = { annIdx: selAnn, edgeIdx: i }; }
    }
    const nearVtx = ann.points.some(p => dist(toCvs(p[0], p[1]).x, toCvs(p[0], p[1]).y, m.x, m.y) <= 10);
    hoverEdge = nearVtx ? null : bestEdge;
    render();
  }
}

function onPointerUp(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) lastPinch = null;

  // freehand finalize: covers freehand tool, pen-in-draw-mode, and barrel-button-in-edit-mode
  if (isDrawingFH) {
    isDrawingFH = false; fhPointerId = null;
    const wasBarrel = fhFromBarrel;
    fhFromBarrel = false;
    if (freehandPts.length >= 3 && currentLabel) {
      const simplified = simplifyRDP(freehandPts, 1.5 / scale);
      if (simplified.length >= 3) {
        if (!wasBarrel && tool !== 'freehand') setTool('freehand'); // auto-switch from draw mode
        pushHistory();
        const newIdx = annotations.length;
        annotations.push({ id: uid(), label: currentLabel.name, color: currentLabel.color, points: simplified });
        markDirty(); refreshAnnList(); render();
        setStatus(`Added freehand annotation (${currentLabel.name}). Total: ${annotations.length}`);
        if (wasBarrel) selectAnnotation(newIdx, null); // stay in edit mode; select the new annotation
      } else {
        // simplified to nothing — treat as tap
        _trySelectAtPoint(freehandPts[0], e.pointerType);
      }
    } else {
      // short stroke = tap → try to select annotation
      _trySelectAtPoint(freehandPts[0] || null, e.pointerType);
    }
    freehandPts = [];
    return;
  }

  // rubber band: finalize multi-select on mouse/pen release
  if (rubberBand) {
    const rx1 = Math.min(rubberBand.x1, rubberBand.x2);
    const ry1 = Math.min(rubberBand.y1, rubberBand.y2);
    const rx2 = Math.max(rubberBand.x1, rubberBand.x2);
    const ry2 = Math.max(rubberBand.y1, rubberBand.y2);
    const rbCtrl = rubberBand.ctrl;
    rubberBand = null;
    // only select if the band has meaningful size (avoids treating a click as a band)
    const a = toCvs(rx1, ry1), b = toCvs(rx2, ry2);
    if (Math.abs(b.x - a.x) > 4 || Math.abs(b.y - a.y) > 4) {
      const newSel = new Set();
      annotations.forEach((ann, i) => {
        if (ann.points.some(p => p[0] >= rx1 && p[0] <= rx2 && p[1] >= ry1 && p[1] <= ry2))
          newSel.add(i);
      });
      if (rbCtrl) { for (const i of newSel) selAnns.add(i); }
      else { selAnns = newSel; }
      if (selAnns.size > 0) { selAnn = Math.min(...selAnns); selAnchor = selAnn; }
      else if (!rbCtrl) { selAnn = -1; selAnchor = -1; }
      refreshAnnList();
    }
    render();
    return;
  }

  if (panning && activePointers.size === 0) {
    panning = false;
    canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    // touch tap: if finger barely moved, try to select annotation
    if (touchStart) {
      const im = toImg(touchStart.x, touchStart.y);
      _trySelectAtPoint([im.x, im.y], 'touch');
      touchStart = null;
    }
  }
  if (draggingVtx) { draggingVtx = false; markDirty(); }
}

function _trySelectAtPoint(pt, pointerType) {
  if (!pt) return;
  let found = -1;
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (pointInPoly(pt[0], pt[1], annotations[i].points)) { found = i; break; }
  }
  if (found >= 0) selectAnnotation(found, null);
}

function onDblClick(e) {
  if (tool === 'draw' && drawPts.length >= 3) {
    drawPts.pop(); // remove point added by second click
    closePolygon();
  }
}

function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey) {
    // Pinch gesture on touchpad, or Ctrl+scroll → zoom toward cursor
    const m   = canvasMouse(e);
    const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns  = Math.max(0.05, Math.min(40, scale * delta));
    panX = m.x - (m.x - panX) * (ns / scale);
    panY = m.y - (m.y - panY) * (ns / scale);
    scale = ns;
    document.getElementById('zoom-label').textContent = Math.round(scale * 100) + '%';
    render();
  } else {
    // Two-finger scroll on touchpad, or plain scroll wheel → pan
    panX -= e.deltaX;
    panY -= e.deltaY;
    render();
  }
}

function onRightClick(e) {
  e.preventDefault();
  if (fhFromBarrel) return; // barrel-button freehand in progress — don't cancel it
  if (tool === 'draw') {
    if (drawPts.length > 0) drawPts.pop();
    if (drawPts.length === 0) nearFirst = false;
    render();
  }
  if (tool === 'freehand' && isDrawingFH) {
    isDrawingFH = false; fhPointerId = null; freehandPts = [];
    render();
  }
}

// ── Polygon operations ─────────────────────────────────────────
function closePolygon() {
  if (drawPts.length < 3 || !currentLabel) return;
  pushHistory();
  annotations.push({ id: uid(), label: currentLabel.name, color: currentLabel.color, points: [...drawPts] });
  drawPts = []; nearFirst = false;
  markDirty(); refreshAnnList(); render();
  setStatus(`Added annotation (${currentLabel.name}). Total: ${annotations.length}`);
}

function deleteSelected() {
  if (selAnns.size === 0) return;
  pushHistory();
  [...selAnns].sort((a, b) => b - a).forEach(idx => annotations.splice(idx, 1));
  selAnn = -1; selVertex = -1; selAnns = new Set(); selAnchor = -1;
  markDirty(); refreshAnnList(); render();
}

function deleteAll() {
  if (annotations.length === 0) return;
  if (!confirm(`Delete all ${annotations.length} annotation(s)?`)) return;
  pushHistory();
  annotations = [];
  selAnn = -1; selVertex = -1; selAnns = new Set(); selAnchor = -1;
  markDirty(); refreshAnnList(); render();
}

function removeAnnotation(idx, event) {
  if (event) event.stopPropagation();
  pushHistory();
  annotations.splice(idx, 1);
  const newSel = new Set();
  for (const i of selAnns) {
    if (i < idx) newSel.add(i);
    else if (i > idx) newSel.add(i - 1);
  }
  selAnns = newSel;
  if (!selAnns.has(selAnn)) selAnn = selAnns.size > 0 ? Math.min(...selAnns) : -1;
  if (selAnn >= annotations.length) selAnn = -1;
  selVertex = -1;
  markDirty(); refreshAnnList(); render();
}

function selectAnnotation(idx, e) {
  if (e && e.shiftKey && selAnchor >= 0) {
    const lo = Math.min(selAnchor, idx), hi = Math.max(selAnchor, idx);
    selAnns = new Set();
    for (let i = lo; i <= hi; i++) selAnns.add(i);
    selAnn = idx;
  } else if (e && (e.ctrlKey || e.metaKey)) {
    if (selAnns.has(idx)) {
      selAnns.delete(idx);
      if (selAnn === idx) selAnn = selAnns.size > 0 ? Math.min(...selAnns) : -1;
    } else {
      selAnns.add(idx);
      selAnn = idx;
    }
    selAnchor = idx;
  } else {
    selAnns = new Set([idx]);
    selAnn = idx; selAnchor = idx; selVertex = -1;
    setTool('edit');
    _syncToolbarToAnn(idx);
  }
  refreshAnnList(); render();
}

function relabelAnnotation(idx, newLabel, event) {
  if (event) event.stopPropagation();
  const lobj = labels.find(l => l.name === newLabel);
  if (!lobj || idx < 0 || idx >= annotations.length) return;
  pushHistory();
  annotations[idx].label = lobj.name;
  annotations[idx].color = lobj.color;
  markDirty();
  // update swatch without rebuilding whole list
  const items = document.querySelectorAll('.ann-item');
  if (items[idx]) items[idx].querySelector('.ann-swatch').style.background = lobj.color;
  render();
}

// sync toolbar label-select to match the selected annotation
function _syncToolbarToAnn(idx) {
  if (idx < 0 || idx >= annotations.length) return;
  const ann = annotations[idx];
  const sel = document.getElementById('label-select');
  if (sel) sel.value = ann.label;
  currentLabel = labels.find(l => l.name === ann.label) || currentLabel;
  const dot = document.getElementById('label-dot');
  if (dot) dot.style.background = currentLabel?.color || '#999';
}

// ── History / undo / redo ──────────────────────────────────────
function pushHistory() {
  history.push(JSON.stringify(annotations));
  if (history.length > 50) history.shift();
  future = [];   // new action invalidates the redo stack
}

function undo() {
  if (history.length === 0) { setStatus('Nothing to undo.'); return; }
  if (drawPts.length > 0) { drawPts = []; nearFirst = false; render(); return; }
  future.push(JSON.stringify(annotations));
  if (future.length > 50) future.shift();
  annotations = JSON.parse(history.pop());
  selAnn = -1; selVertex = -1;
  markDirty(); refreshAnnList(); render();
  setStatus('Undo.');
}

function redo() {
  if (future.length === 0) { setStatus('Nothing to redo.'); return; }
  history.push(JSON.stringify(annotations));
  annotations = JSON.parse(future.pop());
  selAnn = -1; selVertex = -1;
  markDirty(); refreshAnnList(); render();
  setStatus('Redo.');
}

// ── Dirty state ────────────────────────────────────────────────
function markDirty() {
  isDirty = true;
  const btn = document.getElementById('btn-discard');
  if (btn) btn.disabled = false;
  const st = document.getElementById('status-text');
  if (st && !st.textContent.startsWith('●')) {
    st.textContent = '● ' + st.textContent;
  }
}

function markClean() {
  isDirty = false;
  const btn = document.getElementById('btn-discard');
  if (btn) btn.disabled = true;
  const st = document.getElementById('status-text');
  if (st) st.textContent = st.textContent.replace(/^● /, '');
}

function discardChanges() {
  if (!isDirty) { setStatus('No unsaved changes.'); return; }
  if (!confirm('Discard all unsaved changes and revert to last save?')) return;
  annotations = JSON.parse(lastSavedAnns);
  history = []; future = [];
  selAnn = -1; selVertex = -1; selAnns = new Set(); selAnchor = -1;
  drawPts = []; freehandPts = [];
  markClean();
  refreshAnnList(); render();
  setStatus('Changes discarded.');
}

// ── Tools ──────────────────────────────────────────────────────
function setTool(t) {
  prevTool = tool; tool = t;
  rubberBand = null;
  if (t !== 'draw')     { drawPts = []; nearFirst = false; }
  if (t !== 'freehand') { freehandPts = []; isDrawingFH = false; fhPointerId = null; }
  if (t !== 'edit')     { hoverEdge = null; }
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-' + t);
  if (btn) btn.classList.add('active');
  canvas.style.cursor = t === 'pan' ? 'grab' : 'crosshair';
  render();
}

// hold Space to pan temporarily
window.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

  if (e.code === 'Space' && tool !== 'pan' && !inInput) { setTool('pan'); e.preventDefault(); }
  if (!inInput) {
    if (e.key === 'd' || e.key === 'D') setTool('draw');
    if (e.key === 'h' || e.key === 'H') setTool('freehand');
    if (e.key === 'e' || e.key === 'E') setTool('edit');
    if (e.key === 'p' || e.key === 'P') setTool('pan');
    if (e.key === 'f' || e.key === 'F') fitView();
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selAnns.size > 0) { e.preventDefault(); deleteSelected(); }
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (annotations.length === 0) return;
      e.preventDefault();
      const dir  = e.key === 'ArrowUp' ? -1 : 1;
      const next = selAnn < 0
        ? (dir > 0 ? 0 : annotations.length - 1)
        : Math.max(0, Math.min(annotations.length - 1, selAnn + dir));
      selectAnnotation(next, null);
      const el = document.querySelectorAll('.ann-item')[next];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }
  if (e.key === 'Escape') {
    rubberBand = null;
    drawPts = []; nearFirst = false;
    if (isDrawingFH) { isDrawingFH = false; fhPointerId = null; freehandPts = []; }
    render();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAnnotations(); }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') setTool(prevTool);
});

// ── Display controls ───────────────────────────────────────────
function onOverlayToggle(el) {
  showOverlay = el.checked;
  document.getElementById('slider-overlay').disabled = !el.checked;
  render();
}
function onOutlineToggle(el) {
  showOutline = el.checked;
  document.getElementById('slider-outline').disabled = !el.checked;
  render();
}
function onOverlayAlpha(v) { overlayAlpha = parseInt(v) / 100; render(); }
function onOutlineAlpha(v) { outlineAlpha = parseInt(v) / 100; render(); }
function onAnnIdsToggle(el) {
  showAnnIds = el.checked;
  document.getElementById('slider-ann-id-size').disabled = !el.checked;
  render();
}
function onAnnIdSize(v) { annIdFontSize = parseInt(v); render(); }

// ── Theme ──────────────────────────────────────────────────────
function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', theme);
  applyTheme();
}

function applyTheme() {
  document.body.classList.toggle('light', theme === 'light');
  const s = getComputedStyle(document.documentElement);
  checkerA = s.getPropertyValue('--checker-a').trim() || (theme === 'light' ? '#d0d0d0' : '#1a1a1a');
  checkerB = s.getPropertyValue('--checker-b').trim() || (theme === 'light' ? '#c4c4c4' : '#141414');
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  render();
}

// ── View ───────────────────────────────────────────────────────
function zoomBy(factor) {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const ns = Math.max(0.05, Math.min(40, scale * factor));
  panX = cx - (cx - panX) * (ns / scale);
  panY = cy - (cy - panY) * (ns / scale);
  scale = ns;
  document.getElementById('zoom-label').textContent = Math.round(scale * 100) + '%';
  render();
}

function fitView() {
  if (!img) return;
  const pw = canvas.width - 40, ph = canvas.height - 40;
  scale = Math.min(pw / imgW, ph / imgH);
  panX  = (canvas.width  - imgW * scale) / 2;
  panY  = (canvas.height - imgH * scale) / 2;
  document.getElementById('zoom-label').textContent = Math.round(scale * 100) + '%';
  render();
}

// ── Image loading ──────────────────────────────────────────────
async function loadImage(name) {
  if (currentImage && annotations.length > 0) await saveAnnotations(true);
  currentImage = name;
  drawPts = []; freehandPts = []; selAnn = -1; selVertex = -1;
  selAnns = new Set(); selAnchor = -1; annotations = []; history = [];

  const i = new Image();
  i.src = '/img/' + encodeURIComponent(name);
  await new Promise(r => { i.onload = r; i.onerror = r; });
  img = i; imgW = i.naturalWidth; imgH = i.naturalHeight;

  fitView();

  const res  = await fetch('/api/annotations/' + encodeURIComponent(name));
  annotations = await res.json();
  lastSavedAnns = JSON.stringify(annotations);
  markClean();
  refreshAnnList(); render();

  document.querySelectorAll('.img-item').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`[data-img="${name}"]`);
  if (el) el.classList.add('active');
  setStatus(`${name}  (${imgW}×${imgH})  |  ${annotations.length} annotation(s)`);
}

// ── Save / export ──────────────────────────────────────────────
async function saveAnnotations(silent = false) {
  if (!currentImage) return;
  await fetch('/api/annotations/' + encodeURIComponent(currentImage), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(annotations)
  });
  lastSavedAnns = JSON.stringify(annotations);
  markClean();
  if (!silent) setStatus(`Saved ${annotations.length} annotation(s).`);
}

async function exportPNG() {
  if (!currentImage) { alert('No image loaded.'); return; }
  await saveAnnotations(true);
  setStatus('Exporting PNG masks…');
  const res = await fetch('/api/export/png/' + encodeURIComponent(currentImage));
  if (!res.ok) { setStatus('PNG export failed.'); return; }
  const data = await res.json();
  setStatus(`PNG saved: ${data.sem_file} (semantic) + ${data.inst_file} (instance)`);
}

async function exportGeoJSON() {
  if (!currentImage) { alert('No image loaded.'); return; }
  await saveAnnotations(true);
  setStatus('Exporting GeoJSON…');
  const res = await fetch('/api/export/geojson/' + encodeURIComponent(currentImage));
  if (!res.ok) { setStatus('GeoJSON export failed.'); return; }
  const data = await res.json();
  setStatus(`GeoJSON saved: ${data.file}`);
}

// ── Mask import modal ──────────────────────────────────────────
let _maskAnalysis = null;

async function openMaskModal() {
  const res   = await fetch('/api/masks');
  const masks = await res.json();
  const msel  = document.getElementById('mask-select');
  msel.innerHTML = masks.length
    ? masks.map(m => `<option value="${m}">${m}</option>`).join('')
    : '<option value="">No mask files found</option>';

  if (currentImage) {
    const g = await fetch('/api/guess-mask/' + encodeURIComponent(currentImage)).then(r => r.json());
    if (g.mask) [...msel.options].forEach(o => { if (o.value === g.mask) o.selected = true; });
  }

  showMaskStep(1);
  document.getElementById('mask-modal').style.display = 'flex';
}

function closeMaskModal() {
  document.getElementById('mask-modal').style.display = 'none';
}

function showMaskStep(n) {
  document.getElementById('mask-s1').style.display = n === 1 ? '' : 'none';
  document.getElementById('mask-s2').style.display = n === 2 ? '' : 'none';
}

async function analyzeMask() {
  const maskName = document.getElementById('mask-select').value;
  if (!maskName) { alert('Select a mask file first.'); return; }

  const btn = document.getElementById('btn-analyze');
  btn.textContent = 'Analyzing…'; btn.disabled = true;

  const res = await fetch('/api/mask-analysis/' + encodeURIComponent(maskName));
  btn.textContent = 'Analyze →'; btn.disabled = false;

  if (!res.ok) { alert('Failed to analyze mask.'); return; }
  _maskAnalysis = await res.json();

  _renderMaskAssignment(_maskAnalysis);
  showMaskStep(2);
}

function _classAssignTable(groups) {
  return `
    <table class="assign-table">
      <thead><tr>
        <th>Pixel value</th><th>Regions</th><th>Assign label</th><th>Import</th>
      </tr></thead>
      <tbody>
        ${groups.map(g => `
          <tr>
            <td>
              <span class="assign-swatch" style="background:${g.color || '#888'}"></span>
              ${g.pixel_value}
            </td>
            <td>${g.count}</td>
            <td>
              <select class="assign-sel" data-pv="${g.pixel_value}">
                ${labels.map(l =>
                  `<option value="${l.name}" ${l.name === g.suggested_label ? 'selected' : ''}>${l.name}</option>`
                ).join('')}
              </select>
            </td>
            <td style="text-align:center">
              <input type="checkbox" class="assign-chk" data-pv="${g.pixel_value}" checked
                ${g.count === 0 ? 'disabled' : ''}>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function _renderMaskAssignment(data) {
  const area = document.getElementById('mask-assignment-area');
  const desc = document.getElementById('mask-type-desc');

  if (data.is_class_map) {
    desc.textContent =
      `Semantic mask detected — ${data.groups.length} class(es) found. Labels auto-assigned below; adjust if needed.`;
    area.innerHTML = _classAssignTable(data.groups);
  } else if (data.has_paired_sem) {
    const total = data.groups.reduce((s, g) => s + g.count, 0);
    desc.innerHTML =
      `Instance mask detected — paired semantic mask <strong>${data.has_paired_sem}</strong> found. ` +
      `${total} instance(s) across ${data.groups.length} class(es); labels auto-assigned below.`;
    area.innerHTML = _classAssignTable(data.groups);
  } else {
    const total = data.groups[0]?.count ?? 0;
    desc.textContent =
      `Instance mask detected — ${total} region(s) found. All instances will be assigned to one label.`;
    area.innerHTML = `
      <div class="instance-assign-row">
        <span>Assign all ${total} instances to:</span>
        <select id="instance-label-sel">
          ${labels.map((l, i) => `<option value="${l.name}" ${i === 1 ? 'selected' : ''}>${l.name}</option>`).join('')}
        </select>
      </div>`;
  }
}

async function importMask() {
  const maskName = document.getElementById('mask-select').value;
  const maxP     = parseInt(document.getElementById('mask-max').value) || 200;
  if (!maskName) { alert('No mask selected.'); return; }

  let assignments = [];
  let semMaskName = '';

  const _collectCheckedAssignments = () => {
    const result = [];
    document.querySelectorAll('.assign-chk:checked').forEach(chk => {
      const pv    = parseInt(chk.dataset.pv);
      const sel   = document.querySelector(`.assign-sel[data-pv="${pv}"]`);
      const lname = sel?.value || labels[0]?.name;
      const lobj  = labels.find(l => l.name === lname) || labels[0];
      result.push({ pixel_value: pv, label: lobj.name, color: lobj.color });
    });
    return result;
  };

  if (_maskAnalysis?.is_class_map) {
    assignments = _collectCheckedAssignments();
    if (assignments.length === 0) { alert('No groups checked for import.'); return; }
  } else if (_maskAnalysis?.has_paired_sem) {
    semMaskName = _maskAnalysis.has_paired_sem;
    assignments = _collectCheckedAssignments();
    if (assignments.length === 0) { alert('No classes checked for import.'); return; }
  } else {
    const sel  = document.getElementById('instance-label-sel');
    const lobj = labels.find(l => l.name === sel?.value) || labels[1] || labels[0];
    assignments.push({ pixel_value: null, label: lobj.name, color: lobj.color });
  }

  setStatus('Importing polygons from mask…');
  closeMaskModal();

  const res = await fetch('/api/mask-import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mask_name: maskName, sem_mask_name: semMaskName, assignments, max_polys: maxP })
  });

  if (!res.ok) { setStatus('Import failed.'); return; }
  const polys = await res.json();

  pushHistory();
  polys.forEach(p => {
    annotations.push({ id: uid(), label: p.label, color: p.color, points: p.points });
  });

  markDirty(); refreshAnnList(); render();
  setStatus(`Imported ${polys.length} polygon(s) from "${maskName}".`);
}

// ── Label management ───────────────────────────────────────────
function buildLabelInputs(presets) {
  const FALLBACK_PALETTE = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c'];
  const src = presets || DEFAULT_LABELS;
  const n = Math.max(1, Math.min(20, parseInt(document.getElementById('label-count').value) || src.length));
  document.getElementById('label-count').value = n;
  const container = document.getElementById('label-inputs-container');
  container.innerHTML = Array.from({ length: n }, (_, i) => {
    const def = src[i] || { name: `Label ${i + 1}`, color: FALLBACK_PALETTE[i % FALLBACK_PALETTE.length] };
    return `<div class="label-row" draggable="true" data-idx="${i}"
      ondragstart="_labelRowDragStart(event,${i})"
      ondragover="_labelRowDragOver(event,${i})"
      ondrop="_labelRowDrop(event,${i})"
      ondragend="_labelRowDragEnd(event)">
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <input type="color" id="lc${i}" value="${def.color}">
      <input type="text"  id="ln${i}" placeholder="Label ${i + 1} name" value="${def.name}">
    </div>`;
  }).join('');
}

function _labelRowDragStart(e, idx) {
  _dragSrcIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.target.closest('.label-row').classList.add('dragging');
}

function _labelRowDragOver(e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('#label-inputs-container .label-row').forEach(r => r.classList.remove('drag-over'));
  const row = document.querySelector(`#label-inputs-container [data-idx="${idx}"]`);
  if (row) row.classList.add('drag-over');
}

function _labelRowDrop(e, destIdx) {
  e.preventDefault();
  if (_dragSrcIdx === null || _dragSrcIdx === destIdx) { _dragSrcIdx = null; return; }
  const container = document.getElementById('label-inputs-container');
  const current = [...container.querySelectorAll('.label-row')].map(r => {
    const i = parseInt(r.dataset.idx);
    return {
      color: document.getElementById('lc' + i)?.value || '#999',
      name: (document.getElementById('ln' + i)?.value || '').trim()
    };
  });
  const [moved] = current.splice(_dragSrcIdx, 1);
  current.splice(destIdx, 0, moved);
  _dragSrcIdx = null;
  buildLabelInputs(current);
}

function _labelRowDragEnd(e) {
  document.querySelectorAll('#label-inputs-container .label-row').forEach(r => {
    r.classList.remove('dragging', 'drag-over');
  });
  _dragSrcIdx = null;
}

function confirmLabels() {
  const n = parseInt(document.getElementById('label-count').value) || 2;
  const result = [];
  for (let i = 0; i < n; i++) {
    const color = document.getElementById('lc' + i)?.value || '#999';
    const name  = document.getElementById('ln' + i)?.value?.trim() || `Label ${i + 1}`;
    result.push({ name, color });
  }
  if (result.length === 0) return;
  applyLabels(result);
}

function applyLabels(lbls) {
  labels = lbls;
  currentLabel = labels[0];
  localStorage.setItem('annLabels', JSON.stringify(labels));

  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  buildLabelSelect();
  buildLegend();
  resizeCanvas();
  loadImageList();
}

function useSavedLabels() {
  try {
    const saved = JSON.parse(localStorage.getItem('annLabels') || '[]');
    if (saved.length > 0) { applyLabels(saved); return; }
  } catch (e) {}
}

function reconfigureLabels() {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('label-count').value = labels.length || DEFAULT_LABELS.length;
  buildLabelInputs(labels.length ? labels : DEFAULT_LABELS);
}

function onLabelChange() {
  const sel = document.getElementById('label-select').value;
  currentLabel = labels.find(l => l.name === sel) || labels[0];
  document.getElementById('label-dot').style.background = currentLabel?.color || '#999';
  // relabel all selected annotations when toolbar label changes in edit mode
  if (tool === 'edit' && selAnns.size > 0 && currentLabel) {
    pushHistory();
    for (const idx of selAnns) {
      if (idx >= 0 && idx < annotations.length) {
        annotations[idx].label = currentLabel.name;
        annotations[idx].color = currentLabel.color;
      }
    }
    markDirty(); refreshAnnList(); render();
  }
}

function buildLabelSelect() {
  const sel = document.getElementById('label-select');
  sel.innerHTML = labels.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
  currentLabel = labels[0];
  document.getElementById('label-dot').style.background = currentLabel?.color || '#999';
}

function buildLegend() {
  const counts = {};
  annotations.forEach(ann => { counts[ann.label] = (counts[ann.label] || 0) + 1; });
  document.getElementById('legend').innerHTML = labels.map(l => `
    <div class="legend-item">
      <span class="legend-swatch" style="background:${l.color}"></span>
      <span class="legend-name">${l.name}</span>
      <span class="legend-count">${counts[l.name] || 0}</span>
    </div>`).join('');
}

// ── Annotation list UI ─────────────────────────────────────────
function refreshAnnList() {
  buildLegend();
  document.getElementById('ann-count').textContent = annotations.length;
  document.getElementById('ann-list').innerHTML = annotations.map((ann, i) => `
    <div class="ann-item ${selAnns.has(i) ? 'active' : ''} ${i === selAnn && selAnns.size > 1 ? 'primary' : ''}"
         onclick="selectAnnotation(${i}, event)">
      <span class="ann-swatch" style="background:${ann.color}"></span>
      <span class="ann-id">${i + 1}</span>
      <select class="ann-label-sel" onclick="event.stopPropagation()"
              onchange="relabelAnnotation(${i},this.value,event)">
        ${labels.map(l => `<option value="${l.name}" ${l.name === ann.label ? 'selected' : ''}>${l.name}</option>`).join('')}
      </select>
      <span class="ann-pts">${ann.points.length}pt</span>
      <button class="ann-del" onclick="removeAnnotation(${i},event)">×</button>
    </div>`).join('');
}

// ── Image list ─────────────────────────────────────────────────
async function loadImageList() {
  const res = await fetch('/api/images');
  const imgs = await res.json();
  document.getElementById('image-list').innerHTML = imgs.map(name =>
    `<div class="img-item" data-img="${name}" onclick="loadImage('${name}')">${name}</div>`
  ).join('');
  if (imgs.length > 0) loadImage(imgs[0]);
}

// ── Utilities ──────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function setStatus(msg) { document.getElementById('status-text').textContent = msg; }

// ── Init ───────────────────────────────────────────────────────
window.addEventListener('load', () => {
  theme = localStorage.getItem('theme') || 'dark';
  applyTheme();

  document.getElementById('label-count').value = DEFAULT_LABELS.length;
  buildLabelInputs(DEFAULT_LABELS);

  try {
    const saved = JSON.parse(localStorage.getItem('annLabels') || '[]');
    if (saved.length > 0) {
      const btn = document.getElementById('btn-use-saved');
      btn.style.display = 'inline-block';
      btn.textContent = `Use Previous (${saved.map(l => l.name).join(', ')})`;
    }
  } catch (e) {}
});
