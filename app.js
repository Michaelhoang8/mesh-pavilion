import { example, validate, parseOBJ, toOBJ, repair } from "./core.js";
const $ = (id) => document.getElementById(id),
  canvas = $("canvas"),
  ctx = canvas.getContext("2d"),
  worker = new Worker("./worker.js", { type: "module" });
let result = null,
  request = 0,
  ready = false,
  title = "Cube / a reversed face",
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
  $("status").textContent = "Inspecting indexed connections…";
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
  $("status").textContent = ignored.length
    ? "OBJ directives ignored: " + ignored.join(", ") + "."
    : "Coordinates preserved. Analysis complete.";
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
  ctx.fillStyle = "#f5f2eb";
  ctx.fillRect(0, 0, 1000, 700);
  if (!result) return;
  const vertices = result.mesh.vertices,
    used = [...new Set(result.mesh.faces.flat())],
    mins = [0, 1, 2].map((i) => Math.min(...used.map((v) => vertices[v][i]))),
    maxs = [0, 1, 2].map((i) => Math.max(...used.map((v) => vertices[v][i]))),
    center = mins.map((v, i) => (v + maxs[i]) / 2),
    extent = Math.max(...maxs.map((v, i) => v - mins[i]), 1e-9),
    scale = (330 / extent) * zoom;
  const points = vertices
    .map((v) => transform(v.map((x, i) => x - center[i])))
    .map((v) => ({ x: 500 + v[0] * scale, y: 350 - v[1] * scale, z: v[2] }));
  ctx.strokeStyle = "#dce1d7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(75, 590);
  ctx.lineTo(925, 590);
  ctx.stroke();
  ctx.font = "12px Arial";
  ctx.fillStyle = "#949d96";
  ctx.fillText("INDEXED TRIANGLE STUDY", 75, 615);
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
    ctx.fillStyle =
      "rgb(" +
      Math.round(75 + light * 75) +
      "," +
      Math.round(100 + light * 80) +
      "," +
      Math.round(109 + light * 85) +
      ")";
    ctx.fill();
    if ($("wire").checked) {
      ctx.strokeStyle = "#49616d99";
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
    title = file.name.slice(0, 100);
    ignored = notes;
    run(m);
  } catch (e) {
    $("error").textContent = "Could not open mesh: " + e.message;
  }
};
run(example("flipped"));
