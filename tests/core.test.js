import test from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  example,
  repair,
  parseOBJ,
  toOBJ,
  validate,
} from "../core.js";
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
test("closed cube has sphere topology, correct area and signed volume", () => {
  const r = analyze(example());
  assert.equal(r.summary.edges, 18);
  assert.equal(r.summary.boundaryEdges, 0);
  assert.equal(r.components[0].euler, 2);
  assert.equal(r.components[0].genus, 0);
  near(r.summary.area, 24);
  near(r.components[0].signedVolume, 8);
  assert.deepEqual(r.badVertices, []);
});
test("one reversed face is repaired without changing coordinates or unsigned area", () => {
  const m = example("flipped"),
    before = structuredClone(m),
    r = analyze(m);
  assert.equal(r.summary.windingConflicts, 3);
  assert.deepEqual(r.flipPlan, [3]);
  assert.equal(r.components[0].signedVolume, null);
  const fixed = analyze(repair(r));
  assert.equal(fixed.summary.windingConflicts, 0);
  near(fixed.components[0].signedVolume, 8);
  assert.deepEqual(m, before);
  assert.deepEqual(fixed.mesh.vertices, m.vertices);
});
test("open cube is a disk with one complete boundary loop", () => {
  const r = analyze(example("open")),
    c = r.components[0];
  assert.equal(r.summary.boundaryEdges, 4);
  assert.equal(c.euler, 1);
  assert.equal(c.genus, 0);
  assert.equal(c.boundaryLoops.length, 1);
  assert.equal(c.boundaryLoops[0].length, 5);
  assert.equal(c.signedVolume, null);
});
test("torus is genus one while the Mobius band is manifold but nonorientable", () => {
  const torus = analyze(example("torus"));
  assert.equal(torus.components[0].euler, 0);
  assert.equal(torus.components[0].genus, 1);
  assert.ok(torus.components[0].signedVolume > 0);
  const r = analyze(example("mobius")),
    c = r.components[0];
  assert.equal(c.manifold, true);
  assert.equal(c.orientable, false);
  assert.equal(c.euler, 0);
  assert.equal(c.genus, null);
  assert.equal(c.boundaryLoops.length, 1);
  assert.ok(r.orientationConflicts.length);
  assert.equal(r.canRepair, false);
  assert.throws(() => repair(r));
});
test("pinched vertices and overfull edges are diagnosed independently", () => {
  const pinch = analyze(example("pinch"));
  assert.deepEqual(pinch.badVertices, [0]);
  assert.equal(pinch.summary.nonManifoldEdges, 0);
  assert.equal(pinch.summary.components, 2);
  assert.equal(pinch.canRepair, false);
  assert.ok(pinch.components.every((c) => c.genus === null));
  const edge = analyze(example("edge"));
  assert.equal(edge.summary.nonManifoldEdges, 1);
  assert.ok(edge.badVertices.includes(0) && edge.badVertices.includes(1));
  assert.equal(edge.components[0].boundaryLoops, null);
});
test("OBJ round trips indices, supports relative references and rejects ambiguous polygon imports", () => {
  const m = example("torus");
  assert.deepEqual(parseOBJ(toOBJ(m)).mesh, m);
  assert.deepEqual(
    parseOBJ("v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nf -3/1 -2/1 -1/1").mesh.faces,
    [[0, 1, 2]],
  );
  for (const text of [
    "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3 1",
    "v 0 0 0\nf 1 2 3",
    "v NaN 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3",
    "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 2 3",
  ])
    assert.throws(() => parseOBJ(text));
});
test("all 4096 cube winding assignments yield a valid consistent repair", () => {
  for (let mask = 0; mask < 4096; mask++) {
    const m = example();
    m.faces = m.faces.map((f, i) => ((mask >> i) & 1 ? [f[0], f[2], f[1]] : f));
    const r = analyze(m);
    assert.equal(r.canRepair, true);
    assert.ok(r.flipPlan.length <= 6);
    const fixed = analyze(repair(r));
    assert.equal(fixed.summary.windingConflicts, 0);
    near(Math.abs(fixed.components[0].signedVolume), 8);
  }
});
test("unused vertices, duplicate faces and degenerate geometry remain visible", () => {
  const m = example();
  m.vertices.push([99, 99, 99]);
  let r = analyze(m);
  assert.equal(r.summary.usedVertices, 8);
  assert.equal(r.summary.vertices, 9);
  assert.equal(r.components[0].genus, 0);
  m.faces.push([...m.faces[0]]);
  r = analyze(m);
  assert.deepEqual(r.duplicateFaces, [12]);
  assert.equal(r.canRepair, false);
  const d = {
    format: m.format,
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ],
    faces: [[0, 1, 2]],
  };
  assert.deepEqual(analyze(d).degenerateFaces, [0]);
  assert.throws(() => validate({ ...d, faces: [[0, 0, 2]] }));
});
