(function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    folderInput: $("folderInput"),
    fileInput: $("fileInput"),
    exportBtn: $("exportBtn"),
    copyJsonBtn: $("copyJsonBtn"),
    downloadJsonBtn: $("downloadJsonBtn"),
    librarySearch: $("librarySearch"),
    libraryList: $("libraryList"),
    exprCount: $("exprCount"),
    paramCount: $("paramCount"),
    nodeCount: $("nodeCount"),
    durationLabel: $("durationLabel"),
    fpsInput: $("fpsInput"),
    playheadInput: $("playheadInput"),
    ruler: $("ruler"),
    stage: $("stage"),
    playhead: $("playhead"),
    inspector: $("inspector"),
    inspectorEmpty: $("inspectorEmpty"),
    nodeName: $("nodeName"),
    nodeStart: $("nodeStart"),
    nodeDuration: $("nodeDuration"),
    nodeStrength: $("nodeStrength"),
    nodeFadeIn: $("nodeFadeIn"),
    nodeFadeOut: $("nodeFadeOut"),
    nodeEnabled: $("nodeEnabled"),
    duplicateBtn: $("duplicateBtn"),
    deleteBtn: $("deleteBtn"),
    paramList: $("paramList"),
    nodeMeta: $("nodeMeta"),
    playheadSummary: $("playheadSummary"),
    exportPreview: $("exportPreview"),
    outputName: $("outputName"),
  };

  const COLORS = ["#6ee7c8", "#7aa8ff", "#ffb86b", "#ff7a92", "#a98bff", "#6fd7ff", "#f3d16b"];
  const PX_PER_SECOND = 88;
  const DEFAULT_DURATION = 0.5;

  const state = {
    template: null,
    expressions: [],
    nodes: [],
    selectedNodeId: null,
    search: "",
    fps: 60,
    playhead: 0,
    exportCache: "",
  };

  const uid = (prefix) => {
    if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, digits = 6) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  };
  const fmt = (value, digits = 2) => Number(value || 0).toFixed(digits);
  const sanitizeName = (name) => String(name || "untitled").replace(/\.[^.]+$/, "").trim();

  function isMotion3(data) {
    return Boolean(data && typeof data === "object" && data.Meta && Array.isArray(data.Curves));
  }

  function isExpression(data) {
    return Boolean(data && typeof data === "object" && Array.isArray(data.Parameters));
  }

  function getExpressionById(id) {
    return state.expressions.find((expr) => expr.id === id) || null;
  }

  function getNodeById(id) {
    return state.nodes.find((node) => node.id === id) || null;
  }

  function getAllParameterIds() {
    const ids = new Set();
    state.expressions.forEach((expr) => expr.parameters.forEach((p) => ids.add(p.id)));
    return [...ids].sort((a, b) => a.localeCompare(b));
  }

  function inferDuration() {
    const templateDuration = Number(state.template?.Meta?.Duration || 0);
    const nodeDuration = state.nodes.reduce((max, node) => Math.max(max, node.start + node.duration), 0);
    return Math.max(DEFAULT_DURATION, templateDuration, nodeDuration);
  }

  function normalizeExpression(file, data, index) {
    return {
      id: uid("expr"),
      name: sanitizeName(file.name),
      fileName: file.name,
      color: COLORS[index % COLORS.length],
      parameters: (data.Parameters || []).map((param) => ({
        id: String(param.Id),
        value: Number(param.Value ?? 0),
        blend: param.Blend || "Add",
      })),
    };
  }

  function createNode(expr, opts = {}) {
    const start = opts.start ?? Math.max(0, state.playhead);
    const node = {
      id: uid("node"),
      exprId: expr.id,
      name: expr.name,
      color: expr.color,
      x: opts.x ?? start * PX_PER_SECOND,
      y: opts.y ?? 36 + (state.nodes.length % 6) * 92,
      start,
      duration: opts.duration ?? 2.5,
      strength: opts.strength ?? 1,
      fadeIn: opts.fadeIn ?? 0.12,
      fadeOut: opts.fadeOut ?? 0.12,
      enabled: opts.enabled ?? true,
      parameters: clone(expr.parameters),
    };
    state.nodes.push(node);
    state.selectedNodeId = node.id;
    refreshAll();
  }

  async function readFile(file) {
    try {
      return { file, data: JSON.parse(await file.text()) };
    } catch {
      return { file, error: "invalid-json" };
    }
  }

  async function ingestFiles(files) {
    const list = [...(files || [])];
    if (!list.length) return;

    const parsed = await Promise.all(list.map(readFile));
    const expressions = [];
    let template = null;

    parsed.forEach((entry, index) => {
      if (entry.error) return;
      if (isMotion3(entry.data) && !template) {
        template = entry.data;
        return;
      }
      if (isExpression(entry.data)) {
        expressions.push(normalizeExpression(entry.file, entry.data, index));
      }
    });

    if (template) state.template = template;
    if (expressions.length) state.expressions = expressions.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));

    if (!state.template && !state.expressions.length) {
      state.exportCache = "未偵測到可用的 `motion3` 或 `exp3` 檔案。";
      els.exportPreview.value = state.exportCache;
      refreshAll(false);
      return;
    }

    const duration = inferDuration();
    els.playheadInput.max = String(duration);
    state.playhead = clamp(state.playhead, 0, duration);
    els.playheadInput.value = String(state.playhead);
    refreshAll();
  }

  function renderLibrary() {
    const query = state.search.trim().toLowerCase();
    els.libraryList.innerHTML = "";

    const filtered = state.expressions.filter((expr) => {
      if (!query) return true;
      const haystack = [expr.name, expr.fileName, ...expr.parameters.map((p) => p.id)].join(" ").toLowerCase();
      return haystack.includes(query);
    });

    els.exprCount.textContent = String(state.expressions.length);
    els.paramCount.textContent = String(getAllParameterIds().length);

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = "<strong>沒有符合的項目</strong><p>可以試著搜尋參數名稱，例如 `ParamMouthOpen`。</p>";
      els.libraryList.appendChild(empty);
      return;
    }

    filtered.forEach((expr) => {
      const tpl = $("libraryCardTemplate");
      const card = tpl.content.firstElementChild.cloneNode(true);
      card.querySelector(".expr-name").textContent = expr.name;
      card.querySelector(".expr-file").textContent = expr.fileName;
      card.querySelector(".expr-summary").textContent = `${expr.parameters.length} 個參數，點擊可新增到時間軸。`;

      const chipList = card.querySelector(".chip-list");
      expr.parameters.slice(0, 5).forEach((param) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = param.id;
        chipList.appendChild(chip);
      });
      if (expr.parameters.length > 5) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = `+${expr.parameters.length - 5}`;
        chipList.appendChild(chip);
      }

      card.querySelector(".add-node-btn").addEventListener("click", () => createNode(expr));
      els.libraryList.appendChild(card);
    });
  }

  function renderRuler() {
    const duration = inferDuration();
    const width = Math.max(els.stage.clientWidth, duration * PX_PER_SECOND + 80);
    els.stage.style.width = `${width}px`;

    els.ruler.innerHTML = "";
    const marks = Math.max(1, Math.ceil(duration));
    for (let i = 0; i <= marks; i++) {
      const label = document.createElement("div");
      label.className = "ruler-label";
      label.style.left = `${(i / Math.max(1, duration)) * 100}%`;
      label.textContent = `${i}s`;
      els.ruler.appendChild(label);
    }
  }

  function renderNodes() {
    [...els.stage.querySelectorAll(".node-card")].forEach((el) => el.remove());

    state.nodes.forEach((node) => {
      const tpl = $("nodeTemplate");
      const card = tpl.content.firstElementChild.cloneNode(true);
      const expr = getExpressionById(node.exprId);
      const color = expr?.color || node.color || "#6ee7c8";
      card.dataset.nodeId = node.id;
      card.classList.toggle("selected", node.id === state.selectedNodeId);
      card.style.left = `${node.x}px`;
      card.style.top = `${node.y}px`;
      card.style.borderColor = node.id === state.selectedNodeId ? color : "rgba(143, 161, 186, 0.18)";

      card.querySelector(".node-title").textContent = node.name;
      card.querySelector(".node-time").textContent = `start ${fmt(node.start)}s · ${fmt(node.duration)}s · x${fmt(node.strength, 2)}`;

      const badgeList = card.querySelector(".node-badge-list");
      const miniStats = card.querySelector(".node-mini-stats");
      const activeCount = node.parameters.filter((p) => p.value !== 0).length;
      const badges = [`${node.parameters.length} params`, `${activeCount} active`];
      badgeList.innerHTML = "";
      badges.forEach((text) => {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = text;
        badgeList.appendChild(badge);
      });

      miniStats.innerHTML = "";
      const mini = document.createElement("span");
      mini.className = "mini-stat";
      mini.textContent = `fade ${fmt(node.fadeIn)} / ${fmt(node.fadeOut)}`;
      miniStats.appendChild(mini);

      card.querySelector(".node-handle").addEventListener("pointerdown", (event) => beginNodeDrag(event, node.id));
      card.addEventListener("click", (event) => {
        if (event.target.closest("input, button")) return;
        state.selectedNodeId = node.id;
        renderNodes();
        renderInspector();
      });

      els.stage.appendChild(card);
    });

    els.nodeCount.textContent = String(state.nodes.length);
  }

  function renderInspector() {
    const node = getNodeById(state.selectedNodeId);
    const hasNode = Boolean(node);
    els.inspector.classList.toggle("hidden", !hasNode);
    els.inspectorEmpty.classList.toggle("hidden", hasNode);
    if (!node) return;

    els.nodeName.value = node.name;
    els.nodeStart.value = round(node.start, 3);
    els.nodeDuration.value = round(node.duration, 3);
    els.nodeStrength.value = round(node.strength, 3);
    els.nodeFadeIn.value = round(node.fadeIn, 3);
    els.nodeFadeOut.value = round(node.fadeOut, 3);
    els.nodeEnabled.checked = Boolean(node.enabled);
    els.nodeMeta.textContent = `${node.parameters.length} 個參數`;

    els.paramList.innerHTML = "";
    node.parameters.forEach((param, index) => {
      const row = document.createElement("div");
      row.className = "param-row";
      const name = document.createElement("span");
      name.textContent = param.id;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.05";
      input.value = String(param.value);
      input.addEventListener("input", () => {
        const liveNode = getNodeById(node.id);
        if (!liveNode) return;
        liveNode.parameters[index].value = Number(input.value || 0);
        refreshAll(false);
      });
      row.appendChild(name);
      row.appendChild(input);
      els.paramList.appendChild(row);
    });
  }

  function sampleNodeContribution(node, time) {
    if (!node.enabled) return null;
    const start = node.start;
    const end = node.start + node.duration;
    if (time < start || time > end) return null;

    let env = 1;
    if (node.fadeIn > 0 && time < start + node.fadeIn) {
      env = clamp((time - start) / node.fadeIn, 0, 1);
    }
    if (node.fadeOut > 0 && time > end - node.fadeOut) {
      env = Math.min(env, clamp((end - time) / node.fadeOut, 0, 1));
    }

    const result = {};
    node.parameters.forEach((param) => {
      result[param.id] = (result[param.id] || 0) + Number(param.value || 0) * node.strength * env;
    });
    return result;
  }

  function sampleAt(time) {
    const result = {};
    state.nodes.forEach((node) => {
      const contribution = sampleNodeContribution(node, time);
      if (!contribution) return;
      Object.entries(contribution).forEach(([id, value]) => {
        result[id] = (result[id] || 0) + value;
      });
    });
    return result;
  }

  function renderSummary() {
    const duration = inferDuration();
    els.durationLabel.textContent = `${fmt(duration)}s`;
    els.playhead.style.left = `${clamp(state.playhead, 0, duration) * PX_PER_SECOND}px`;
    els.playheadInput.max = String(duration);
    els.playheadInput.value = String(clamp(state.playhead, 0, duration));

    const sample = sampleAt(state.playhead);
    const top = Object.entries(sample)
      .filter(([, value]) => Math.abs(value) > 0.00001)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 10);

    els.playheadSummary.innerHTML = "";
    [
      ["播放頭", `${fmt(state.playhead)}s / ${fmt(duration)}s`],
      ["啟用節點", String(state.nodes.filter((n) => n.enabled).length)],
    ].forEach(([label, value]) => {
      const line = document.createElement("div");
      line.className = "line";
      line.innerHTML = `<span>${label}</span><span>${value}</span>`;
      els.playheadSummary.appendChild(line);
    });

    if (!top.length) {
      const line = document.createElement("div");
      line.className = "line";
      line.innerHTML = "<span>參數加總</span><span>目前沒有數值</span>";
      els.playheadSummary.appendChild(line);
      return;
    }

    top.forEach(([id, value]) => {
      const line = document.createElement("div");
      line.className = "line";
      line.innerHTML = `<span>${id}</span><span>${fmt(value, 4)}</span>`;
      els.playheadSummary.appendChild(line);
    });
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

  function generateMotion3() {
    const duration = inferDuration();
    const fps = clamp(Number(els.fpsInput.value || 60), 1, 120);
    state.fps = fps;

    const times = [];
    const step = 1 / fps;
    for (let t = 0; t < duration; t += step) times.push(round(t, 6));
    if (times[times.length - 1] !== round(duration, 6)) times.push(round(duration, 6));
    const sampled = times.map((t) => ({ t, values: sampleAt(t) }));

    const curves = [{
      Target: "Model",
      Id: "Opacity",
      Segments: [0, 1.0, 0, round(duration), 1.0],
    }];
    let totalSegments = 1;
    let totalPoints = 2;

    getAllParameterIds().forEach((paramId) => {
      const points = simplifyPoints(sampled.map((sample) => ({ t: sample.t, v: sample.values[paramId] || 0 })));
      curves.push({
        Target: "Parameter",
        Id: paramId,
        Segments: buildCurveSegments(points),
      });
      totalSegments += Math.max(0, points.length - 1);
      totalPoints += points.length;
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

  function refreshExport() {
    const json = generateMotion3();
    state.exportCache = json;
    els.exportPreview.value = json;
  }

  function refreshAll(updateExport = true) {
    renderLibrary();
    renderRuler();
    renderNodes();
    renderInspector();
    renderSummary();
    if (updateExport) refreshExport();
  }

  function updateSelectedNode(mutator) {
    const node = getNodeById(state.selectedNodeId);
    if (!node) return;
    mutator(node);
    node.start = Math.max(0, Number(node.start || 0));
    node.duration = Math.max(0.01, Number(node.duration || 0.01));
    node.strength = Number(node.strength || 0);
    node.fadeIn = Math.max(0, Number(node.fadeIn || 0));
    node.fadeOut = Math.max(0, Number(node.fadeOut || 0));
    node.x = node.start * PX_PER_SECOND;
    refreshAll();
  }

  function duplicateSelectedNode() {
    const node = getNodeById(state.selectedNodeId);
    if (!node) return;
    const copy = clone(node);
    copy.id = uid("node");
    copy.x += 24;
    copy.y += 24;
    copy.start += 0.25;
    state.nodes.push(copy);
    state.selectedNodeId = copy.id;
    refreshAll();
  }

  function deleteSelectedNode() {
    if (!state.selectedNodeId) return;
    state.nodes = state.nodes.filter((node) => node.id !== state.selectedNodeId);
    state.selectedNodeId = state.nodes[0]?.id || null;
    refreshAll();
  }

  function exportJson() {
    const json = state.exportCache || generateMotion3();
    const name = `${sanitizeName(els.outputName.value || "generated")}.motion3.json`;
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function copyExport() {
    await navigator.clipboard.writeText(state.exportCache || generateMotion3());
  }

  function beginNodeDrag(event, nodeId) {
    event.preventDefault();
    const node = getNodeById(nodeId);
    if (!node) return;
    state.selectedNodeId = nodeId;
    const rect = els.stage.getBoundingClientRect();
    const originX = event.clientX;
    const originY = event.clientY;
    const startX = node.x;
    const startY = node.y;

    const onMove = (moveEvent) => {
      node.x = Math.max(0, startX + (moveEvent.clientX - originX));
      node.y = clamp(startY + (moveEvent.clientY - originY), 12, Math.max(12, rect.height - 120));
      node.start = Math.max(0, node.x / PX_PER_SECOND);
      renderNodes();
      renderInspector();
      renderSummary();
      refreshExport();
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      refreshAll();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function wireEvents() {
    els.folderInput.addEventListener("change", async () => {
      await ingestFiles(els.folderInput.files);
      els.folderInput.value = "";
    });

    els.fileInput.addEventListener("change", async () => {
      await ingestFiles(els.fileInput.files);
      els.fileInput.value = "";
    });

    els.exportBtn.addEventListener("click", exportJson);
    els.downloadJsonBtn.addEventListener("click", exportJson);
    els.copyJsonBtn.addEventListener("click", async () => {
      try {
        await copyExport();
        els.copyJsonBtn.textContent = "已複製";
      } catch {
        els.copyJsonBtn.textContent = "複製失敗";
      } finally {
        setTimeout(() => (els.copyJsonBtn.textContent = "複製 JSON"), 900);
      }
    });

    els.librarySearch.addEventListener("input", () => {
      state.search = els.librarySearch.value;
      renderLibrary();
    });

    els.fpsInput.addEventListener("input", () => refreshExport());

    els.playheadInput.addEventListener("input", () => {
      state.playhead = Number(els.playheadInput.value || 0);
      renderSummary();
    });

    [
      [els.nodeName, (node, value) => { node.name = value; }],
      [els.nodeStart, (node, value) => { node.start = Number(value || 0); node.x = node.start * PX_PER_SECOND; }],
      [els.nodeDuration, (node, value) => { node.duration = Number(value || 0.01); }],
      [els.nodeStrength, (node, value) => { node.strength = Number(value || 0); }],
      [els.nodeFadeIn, (node, value) => { node.fadeIn = Number(value || 0); }],
      [els.nodeFadeOut, (node, value) => { node.fadeOut = Number(value || 0); }],
      [els.nodeEnabled, (node, value) => { node.enabled = value; }],
    ].forEach(([field, handler]) => {
      const eventName = field.type === "checkbox" ? "change" : "input";
      field.addEventListener(eventName, () => {
        updateSelectedNode((node) => handler(node, field.type === "checkbox" ? field.checked : field.value));
        refreshExport();
      });
    });

    els.duplicateBtn.addEventListener("click", duplicateSelectedNode);
    els.deleteBtn.addEventListener("click", deleteSelectedNode);

    els.stage.addEventListener("dragover", (event) => event.preventDefault());
    els.stage.addEventListener("drop", async (event) => {
      event.preventDefault();
      if (event.dataTransfer?.files?.length) {
        await ingestFiles(event.dataTransfer.files);
      }
    });
  }

  function initialRender() {
    els.playheadInput.max = "10";
    els.playheadInput.value = "0";
    els.durationLabel.textContent = `${DEFAULT_DURATION.toFixed(2)}s`;
    renderLibrary();
    renderRuler();
    renderNodes();
    renderInspector();
    renderSummary();
    refreshExport();
  }

  wireEvents();
  initialRender();
})();
