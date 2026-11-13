const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const key = (a, b) => (a < b ? a + ":" + b : b + ":" + a);
export function validate(raw) {
  if (
    !raw ||
    raw.format !== "mesh-pavilion-v1" ||
    !Array.isArray(raw.vertices) ||
    !Array.isArray(raw.faces) ||
    raw.vertices.length < 3 ||
    raw.vertices.length > 2000 ||
    raw.faces.length < 1 ||
    raw.faces.length > 4000
  )
    throw Error("Use 3–2,000 vertices and 1–4,000 triangular faces.");
  const vertices = raw.vertices.map((v) => {
    if (
      !Array.isArray(v) ||
      v.length !== 3 ||
      v.some(
        (x) =>
          typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > 1000,
      )
    )
      throw Error("Each vertex needs three finite coordinates within ±1,000.");
    return [...v];
  });
  const faces = raw.faces.map((f) => {
    if (
      !Array.isArray(f) ||
      f.length !== 3 ||
      new Set(f).size !== 3 ||
      f.some((x) => !Number.isInteger(x) || x < 0 || x >= vertices.length)
    )
      throw Error(
        "Each triangle must reference three distinct existing vertex indices.",
      );
    return [...f];
  });
  return { format: raw.format, vertices, faces };
}
export function parseOBJ(text) {
  if (typeof text !== "string" || text.length > 1000000)
    throw Error("OBJ input is limited to 1 MB of text.");
  const vertices = [],
    faces = [],
    ignored = new Set();
  for (const [lineNo, line] of text.split(/\r?\n/).entries()) {
    const parts = line.split("#")[0].trim().split(/\s+/);
    if (!parts[0]) continue;
    const [op, ...args] = parts;
    if (op === "v") {
      if (args.length !== 3)
        throw Error(
          "Line " + (lineNo + 1) + ": use three coordinates per vertex.",
        );
      vertices.push(args.map(Number));
      if (vertices.length > 2000) throw Error("At most 2,000 vertices.");
    } else if (op === "f") {
      if (args.length !== 3)
        throw Error(
          "Line " +
            (lineNo + 1) +
            ": only triangular OBJ faces are supported; triangulate polygons before import.",
        );
      const face = args.map((token) => {
        if (
          !/^-?[1-9]\d*(?:\/-?[1-9]\d*(?:\/-?[1-9]\d*)?|\/\/-?[1-9]\d*)?$/.test(
            token,
          )
        )
          throw Error("Line " + (lineNo + 1) + ": invalid face reference.");
        const n = Number(token.split("/")[0]),
          i = n < 0 ? vertices.length + n : n - 1;
        if (!Number.isSafeInteger(n) || i < 0 || i >= vertices.length)
          throw Error(
            "Line " +
              (lineNo + 1) +
              ": face references must resolve to an already defined vertex.",
          );
        return i;
      });
      faces.push(face);
      if (faces.length > 4000) throw Error("At most 4,000 faces.");
    } else if (["vn", "vt", "o", "g", "s", "usemtl", "mtllib"].includes(op))
      ignored.add(op);
    else
      throw Error(
        "Line " + (lineNo + 1) + ": unsupported OBJ directive " + op + ".",
      );
  }
  return {
    mesh: validate({ format: "mesh-pavilion-v1", vertices, faces }),
    ignored: [...ignored].sort(),
  };
}
export function toOBJ(mesh) {
  return (
    "# Mesh Pavilion — indexed triangles; coordinates preserved\n" +
    mesh.vertices.map((v) => "v " + v.join(" ")).join("\n") +
    "\n" +
    mesh.faces.map((f) => "f " + f.map((i) => i + 1).join(" ")).join("\n") +
    "\n"
  );
}
function connected(nodes, adj) {
  const seen = new Set(),
    groups = [];
  for (const start of nodes) {
    if (seen.has(start)) continue;
    const group = [],
      queue = [start];
    seen.add(start);
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      group.push(n);
      for (const next of adj.get(n) || [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    groups.push(group);
  }
  return groups;
}
export function analyze(raw) {
  const mesh = validate(raw),
    edges = new Map(),
    vertexFaces = mesh.vertices.map(() => []),
    faceAdj = new Map(mesh.faces.map((_, i) => [i, new Set()])),
    duplicateFaces = [],
    degenerateFaces = [],
    normals = [],
    areas = [],
    seenFaces = new Map();
  mesh.faces.forEach((f, i) => {
    const canonical = [...f].sort((a, b) => a - b).join(":");
    if (seenFaces.has(canonical)) duplicateFaces.push(i);
    else seenFaces.set(canonical, i);
    f.forEach((v) => vertexFaces[v].push(i));
    for (let j = 0; j < 3; j++) {
      const a = f[j],
        b = f[(j + 1) % 3],
        k = key(a, b);
      if (!edges.has(k))
        edges.set(k, {
          key: k,
          vertices: [Math.min(a, b), Math.max(a, b)],
          incidents: [],
        });
      edges.get(k).incidents.push({ face: i, from: a, to: b });
    }
    const [a, b, c] = f.map((v) => mesh.vertices[v]),
      ab = sub(b, a),
      ac = sub(c, a),
      bc = sub(c, b),
      n = cross(ab, ac),
      length = Math.hypot(...n),
      scale = Math.max(dot(ab, ab), dot(ac, ac), dot(bc, bc));
    normals.push(length ? n.map((v) => v / length) : [0, 0, 0]);
    areas.push(length / 2);
    if (length <= 1e-12 * scale) degenerateFaces.push(i);
  });
  const edgeList = [...edges.values()].sort(
    (a, b) => a.vertices[0] - b.vertices[0] || a.vertices[1] - b.vertices[1],
  );
  for (const e of edgeList) {
    const inc = e.incidents;
    e.kind =
      inc.length === 1
        ? "boundary"
        : inc.length > 2
          ? "non-manifold"
          : inc[0].from === inc[1].from
            ? "winding conflict"
            : "interior";
    for (let i = 1; i < inc.length; i++) {
      faceAdj.get(inc[0].face).add(inc[i].face);
      faceAdj.get(inc[i].face).add(inc[0].face);
    }
  }
  const badVertices = [],
    vertexLinks = [];
  vertexFaces.forEach((faces, v) => {
    if (!faces.length) {
      vertexLinks.push({ vertex: v, kind: "unused", components: 0 });
      return;
    }
    const adj = new Map(),
      degrees = new Map();
    for (const fi of faces) {
      const [a, b] = mesh.faces[fi].filter((x) => x !== v);
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        if (!adj.has(x)) adj.set(x, new Set());
        adj.get(x).add(y);
        degrees.set(x, (degrees.get(x) || 0) + 1);
      }
    }
    const groups = connected([...adj.keys()], adj),
      ds = [...degrees.values()],
      ones = ds.filter((x) => x === 1).length,
      valid =
        groups.length === 1 &&
        (ds.every((x) => x === 2) ||
          (ones === 2 && ds.every((x) => x === 1 || x === 2)));
    if (!valid) badVertices.push(v);
    vertexLinks.push({
      vertex: v,
      kind: valid ? (ones === 2 ? "boundary" : "interior") : "non-manifold",
      components: groups.length,
    });
  });
  const groups = connected(
      mesh.faces.map((_, i) => i),
      faceAdj,
    ),
    components = [],
    flipPlan = [],
    orientationConflicts = [];
  for (const [ci, faces] of groups.entries()) {
    const members = new Set(faces),
      vertices = new Set(faces.flatMap((i) => mesh.faces[i])),
      localEdges = edgeList.filter((e) => members.has(e.incidents[0].face)),
      boundaryEdges = localEdges.filter((e) => e.kind === "boundary"),
      adj = new Map(faces.map((i) => [i, []]));
    for (const e of localEdges)
      if (e.incidents.length === 2) {
        const [a, b] = e.incidents,
          parity = a.from === b.from ? 1 : 0;
        adj.get(a.face).push({ face: b.face, parity, key: e.key });
        adj.get(b.face).push({ face: a.face, parity, key: e.key });
      }
    const flips = new Map(),
      conflicts = new Set();
    for (const root of faces) {
      if (flips.has(root)) continue;
      flips.set(root, 0);
      const queue = [root];
      for (let i = 0; i < queue.length; i++) {
        const f = queue[i];
        for (const a of adj.get(f)) {
          const wanted = flips.get(f) ^ a.parity;
          if (!flips.has(a.face)) {
            flips.set(a.face, wanted);
            queue.push(a.face);
          } else if (flips.get(a.face) !== wanted) conflicts.add(a.key);
        }
      }
    }
    const boundaryAdj = new Map();
    for (const e of boundaryEdges)
      for (const [a, b] of [e.vertices, [...e.vertices].reverse()]) {
        if (!boundaryAdj.has(a)) boundaryAdj.set(a, new Set());
        boundaryAdj.get(a).add(b);
      }
    const loops = [];
    const boundaryRegular = [...boundaryAdj.values()].every(
      (a) => a.size === 2,
    );
    if (boundaryRegular) {
      const used = new Set();
      for (const e of boundaryEdges) {
        if (used.has(e.key)) continue;
        const start = e.vertices[0],
          loop = [start];
        let previous = -1,
          current = start;
        do {
          const next = [...boundaryAdj.get(current)].find(
            (x) => x !== previous && !used.has(key(current, x)),
          );
          if (next === undefined) break;
          used.add(key(current, next));
          loop.push(next);
          previous = current;
          current = next;
        } while (current !== start && loop.length <= boundaryEdges.length + 1);
        loops.push(loop);
      }
    }
    const manifold =
      !localEdges.some((e) => e.kind === "non-manifold") &&
      ![...vertices].some((v) => badVertices.includes(v)) &&
      !faces.some((i) => duplicateFaces.includes(i));
    const orientable = conflicts.size === 0,
      chi = vertices.size - localEdges.length + faces.length,
      genus =
        manifold && orientable && boundaryRegular
          ? (2 - loops.length - chi) / 2
          : null;
    let chosen = faces.filter((i) => flips.get(i));
    if (chosen.length > faces.length / 2)
      chosen = faces.filter((i) => !flips.get(i));
    const canRepair = manifold && orientable;
    if (canRepair) flipPlan.push(...chosen);
    const consistent = !localEdges.some((e) => e.kind === "winding conflict"),
      closed = boundaryEdges.length === 0;
    let signedVolume = null;
    if (
      manifold &&
      orientable &&
      consistent &&
      closed &&
      !faces.some((i) => degenerateFaces.includes(i))
    ) {
      const origin = mesh.vertices[mesh.faces[faces[0]][0]];
      signedVolume = faces.reduce((sum, i) => {
        const [a, b, c] = mesh.faces[i].map((v) =>
          sub(mesh.vertices[v], origin),
        );
        return sum + dot(a, cross(b, c)) / 6;
      }, 0);
    }
    orientationConflicts.push(...conflicts);
    components.push({
      id: ci,
      faces: faces.sort((a, b) => a - b),
      vertices: vertices.size,
      edges: localEdges.length,
      euler: chi,
      boundaryLoops: boundaryRegular ? loops : null,
      manifold,
      orientable: manifold ? orientable : null,
      consistent,
      closed,
      genus,
      signedVolume,
      canRepair,
      flipFaces: canRepair ? chosen : [],
      area: faces.reduce((s, i) => s + areas[i], 0),
    });
  }
  return {
    format: "mesh-pavilion-evidence-v1",
    mesh,
    edges: edgeList,
    components,
    vertexLinks,
    normals,
    areas,
    duplicateFaces,
    degenerateFaces,
    badVertices,
    orientationConflicts: [...new Set(orientationConflicts)],
    flipPlan: flipPlan.sort((a, b) => a - b),
    canRepair: components.every((c) => c.canRepair),
    summary: {
      vertices: mesh.vertices.length,
      usedVertices: vertexFaces.filter((x) => x.length).length,
      faces: mesh.faces.length,
      edges: edgeList.length,
      components: components.length,
      boundaryEdges: edgeList.filter((e) => e.kind === "boundary").length,
      nonManifoldEdges: edgeList.filter((e) => e.kind === "non-manifold")
        .length,
      windingConflicts: edgeList.filter((e) => e.kind === "winding conflict")
        .length,
      area: areas.reduce((a, b) => a + b, 0),
    },
  };
}
export function repair(result) {
  if (!result.canRepair)
    throw Error("Consistent winding requires manifold, orientable components.");
  const flip = new Set(result.flipPlan);
  return {
    ...result.mesh,
    vertices: result.mesh.vertices.map((v) => [...v]),
    faces: result.mesh.faces.map((f, i) =>
      flip.has(i) ? [f[0], f[2], f[1]] : [...f],
    ),
  };
}
export function example(kind = "cube") {
  const cube = {
    format: "mesh-pavilion-v1",
    vertices: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
    faces: [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
    ],
  };
  if (kind === "cube") return cube;
  if (kind === "flipped") {
    cube.faces[3].reverse();
    return cube;
  }
  if (kind === "open") {
    cube.faces.splice(2, 2);
    return cube;
  }
  if (kind === "pinch")
    return {
      format: cube.format,
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [-1, 0, 0],
        [0, -1, 0],
      ],
      faces: [
        [0, 1, 2],
        [0, 3, 4],
      ],
    };
  if (kind === "edge")
    return {
      format: cube.format,
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
      ],
      faces: [
        [0, 1, 2],
        [1, 0, 3],
        [0, 1, 4],
      ],
    };
  if (kind === "mobius") {
    const n = 12,
      vertices = [],
      faces = [];
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n;
      for (const u of [-0.3, 0.3])
        vertices.push([
          (1 + u * Math.cos(t / 2)) * Math.cos(t),
          (1 + u * Math.cos(t / 2)) * Math.sin(t),
          u * Math.sin(t / 2),
        ]);
    }
    for (let i = 0; i < n; i++) {
      const a = 2 * i,
        b = a + 1,
        c = i === n - 1 ? 1 : a + 2,
        d = i === n - 1 ? 0 : a + 3;
      faces.push([a, c, b], [b, c, d]);
    }
    return { format: cube.format, vertices, faces };
  }
  if (kind === "torus") {
    const n = 16,
      m = 8,
      vertices = [],
      faces = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++) {
        const u = (2 * Math.PI * i) / n,
          v = (2 * Math.PI * j) / m;
        vertices.push([
          (1 + 0.35 * Math.cos(v)) * Math.cos(u),
          (1 + 0.35 * Math.cos(v)) * Math.sin(u),
          0.35 * Math.sin(v),
        ]);
      }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++) {
        const a = i * m + j,
          b = ((i + 1) % n) * m + j,
          c = ((i + 1) % n) * m + ((j + 1) % m),
          d = i * m + ((j + 1) % m);
        faces.push([a, b, c], [a, c, d]);
      }
    return { format: cube.format, vertices, faces };
  }
  throw Error("Unknown example.");
}
