// Pooled visual effects: tracers, impact sparks, smoke and the planted charge. Every pool is
// allocated once at boot and recycled, so the hot loop never creates objects — a tracer is a
// line segment with a lifetime, a spark is a point with a velocity, a smoke cloud is a few
// sprites that grow and fade. Smoke doubles as a game rule: its live spheres block bot sight.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 48;
const MAX_SPARKS = 240;

function smokeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(216,220,228,0.85)');
  grad.addColorStop(0.6, 'rgba(170,176,188,0.45)');
  grad.addColorStop(1, 'rgba(160,166,178,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

export function createEffects(scene) {
  // tracers
  const tracerPos = new Float32Array(MAX_TRACERS * 6);
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const tracers = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({
    color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85,
  }));
  tracers.frustumCulled = false;
  scene.add(tracers);
  const tracerLife = new Float32Array(MAX_TRACERS);
  let tracerCursor = 0;

  // sparks
  const sparkPos = new Float32Array(MAX_SPARKS * 3);
  const sparkVel = new Float32Array(MAX_SPARKS * 3);
  const sparkLife = new Float32Array(MAX_SPARKS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: new THREE.Color(PALETTE.accent), size: 0.07, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkCursor = 0;
  for (let i = 0; i < MAX_SPARKS; i += 1) sparkPos[i * 3 + 1] = -50;

  // smoke clouds
  const smokeMat = new THREE.SpriteMaterial({ map: smokeTexture(), transparent: true, opacity: 0, depthWrite: false });
  const smokes = [];
  for (let i = 0; i < 6; i += 1) {
    const group = new THREE.Group();
    const puffs = [];
    for (let j = 0; j < 5; j += 1) {
      const sprite = new THREE.Sprite(smokeMat.clone());
      sprite.position.set((Math.random() - 0.5) * 2.4, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 2.4);
      sprite.scale.setScalar(2.4 + Math.random() * 1.6);
      group.add(sprite);
      puffs.push(sprite);
    }
    group.visible = false;
    scene.add(group);
    smokes.push({ group, puffs, until: 0, radius: 4.2 });
  }

  // the planted charge: a small box with a blinking amber eye, built once and reused
  const charge = new THREE.Group();
  const chargeBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.3, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.4 }),
  );
  chargeBody.position.y = 0.15;
  const chargeEye = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.08, 0.02),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.jackal) }),
  );
  chargeEye.position.set(0, 0.2, -0.16);
  charge.add(chargeBody, chargeEye);
  charge.visible = false;
  scene.add(charge);
  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 30, 1.4);
  scene.add(blastLight);
  let blast = 0;

  const tmp = new THREE.Vector3();

  return {
    charge,
    tracer(from, to) {
      const i = tracerCursor;
      tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
      tracerPos.set([from.x, from.y, from.z, to.x, to.y, to.z], i * 6);
      tracerLife[i] = 0.055;
      tracerGeo.attributes.position.needsUpdate = true;
    },
    impact(point, n = 6, spread = 1.6) {
      for (let k = 0; k < n; k += 1) {
        const i = sparkCursor;
        sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
        sparkPos.set([point.x, point.y, point.z], i * 3);
        sparkVel[i * 3] = (Math.random() - 0.5) * spread;
        sparkVel[i * 3 + 1] = Math.random() * 2.2;
        sparkVel[i * 3 + 2] = (Math.random() - 0.5) * spread;
        sparkLife[i] = 0.28 + Math.random() * 0.2;
      }
    },
    smoke(point, radius, duration, now) {
      const cloud = smokes.find((s) => !s.group.visible) || smokes[0];
      cloud.group.position.copy(point);
      cloud.radius = radius;
      cloud.until = now + duration;
      cloud.group.visible = true;
      for (const puff of cloud.puffs) puff.material.opacity = 0.55;
    },
    smokeBlocks(x1, z1, x2, z2, now) {
      for (const cloud of smokes) {
        if (!cloud.group.visible || now > cloud.until) continue;
        const c = cloud.group.position;
        // distance from the cloud centre to the sight segment, in plan view
        const dx = x2 - x1;
        const dz = z2 - z1;
        const len2 = dx * dx + dz * dz || 1;
        let t = ((c.x - x1) * dx + (c.z - z1) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        tmp.set(x1 + dx * t - c.x, 0, z1 + dz * t - c.z);
        if (tmp.length() < cloud.radius * 0.8) return true;
      }
      return false;
    },
    explosion(point) {
      blast = 1;
      blastLight.position.copy(point).y = 2;
      this.impact(point, 90, 7);
    },
    setChargeBlink(on) {
      chargeEye.material.color.set(on ? PALETTE.jackal : PALETTE.hairline);
    },
    step(dt, now) {
      let anyTracer = false;
      for (let i = 0; i < MAX_TRACERS; i += 1) {
        if (tracerLife[i] <= 0) continue;
        tracerLife[i] -= dt;
        anyTracer = true;
        if (tracerLife[i] <= 0) tracerPos.fill(0, i * 6, i * 6 + 6);
      }
      if (anyTracer) tracerGeo.attributes.position.needsUpdate = true;
      let anySpark = false;
      for (let i = 0; i < MAX_SPARKS; i += 1) {
        if (sparkLife[i] <= 0) continue;
        anySpark = true;
        sparkLife[i] -= dt;
        sparkVel[i * 3 + 1] -= 7 * dt;
        sparkPos[i * 3] += sparkVel[i * 3] * dt;
        sparkPos[i * 3 + 1] = Math.max(0.03, sparkPos[i * 3 + 1] + sparkVel[i * 3 + 1] * dt);
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        if (sparkLife[i] <= 0) sparkPos[i * 3 + 1] = -50;
      }
      if (anySpark) sparkGeo.attributes.position.needsUpdate = true;
      for (const cloud of smokes) {
        if (!cloud.group.visible) continue;
        if (now > cloud.until) { cloud.group.visible = false; continue; }
        const fade = Math.min(1, (cloud.until - now) / 1.5);
        for (const puff of cloud.puffs) puff.material.opacity = 0.55 * fade;
      }
      if (blast > 0) {
        blast = Math.max(0, blast - dt * 1.4);
        blastLight.intensity = blast * 260;
      }
    },
  };
}
