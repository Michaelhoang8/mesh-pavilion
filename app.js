import { example, validate, parseOBJ, toOBJ, repair } from "./core.js";
const $ = (id) => document.getElementById(id),
  canvas = $("canvas"),
  ctx = canvas.getContext("2d"),
  worker = new Worker("./worker.js", { type: "module" });
let result = null,
  request = 0,
  ready = false,
  title = "Reversed cube",
  ignored = [],
  history = [],
  yaw = -0.65,
  pitch = 0.4,
  zoom = 1,
  selected = null,
  page = 0,
  spinFrame = null,
  lastTime = 0;
function enable(value) {
  ready = value;
  for (const id of ["save", "json", "evidence", "png", "reverse"])
    $(id).disabled = !value;
  $("repair").disabled =
    !value || !result?.canRepair || !result?.flipPlan.length;
}
function run(mesh) {
  enable(false);
  $("error").textContent = "";
  $("status").textContent = "Analyzing…";
  worker.postMessage({ id: ++request, model: mesh });
}
worker.onmessage = ({ data }) => {
  if (data.id !== request) return;
  if (data.error) {
    $("error").textContent = data.error;
    $("status").textContent = "Mesh was not updated.";
    return;
  }
  result = data.result;
  selected = null;
  page = 0;
  enable(true);
  render();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    canvas.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 300 });
  $("status").textContent = ignored.length
    ? "OBJ directives ignored: " + ignored.join(", ") + "."
    : "";
};
worker.onerror = () => {
  $("error").textContent = "The analysis worker stopped. Reload to restart it.";
  enable(false);
};
function remember() {
  history.push({
    mesh: structuredClone(result.mesh),
    title,
    ignored: [...ignored],
  });
  if (history.length > 20) history.shift();
  $("undo").disabled = false;
}
function labelIndices(values) {
  return values.length
    ? values
        .slice(0, 15)
        .map((i) => i + 1)
        .join(", ") +
        (values.length > 15 ? " … (" + values.length + " total)" : "")
    : "none";
}
function render() {
  const s = result.summary;
  $("object-name").textContent = title;
  $("vertices").textContent = s.vertices;
  $("faces").textContent = s.faces;
  $("edges").textContent = s.edges;
  $("boundary").textContent = s.boundaryEdges;
  $("nonmanifold").textContent = s.nonManifoldEdges;
  $("badvertices").textContent = result.badVertices.length;
  $("winding").textContent = s.windingConflicts;
  $("area").textContent = s.area.toFixed(4);
  $("health").textContent = result.degenerateFaces.length
    ? result.degenerateFaces.length + " degenerate triangles; inspect geometry."
    : !result.canRepair
      ? "Topology needs inspection."
      : s.windingConflicts
        ? "Face winding can be made consistent."
        : s.boundaryEdges
          ? "Consistent surface with an open boundary."
          : "Closed, consistently oriented topology.";
  $("components").replaceChildren();
  for (const c of result.components) {
    const card = document.createElement("article");
    card.className = "component";
    const h = document.createElement("h3");
    h.textContent = "Surface " + (c.id + 1);
    card.append(h);
    for (const [text, cls] of [
      [
        c.faces.length +
          " faces · " +
          c.vertices +
          " indexed vertices · " +
          (c.closed ? "no boundary" : "open boundary"),
        "",
      ],
      [
        "χ = " +
          c.euler +
          " · genus " +
          (c.genus === null ? "not reported" : c.genus) +
          " · boundary loops " +
          (c.boundaryLoops === null ? "irregular" : c.boundaryLoops.length),
        "invariants",
      ],
      [
        !c.manifold
          ? "Non-manifold connectivity"
          : !c.orientable
            ? "Manifold, non-orientable"
            : "Manifold, orientable",
        "",
      ],
      [
        "Signed volume: " +
          (c.signedVolume === null
            ? "not reported"
            : c.signedVolume.toFixed(5)),
        "",
      ],
    ]) {
      const p = document.createElement("p");
      p.textContent = text;
      p.className = cls;
      card.append(p);
    }
    $("components").append(card);
  }
  $("diagnostics").textContent =
    "Non-manifold vertex IDs: " +
    labelIndices(result.badVertices) +
    ". Duplicate face IDs: " +
    labelIndices(result.duplicateFaces) +
    ". Degenerate face IDs: " +
    labelIndices(result.degenerateFaces) +
    ". Unused vertices: " +
    (s.vertices - s.usedVertices) +
    ". All displayed IDs are one-based.";
  $("repair-note").textContent = result.canRepair
    ? "Consistency plan flips " +
      result.flipPlan.length +
      " faces: " +
      labelIndices(result.flipPlan) +
      ". This does not choose an outward direction."
    : "Winding repair is disabled for non-manifold or non-orientable surfaces. It cannot resolve their topology.";
  edgeList();
  draw();
}
function filtered() {
  return result.edges.filter(
    (e) =>
      $("edge-filter").value === "all" ||
      ($("edge-filter").value === "problem"
        ? e.kind !== "interior"
        : e.kind === $("edge-filter").value),
  );
}
function edgeList() {
  if (!result) return;
  const edges = filtered(),
    pages = Math.max(1, Math.ceil(edges.length / 12));
  page = Math.max(0, Math.min(page, pages - 1));
  $("previous").disabled = page === 0;
  $("next").disabled = page === pages - 1;
  $("edge-page").textContent =
    edges.length + " edges · page " + (page + 1) + " / " + pages;
  $("edge-list").replaceChildren();
  for (const e of edges.slice(page * 12, page * 12 + 12)) {
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", e.key === selected);
    b.append("v" + (e.vertices[0] + 1) + " — v" + (e.vertices[1] + 1));
    const small = document.createElement("small");
    small.textContent = e.kind;
    b.append(small);
    b.onclick = () => {
      selected = e.key;
      edgeList();
      draw();
    };
    $("edge-list").append(b);
  }
  const e = result.edges.find((e) => e.key === selected);
  $("edge-detail").textContent = e
    ? "Selected edge: " +
      e.incidents.length +
      " incident faces (" +
      e.incidents.map((x) => x.face + 1).join(", ") +
      ")."
    : "Select an edge to highlight it in the drawing.";
}
function transform(v) {
  const a = Math.cos(yaw),
    b = Math.sin(yaw),
    c = Math.cos(pitch),
    d = Math.sin(pitch),
    x = a * v[0] + b * v[2],
    z = -b * v[0] + a * v[2];
  return [x, c * v[1] - d * z, d * v[1] + c * z];
}
function draw() {
  const rect = canvas.getBoundingClientRect(),
    width = rect.width,
    height = rect.height;
  if (!width || !height) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const studio = ctx.createRadialGradient(
    width * 0.45,
    height * 0.4,
    0,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.8,
  );
  studio.addColorStop(0, "#fafaf7");
  studio.addColorStop(1, "#e2e5df");
  ctx.fillStyle = studio;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#d3d7d1";
  for (let y = 25; y < height; y += 25)
    for (let x = 25; x < width; x += 25) {
      ctx.beginPath();
      ctx.arc(x, y, 0.65, 0, Math.PI * 2);
      ctx.fill();
    }
  if (!result) return;
  const vertices = result.mesh.vertices,
    used = [...new Set(result.mesh.faces.flat())],
    mins = [0, 1, 2].map((i) => Math.min(...used.map((v) => vertices[v][i]))),
    maxs = [0, 1, 2].map((i) => Math.max(...used.map((v) => vertices[v][i]))),
    center = mins.map((v, i) => (v + maxs[i]) / 2),
    extent = Math.max(...maxs.map((v, i) => v - mins[i]), 1e-9),
    scale = (Math.min(width * 0.53, height * 0.55) / extent) * zoom;
  const points = vertices
    .map((v) => transform(v.map((x, i) => x - center[i])))
    .map((v) => ({
      x: width / 2 + v[0] * scale,
      y: height / 2 - v[1] * scale,
      z: v[2],
    }));
  // Small orientation axes remain independent of the object scale.
  const origin = [width - 52, 90];
  for (const [axis, label, color] of [
    [[1, 0, 0], "X", "#bf6a49"],
    [[0, 1, 0], "Y", "#618065"],
    [[0, 0, 1], "Z", "#6689aa"],
  ]) {
    const v = transform(axis),
      x = origin[0] + v[0] * 24,
      y = origin[1] - v[1] * 24;
    ctx.beginPath();
    ctx.moveTo(...origin);
    ctx.lineTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "9px Arial";
    ctx.fillText(label, x + 3, y - 3);
  }
  const order = result.mesh.faces
    .map((f, i) => ({ f, i, z: f.reduce((s, v) => s + points[v].z, 0) / 3 }))
    .sort((a, b) => a.z - b.z);
  for (const { f, i } of order) {
    const n = transform(result.normals[i]),
      light = 0.42 + 0.48 * Math.abs(0.3 * n[0] + 0.5 * n[1] + 0.8 * n[2]);
    ctx.beginPath();
    f.forEach((v, j) =>
      j
        ? ctx.lineTo(points[v].x, points[v].y)
        : ctx.moveTo(points[v].x, points[v].y),
    );
    ctx.closePath();
    const finish = $("finish").value;
    const palette = {
      copper: [
        [133, 65, 38],
        [247, 186, 124],
      ],
      porcelain: [
        [142, 157, 155],
        [249, 250, 235],
      ],
      graphite: [
        [32, 44, 53],
        [154, 179, 191],
      ],
    }[finish];
    const specular =
      Math.pow(Math.abs(0.22 * n[0] + 0.33 * n[1] + 0.918 * n[2]), 24) * 0.38;
    const rgb = palette[0].map((base, index) =>
      Math.min(
        255,
        base + (palette[1][index] - base) * light + specular * (255 - base),
      ),
    );
    ctx.fillStyle = `rgb(${rgb.map(Math.round).join(",")})`;
    ctx.fill();
    if ($("wire").checked) {
      ctx.strokeStyle =
        finish === "copper"
          ? "#74462e88"
          : finish === "porcelain"
            ? "#667d7888"
            : "#101e2b99";
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }
  for (const e of result.edges) {
    if (e.kind === "interior" && e.key !== selected) continue;
    const [a, b] = e.vertices.map((v) => points[v]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle =
      e.key === selected
        ? "#c34232"
        : e.kind === "boundary"
          ? "#bc7c34"
          : e.kind === "non-manifold"
            ? "#b04979"
            : "#446ba0";
    ctx.lineWidth = e.key === selected ? 5 : 2.5;
    ctx.stroke();
  }
  for (const index of result.badVertices) {
    const p = points[index];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = "#b04979";
    ctx.fill();
  }
  canvas.setAttribute(
    "aria-label",
    title +
      ". " +
      result.summary.faces +
      " triangles, " +
      result.summary.boundaryEdges +
      " boundary edges, " +
      result.summary.windingConflicts +
      " winding conflicts. Drag or use arrows to rotate.",
  );
}
$("collection").onchange = () => {
  for (const b of document.querySelectorAll(".model-button"))
    b.setAttribute("aria-pressed", b.dataset.model === $("collection").value);
  history = [];
  $("undo").disabled = true;
  title = $("collection").selectedOptions[0].textContent;
  ignored = [];
  run(example($("collection").value));
};
$("repair").onclick = () => {
  if (!ready) return;
  try {
    remember();
    title += " / consistent";
    run(repair(result));
  } catch (e) {
    $("error").textContent = e.message;
  }
};
$("reverse").onclick = () => {
  if (!ready) return;
  remember();
  const m = structuredClone(result.mesh);
  m.faces = m.faces.map((f) => [f[0], f[2], f[1]]);
  title += " / reversed";
  run(m);
};
$("undo").onclick = () => {
  const previous = history.pop();
  if (previous) {
    title = previous.title;
    ignored = previous.ignored;
    run(previous.mesh);
  }
  $("undo").disabled = !history.length;
};
$("edge-filter").onchange = () => {
  page = 0;
  selected = null;
  edgeList();
  draw();
};
$("previous").onclick = () => {
  page--;
  edgeList();
};
$("next").onclick = () => {
  page++;
  edgeList();
};
$("wire").onchange = draw;
$("finish").onchange = () => {
  draw();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    canvas.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 250 });
};
$("reset-camera").onclick = () => {
  yaw = -0.65;
  pitch = 0.4;
  zoom = 1;
  draw();
};
let drag = null;
canvas.onpointerdown = (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!drag) return;
  yaw += (e.clientX - drag.x) * 0.008;
  pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag.y) * 0.008));
  drag = { x: e.clientX, y: e.clientY };
  draw();
};
canvas.onpointerup = canvas.onpointercancel = () => {
  drag = null;
};
canvas.onkeydown = (e) => {
  if (
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(
      e.key,
    )
  ) {
    e.preventDefault();
    if (e.key === "ArrowLeft") yaw -= 0.12;
    if (e.key === "ArrowRight") yaw += 0.12;
    if (e.key === "ArrowUp") pitch = Math.min(1.5, pitch + 0.12);
    if (e.key === "ArrowDown") pitch = Math.max(-1.5, pitch - 0.12);
    if (e.key === "+" || e.key === "=") zoom = Math.min(2, zoom * 1.1);
    if (e.key === "-") zoom = Math.max(0.4, zoom / 1.1);
    draw();
  }
};
function orbit(time) {
  if (!$("spin").checked) {
    spinFrame = null;
    return;
  }
  if (lastTime) yaw += Math.min(time - lastTime, 50) * 0.00018;
  lastTime = time;
  draw();
  spinFrame = requestAnimationFrame(orbit);
}
$("spin").onchange = () => {
  if ($("spin").checked && !spinFrame) {
    lastTime = 0;
    spinFrame = requestAnimationFrame(orbit);
  } else if (!$("spin").checked && spinFrame) {
    cancelAnimationFrame(spinFrame);
    spinFrame = null;
  }
};
function download(name, text, type = "application/json") {
  const blob = text instanceof Blob ? text : new Blob([text], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () => {
  if (ready) download("mesh-pavilion.obj", toOBJ(result.mesh), "text/plain");
};
$("json").onclick = () => {
  if (ready)
    download("mesh-pavilion.json", JSON.stringify(result.mesh, null, 2));
};
$("evidence").onclick = () => {
  if (ready)
    download("mesh-pavilion-evidence.json", JSON.stringify(result, null, 2));
};
$("png").onclick = () => {
  if (ready)
    canvas.toBlob((blob) => {
      if (blob) download("mesh-pavilion-preview.png", blob);
    });
};
$("open").onclick = () => $("file").click();
let fileSeq = 0;
$("file").onchange = async () => {
  const file = $("file").files[0],
    seq = ++fileSeq;
  $("file").value = "";
  if (!file) return;
  try {
    if (file.size > 1000000) throw Error("Files must be at most 1 MB.");
    const text = await file.text();
    if (seq !== fileSeq) return;
    let m,
      notes = [];
    if (file.name.toLowerCase().endsWith(".json"))
      m = validate(JSON.parse(text));
    else {
      const parsed = parseOBJ(text);
      m = parsed.mesh;
      notes = parsed.ignored;
    }
    history = [];
    $("undo").disabled = true;
    for (const b of document.querySelectorAll(".model-button"))
      b.setAttribute("aria-pressed", "false");
    title = file.name.slice(0, 100);
    ignored = notes;
    run(m);
  } catch (e) {
    $("error").textContent = "Could not open mesh: " + e.message;
  }
};
const icons = {
  torus:
    '<ellipse cx="16" cy="16" rx="13" ry="9"/><ellipse cx="16" cy="16" rx="6" ry="3"/>',
  mobius: '<path d="M3 16C3 2 26 28 29 16S6 4 3 16Z"/>',
  pinch: '<path d="M3 4L16 16L3 28ZM29 4L16 16L29 28Z"/>',
  edge: '<path d="M16 4V28L3 19ZM16 4L29 15L16 28M16 4L24 8L16 28"/>',
  cube: '<path d="M16 2L29 9V23L16 30L3 23V9ZM3 9L16 16L29 9M16 16V30M3 9L16 2L16 16"/>',
};
for (const option of $("collection").options) {
  const b = document.createElement("button");
  b.className = "model-button";
  b.dataset.model = option.value;
  b.setAttribute("aria-pressed", option.value === "flipped");
  b.innerHTML =
    '<svg viewBox="0 0 32 32" aria-hidden="true">' +
    (icons[option.value] || icons.cube) +
    "</svg>";
  b.append(document.createTextNode(option.textContent));
  b.onclick = () => {
    $("collection").value = option.value;
    $("collection").onchange();
  };
  $("model-list").append(b);
}
function showTopology(open) {
  $("topology-panel").hidden = !open;
  $("topology-toggle").setAttribute("aria-expanded", open);
}
$("topology-toggle").onclick = () => showTopology($("topology-panel").hidden);
$("topology-close").onclick = () => {
  showTopology(false);
  $("topology-toggle").focus();
};
const tabs = [...document.querySelectorAll("[data-pane]")];
function selectPane(button) {
  for (const t of tabs) {
    const active = t === button;
    t.setAttribute("aria-selected", active);
    t.tabIndex = active ? 0 : -1;
    $("pane-" + t.dataset.pane).hidden = !active;
  }
}
for (const [i, b] of tabs.entries()) {
  b.tabIndex = i === 0 ? 0 : -1;
  b.onclick = () => selectPane(b);
  b.onkeydown = (e) => {
    let next;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i + tabs.length - 1) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    selectPane(tabs[next]);
    tabs[next].focus();
  };
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("topology-panel").hidden) {
    showTopology(false);
    $("topology-toggle").focus();
  }
});
new ResizeObserver(draw).observe(canvas);
run(example("flipped"));
