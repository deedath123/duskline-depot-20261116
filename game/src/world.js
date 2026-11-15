// Duskline Depot: an original harbour depot with three lanes (West, Mid, East), two cross
// connectors, and two charge sites. One data table builds the meshes, the colliders and the
// bullet-stoppers, so what you see is exactly what you collide with and shoot at. A waypoint
// graph over the same colliders gives the bots their routes, with edges only where a walker
// fits and a straight line is clear.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { name: 'A — Crane Yard', x: -19, z: -21, radius: 5.6 },
  B: { name: 'B — Fuel Row', x: 19, z: -21, radius: 5.6 },
};

export const SPAWNS = {
  attack: [[-4, 27], [0, 27.6], [4, 27], [-8, 25.4], [8, 25.4]],
  defend: [[-19, -27], [-15.5, -25], [19, -27], [15.5, -25], [0, -27.5]],
  defendHome: { A: [[-24, -24], [-14, -18]], B: [[24, -24], [14, -18]], mid: [[0, -24]] },
};

// [centreX, centreZ, width, depth, height, material] — height 1.15 is crouch cover, 2.6+ is a wall.
const BLOCKS = [
  // perimeter
  [0, -30.4, 62, 0.8, 4.2, 'surface'], [0, 30.4, 62, 0.8, 4.2, 'surface'],
  [-30.4, 0, 0.8, 62, 4.2, 'surface'], [30.4, 0, 0.8, 62, 4.2, 'surface'],
  // blocks between Mid and the side lanes, with gaps at the two connectors (z=8 and z=-14)
  [-10, 19, 2.2, 14, 3.4, 'surface'], [-10, -4, 2.2, 12, 3.4, 'surface'], [-10, -23.5, 2.2, 9, 3.4, 'surface'],
  [10, 19, 2.2, 14, 3.4, 'surface'], [10, -4, 2.2, 12, 3.4, 'surface'], [10, -23.5, 2.2, 9, 3.4, 'surface'],
  // mid: the broken wall the centre fight turns on, and two containers
  [0, 1.5, 5.2, 1.1, 1.15, 'hairline'], [-4.4, -8, 1.15, 3.4, 1.15, 'hairline'], [4.4, -8, 1.15, 3.4, 1.15, 'hairline'],
  [-3.4, 14.5, 6, 2.6, 2.6, 'jackal'], [3.6, -17.5, 6, 2.6, 2.6, 'warden'],
  // west lane and site A cover
  [-19, 12, 6, 2.6, 2.6, 'surface'], [-24.5, 0.5, 2.6, 6, 2.6, 'hairline'], [-13.8, -8.5, 2.6, 5, 2.6, 'hairline'],
  [-19, -21, 2.4, 2.4, 1.15, 'accent'], [-23.5, -17, 2.2, 1.15, 1.15, 'hairline'], [-14.5, -24.5, 2.2, 1.15, 1.15, 'hairline'],
  [-19, -14.5, 3.2, 1.15, 1.15, 'hairline'], [-25, -27.5, 1.15, 3.4, 1.15, 'hairline'],
  // east lane and site B cover (mirrors A, not a copy: different container spots)
  [19, 10, 6, 2.6, 2.6, 'surface'], [24.5, -2, 2.6, 6, 2.6, 'hairline'], [14, -6, 2.6, 5, 2.6, 'hairline'],
  [19, -21, 2.4, 2.4, 1.15, 'accent'], [23.5, -24.5, 2.2, 1.15, 1.15, 'hairline'], [14.5, -17, 2.2, 1.15, 1.15, 'hairline'],
  [19, -12.5, 3.2, 1.15, 1.15, 'hairline'], [25.5, -27.5, 1.15, 3.4, 1.15, 'hairline'],
  // spawn-yard dressing and connector cover
  [-6, 21.5, 2.2, 1.15, 1.15, 'hairline'], [6, 21.5, 2.2, 1.15, 1.15, 'hairline'],
  [0, 8, 2.4, 1.15, 1.15, 'accent'], [-19, 2.5, 2.2, 1.15, 1.15, 'hairline'], [19, 4.5, 2.2, 1.15, 1.15, 'hairline'],
  [0, -25, 3.4, 1.15, 1.15, 'hairline'],
];

const NODE_POSITIONS = [
  [0, 27], [-19, 24], [19, 24], [0, 18], [-19, 17], [19, 17], [-10, 8], [0, 8], [10, 8],
  [-19, 6], [19, 6], [0, -3], [-19, -6], [19, -8], [-10, -14], [0, -14], [10, -14],
  [-19, -14.5], [19, -16], [-24, -21], [-19, -21], [-14, -21], [14, -21], [19, -21], [24, -21],
  [-19, -26.5], [19, -26.5], [0, -22], [-6, -26], [6, -26], [-25, -12], [25, -12],
];
export const COVER_NODES = new Set([10, 11, 17, 19, 21, 23, 27]);

function segmentHitsRect(x1, z1, x2, z2, minX, maxX, minZ, maxZ) {
  // Slab test: does the segment cross the rectangle at all?
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const slabs = [[x1, dx, minX, maxX], [z1, dz, minZ, maxZ]];
  for (const [p, d, lo, hi] of slabs) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let ta = (lo - p) / d;
      let tb = (hi - p) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // Procedural surface detail, drawn once on canvases with a seeded PRNG so every build
  // textures identically: a speckled scrub texture for the ground and a corrugated-rib
  // texture that multiplies every block colour, so flat palette boxes read as concrete,
  // crates and container steel instead of plain slabs.
  function canvasTexture(size, draw, repeatX, repeatY) {
    const canvas = document.createElement('canvas');
    canvas.width = size[0];
    canvas.height = size[1];
    draw(canvas.getContext('2d'), size[0], size[1]);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  let seed = 20261116;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const groundTex = canvasTexture([256, 256], (g, w, h) => {
    g.fillStyle = PALETTE.grass;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.13)' : (v < 0.8 ? 'rgba(236,231,218,0.05)' : 'rgba(90,140,90,0.10)');
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
    }
    for (let i = 0; i < 12; i++) {
      g.fillStyle = 'rgba(0,0,0,0.07)';
      g.beginPath();
      g.ellipse(rnd() * w, rnd() * h, 14 + rnd() * 30, 8 + rnd() * 18, rnd() * 3, 0, 7);
      g.fill();
    }
  }, 10, 10);
  const ribTex = canvasTexture([128, 128], (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = 'rgba(0,0,0,0.17)';
      g.fillRect(x, 0, 2, h);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x + 2, 0, 1, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
  }, 2, 1);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.5 : 0.9,
      metalness: 0.04,
      map: ribTex,
    });
  }
  materials.ground = new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffffff'), roughness: 1, map: groundTex });

  const colliders = [];
  const shootables = [];
  const boxGeoCache = new Map();
  function boxGeo(w, h, d) {
    const key = `${w}|${h}|${d}`;
    if (!boxGeoCache.has(key)) boxGeoCache.set(key, new THREE.BoxGeometry(w, h, d));
    return boxGeoCache.get(key);
  }
  function addBlock([x, z, w, d, h, mat]) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), materials[mat]);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = h > 1.2;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2)));
    shootables.push(mesh);
    return mesh;
  }
  for (const block of BLOCKS) addBlock(block);

  // Ground: one slab, with lighter concrete pads painted on the two sites.
  const ground = new THREE.Mesh(new THREE.BoxGeometry(62, 0.4, 62), materials.ground);
  ground.position.y = -0.2;
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3(new THREE.Vector3(-31, -0.4, -31), new THREE.Vector3(31, 0, 31)));
  shootables.push(ground);
  const padMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.95 });
  for (const site of Object.values(SITES)) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(site.radius + 0.7, site.radius + 0.7, 0.06, 28), padMat);
    pad.position.set(site.x, 0.03, site.z);
    pad.receiveShadow = true;
    group.add(pad);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(site.radius + 0.7, 0.09, 6, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(site.x, 0.1, site.z);
    group.add(ring);
  }

  // Set dressing: lamp posts (thin, no collider worth having) and a crane over site A.
  const lampMat = materials.hairline;
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  for (const [x, z] of [[-27, 14], [27, 14], [-27, -27], [27, -27], [0, -6], [-12, -27], [12, 24]]) {
    const pole = new THREE.Mesh(boxGeo(0.18, 5.4, 0.18), lampMat);
    pole.position.set(x, 2.7, z);
    const bulb = new THREE.Mesh(boxGeo(0.5, 0.18, 0.5), bulbMat);
    bulb.position.set(x, 5.45, z);
    group.add(pole, bulb);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 22, 15, 1.8);
    light.position.set(x, 5.2, z);
    group.add(light);
  }
  const craneMat = materials.accent;
  const craneLeg = new THREE.Mesh(boxGeo(0.5, 11, 0.5), craneMat);
  craneLeg.position.set(-26, 5.5, -27);
  const craneArm = new THREE.Mesh(boxGeo(15, 0.5, 0.5), craneMat);
  craneArm.position.set(-19.5, 10.8, -27);
  const craneHook = new THREE.Mesh(boxGeo(0.16, 4.4, 0.16), lampMat);
  craneHook.position.set(-16, 8.4, -27);
  const craneLoad = new THREE.Mesh(boxGeo(2.6, 1.3, 1.3), materials.jackal);
  craneLoad.position.set(-16, 5.6, -27);
  group.add(craneLeg, craneArm, craneHook, craneLoad);

  // Painted site boards on the north wall, one per charge site: the map names its own
  // objectives in-world, the way a real depot is signed.
  for (const [key, site] of Object.entries(SITES)) {
    const signTex = canvasTexture([1024, 512], (g, w, h) => {
      g.fillStyle = '#1d2129';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = PALETTE.accent;
      g.lineWidth = 12;
      g.strokeRect(20, 20, w - 40, h - 40);
      g.fillStyle = PALETTE.accent;
      g.font = '900 330px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(key, 215, 395);
      g.textAlign = 'left';
      g.fillStyle = PALETTE.muted;
      g.font = '600 44px system-ui, sans-serif';
      g.fillText('CHARGE SITE', 400, 150);
      g.fillStyle = PALETTE.ink;
      g.font = '700 96px system-ui, sans-serif';
      g.fillText(site.name.split('— ')[1].toUpperCase(), 396, 268);
      g.fillStyle = PALETTE.muted;
      g.font = '500 44px system-ui, sans-serif';
      g.fillText('DUSKLINE DEPOT', 400, 348);
    }, 1, 1);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 4),
      new THREE.MeshBasicMaterial({ map: signTex }),
    );
    sign.position.set(site.x, 2.4, -29.9);
    group.add(sign);
  }

  // Light: low warm sun from the west, cool sky fill, and the lamps above. The sky is a
  // dusk gradient — indigo up top melting to amber at the horizon — and the fog takes the
  // horizon's warm mauve so the far walls melt into the sunset instead of a flat void.
  const skyTex = canvasTexture([16, 256], (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#141824');
    grad.addColorStop(0.45, '#362e3d');
    grad.addColorStop(0.72, '#7d4c36');
    grad.addColorStop(0.88, '#c07a3d');
    grad.addColorStop(1, '#e09a4a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, 1, 1);
  scene.background = skyTex;
  scene.fog = new THREE.Fog(new THREE.Color('#5f3d33'), 40, 112);
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.muted), new THREE.Color(PALETTE.canvas), 1.7);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.7);
  sun.position.set(-26, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  // --- sight and walking tests over the colliders ---
  function losBlocked(x1, z1, x2, z2, eyeHeight) {
    for (const box of colliders) {
      if (box.max.y <= eyeHeight || box.max.y <= 0.05) continue;
      if (segmentHitsRect(x1, z1, x2, z2, box.min.x + 0.02, box.max.x - 0.02, box.min.z + 0.02, box.max.z - 0.02)) return true;
    }
    return false;
  }

  // --- waypoint graph ---
  const nodes = NODE_POSITIONS.map(([x, z], i) => ({ i, x, z, edges: [] }));
  for (const a of nodes) {
    for (const b of nodes) {
      if (a === b) continue;
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > 15) continue;
      if (losBlocked(a.x, a.z, b.x, b.z, 0.4)) continue;
      a.edges.push({ to: b.i, cost: dist });
    }
  }
  function nearestNode(x, z) {
    let best = nodes[0];
    let bestDist = Infinity;
    for (const node of nodes) {
      const d = Math.hypot(node.x - x, node.z - z);
      if (d < bestDist) { bestDist = d; best = node; }
    }
    return best;
  }
  function findPath(fromX, fromZ, toX, toZ) {
    const start = nearestNode(fromX, fromZ);
    const goal = nearestNode(toX, toZ);
    if (start === goal) return [{ x: toX, z: toZ }];
    const dist = new Map([[start.i, 0]]);
    const prev = new Map();
    const open = new Set(nodes.map((n) => n.i));
    while (open.size) {
      let current = -1;
      let best = Infinity;
      for (const i of open) {
        const d = dist.get(i) ?? Infinity;
        if (d < best) { best = d; current = i; }
      }
      if (current === -1) break;
      if (current === goal.i) break;
      open.delete(current);
      for (const edge of nodes[current].edges) {
        if (!open.has(edge.to)) continue;
        const next = best + edge.cost;
        if (next < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, next);
          prev.set(edge.to, current);
        }
      }
    }
    if (!prev.has(goal.i) && goal.i !== start.i) return [{ x: toX, z: toZ }];
    const path = [];
    let cursor = goal.i;
    while (cursor !== start.i && cursor !== undefined) {
      path.push({ x: nodes[cursor].x, z: nodes[cursor].z });
      cursor = prev.get(cursor);
    }
    path.reverse();
    if (path.length) path[path.length - 1] = { x: toX, z: toZ };
    return path;
  }

  return { colliders, shootables, group, nodes, losBlocked, nearestNode, findPath, materials };
}
