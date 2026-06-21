(function () {
  "use strict";

  const STORAGE_KEY = "node-note-project-v1";
  const PRESET_MANIFEST = "expression-manifest.json";
  const PRESET_ROOT = "../../expressions/";
  const NODE_WIDTH = 270;
  const NODE_GAP_X = 320;
  const NODE_GAP_Y = 120;

  const $ = (id) => document.getElementById(id);
  const els = {
    folderInput: $("folderInput"),
    fileInput: $("fileInput"),
    btnReset: $("btnReset"),
    btnExport: $("btnExport"),
    searchInput: $("searchInput"),
    exprCount: $("exprCount"),
    paramCount: $("paramCount"),
    nodeCount: $("nodeCount"),
    durationLabel: $("durationLabel"),
    libraryList: $("libraryList"),
    graph: $("graph"),
    wires: $("wires"),
    nodeLayer: $("nodeLayer"),
    ghostWire: $("ghostWire"),
    fpsInput: $("fpsInput"),
    timeInput: $("timeInput"),
    emptyInspector: $("emptyInspector"),
    nodeInspector: $("nodeInspector"),
    edgeInspector: $("edgeInspector"),
    nodeType: $("nodeType"),
    nodeName: $("nodeName"),
    nodeStart: $("nodeStart"),
    nodeDuration: $("nodeDuration"),
    nodeStrength: $("nodeStrength"),
    nodeEnabled: $("nodeEnabled"),
    nodeFadeIn: $("nodeFadeIn"),
    nodeFadeOut: $("nodeFadeOut"),
    presetWrap: $("presetWrap"),
    presetSelect: $("presetSelect"),
    addInputBtn: $("addInputBtn"),
    dupNodeBtn: $("dupNodeBtn"),
    deleteNodeBtn: $("deleteNodeBtn"),
    focusNodeBtn: $("focusNodeBtn"),
    edgeLabel: $("edgeLabel"),
    deleteEdgeBtn: $("deleteEdgeBtn"),
    jsonPreview: $("jsonPreview"),
    copyJsonBtn: $("copyJsonBtn"),
    downloadJsonBtn: $("downloadJsonBtn"),
  };

  const state = {
    presets: [],
    presetMap: new Map(),
    nodes: [],
    edges: [],
    selectedNodeId: null,
    selectedEdgeId: null,
    search: "",
    sampleTime: 0,
    fps: 60,
    nextNodeId: 1,
    nextEdgeId: 1,
    draggingNode: null,
    connecting: null,
    nodesById: new Map(),
    saveTimer: null,
  };

  const PRESET_COLORS = ["#6ee7c8", "#7aa8ff", "#ffb86b", "#ff7a92", "#a98bff", "#6fd7ff", "#f3d16b"];

  function uid(prefix, n) {
    return `${prefix}${n}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function round(value, digits = 6) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  }

  function safeName(name) {
    return String(name || "untitled").replace(/\.[^.]+$/, "").trim();
  }

  function expressionColor(index) {
    return PRESET_COLORS[index % PRESET_COLORS.length];
  }

  function createEmptyProject() {
    state.nodes = [];
    state.edges = [];
    state.nextNodeId = 1;
    state.nextEdgeId = 1;
    const mixer = createNode("mixer", { x: 520, y: 160, title: "Mixer" });
    mixer.inputs = ["in 1"];
    const output = createNode("export", { x: 880, y: 160, title: "Export" });
    connectNodes(mixer.id, 0, output.id, 0);
    selectNode(output.id);
    renderAll(true);
  }

  function createNode(type, opts = {}) {
    const node = {
      id: uid("n", state.nextNodeId++),
      type,
      x: opts.x ?? 80 + (state.nodes.length % 3) * NODE_GAP_X,
      y: opts.y ?? 80 + Math.floor(state.nodes.length / 3) * NODE_GAP_Y,
      title: opts.title || "",
      presetId: opts.presetId || "",
      enabled: opts.enabled ?? true,
      start: opts.start ?? 0,
      duration: opts.duration ?? 2.5,
      strength: opts.strength ?? 1,
      fadeIn: opts.fadeIn ?? 0.12,
      fadeOut: opts.fadeOut ?? 0.12,
      inputs: opts.inputs ? [...opts.inputs] : (type === "mixer" ? ["in 1"] : type === "export" ? ["in"] : []),
      outputLabel: type === "export" ? "" : "params",
      note: opts.note || "",
      selected: false,
    };

    if (type === "expression" && node.presetId) {
      const preset = state.presetMap.get(node.presetId);
      node.title = opts.title || preset?.name || node.title || "Expression";
      node.note = preset ? `${preset.parameters.length} parameters` : "";
    }

    state.nodes.push(node);
    refreshNodeIndex();
    return node;
  }

  function refreshNodeIndex() {
    state.nodesById = new Map(state.nodes.map((node) => [node.id, node]));
  }

  function addExpressionNode(preset, opts = {}) {
    const node = createNode("expression", {
      x: opts.x ?? 96 + (state.nodes.filter((n) => n.type === "expression").length % 4) * NODE_GAP_X,
      y: opts.y ?? 120 + Math.floor(state.nodes.filter((n) => n.type === "expression").length / 4) * NODE_GAP_Y,
      title: preset.name,
      presetId: preset.id,
      start: opts.start ?? 0,
      duration: opts.duration ?? 2.5,
      strength: opts.strength ?? 1,
      fadeIn: opts.fadeIn ?? 0.12,
      fadeOut: opts.fadeOut ?? 0.12,
      note: `${preset.parameters.length} parameters`,
    });
    selectNode(node.id);
    scheduleSave();
    renderAll(true);
  }

  function removeNode(nodeId) {
    const edgeIds = state.edges.filter((edge) => edge.fromId === nodeId || edge.toId === nodeId).map((e) => e.id);
    state.edges = state.edges.filter((edge) => !edgeIds.includes(edge.id));
    state.nodes = state.nodes.filter((node) => node.id !== nodeId);
    if (state.selectedNodeId === nodeId) state.selectedNodeId = null;
    if (state.selectedEdgeId && edgeIds.includes(state.selectedEdgeId)) state.selectedEdgeId = null;
    refreshNodeIndex();
    scheduleSave();
    renderAll(true);
  }

  function removeEdge(edgeId) {
    state.edges = state.edges.filter((edge) => edge.id !== edgeId);
    if (state.selectedEdgeId === edgeId) state.selectedEdgeId = null;
    scheduleSave();
    renderAll(true);
  }

  function addInput(nodeId) {
    const node = state.nodesById.get(nodeId);
    if (!node || (node.type !== "mixer" && node.type !== "export")) return;
    node.inputs.push(`in ${node.inputs.length + 1}`);
    scheduleSave();
    renderAll(true);
  }

  function connectNodes(fromId, fromSocket, toId, toSocket) {
    const fromNode = state.nodesById.get(fromId);
    const toNode = state.nodesById.get(toId);
    if (!fromNode || !toNode) return false;
    if (fromNode.id === toNode.id) return false;
    if (fromNode.type === "export") return false;
    if (toNode.type === "expression") return false;
    if (fromNode.type === "mixer" && toNode.type === "export" && fromSocket !== 0) return false;
    if (toSocket < 0 || toSocket >= toNode.inputs.length) return false;

    state.edges = state.edges.filter((edge) => !(edge.toId === toId && edge.toSocket === toSocket));
    state.edges.push({
      id: uid("e", state.nextEdgeId++),
      fromId,
      fromSocket,
      toId,
      toSocket,
      label: "connection",
    });
    state.selectedEdgeId = null;
    scheduleSave();
    return true;
  }

  function disconnectInput(nodeId, inputIndex) {
    state.edges = state.edges.filter((edge) => !(edge.toId === nodeId && edge.toSocket === inputIndex));
    scheduleSave();
  }

  function getOutputSocket(nodeId) {
    return els.nodeLayer.querySelector(`.node[data-id="${nodeId}"] .socket.output`);
  }

  function getInputSocket(nodeId, index) {
    return els.nodeLayer.querySelector(`.node[data-id="${nodeId}"] .socket.input[data-index="${index}"]`);
  }

  function socketCenter(socketEl) {
    const graphRect = els.graph.getBoundingClientRect();
    const rect = socketEl.getBoundingClientRect();
    return {
      x: rect.left - graphRect.left + rect.width / 2,
      y: rect.top - graphRect.top + rect.height / 2,
    };
  }

  function wirePath(a, b) {
    const dx = Math.max(80, Math.abs(b.x - a.x) * 0.5);
    const c1x = a.x + dx;
    const c2x = b.x - dx;
    return `M ${a.x} ${a.y} C ${c1x} ${a.y}, ${c2x} ${b.y}, ${b.x} ${b.y}`;
  }

  function simplifyPoints(points) {
    if (points.length <= 2) return points;
    const simplified = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const c = points[i];
      if (simplified.length < 2) {
        simplified.push(c);
        continue;
      }
      const a = simplified[simplified.length - 2];
      const b = simplified[simplified.length - 1];
      const dx1 = b.t - a.t;
      const dy1 = b.v - a.v;
      const dx2 = c.t - b.t;
      const dy2 = c.v - b.v;
      const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
      const scale = Math.max(1, Math.abs(dx1) + Math.abs(dy1) + Math.abs(dx2) + Math.abs(dy2));
      if (cross / scale < 0.0005) {
        simplified[simplified.length - 1] = c;
      } else {
        simplified.push(c);
      }
    }
    return simplified;
  }

  function buildCurveSegments(points) {
    if (!points.length) return [0, 0, 0, 0, 0];
    const segments = [];
    points.forEach((point, index) => {
      if (index === 0) {
        segments.push(round(point.t), round(point.v));
      } else {
        segments.push(0, round(point.t), round(point.v));
      }
    });
    if (points.length === 1) {
      segments.push(0, round(points[0].t), round(points[0].v));
    }
    return segments;
  }

  function getPresetById(id) {
    return state.presetMap.get(id) || null;
  }

  function evaluateNode(node, time, memo, stack) {
    if (!node) return {};
    const key = `${node.id}@${time}`;
    if (memo.has(key)) return memo.get(key);
    if (stack.has(node.id)) return {};
    stack.add(node.id);

    let result = {};
    if (node.type === "expression") {
      const preset = getPresetById(node.presetId);
      if (preset && node.enabled) {
        const start = Number(node.start || 0);
        const duration = Math.max(0.01, Number(node.duration || 0.01));
        const end = start + duration;
        if (time >= start && time <= end) {
          let envelope = 1;
          const fadeIn = Math.max(0, Number(node.fadeIn || 0));
          const fadeOut = Math.max(0, Number(node.fadeOut || 0));
          if (fadeIn > 0 && time < start + fadeIn) {
            envelope = clamp((time - start) / fadeIn, 0, 1);
          }
          if (fadeOut > 0 && time > end - fadeOut) {
            envelope = Math.min(envelope, clamp((end - time) / fadeOut, 0, 1));
          }
          const strength = Number(node.strength || 0);
          preset.parameters.forEach((param) => {
            result[param.id] = (result[param.id] || 0) + Number(param.value || 0) * strength * envelope;
          });
        }
      }
    } else {
      node.inputs.forEach((_, index) => {
        const edge = state.edges.find((item) => item.toId === node.id && item.toSocket === index);
        if (!edge) return;
        const source = state.nodesById.get(edge.fromId);
        result = mergeMaps(result, evaluateNode(source, time, memo, stack));
      });
    }

    stack.delete(node.id);
    memo.set(key, result);
    return result;
  }

  function mergeMaps(target, source) {
    const out = { ...target };
    Object.entries(source || {}).forEach(([key, value]) => {
      out[key] = (out[key] || 0) + Number(value || 0);
    });
    return out;
  }

  function sampleGraph(time) {
    const exportNode = state.nodes.find((node) => node.type === "export");
    const root = exportNode || state.nodes.find((node) => node.type === "mixer") || state.nodes.find((node) => node.type === "expression");
    if (!root) return {};
    return evaluateNode(root, time, new Map(), new Set());
  }

  function motionDuration() {
    const exprNodes = state.nodes.filter((node) => node.type === "expression");
    const maxEnd = exprNodes.reduce((max, node) => Math.max(max, Number(node.start || 0) + Number(node.duration || 0)), 0);
    return Math.max(0.5, maxEnd);
  }

  function exportMotion3() {
    const duration = motionDuration();
    const fps = clamp(Number(els.fpsInput.value || 60), 1, 120);
    state.fps = fps;
    const step = 1 / fps;
    const times = [];
    for (let t = 0; t < duration; t += step) {
      times.push(round(t, 6));
    }
    if (times[times.length - 1] !== round(duration, 6)) {
      times.push(round(duration, 6));
    }

    const paramIds = [...new Set(state.presets.flatMap((preset) => preset.parameters.map((param) => param.id)))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const curves = [{
      Target: "Model",
      Id: "Opacity",
      Segments: [0, 1.0, 0, round(duration), 1.0],
    }];
    let totalSegments = 1;
    let totalPoints = 2;

    paramIds.forEach((paramId) => {
      const points = simplifyPoints(times.map((t) => ({
        t,
        v: sampleGraph(t)[paramId] || 0,
      })));
      curves.push({
        Target: "Parameter",
        Id: paramId,
        Segments: buildCurveSegments(points),
      });
      totalSegments += Math.max(0, points.length - 1);
      totalPoints += points.length;
    });

    const motion = {
      Version: 3,
      Meta: {
        Duration: round(duration, 3),
        Fps: fps,
        Loop: false,
        AreBeziersRestricted: false,
        CurveCount: curves.length,
        TotalSegmentCount: totalSegments,
        TotalPointCount: totalPoints,
        UserDataCount: 0,
        TotalUserDataSize: 0,
      },
      Curves: curves,
    };
    return JSON.stringify(motion, null, 2);
  }

  function loadProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      state.nodes = data.nodes || [];
      state.edges = data.edges || [];
      state.nextNodeId = data.nextNodeId || state.nodes.length + 1;
      state.nextEdgeId = data.nextEdgeId || state.edges.length + 1;
      state.selectedNodeId = data.selectedNodeId || null;
      state.selectedEdgeId = data.selectedEdgeId || null;
      state.fps = data.fps || 60;
      state.sampleTime = data.sampleTime || 0;
      refreshNodeIndex();
      return true;
    } catch {
      return false;
    }
  }

  function saveProject() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        nodes: state.nodes,
        edges: state.edges,
        nextNodeId: state.nextNodeId,
        nextEdgeId: state.nextEdgeId,
        selectedNodeId: state.selectedNodeId,
        selectedEdgeId: state.selectedEdgeId,
        fps: state.fps,
        sampleTime: state.sampleTime,
      }));
    } catch {
      // Ignore storage failures on GitHub Pages/private mode.
    }
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveProject, 50);
  }

  function selectNode(nodeId) {
    state.selectedNodeId = nodeId;
    state.selectedEdgeId = null;
    renderInspector();
    renderGraph();
  }

  function selectEdge(edgeId) {
    state.selectedEdgeId = edgeId;
    state.selectedNodeId = null;
    renderInspector();
    renderGraph();
  }

  function renderLibrary() {
    const query = state.search.trim().toLowerCase();
    const filtered = state.presets.filter((preset) => {
      if (!query) return true;
      const haystack = [preset.name, preset.fileName, ...preset.parameters.map((p) => p.id)].join(" ").toLowerCase();
      return haystack.includes(query);
    });

    els.exprCount.textContent = String(state.presets.length);
    els.paramCount.textContent = String([...new Set(state.presets.flatMap((preset) => preset.parameters.map((p) => p.id)))].length);
    els.libraryList.innerHTML = "";

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = "<strong>沒有符合的表情</strong><p>試試參數名稱，例如 `ParamMouthOpen`。</p>";
      els.libraryList.appendChild(empty);
      return;
    }

    filtered.forEach((preset) => {
      const tpl = $("libraryTemplate");
      const card = tpl.content.firstElementChild.cloneNode(true);
      card.querySelector(".card-title").textContent = preset.name;
      card.querySelector(".card-meta").textContent = preset.fileName;
      card.querySelector(".card-desc").textContent = `${preset.parameters.length} 個參數，可直接加到畫布。`;
      const chips = card.querySelector(".chips");
      preset.parameters.slice(0, 5).forEach((param) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = param.id;
        chips.appendChild(chip);
      });
      if (preset.parameters.length > 5) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = `+${preset.parameters.length - 5}`;
        chips.appendChild(chip);
      }
      card.querySelector(".add-btn").addEventListener("click", () => addExpressionNode(preset));
      els.libraryList.appendChild(card);
    });
  }

  function updateStats() {
    els.nodeCount.textContent = String(state.nodes.length);
    els.durationLabel.textContent = `${motionDuration().toFixed(2)}s`;
    els.timeInput.max = String(Math.max(0.5, motionDuration()));
    els.timeInput.value = String(clamp(state.sampleTime, 0, motionDuration()));
  }

  function renderGraph() {
    refreshNodeIndex();
    els.nodeLayer.innerHTML = "";
    els.wires.innerHTML = "";

    state.nodes.forEach((node) => {
      const nodeEl = document.createElement("article");
      nodeEl.className = `node ${state.selectedNodeId === node.id ? "selected" : ""}`;
      nodeEl.dataset.id = node.id;
      nodeEl.style.left = `${node.x}px`;
      nodeEl.style.top = `${node.y}px`;

      const kind = node.type === "expression" ? "Expression" : node.type === "mixer" ? "Mixer" : "Export";
      const subtitle = node.type === "expression"
        ? (getPresetById(node.presetId)?.fileName || "preset")
        : node.type === "mixer"
          ? "sum incoming params"
          : "motion3 output";

      const inputs = node.inputs.map((label, index) => `
        <div class="socket-row left">
          <button class="socket input" data-index="${index}" title="input ${index + 1}"></button>
          <span>${label}</span>
        </div>
      `).join("");

      const outputs = node.type === "export" ? "" : `
        <div class="socket-row right">
          <span>${node.outputLabel || "params"}</span>
          <button class="socket output" title="output"></button>
        </div>
      `;

      const metaHtml = node.type === "expression"
        ? `<div class="node-note">${getPresetById(node.presetId)?.parameters.length || 0} parameters<br/>start ${round(node.start, 2)}s · dur ${round(node.duration, 2)}s · x${round(node.strength, 2)}</div>`
        : node.type === "mixer"
          ? `<div class="node-note">用來加總所有輸入的參數。</div>`
          : `<div class="node-note">把最終結果匯出成 MOTION3。</div>`;

      nodeEl.innerHTML = `
        <header class="node-head">
          <div>
            <div class="node-kind">${kind}</div>
            <div class="node-title">${node.title || kind}</div>
            <div class="node-subtitle">${subtitle}</div>
          </div>
          <button class="mini-btn" data-action="delete-node" type="button">刪除</button>
        </header>
        <div class="node-body">
          ${metaHtml}
          <div class="socket-list inputs">${inputs}</div>
          <div class="socket-list outputs">${outputs}</div>
        </div>
      `;

      const head = nodeEl.querySelector(".node-head");
      head.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button")) return;
        startNodeDrag(event, node.id);
      });

      nodeEl.addEventListener("click", (event) => {
        if (event.target.closest("[data-action='delete-node']")) return;
        if (event.target.closest(".socket")) return;
        selectNode(node.id);
      });

      nodeEl.querySelector("[data-action='delete-node']").addEventListener("click", () => removeNode(node.id));

      nodeEl.querySelectorAll(".socket.output").forEach((socket) => {
        socket.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const socketRect = socket.getBoundingClientRect();
          const graphRect = els.graph.getBoundingClientRect();
          state.connecting = {
            fromId: node.id,
            fromSocket: 0,
            x: socketRect.left - graphRect.left + socketRect.width / 2,
            y: socketRect.top - graphRect.top + socketRect.height / 2,
          };
          els.ghostWire.classList.remove("hidden");
          renderGraph();
        });
      });

      nodeEl.querySelectorAll(".socket.input").forEach((socket) => {
        const index = Number(socket.dataset.index);
        socket.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const graphRect = els.graph.getBoundingClientRect();
          const rect = socket.getBoundingClientRect();
          if (state.connecting) {
            connectNodes(state.connecting.fromId, state.connecting.fromSocket, node.id, index);
            state.connecting = null;
            els.ghostWire.classList.add("hidden");
            renderAll(true);
          } else {
            disconnectInput(node.id, index);
            selectNode(node.id);
          }
        });
      });

      els.nodeLayer.appendChild(nodeEl);
    });

    const sockets = new Map();
    state.nodes.forEach((node) => {
      const nodeEl = els.nodeLayer.querySelector(`.node[data-id="${node.id}"]`);
      if (!nodeEl) return;
      const inputSockets = [...nodeEl.querySelectorAll(".socket.input")];
      const outputSocket = nodeEl.querySelector(".socket.output");
      if (outputSocket) sockets.set(`out:${node.id}`, socketCenter(outputSocket));
      inputSockets.forEach((socket, index) => sockets.set(`in:${node.id}:${index}`, socketCenter(socket)));
    });

    state.edges.forEach((edge) => {
      const from = sockets.get(`out:${edge.fromId}`);
      const to = sockets.get(`in:${edge.toId}:${edge.toSocket}`);
      if (!from || !to) return;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", wirePath(from, to));
      path.classList.add("wire");
      if (state.selectedEdgeId === edge.id) path.classList.add("selected");
      path.dataset.id = edge.id;
      path.style.pointerEvents = "stroke";
      path.addEventListener("click", (event) => {
        event.stopPropagation();
        selectEdge(edge.id);
      });
      els.wires.appendChild(path);
    });

    if (state.connecting) {
      const temp = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const start = { x: state.connecting.x, y: state.connecting.y };
      const end = state.pointer || start;
      temp.setAttribute("d", wirePath(start, end));
      temp.classList.add("wire", "wire-ghost");
      els.wires.appendChild(temp);
    }

    updateStats();
    renderPreview();
  }

  function renderPreview() {
    els.jsonPreview.value = exportMotion3();
  }

  function renderInspector() {
    const node = state.nodesById.get(state.selectedNodeId);
    const edge = state.edges.find((item) => item.id === state.selectedEdgeId);
    const hasNode = Boolean(node);
    const hasEdge = Boolean(edge);

    els.emptyInspector.classList.toggle("hidden", hasNode || hasEdge);
    els.nodeInspector.classList.toggle("hidden", !hasNode);
    els.edgeInspector.classList.toggle("hidden", !hasEdge);

    if (!node) {
      if (edge) {
        els.edgeLabel.value = edge.label || "connection";
      }
      return;
    }

    els.nodeType.value = node.type;
    els.nodeName.value = node.title || "";
    els.nodeStart.value = round(node.start, 3);
    els.nodeDuration.value = round(node.duration, 3);
    els.nodeStrength.value = round(node.strength, 3);
    els.nodeEnabled.value = String(Boolean(node.enabled));
    els.nodeFadeIn.value = round(node.fadeIn, 3);
    els.nodeFadeOut.value = round(node.fadeOut, 3);

    const isExpression = node.type === "expression";
    els.presetWrap.classList.toggle("hidden", !isExpression);
    els.addInputBtn.disabled = !(node.type === "mixer" || node.type === "export");

    if (isExpression) {
      els.presetSelect.innerHTML = "";
      state.presets.forEach((preset) => {
        const option = document.createElement("option");
        option.value = preset.id;
        option.textContent = preset.name;
        if (preset.id === node.presetId) option.selected = true;
        els.presetSelect.appendChild(option);
      });
    }
  }

  function startNodeDrag(event, nodeId) {
    const node = state.nodesById.get(nodeId);
    if (!node) return;
    state.draggingNode = {
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
    };
    window.addEventListener("pointermove", onNodeDragMove);
    window.addEventListener("pointerup", onNodeDragEnd, { once: true });
  }

  function onNodeDragMove(event) {
    if (!state.draggingNode) return;
    const node = state.nodesById.get(state.draggingNode.nodeId);
    if (!node) return;
    const dx = event.clientX - state.draggingNode.startX;
    const dy = event.clientY - state.draggingNode.startY;
    node.x = Math.max(0, state.draggingNode.nodeX + dx);
    node.y = Math.max(0, state.draggingNode.nodeY + dy);
    renderGraph();
  }

  function onNodeDragEnd() {
    state.draggingNode = null;
    window.removeEventListener("pointermove", onNodeDragMove);
    scheduleSave();
    renderAll(true);
  }

  function setProjectFromPresets(presets) {
    state.presets = presets;
    state.presetMap = new Map(presets.map((preset) => [preset.id, preset]));
    renderLibrary();
    populatePresetSelect();
    renderAll(true);
  }

  function populatePresetSelect() {
    const node = state.nodesById.get(state.selectedNodeId);
    if (!node || node.type !== "expression") return;
    els.presetSelect.innerHTML = "";
    state.presets.forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      if (preset.id === node.presetId) option.selected = true;
      els.presetSelect.appendChild(option);
    });
  }

  async function loadManifestPresets() {
    try {
      const response = await fetch(PRESET_MANIFEST, { cache: "no-store" });
      if (!response.ok) return [];
      const files = await response.json();
      const presets = [];
      for (let i = 0; i < files.length; i++) {
        const fileName = files[i];
        try {
          const presetRes = await fetch(`${PRESET_ROOT}${encodeURIComponent(fileName)}`, { cache: "no-store" });
          if (!presetRes.ok) continue;
          const data = await presetRes.json();
          if (!Array.isArray(data.Parameters)) continue;
          presets.push({
            id: `preset-${i}-${safeName(fileName)}`,
            name: safeName(fileName),
            fileName,
            color: expressionColor(i),
            parameters: data.Parameters.map((param) => ({
              id: String(param.Id),
              value: Number(param.Value ?? 0),
              blend: param.Blend || "Add",
            })),
          });
        } catch {
          // Ignore bad files.
        }
      }
      return presets;
    } catch {
      return [];
    }
  }

  async function ingestFiles(files) {
    const list = [...(files || [])];
    if (!list.length) return;
    const parsed = await Promise.all(list.map(async (file) => {
      try {
        return { file, data: JSON.parse(await file.text()) };
      } catch {
        return { file, error: true };
      }
    }));

    const expressions = parsed
      .filter((item) => !item.error && Array.isArray(item.data?.Parameters))
      .map((item, index) => ({
        id: `preset-upload-${index}-${safeName(item.file.name)}`,
        name: safeName(item.file.name),
        fileName: item.file.name,
        color: expressionColor(index),
        parameters: item.data.Parameters.map((param) => ({
          id: String(param.Id),
          value: Number(param.Value ?? 0),
          blend: param.Blend || "Add",
        })),
      }));

    if (expressions.length) {
      setProjectFromPresets(expressions.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")));
    }
  }

  function copyPreview() {
    navigator.clipboard.writeText(els.jsonPreview.value || exportMotion3());
  }

  function downloadPreview() {
    const blob = new Blob([els.jsonPreview.value || exportMotion3()], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "generated.motion3.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function renderAll(skipHistory = false) {
    refreshNodeIndex();
    renderLibrary();
    updateStats();
    renderGraph();
    renderInspector();
    if (!skipHistory) saveProject();
  }

  function bindEvents() {
    els.searchInput.addEventListener("input", () => {
      state.search = els.searchInput.value;
      renderLibrary();
    });

    els.timeInput.addEventListener("input", () => {
      state.sampleTime = Number(els.timeInput.value || 0);
      renderGraph();
    });

    els.fpsInput.addEventListener("input", () => {
      state.fps = clamp(Number(els.fpsInput.value || 60), 1, 120);
      renderGraph();
      scheduleSave();
    });

    els.btnReset.addEventListener("click", () => {
      if (confirm("重新建立一個新專案？")) {
        createEmptyProject();
        saveProject();
      }
    });

    els.btnExport.addEventListener("click", downloadPreview);
    els.copyJsonBtn.addEventListener("click", copyPreview);
    els.downloadJsonBtn.addEventListener("click", downloadPreview);

    els.folderInput.addEventListener("change", async () => {
      await ingestFiles(els.folderInput.files);
      els.folderInput.value = "";
    });

    els.fileInput.addEventListener("change", async () => {
      await ingestFiles(els.fileInput.files);
      els.fileInput.value = "";
    });

    els.nodeName.addEventListener("input", () => {
      const node = state.nodesById.get(state.selectedNodeId);
      if (!node) return;
      node.title = els.nodeName.value;
      scheduleSave();
      renderGraph();
    });

    els.nodeStart.addEventListener("input", () => {
      const node = state.nodesById.get(state.selectedNodeId);
      if (!node) return;
      node.start = Number(els.nodeStart.value || 0);
      scheduleSave();
      renderGraph();
    });

    els.nodeDuration.addEventListener("input", () => {
      const node = state.nodesById.get(state.selectedNodeId);
      if (!node) return;
      node.duration = Math.max(0.01, Number(els.nodeDuration.value || 0.01));
      scheduleSave();
      renderGraph();
    });

    els.nodeStrength.addEventListener("input", () => {
      const node = state.nodesById.get(state.selectedNodeId);
      if (!node) return;
      node.strength = Number(els.nodeStrength.value || 0);
      scheduleSave();
      renderGraph();
    });

    els.nodeEnabled.addEventListener("change", () => {
      const node = state.nodesById.get(state.selectedNodeId);
      if (!node) return;
      node.enabled = els.nodeEnabled.value === "true";
      scheduleSave();
      renderGraph();
    });

    els.nodeFadeIn.addEventListener("input", () => {
      const node = state.nodesById.get(state.selectedNodeId);
      if (!node) return;
      node.fadeIn = Math.max(0, Number(els.nodeFadeIn.value || 0));
      scheduleSave();
      renderGraph();
    });

    els.nodeFadeOut.addEventListener("input", () => {
      const node = state.nodesById.get(state.selectedNodeId);
      if (!node) return;
      node.fadeOut = Math.max(0, Number(els.nodeFadeOut.value || 0));
      scheduleSave();
      renderGraph();
    });

    els.presetSelect.addEventListener("change", () => {
      const node = state.nodesById.get(state.selectedNodeId);
      if (!node || node.type !== "expression") return;
      node.presetId = els.presetSelect.value;
      const preset = getPresetById(node.presetId);
      node.title = preset?.name || node.title;
      node.note = preset ? `${preset.parameters.length} parameters` : "";
      scheduleSave();
      renderGraph();
    });

    els.addInputBtn.addEventListener("click", () => {
      if (state.selectedNodeId) addInput(state.selectedNodeId);
    });

    els.dupNodeBtn.addEventListener("click", () => {
      const node = state.nodesById.get(state.selectedNodeId);
      if (!node) return;
      const copy = clone(node);
      copy.id = uid("n", state.nextNodeId++);
      copy.x += 24;
      copy.y += 24;
      state.nodes.push(copy);
      refreshNodeIndex();
      selectNode(copy.id);
      scheduleSave();
      renderAll(true);
    });

    els.deleteNodeBtn.addEventListener("click", () => {
      if (state.selectedNodeId) removeNode(state.selectedNodeId);
    });

    els.focusNodeBtn.addEventListener("click", () => {
      const node = state.nodesById.get(state.selectedNodeId);
      if (!node) return;
      node.x = 96;
      node.y = 120;
      scheduleSave();
      renderGraph();
    });

    els.edgeLabel.addEventListener("input", () => {
      const edge = state.edges.find((item) => item.id === state.selectedEdgeId);
      if (!edge) return;
      edge.label = els.edgeLabel.value;
      scheduleSave();
    });

    els.deleteEdgeBtn.addEventListener("click", () => {
      if (state.selectedEdgeId) removeEdge(state.selectedEdgeId);
    });

    window.addEventListener("pointermove", (event) => {
      state.pointer = {
        x: event.clientX - els.graph.getBoundingClientRect().left,
        y: event.clientY - els.graph.getBoundingClientRect().top,
      };
      if (state.connecting) renderGraph();
    });

    window.addEventListener("pointerup", (event) => {
      if (!state.connecting) return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const inputSocket = hit?.closest?.(".socket.input");
      if (inputSocket) {
        const toNode = inputSocket.closest(".node");
        const toSocket = Number(inputSocket.dataset.index);
        const ok = connectNodes(state.connecting.fromId, state.connecting.fromSocket, toNode.dataset.id, toSocket);
        if (ok) {
          els.ghostWire.classList.add("hidden");
          state.connecting = null;
          renderAll(true);
          return;
        }
      }
      state.connecting = null;
      els.ghostWire.classList.add("hidden");
      renderGraph();
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        if (state.selectedEdgeId) {
          removeEdge(state.selectedEdgeId);
          return;
        }
        if (state.selectedNodeId) {
          removeNode(state.selectedNodeId);
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        downloadPreview();
      }
    });

    els.graph.addEventListener("click", (event) => {
      if (event.target === els.graph || event.target === els.wires) {
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        renderInspector();
        renderGraph();
      }
    });

    window.addEventListener("resize", () => renderGraph());
  }

  async function init() {
    bindEvents();
    const loaded = loadProject();
    const presets = await loadManifestPresets();
    setProjectFromPresets(presets);
    if (!loaded) createEmptyProject();
    if (loaded && !state.nodes.length) createEmptyProject();
    if (!loaded) saveProject();
    renderAll(true);
    renderPreview();
    if (state.nodes.length) {
      const node = state.nodesById.get(state.selectedNodeId) || state.nodes[0];
      if (node) selectNode(node.id);
    }
  }

  init();
})();
