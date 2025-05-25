// content_script.js

const urlKey = window.location.href;
let overlay, ctx;
let strokes = [], undone = [];
let brushColor = "#4328df";
let brushSize  = 5;
let isDrawing  = false;
let drawEnabled = false;

// menu variables
let menuEl, colorInput, sizeSlider, previewEl;

// drawing mode: "free" | "rect" | "circle"
let shapeMode = "free";

// stroke-drawing temps
let startX = 0, startY = 0;
let currentStroke = null;

// drag & collapse state
let isDraggingMenu = false;
let dragMoved      = false;
let dragStartX     = 0, dragStartY = 0;
let menuStartLeft  = 0, menuStartTop = 0;
let isCollapsed    = false;

/** --- Load & Save --- */
async function loadStrokes() {
  const res = await browser.storage.local.get(urlKey + "_strokes");
  if (res[urlKey + "_strokes"]) {
    strokes = res[urlKey + "_strokes"];
    redraw();
  }
}
function saveStrokes() {
  browser.storage.local.set({ [urlKey + "_strokes"]: strokes });
}

/** --- Canvas Overlay --- */
function createOverlay() {
  if (overlay) return;
  overlay = document.createElement("canvas");
  overlay.id = "drawing-overlay";
  Object.assign(overlay.style, {
    position:      "absolute",
    top:           "0",
    left:          "0",
    zIndex:        "99999998",
    pointerEvents: "auto"
  });

  const w = document.documentElement.scrollWidth;
  const h = document.documentElement.scrollHeight;
  overlay.width  = w;
  overlay.height = h;
  overlay.style.width  = w + "px";
  overlay.style.height = h + "px";

  ctx = overlay.getContext("2d");
  overlay.addEventListener("mousedown", startStroke);
  overlay.addEventListener("mousemove", continueStroke);
  overlay.addEventListener("mouseup", endStroke);
  overlay.addEventListener("mouseleave", endStroke);

  document.body.appendChild(overlay);
  loadStrokes();
}
function removeOverlay() {
  if (!overlay) return;
  overlay.remove();
  overlay = ctx = null;
  strokes = []; undone = [];
}

/** --- Redraw --- */
function redraw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  strokes.forEach(s => {
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth   = s.size;

    if (s.type === "free") {
      ctx.lineCap = "round";
      s.points.forEach((pt,i) =>
        i===0 ? ctx.moveTo(pt.x,pt.y) : ctx.lineTo(pt.x,pt.y)
      );
      ctx.stroke();

    } else if (s.type === "rect") {
      const { x: x0, y: y0 } = s.start;
      const w = s.end.x - x0, h = s.end.y - y0;
      ctx.strokeRect(x0, y0, w, h);

    } else if (s.type === "circle") {
      const { x: x0, y: y0 } = s.start;
      const dx = s.end.x - x0, dy = s.end.y - y0;
      const r  = Math.hypot(dx, dy);
      ctx.arc(x0, y0, r, 0, 2*Math.PI);
      ctx.stroke();
    }
  });
}

/** --- Stroke Logic --- */
function startStroke(e) {
  if (!drawEnabled || e.button !== 0) return;
  isDrawing = true;
  startX = e.pageX; startY = e.pageY;

  if (shapeMode === "free") {
    currentStroke = {
      type:   "free",
      color:  brushColor,
      size:   brushSize,
      points: [{ x: startX, y: startY }]
    };
    ctx.beginPath();
    ctx.strokeStyle = brushColor;
    ctx.lineWidth   = brushSize;
    ctx.lineCap     = "round";
    ctx.moveTo(startX, startY);

  } else {
    currentStroke = {
      type:  shapeMode,
      color: brushColor,
      size:  brushSize,
      start: { x: startX, y: startY },
      end:   { x: startX, y: startY }
    };
  }

  e.preventDefault();
}
function continueStroke(e) {
  if (!drawEnabled || !isDrawing) return;
  const x = e.pageX, y = e.pageY;

  if (shapeMode === "free") {
    currentStroke.points.push({ x, y });
    ctx.lineTo(x, y);
    ctx.stroke();

  } else {
    currentStroke.end = { x, y };
    redraw();
    ctx.beginPath();
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth   = currentStroke.size;

    if (shapeMode === "rect") {
      const w = x - startX, h = y - startY;
      ctx.strokeRect(startX, startY, w, h);
    } else {
      const dx = x - startX, dy = y - startY;
      const r  = Math.hypot(dx, dy);
      ctx.arc(startX, startY, r, 0, 2*Math.PI);
      ctx.stroke();
    }
  }

  e.preventDefault();
}
function endStroke(e) {
  if (!drawEnabled || !isDrawing) return;
  isDrawing = false;
  strokes.push(currentStroke);
  undone = [];
  saveStrokes();
}

/** --- Undo/Redo/Clear --- */
function doUndo() {
  if (!strokes.length) return;
  undone.push(strokes.pop());
  redraw(); saveStrokes();
}
function doRedo() {
  if (!undone.length) return;
  strokes.push(undone.pop());
  redraw(); saveStrokes();
}
function doClear() {
  strokes = []; undone = [];
  redraw();
  browser.storage.local.remove(urlKey + "_strokes");
}

/** --- Export PNG --- */
async function doExport() {
  if (typeof html2canvas !== "function") return;
  const w = document.documentElement.scrollWidth;
  const h = document.documentElement.scrollHeight;
  html2canvas(document.body, {
    width: w, height: h,
    windowWidth: w, windowHeight: h,
    scrollX: 0, scrollY: 0
  }).then(canvas => {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `page-drawing_${Date.now()}.png`;
    link.click();
  }).catch(console.error);
}

/** --- Toggle Collapsed --- */
function toggleCollapse() {
  isCollapsed = !isCollapsed;
  menuEl.classList.toggle("collapsed", isCollapsed);
}

/** --- Build & Inject Menu (using DOMParser) --- */
async function createFloatingMenu() {
  if (menuEl) return;

  // fetch menu.html
  const resp = await fetch(browser.runtime.getURL("menu.html"));
  const html = await resp.text();

  // parse with DOMParser (preserves UTF-8 symbols safely)
  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, "text/html");
  const template = doc.getElementById("draw-floating-menu");
  if (!template) {
    console.error("Menu markup not found");
    return;
  }
  menuEl = template.cloneNode(true);

  // initial styling
  Object.assign(menuEl.style, {
    position:      "fixed",
    bottom:        "var(--menu-spacing)",
    left:          "50%",
    transform:     "translateX(-50%)",
    pointerEvents: "auto",
    zIndex:        "var(--z-draw-menu)"
  });

  // prevent clicks falling through
  ["mousedown","click"].forEach(evt =>
    menuEl.addEventListener(evt, e => e.stopPropagation())
  );

  // 1) Drag-handle wiring
  const handle = menuEl.querySelector("#drag-handle");
  handle.addEventListener("mousedown", e => {
    isDraggingMenu = true;
    dragMoved      = false;
    dragStartX     = e.clientX;
    dragStartY     = e.clientY;
    const r        = menuEl.getBoundingClientRect();
    menuStartLeft  = r.left;
    menuStartTop   = r.top;
    menuEl.style.transform = "none";
    menuEl.style.left      = r.left + "px";
    menuEl.style.top       = r.top  + "px";
    menuEl.style.bottom    = "auto";
    e.preventDefault();
  });
  document.addEventListener("mousemove", e => {
    if (!isDraggingMenu) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.hypot(dx, dy) > 4) dragMoved = true;
    menuEl.style.left = menuStartLeft + dx + "px";
    menuEl.style.top  = menuStartTop  + dy + "px";
  });
  document.addEventListener("mouseup", () => {
    if (!isDraggingMenu) return;
    isDraggingMenu = false;
    if (!dragMoved) toggleCollapse();
  });

  // 2) Wire up action buttons
  const fnMap = {
    undo:   doUndo,
    redo:   doRedo,
    clear:  doClear,
    export: doExport,
    close:  handleClose
  };
  menuEl.querySelectorAll("button[data-action]").forEach(btn => {
    const fn = fnMap[btn.dataset.action];
    if (fn) btn.addEventListener("click", fn);
  });

  // 3) Brush controls
  previewEl     = menuEl.querySelector("#brush-preview");
  colorInput    = menuEl.querySelector("#brush-color-input");
  sizeSlider    = menuEl.querySelector("#brush-size-input");
  const brushContainer = menuEl.querySelector(".brush-container");
  brushContainer.addEventListener("click", () => colorInput.click());
  colorInput.addEventListener("input", e => {
    brushColor = e.target.value;
    menuEl.style.setProperty("--brush-color", brushColor);
  });
  sizeSlider.addEventListener("input", e => {
    brushSize = +e.target.value;
    menuEl.style.setProperty("--brush-size", brushSize + "px");
  });

  // 4) Shape-toggle buttons
  menuEl.querySelectorAll(".shape-btn").forEach(btn => {
    if (btn.dataset.shape === shapeMode) btn.classList.add("active");
    btn.addEventListener("click", () => {
      menuEl.querySelectorAll(".shape-btn")
            .forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      shapeMode = btn.dataset.shape;
    });
  });

  // inject into the page
  document.body.appendChild(menuEl);
}

function removeFloatingMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = colorInput = sizeSlider = previewEl = null;
}

function handleClose() {
  drawEnabled = false;
  removeOverlay();
  removeFloatingMenu();
  browser.runtime.sendMessage({ type: "exitDrawMode" });
}

/** --- Background Listener --- */
browser.runtime.onMessage.addListener(msg => {
  if (msg.type === "toggleDrawMode") {
    drawEnabled = msg.enabled;
    if (drawEnabled) {
      createOverlay();
      createFloatingMenu();
    } else {
      removeOverlay();
      removeFloatingMenu();
    }
  } else if (msg.type === "undo") {
    doUndo();
  } else if (msg.type === "redo") {
    doRedo();
  } else if (msg.type === "clear") {
    doClear();
  }
});
