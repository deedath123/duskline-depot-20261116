// The armoury: five guns and two grenades, each a row of numbers plus a low-poly view model
// built from shared boxes. Accuracy is the theme: spread is tiny standing still, blooms when
// moving, crouching claws some back, aiming down sights halves it again — the maths lives in
// spreadFor() and both the player and the bots' fire discipline follow it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sparrow', slot: 'sidearm', price: 0, damage: 26, headMult: 4, rpm: 340, auto: false,
    mag: 12, reserve: 48, reload: 1.15, spreadStill: 0.004, spreadMove: 0.02, pellets: 1,
    fallStart: 18, fallEnd: 55, fallMin: 0.55, kick: 0.011, zoom: 1.35,
  },
  smg: {
    name: 'VK-9 Tempest', slot: 'primary', price: 900, damage: 21, headMult: 3.2, rpm: 820, auto: true,
    mag: 32, reserve: 96, reload: 1.7, spreadStill: 0.009, spreadMove: 0.05, pellets: 1,
    fallStart: 12, fallEnd: 40, fallMin: 0.5, kick: 0.008, zoom: 1.4,
  },
  rifle: {
    name: 'AR-7 Longbow', slot: 'primary', price: 2700, damage: 33, headMult: 4, rpm: 600, auto: true,
    mag: 30, reserve: 90, reload: 2.0, spreadStill: 0.0025, spreadMove: 0.032, pellets: 1,
    fallStart: 22, fallEnd: 70, fallMin: 0.72, kick: 0.013, zoom: 1.5,
  },
  shotgun: {
    name: 'Mule 870', slot: 'primary', price: 1100, damage: 11, headMult: 2, rpm: 68, auto: false,
    mag: 6, reserve: 30, reload: 2.6, spreadStill: 0.05, spreadMove: 0.07, pellets: 8,
    fallStart: 6, fallEnd: 22, fallMin: 0.3, kick: 0.045, zoom: 1.25,
  },
  sniper: {
    name: 'Kite .50', slot: 'primary', price: 3750, damage: 98, headMult: 2.2, rpm: 38, auto: false,
    mag: 5, reserve: 20, reload: 2.8, spreadStill: 0.0008, spreadMove: 0.09, pellets: 1,
    fallStart: 40, fallEnd: 120, fallMin: 0.9, kick: 0.06, zoom: 4,
  },
};
export const GRENADES = {
  he: { name: 'Popper HE', price: 600, damage: 112, radius: 5.2 },
  smoke: { name: 'Veil Smoke', price: 300, radius: 4.2, duration: 9 },
};
export const ARMOUR = { vest: { name: 'Vest', price: 650 }, full: { name: 'Vest + Helm', price: 1000 } };

export function damageAt(def, distance) {
  if (distance <= def.fallStart) return def.damage;
  if (distance >= def.fallEnd) return def.damage * def.fallMin;
  const t = (distance - def.fallStart) / (def.fallEnd - def.fallStart);
  return def.damage * (1 - t * (1 - def.fallMin));
}

export function spreadFor(def, speed, crouching, ads, airborne) {
  const moveT = Math.min(1, speed / 5.4);
  let spread = def.spreadStill + moveT * def.spreadMove;
  if (crouching) spread *= 0.62;
  if (ads) spread *= 0.5;
  if (airborne) spread *= 2.6;
  return spread;
}

const MATS = {};
function mats() {
  if (!MATS.body) {
    MATS.body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.55, metalness: 0.35 });
    MATS.dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.7, metalness: 0.2 });
    MATS.accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.3 });
  }
  return MATS;
}

function box(w, h, d, x, y, z, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

// One view model per gun, all children of a single group the camera carries; only the
// equipped one is visible.
export function buildViewModels(camera) {
  const m = mats();
  const group = new THREE.Group();
  group.position.set(0.25, -0.22, -0.45);
  camera.add(group);
  const models = {};
  {
    const g = new THREE.Group(); // pistol: short and neat
    g.add(box(0.07, 0.09, 0.24, 0, 0.02, -0.05, m.body), box(0.06, 0.12, 0.08, 0, -0.08, 0.06, m.dark));
    models.pistol = g;
  }
  {
    const g = new THREE.Group(); // smg: stubby with a drum
    g.add(box(0.08, 0.1, 0.4, 0, 0.02, -0.1, m.body), box(0.04, 0.04, 0.22, 0, 0.05, -0.38, m.dark),
      box(0.11, 0.11, 0.11, 0, -0.1, -0.05, m.dark), box(0.07, 0.1, 0.14, 0, -0.02, 0.16, m.dark));
    models.smg = g;
  }
  {
    const g = new THREE.Group(); // rifle: long barrel, carry handle, amber sight dot
    g.add(box(0.085, 0.1, 0.46, 0, 0.02, -0.08, m.body), box(0.045, 0.045, 0.42, 0, 0.045, -0.48, m.dark),
      box(0.07, 0.12, 0.09, 0, -0.09, -0.02, m.dark), box(0.075, 0.08, 0.24, 0, -0.01, 0.28, m.dark),
      box(0.02, 0.05, 0.02, 0, 0.11, -0.3, m.accent));
    models.rifle = g;
  }
  {
    const g = new THREE.Group(); // shotgun: fat pump tube
    g.add(box(0.09, 0.1, 0.5, 0, 0.02, -0.12, m.body), box(0.07, 0.06, 0.26, 0, -0.045, -0.3, m.accent),
      box(0.08, 0.09, 0.26, 0, -0.01, 0.3, m.dark));
    models.shotgun = g;
  }
  {
    const g = new THREE.Group(); // sniper: longest barrel, big scope cylinder
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 10), m.dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.12, -0.12);
    g.add(box(0.08, 0.09, 0.55, 0, 0.01, -0.14, m.body), box(0.04, 0.04, 0.55, 0, 0.03, -0.65, m.dark),
      scope, box(0.07, 0.11, 0.08, 0, -0.09, 0.05, m.dark), box(0.075, 0.08, 0.3, 0, 0, 0.36, m.dark));
    models.sniper = g;
  }
  for (const g of Object.values(models)) group.add(g);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  camera.add(flashLight);

  return {
    group,
    models,
    flash,
    flashLight,
    show(id) {
      for (const [key, g] of Object.entries(models)) g.visible = key === id;
    },
    setFlash(id, on) {
      const z = { pistol: -0.85, smg: -1.0, rifle: -1.2, shotgun: -1.05, sniper: -1.5 }[id] ?? -1.1;
      flash.position.set(0.25, -0.17, z);
      flashLight.position.set(0.25, -0.15, z + 0.2);
      flash.visible = on;
      if (on) flash.rotation.z = Math.random() * Math.PI;
      flashLight.intensity = on ? 20 : 0;
    },
  };
}

// A carried gun for a bot: one dark box long enough to read at range, angled to its hands.
export function buildBotGun() {
  const m = mats();
  const gun = new THREE.Group();
  gun.add(box(0.07, 0.09, 0.62, 0, 0, -0.2, m.dark), box(0.05, 0.12, 0.07, 0, -0.09, 0.02, m.dark));
  return gun;
}
