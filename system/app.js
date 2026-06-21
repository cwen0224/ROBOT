(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const PRESET_MANIFEST = "expression-manifest.json";
  const PRESET_DIR = "../expressions/";
  const PX_PER_SECOND = 90;

  const els = {
    folderInput: $("folderInput"),
    fileInput: $("fileInput"),
    exportBtn: $("exportBtn"),
    librarySearch: $("librarySearch"),
    libraryList: $("libraryList"),
    exprCount: $("exprCount"),
    paramCount: $("paramCount"),
    nodeCount: $("nodeCount"),
    durationLabel: $("durationLabel"),
    fpsInput: $("fpsInput"),
    sampleTimeInput: $("sampleTimeInput"),
    graphCanvas: $("graphCanvas"),
    inspectorEmpty: $("inspectorEmpty"),
    inspector: $("inspector"),
    nodeType: $("nodeType"),
    nodeName: $("nodeName"),
    nodeStart: $("nodeStart"),
    nodeDuration: $("nodeDuration"),
    nodeStrength: $("nodeStrength"),
    nodeEnabled: $("nodeEnabled"),
    nodeFadeIn: $("nodeFadeIn"),
    nodeFadeOut: $("nodeFadeOut"),
    nodePreset: $("nodePreset"),
    nodePresetWrap: $("nodePresetWrap"),
    addInputBtn: $("addInputBtn"),
    duplicateBtn: $("duplicateBtn"),
    deleteBtn: $("deleteBtn"),
    focusBtn: $("focusBtn"),
    exportPreview: $("exportPreview"),
  };

  const state = {
    graph: null,
    canvas: null,
    presets: [],
    presetsById: new Map(),
    search: "",
    fps: 60,
    sampleTime: 0,
    exportCache: "",
    selectedNode: null,
    defaultDuration: 6,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, digits = 6) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function safeName(name) {
    return String(name || "untitled").replace(/\.[^.]+$/, "").trim();
  }

  function presetColor(index) {
    const colors = ["#6ee7c8", "#7aa8ff", "#ffb86b", "#ff7a92", "#a98bff", "#6fd7ff", "#f3d16b"];
    return colors[index % colors.length];
  }

  function createParamMap(params) {
    const out = {};
    params.forEach((param) => {
      out[param.id] = (out[param.id] || 0) + Number(param.value || 0);
    });
    return out;
  }

  function mergeParamMaps(list) {
    const out = {};
    list.forEach((map) => {
      if (!map) return;
      Object.entries(map).forEach(([key, value]) => {
        out[key] = (out[key] || 0) + Number(value || 0);
      });
    });
    return out;
  }

  function evaluateExpressionNode(node, time, presetLookup) {
    const preset = presetLookup.get(node.properties.presetId);
    if (!preset || !node.properties.enabled) return {};

    const start = Number(node.properties.start || 0);
    const duration = Math.max(0.01, Number(node.properties.duration || 0.01));
    const end = start + duration;
    if (time < start || time > end) return {};

    let envelope = 1;
    const fadeIn = Math.max(0, Number(node.properties.fadeIn || 0));
    const fadeOut = Math.max(0, Number(node.properties.fadeOut || 0));
    if (fadeIn > 0 && time < start + fadeIn) {
      envelope = clamp((time - start) / fadeIn, 0, 1);
    }
    if (fadeOut > 0 && time > end - fadeOut) {
      envelope = Math.min(envelope, clamp((end - time) / fadeOut, 0, 1));
    }

    const strength = Number(node.properties.strength || 0);
    const out = {};
    preset.parameters.forEach((param) => {
      out[param.id] = (out[param.id] || 0) + Number(param.value || 0) * strength * envelope;
    });
    return out;
  }

  function findNodeById(id) {
    if (!state.graph) return null;
    if (typeof state.graph.getNodeById === "function") {
      return state.graph.getNodeById(id);
    }
    return (state.graph._nodes || []).find((node) => node.id === id) || null;
  }

  function getSelectedNode() {
    if (!state.graph) return null;
    return (state.graph._nodes || []).find((node) => node.selected) || null;
  }

  function collectUpstreamNodes(node, visited = new Set()) {
    const results = [];
    if (!node || visited.has(node.id)) return results;
    visited.add(node.id);

    const inputs = node.inputs || [];
    for (const input of inputs) {
      const linkId = input && input.link;
      if (!linkId || !state.graph.links) continue;
      const link = state.graph.links[linkId];
      if (!link) continue;
      const upstream = findNodeById(link.origin_id);
      if (!upstream) continue;
      results.push(upstream);
      results.push(...collectUpstreamNodes(upstream, visited));
    }
    return results;
  }

  function collectExpressionNodesForExport() {
    const exportNodes = (state.graph._nodes || []).filter((node) => node.type === "robot/export");
    const visited = new Set();
    const nodes = [];
    exportNodes.forEach((exportNode) => {
      nodes.push(...collectUpstreamNodes(exportNode, visited));
    });
    return nodes.filter((node) => node.type === "robot/expression");
  }

  function makeExpressionNode(preset, opts = {}) {
    const node = LiteGraph.createNode("robot/expression");
    node.properties.presetId = preset.id;
    node.properties.name = preset.name;
    node.properties.enabled = true;
    node.properties.start = opts.start ?? 0;
    node.properties.duration = opts.duration ?? 2.5;
    node.properties.strength = opts.strength ?? 1;
    node.properties.fadeIn = opts.fadeIn ?? 0.12;
    node.properties.fadeOut = opts.fadeOut ?? 0.12;
    node.boxcolor = preset.color;
    node.pos = [opts.x ?? 80 + state.graph._nodes.length * 20, opts.y ?? 80 + (state.graph._nodes.length % 5) * 90];
    return node;
  }

  function generateMotion3() {
    const duration = inferDuration();
    const fps = clamp(Number(els.fpsInput.value || 60), 1, 120);
    const step = 1 / fps;
    const times = [];
    for (let t = 0; t < duration; t += step) {
      times.push(round(t, 6));
    }
    if (times[times.length - 1] !== round(duration, 6)) {
      times.push(round(duration, 6));
    }

    const expressionNodes = collectExpressionNodesForExport();
    const curveIds = new Set();
    const curves = [
      {
        Target: "Model",
        Id: "Opacity",
        Segments: [0, 1.0, 0, round(duration), 1.0],
      },
    ];

    let totalSegments = 1;
    let totalPoints = 2;

    times.forEach((time) => {
      expressionNodes.forEach((node) => {
        const preset = state.presetsById.get(node.properties.presetId);
        if (!preset) return;
        preset.parameters.forEach((param) => curveIds.add(param.id));
      });
    });

    [...curveIds].sort((a, b) => a.localeCompare(b, "zh-Hant")).forEach((paramId) => {
      const points = times.map((time) => ({
        t: time,
        v: expressionNodes.reduce((sum, node) => {
          const contribution = evaluateExpressionNode(node, time, state.presetsById);
          return sum + Number(contribution[paramId] || 0);
        }, 0),
      }));
      const simplified = simplifyPoints(points);
      curves.push({
        Target: "Parameter",
        Id: paramId,
        Segments: buildCurveSegments(simplified),
      });
      totalSegments += Math.max(0, simplified.length - 1);
      totalPoints += simplified.length;
    });

    return JSON.stringify({
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
    }, null, 2);
  }

  function inferDuration() {
    const nodes = state.graph ? state.graph._nodes || [] : [];
    const expressionNodes = nodes.filter((node) => node.type === "robot/expression");
    const maxNode = expressionNodes.reduce((max, node) => {
      const start = Number(node.properties.start || 0);
      const duration = Number(node.properties.duration || 0);
      return Math.max(max, start + duration);
    }, 0);
    return Math.max(state.defaultDuration, maxNode);
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

  function updateStats() {
    const nodes = state.graph ? state.graph._nodes || [] : [];
    els.nodeCount.textContent = String(nodes.length);
    els.durationLabel.textContent = `${inferDuration().toFixed(2)}s`;
    els.paramCount.textContent = String(getAllParameterIds().length);
  }

  function getAllParameterIds() {
    const ids = new Set();
    state.presets.forEach((preset) => {
      preset.parameters.forEach((param) => ids.add(param.id));
    });
    return [...ids];
  }

  function renderLibrary() {
    const query = state.search.trim().toLowerCase();
    const filtered = state.presets.filter((preset) => {
      if (!query) return true;
      const haystack = [preset.name, preset.fileName, ...preset.parameters.map((p) => p.id)].join(" ").toLowerCase();
      return haystack.includes(query);
    });

    els.exprCount.textContent = String(state.presets.length);
    els.libraryList.innerHTML = "";

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = "<strong>沒有符合的項目</strong><p>可以試試參數名稱，例如 `ParamMouthOpen`。</p>";
      els.libraryList.appendChild(empty);
      return;
    }

    filtered.forEach((preset) => {
      const tpl = $("libraryCardTemplate");
      const card = tpl.content.firstElementChild.cloneNode(true);
      card.querySelector(".expr-name").textContent = preset.name;
      card.querySelector(".expr-file").textContent = preset.fileName;
      card.querySelector(".expr-summary").textContent = `${preset.parameters.length} 個參數，可直接拖進畫布建立節點。`;

      const chipList = card.querySelector(".chip-list");
      preset.parameters.slice(0, 5).forEach((param) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = param.id;
        chipList.appendChild(chip);
      });
      if (preset.parameters.length > 5) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = `+${preset.parameters.length - 5}`;
        chipList.appendChild(chip);
      }

      card.querySelector(".add-node-btn").addEventListener("click", () => {
        addExpressionPresetToGraph(preset);
      });
      els.libraryList.appendChild(card);
    });
  }

  function addExpressionPresetToGraph(preset, opts = {}) {
    const node = makeExpressionNode(preset, opts);
    state.graph.add(node);
    state.graph.setDirtyCanvas(true, true);
    selectNode(node);
    updateExportPreview();
  }

  function registerNodeTypes() {
    function RobotExpressionNode() {
      this.addOutput("params", "robot/params");
      this.properties = {
        presetId: "",
        name: "Expression",
        start: 0,
        duration: 2.5,
        strength: 1,
        fadeIn: 0.12,
        fadeOut: 0.12,
        enabled: true,
      };
      this.size = [240, 110];
      this.color = "#233047";
    }

    RobotExpressionNode.title = "Expression";
    RobotExpressionNode.desc = "Live2D expression preset";
    RobotExpressionNode.prototype.onExecute = function () {
      this.setOutputData(0, createParamMap(this.getCurrentParameters()));
    };
    RobotExpressionNode.prototype.getCurrentParameters = function () {
      const preset = state.presetsById.get(this.properties.presetId);
      if (!preset) return [];
      return preset.parameters;
    };
    RobotExpressionNode.prototype.onDrawForeground = function (ctx) {
      const preset = state.presetsById.get(this.properties.presetId);
      if (!preset) return;
      ctx.save();
      ctx.fillStyle = "#dbe7f7";
      ctx.font = "12px sans-serif";
      ctx.fillText(`start ${Number(this.properties.start || 0).toFixed(2)}s`, 12, 54);
      ctx.fillText(`dur ${Number(this.properties.duration || 0).toFixed(2)}s`, 12, 70);
      ctx.fillText(`x${Number(this.properties.strength || 0).toFixed(2)}`, 12, 86);
      ctx.fillStyle = preset.color;
      ctx.fillText(preset.name, 12, 22);
      ctx.restore();
    };
    LiteGraph.registerNodeType("robot/expression", RobotExpressionNode);

    function RobotMixerNode() {
      this.addInput("in 1", "robot/params");
      this.addOutput("sum", "robot/params");
      this.properties = { name: "Mixer" };
      this.size = [200, 110];
      this.color = "#1f3a3e";
    }

    RobotMixerNode.title = "Mixer";
    RobotMixerNode.prototype.onExecute = function () {
      const inputs = [];
      for (let i = 0; i < this.inputs.length; i++) {
        inputs.push(this.getInputData(i));
      }
      this.setOutputData(0, mergeParamMaps(inputs));
    };
    LiteGraph.registerNodeType("robot/mixer", RobotMixerNode);

    function RobotExportNode() {
      this.addInput("in 1", "robot/params");
      this.properties = { name: "Export" };
      this.size = [230, 110];
      this.color = "#3a2f1e";
    }

    RobotExportNode.title = "Export";
    RobotExportNode.prototype.onExecute = function () {
      const inputs = [];
      for (let i = 0; i < this.inputs.length; i++) {
        inputs.push(this.getInputData(i));
      }
      this.currentSum = mergeParamMaps(inputs);
    };
    RobotExportNode.prototype.onDrawForeground = function (ctx) {
      ctx.save();
      ctx.fillStyle = "#dbe7f7";
      ctx.font = "12px sans-serif";
      ctx.fillText("MOTION3 output", 12, 22);
      ctx.fillText(`fps ${state.fps}`, 12, 44);
      ctx.fillText(`time ${state.sampleTime.toFixed(2)}s`, 12, 60);
      ctx.fillText("use sidebar to export", 12, 78);
      ctx.restore();
    };
    LiteGraph.registerNodeType("robot/export", RobotExportNode);
  }

  function createDefaultGraph() {
    state.graph = new LiteGraph.LGraph();
    state.canvas = new LiteGraph.LGraphCanvas("#graphCanvas", state.graph);
    state.canvas.background_image = null;
    state.canvas.ds.scale = 1;
    state.canvas.allow_searchbox = true;
    state.canvas.onDropItem = null;
    state.graph.start();

    const mixer = LiteGraph.createNode("robot/mixer");
    mixer.pos = [520, 180];
    state.graph.add(mixer);

    const exportNode = LiteGraph.createNode("robot/export");
    exportNode.pos = [840, 190];
    state.graph.add(exportNode);

    mixer.connect(0, exportNode, 0);
    state.graph.setDirtyCanvas(true, true);
    if (typeof state.canvas.resize === "function") {
      state.canvas.resize();
    }
  }

  function selectNode(node) {
    state.selectedNode = node || null;
    renderInspector();
  }

  function renderInspector() {
    const node = getSelectedNode();
    state.selectedNode = node || null;
    const hasNode = Boolean(node);
    els.inspector.classList.toggle("hidden", !hasNode);
    els.inspectorEmpty.classList.toggle("hidden", hasNode);
    if (!node) return;

    els.nodeType.value = node.type || "";
    els.nodeName.value = node.properties?.name || node.title || "";
    els.nodeStart.value = Number(node.properties?.start || 0).toFixed(2);
    els.nodeDuration.value = Number(node.properties?.duration || 0.01).toFixed(2);
    els.nodeStrength.value = Number(node.properties?.strength || 0).toFixed(2);
    els.nodeEnabled.value = String(Boolean(node.properties?.enabled ?? true));
    els.nodeFadeIn.value = Number(node.properties?.fadeIn || 0).toFixed(2);
    els.nodeFadeOut.value = Number(node.properties?.fadeOut || 0).toFixed(2);

    const isExpression = node.type === "robot/expression";
    els.nodePresetWrap.classList.toggle("hidden", !isExpression);
    els.addInputBtn.disabled = !(node.type === "robot/mixer" || node.type === "robot/export");
    els.duplicateBtn.disabled = !node;
    els.deleteBtn.disabled = !node;
    els.focusBtn.disabled = !node;

    if (isExpression) {
      els.nodePreset.innerHTML = "";
      state.presets.forEach((preset) => {
        const option = document.createElement("option");
        option.value = preset.id;
        option.textContent = preset.name;
        if (preset.id === node.properties.presetId) option.selected = true;
        els.nodePreset.appendChild(option);
      });
    }

    if (node.type === "robot/expression") {
      const preset = state.presetsById.get(node.properties.presetId);
      els.exportPreview.value = JSON.stringify(
        {
          node: {
            preset: preset?.name || "",
            start: Number(node.properties.start || 0),
            duration: Number(node.properties.duration || 0),
            strength: Number(node.properties.strength || 0),
            fadeIn: Number(node.properties.fadeIn || 0),
            fadeOut: Number(node.properties.fadeOut || 0),
          },
        },
        null,
        2,
      );
    } else {
      updateExportPreview();
    }
  }

  function updateExportPreview() {
    try {
      state.exportCache = generateMotion3();
      els.exportPreview.value = state.exportCache;
    } catch (error) {
      els.exportPreview.value = `Export error: ${error.message}`;
    }
    updateStats();
  }

  function duplicateNode() {
    const node = state.selectedNode || getSelectedNode();
    if (!node) return;
    const data = deepClone(node.serialize());
    const clone = LiteGraph.createNode(node.type);
    clone.configure(data);
    clone.pos = [node.pos[0] + 28, node.pos[1] + 28];
    if (clone.type === "robot/expression") {
      clone.properties.presetId = node.properties.presetId;
      clone.properties.name = node.properties.name;
    }
    state.graph.add(clone);
    state.graph.setDirtyCanvas(true, true);
    selectNode(clone);
  }

  function deleteNode() {
    const node = state.selectedNode || getSelectedNode();
    if (!node) return;
    state.graph.remove(node);
    state.graph.setDirtyCanvas(true, true);
    selectNode(null);
    updateExportPreview();
  }

  function addInputSocket() {
    const node = state.selectedNode || getSelectedNode();
    if (!node) return;
    if (typeof node.addInput !== "function") return;
    const count = (node.inputs && node.inputs.length) || 0;
    node.addInput(`in ${count + 1}`, "robot/params");
    node.size = node.computeSize ? node.computeSize() : node.size;
    state.graph.setDirtyCanvas(true, true);
    updateExportPreview();
  }

  function focusNode() {
    const node = state.selectedNode || getSelectedNode();
    if (!node || !state.canvas) return;
    state.canvas.centerOnNode(node);
  }

  function bindEvents() {
    els.librarySearch.addEventListener("input", () => {
      state.search = els.librarySearch.value;
      renderLibrary();
    });

    els.fpsInput.addEventListener("input", () => {
      state.fps = clamp(Number(els.fpsInput.value || 60), 1, 120);
      updateExportPreview();
    });

    els.sampleTimeInput.addEventListener("input", () => {
      state.sampleTime = Number(els.sampleTimeInput.value || 0);
      updateExportPreview();
    });

    els.exportBtn.addEventListener("click", () => {
      const blob = new Blob([state.exportCache || generateMotion3()], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "generated.motion3.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    });

    els.folderInput.addEventListener("change", async () => {
      await ingestFiles(els.folderInput.files);
      els.folderInput.value = "";
    });

    els.fileInput.addEventListener("change", async () => {
      await ingestFiles(els.fileInput.files);
      els.fileInput.value = "";
    });

    const syncField = (el, key, transform = (value) => value) => {
      el.addEventListener("input", () => {
        const node = state.selectedNode || getSelectedNode();
        if (!node) return;
        node.properties[key] = transform(el.value);
        state.graph.setDirtyCanvas(true, true);
        updateExportPreview();
      });
    };

    syncField(els.nodeName, "name", (value) => value);
    syncField(els.nodeStart, "start", (value) => Number(value || 0));
    syncField(els.nodeDuration, "duration", (value) => Math.max(0.01, Number(value || 0.01)));
    syncField(els.nodeStrength, "strength", (value) => Number(value || 0));
    syncField(els.nodeFadeIn, "fadeIn", (value) => Math.max(0, Number(value || 0)));
    syncField(els.nodeFadeOut, "fadeOut", (value) => Math.max(0, Number(value || 0)));

    els.nodeEnabled.addEventListener("change", () => {
      const node = state.selectedNode || getSelectedNode();
      if (!node) return;
      node.properties.enabled = els.nodeEnabled.value === "true";
      state.graph.setDirtyCanvas(true, true);
      updateExportPreview();
    });

    els.nodePreset.addEventListener("change", () => {
      const node = state.selectedNode || getSelectedNode();
      if (!node || node.type !== "robot/expression") return;
      node.properties.presetId = els.nodePreset.value;
      const preset = state.presetsById.get(node.properties.presetId);
      if (preset) {
        node.properties.name = preset.name;
        node.boxcolor = preset.color;
      }
      state.graph.setDirtyCanvas(true, true);
      updateExportPreview();
      renderLibrary();
    });

    els.duplicateBtn.addEventListener("click", duplicateNode);
    els.deleteBtn.addEventListener("click", deleteNode);
    els.addInputBtn.addEventListener("click", addInputSocket);
    els.focusBtn.addEventListener("click", focusNode);

    state.canvas.onNodeSelected = (node) => {
      selectNode(node);
    };

    state.canvas.onNodeDblClicked = (node) => {
      if (node.type === "robot/expression") {
        focusNode();
      }
    };

    setInterval(() => {
      const current = getSelectedNode();
      if (current !== state.selectedNode) {
        selectNode(current);
      }
      updateStats();
    }, 250);
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
      .filter((item) => !item.error && item.data && Array.isArray(item.data.Parameters))
      .map((item, index) => normalizeExpression(item.file.name, item.data, index));

    if (!expressions.length) return;

    state.presets = expressions.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    state.presetsById = new Map(state.presets.map((preset) => [preset.id, preset]));
    renderLibrary();
  }

  function normalizeExpression(fileName, data, index) {
    return {
      id: `preset-${index}-${safeName(fileName)}`,
      name: safeName(fileName),
      fileName,
      color: presetColor(index),
      parameters: (data.Parameters || []).map((param) => ({
        id: String(param.Id),
        value: Number(param.Value ?? 0),
        blend: param.Blend || "Add",
      })),
    };
  }

  async function loadManifest() {
    const response = await fetch(PRESET_MANIFEST, { cache: "no-store" });
    if (!response.ok) throw new Error(`manifest ${response.status}`);
    return response.json();
  }

  async function loadPresetFiles() {
    const manifest = await loadManifest();
    const entries = [];
    for (let i = 0; i < manifest.length; i++) {
      const fileName = manifest[i];
      try {
        const response = await fetch(`${PRESET_DIR}${encodeURIComponent(fileName)}`, { cache: "no-store" });
        if (!response.ok) continue;
        const data = await response.json();
        entries.push(normalizeExpression(fileName, data, i));
      } catch {
        // Ignore individual load failures so the app still opens.
      }
    }
    return entries;
  }

  function initCanvas() {
    registerNodeTypes();
    createDefaultGraph();
  }

  async function main() {
    try {
      state.presets = await loadPresetFiles();
    } catch {
      state.presets = [];
    }
    state.presetsById = new Map(state.presets.map((preset) => [preset.id, preset]));
    renderLibrary();
    initCanvas();
    bindEvents();
    window.addEventListener("resize", () => {
      if (state.canvas && typeof state.canvas.resize === "function") {
        state.canvas.resize();
      }
    });
    updateStats();
    updateExportPreview();
  }

  main();
})();
