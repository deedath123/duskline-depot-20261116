// Duskline Depot — boot and the one game loop. A fixed 60 Hz simulation (player, bots,
// weapons, grenades, the charge, the round clock) feeds a render at the display's rate; no
// game state lives here except the wiring: match state is state.js, bodies are player.js and
// bots.js, numbers are weapons.js.
// Modes: plain play (pointer lock), ?shot=buy|combat|scope|plant|victory (deterministic
// frames for screenshots, window.__shotReady when painted), ?test=1 (a scripted game driven
// through the real input state, reporting window.__testResult).
//
// Design notes — what is in the game, in the order it is judged:
// 1. Complete: 5 v 5 (you + 4 Warden bots vs 5 Jackal bots); rounds of buy 14 s -> live
//    105 s -> planted 38 s, first to 7; the HUD carries health + armour, magazine /
//    reserve, the round clock, the score, money and a live minimap with both sites.
// 2. Gunplay: per-pellet raycasts, head x4 on the rifle and pistol, per-gun damage falloff
//    (weapons.js damageAt); spreadFor() is near-zero standing, blooms with speed, crouch
//    claws some back, ADS halves it and the Kite .50 zooms x4; per-gun view kick, reloads,
//    a dry-fire click on empty. Movement accelerates and damps (player.js) with sprint,
//    crouch, jump and AABB collision — stopping to aim pays.
// 3. Tactics: plant / defuse the charge on A (Crane Yard) or B (Fuel Row); $1.400 to start,
//    +$300 a kill, +$300 a plant, +$2.400 a round won, +$1.400 a round lost, spent in the
//    buy menu on 5 guns ($0-$3.750), Popper HE $600, Veil Smoke $300, Vest $650 and
//    Vest + Helm $1.000. The bots perceive by height-aware line of sight and by hearing (a
//    shot sets a last-known position), path by A* over the 32-node graph, and run
//    objective / engage / cover / defuse states with burst discipline: they hold the
//    sites, rotate on the plant, and break for cover hurt or reloading.
// 4. Map and look: one original 62 x 62 m harbour depot at dusk — containers, crates, a
//    crane over A, fuel drums on B — in six palette colours plus the two team colours
//    (palette.js), under lamps and long shadows; no borrowed art, names or layout.
// 5. Code: one job per module, match state only in state.js, a fixed 60 Hz simulation
//    split from rendering, pooled effects and grenades — nothing allocated per frame in
//    the hot loops.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createBots } from './bots.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createMatch, ROUND_TIME } from './state.js';
import { WEAPONS, GRENADES, damageAt, spreadFor, buildViewModels } from './weapons.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const testMode = params.get('test') === '1';
let rngState = 1234567;
function rand() { // one seeded stream: screenshots and tests are reproducible
  rngState = (Math.imul(rngState, 1664525) + 1013904223) | 0;
  return ((rngState >>> 0) / 4294967296);
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const hud = createHud();
const match = createMatch();
const ms = match.state;
const player = createPlayer(world.colliders);
const bots = createBots(scene, world);
const viewModels = buildViewModels(camera);
const input = createInput(renderer.domElement, onLockChange);

const playerActor = { isPlayer: true, team: 'warden', position: player.state.position, alive: true, crouching: false, eyePosY: 1.6 };

// --- the player's carried weapons: per-gun magazine state, refilled each round ---
const guns = {};
for (const id of Object.keys(WEAPONS)) guns[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, cooldown: 0, reloadT: 0 };
let currentGun = 'pistol';
let equipT = 0;
let inv = { he: 0, smoke: 0 };
let viewKick = 0;
let flashT = 0;
let bobT = 0;
let shake = 0;

const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const shootables = world.shootables.concat(bots.hitMeshes);
const tmpDir = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
let recentShots = [];
let time = 0;
let plantProgress = 0;
let defuseProgress = 0;
let lastDefuseAt = -9;
let beepT = 0;
let playing = false; // pointer locked, or a shot/test mode is driving
let frozen = false;
let minimapT = 0;
let firedLatch = false;

const grenades = [];
{
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.4 });
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, active: false, kind: 'he', vel: new THREE.Vector3(), fuse: 0 });
  }
}

function foesOf(bot) {
  const foes = bots.bots.filter((b) => b.team !== bot.team);
  if (bot.team === 'jackal') foes.push(playerActor);
  return foes;
}

function aliveCount(team) {
  let n = bots.bots.reduce((sum, b) => sum + (b.team === team && b.alive ? 1 : 0), 0);
  if (team === 'warden' && player.state.alive) n += 1;
  return n;
}

function syncPlayerActor() {
  playerActor.alive = player.state.alive;
  playerActor.crouching = player.state.crouching;
  playerActor.eyePosY = player.state.position.y + player.state.eye;
}

function angleToHudHurt(sourcePos) {
  const dx = sourcePos.x - player.state.position.x;
  const dz = sourcePos.z - player.state.position.z;
  const fx = -Math.sin(player.state.yaw);
  const fz = -Math.cos(player.state.yaw);
  const dot = fx * dx + fz * dz;
  const cross = fx * dz - fz * dx;
  return Math.atan2(cross, dot);
}

function damageActor(target, dmg, part, source) {
  if (!target || (target.isPlayer ? !player.state.alive : !target.alive)) return false;
  let amount = dmg;
  if (part === 'leg') amount *= 0.75;
  if (target.isPlayer) {
    if (part === 'body' && ms.loadout.armour >= 1) amount *= 0.55;
    if (part === 'head' && ms.loadout.armour >= 2) amount *= 0.6;
    player.state.hp -= amount;
    hud.hurt(angleToHudHurt(source && source.position ? source.position : player.state.position));
    audio.hurt();
    shake = Math.min(0.5, shake + 0.12);
    if (player.state.hp <= 0) {
      player.state.hp = 0;
      player.state.alive = false;
      ms.deaths += 1;
      hud.killfeed(`${source && source.name ? source.name : 'Jackal'} ▸ YOU`, 'j');
      hud.setSpectate('');
      checkElimination();
    }
    hud.setHealth(player.state.hp, ms.loadout.armour);
    return true;
  }
  const bot = target;
  if (part === 'body' && bot.armour >= 1) amount *= 0.55;
  bot.hp -= amount;
  if (bot.hp <= 0) {
    bots.kill(bot);
    const byPlayer = source === playerActor;
    hud.killfeed(byPlayer ? `YOU ▸ ${bot.name}` : `${source && source.name ? source.name : 'Warden'} ▸ ${bot.name}`, bot.team === 'jackal' ? 'w' : 'j');
    if (byPlayer) {
      ms.money += 300;
      ms.kills += 1;
      hud.setMoney(ms.money);
      audio.kill();
    }
    checkElimination();
  }
  return true;
}

function checkElimination() {
  if (ms.phase !== 'live' && ms.phase !== 'planted') return;
  if (aliveCount('jackal') === 0) endRound('warden', 'Jackals eliminated');
  else if (aliveCount('warden') === 0 && ms.phase === 'live') endRound('jackal', 'Wardens eliminated');
}

function endRound(winner, reason) {
  if (ms.phase === 'end' || ms.phase === 'matchend') return;
  const playerSurvived = player.state.alive;
  match.endRound(winner);
  if (!playerSurvived && winner) match.resetLoadoutAfterDeath();
  if (document.pointerLockElement) document.exitPointerLock();
  playing = false;
  hud.hideBuy();
  hud.setSpectate(null);
  effects.charge.visible = false;
  if (winner === 'warden') { audio.roundWin(); hud.banner('ROUND WON', reason, 3.6); }
  else { audio.roundLose(); hud.banner('ROUND LOST', reason, 3.6); }
  if (ms.matchWinner) {
    ms.phase = 'matchend';
    const won = ms.matchWinner === 'warden';
    hud.showOverlay(
      won ? 'Depot Secured' : 'Depot Lost',
      `Final score ${ms.score.warden} — ${ms.score.jackal}. Your line: ${ms.kills} kills, ${ms.deaths} deaths over ${ms.round} rounds.`,
      'Play again',
      () => { match.restartMatch(() => (rand() < 0.5 ? 'A' : 'B')); startRound(); },
    );
  }
}

function explodeCharge() {
  const pos = effects.charge.position;
  effects.explosion(pos);
  audio.explosion();
  shake = 1;
  // the blast itself settles nearby actors before the round is scored
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = bot.position.distanceTo(pos);
    if (d < 6) damageActor(bot, 130 * (1 - d / 7), 'body', playerActor);
  }
  if (player.state.alive && player.state.position.distanceTo(pos) < 6) {
    damageActor(playerActor, 60, 'body', null);
  }
  endRound('warden', 'Charge detonated at ' + SITES[ms.site].name);
}

function startRound() {
  ms.plantedAt = null;
  plantProgress = 0;
  defuseProgress = 0;
  recentShots = [];
  for (const g of grenades) { g.active = false; g.mesh.visible = false; }
  effects.charge.visible = false;
  player.reset(SPAWNS.attack[0], ms.loadout.armour);
  bots.reset(ms);
  for (const id of Object.keys(guns)) {
    guns[id].mag = WEAPONS[id].mag;
    guns[id].reserve = WEAPONS[id].reserve;
    guns[id].cooldown = 0;
    guns[id].reloadT = 0;
  }
  inv = { he: ms.loadout.he, smoke: ms.loadout.smoke };
  currentGun = ms.loadout.primary || 'pistol';
  viewModels.show(currentGun);
  syncPlayerActor();
  hud.setHealth(100, ms.loadout.armour);
  hud.setMoney(ms.money);
  hud.setTop(ms);
  hud.setObjective(`Plant the charge at ${SITES[ms.site].name} — hold E on the site`);
  hud.setSpectate(null);
  hud.banner(`ROUND ${ms.round}`, ms.score.warden + ms.score.jackal === 0 ? 'First to 7 takes the depot' : '', 1.6);
  if (!shot && !testMode) {
    hud.showBuy(ms, (id) => {
      const ok = match.buy(id);
      if (ok) {
        audio.buy();
        if (WEAPONS[id]) { currentGun = id; viewModels.show(id); }
        inv = { he: ms.loadout.he, smoke: ms.loadout.smoke };
        hud.setMoney(ms.money);
        refreshAmmoHud();
      } else audio.denied();
      return ok;
    }, deploy);
  }
  refreshAmmoHud();
}

function deploy() {
  hud.hideBuy();
  if (ms.phase === 'buy') {
    ms.phase = 'live';
    ms.timer = ROUND_TIME;
  }
  audio.ensure();
  input.requestLock();
}

function refreshAmmoHud() {
  const gun = guns[currentGun];
  hud.setAmmo(gun.mag, gun.reserve, gun.reloadT > 0);
  hud.setWeapon(WEAPONS[currentGun].name.toUpperCase(), inv);
}

function onLockChange(locked) {
  if (shot || testMode) return;
  playing = locked;
  if (locked) {
    hud.hideOverlay();
  } else if ((ms.phase === 'live' || ms.phase === 'planted') && player.state.alive && !hud.buyVisible()) {
    hud.showOverlay('Duskline Depot', 'Paused. The depot waits for no one — click back in.', 'Resume', () => input.requestLock());
  }
}

// --- the player's gun ---
function muzzlePos(out) {
  camera.getWorldPosition(out);
  tmpDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  out.addScaledVector(tmpDir, 0.7);
  out.y -= 0.12;
  return out;
}

function playerShoot() {
  const def = WEAPONS[currentGun];
  const gun = guns[currentGun];
  gun.mag -= 1;
  gun.cooldown = 60 / def.rpm;
  flashT = 0.05;
  viewKick += def.kick * 1.6;
  viewModels.group.position.z = -0.45 + def.kick * 2.4;
  player.recoil(def.kick * (0.85 + rand() * 0.3), (rand() - 0.5) * def.kick * 0.7);
  if (currentGun === 'shotgun') audio.shotgun(0);
  else if (currentGun === 'sniper') audio.sniper(0);
  else audio.shot(0);
  recentShots.push({ x: player.state.position.x, z: player.state.position.z, time, team: 'warden' });
  const spread = spreadFor(def, player.speed(), player.state.crouching, input.state.ads, !player.state.onGround);
  muzzlePos(tmpVec2);
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    camera.getWorldDirection(tmpDir);
    tmpDir.x += (rand() + rand() - 1) * spread;
    tmpDir.y += (rand() + rand() - 1) * spread;
    tmpDir.z += (rand() + rand() - 1) * spread;
    tmpDir.normalize();
    raycaster.set(camera.position, tmpDir);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    const end = hit ? hit.point : tmpVec.copy(camera.position).addScaledVector(tmpDir, 90);
    effects.tracer(tmpVec2, end);
    if (!hit) continue;
    effects.impact(hit.point, 4);
    const data = hit.object.userData;
    if (data && data.actor) {
      const dmg = damageAt(def, hit.distance) * (data.part === 'head' ? def.headMult : 1);
      const wasAlive = data.actor.alive;
      damageActor(data.actor, dmg, data.part, playerActor);
      if (wasAlive) {
        hud.hitMarker(!data.actor.alive);
        audio.hit(data.part === 'head');
      }
    }
  }
  refreshAmmoHud();
}

function botFire(bot, foe) {
  bot.lastShotAt = time;
  recentShots.push({ x: bot.position.x, z: bot.position.z, time, team: bot.team });
  const dist = Math.hypot(foe.position.x - bot.position.x, foe.position.z - bot.position.z);
  const toPlayer = foe.isPlayer ? 0 : Math.min(1, bot.position.distanceTo(player.state.position) / 46);
  if (bot.weaponId === 'shotgun') audio.shotgun(toPlayer);
  else if (bot.weaponId === 'sniper') audio.sniper(toPlayer);
  else audio.shot(toPlayer);
  tmpVec.set(bot.position.x, 1.32, bot.position.z);
  const targetSpeed = foe.isPlayer ? player.speed() : foe.speedNow;
  let pHit = 0.6 - dist * 0.009 - targetSpeed * 0.05 - (foe.crouching ? 0.05 : 0);
  if (bot.weaponId === 'sniper') pHit = Math.min(0.55, pHit + 0.08);
  pHit = Math.max(0.07, Math.min(0.62, pHit));
  const hit = rand() < pHit;
  tmpVec2.set(foe.position.x, foe.isPlayer ? foe.eyePosY - 0.25 : 1.25, foe.position.z);
  if (!hit) {
    tmpVec2.x += (rand() - 0.5) * 2.4;
    tmpVec2.y += rand() * 0.9;
    tmpVec2.z += (rand() - 0.5) * 2.4;
    effects.impact(tmpVec2, 3);
  }
  effects.tracer(tmpVec, tmpVec2);
  if (hit) {
    const roll = rand();
    const part = roll < 0.13 ? 'head' : roll < 0.33 ? 'leg' : 'body';
    const dmg = damageAt(bot.def, dist) * (part === 'head' ? bot.def.headMult : 1);
    damageActor(foe, dmg, part, bot);
  }
}

function throwGrenade(kind) {
  const slot = grenades.find((g) => !g.active);
  if (!slot) return;
  if (kind === 'he' && inv.he <= 0) return;
  if (kind === 'smoke' && inv.smoke <= 0) return;
  if (kind === 'he') inv.he -= 1; else inv.smoke -= 1;
  camera.getWorldPosition(slot.mesh.position);
  camera.getWorldDirection(tmpDir);
  slot.mesh.position.addScaledVector(tmpDir, 0.6);
  slot.vel.copy(tmpDir).multiplyScalar(15);
  slot.vel.y += 4;
  slot.kind = kind;
  slot.fuse = kind === 'he' ? 1.5 : 2.2;
  slot.active = true;
  slot.mesh.visible = true;
  audio.throwWhoosh();
  refreshAmmoHud();
}

function stepGrenades(dt) {
  for (const g of grenades) {
    if (!g.active) continue;
    g.fuse -= dt;
    g.vel.y -= 18 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    if (g.mesh.position.y < 0.1) {
      g.mesh.position.y = 0.1;
      g.vel.y = Math.abs(g.vel.y) * 0.35;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
      if (g.kind === 'smoke' && g.fuse > 0.4) g.fuse = 0.4; // smoke pops soon after it lands
    }
    if (g.fuse <= 0) {
      g.active = false;
      g.mesh.visible = false;
      if (g.kind === 'he') {
        effects.explosion(g.mesh.position);
        audio.grenadeBoom(Math.min(1, g.mesh.position.distanceTo(player.state.position) / 40));
        shake = Math.min(1, shake + Math.max(0, 0.5 - g.mesh.position.distanceTo(player.state.position) * 0.012));
        const all = bots.bots.concat([playerActor]);
        for (const actor of all) {
          const alive = actor.isPlayer ? player.state.alive : actor.alive;
          if (!alive) continue;
          const d = actor.position.distanceTo(g.mesh.position);
          if (d < GRENADES.he.radius) damageActor(actor, GRENADES.he.damage * (1 - d / (GRENADES.he.radius + 1.5)), 'body', playerActor);
        }
      } else {
        effects.smoke(g.mesh.position, GRENADES.smoke.radius, GRENADES.smoke.duration, time);
        audio.smokePop();
      }
    }
  }
}

// --- per-step simulation ---
function step(dt) {
  time += dt;
  hud.step(dt);
  effects.step(dt, time);
  recentShots = recentShots.filter((s) => time - s.time < 3);

  if (ms.phase === 'buy') {
    ms.timer -= dt;
    if (ms.timer <= 0) { hud.hideBuy(); ms.phase = 'live'; ms.timer = ROUND_TIME; }
    syncCamera();
    return;
  }
  if (ms.phase === 'end') {
    ms.timer -= dt;
    stepBots(dt);
    if (ms.timer <= 0) { match.nextRound(() => (rand() < 0.5 ? 'A' : 'B')); startRound(); }
    syncCamera();
    return;
  }
  if (ms.phase === 'matchend') { syncCamera(); return; }

  // live or planted
  ms.timer -= dt;
  if (ms.phase === 'live' && ms.timer <= 0) { endRound('jackal', 'Time expired — no plant'); return; }
  if (ms.phase === 'planted') {
    const left = ms.timer;
    beepT -= dt;
    if (beepT <= 0) {
      beepT = 0.16 + (left / 38) * 0.8;
      audio.plantBeep(left < 10);
      effects.setChargeBlink(Math.floor(time * 4) % 2 === 0);
    }
    if (defuseProgress > 0 && time - lastDefuseAt > 0.25) defuseProgress = 0;
    if (left <= 0) { explodeCharge(); return; }
  }

  const canAct = playing && player.state.alive;
  if (canAct) {
    const look = input.takeLook();
    const sens = input.state.ads ? 0.0011 : 0.0021;
    player.look(look.x, look.y, sens);
    handleKeys(dt);
  }
  if (player.state.alive) player.step(dt, canAct ? input.state.keys : EMPTY_KEYS);
  stepWeapons(dt, canAct);
  stepBots(dt);
  stepGrenades(dt);
  stepPlant(dt, canAct);
  syncPlayerActor();
  hud.setTop(ms);
  minimapT -= dt;
  if (minimapT <= 0) {
    minimapT = 0.12;
    hud.drawMinimap({
      colliders: world.colliders, playerPos: player.state.position, playerYaw: player.state.yaw,
      bots: bots.bots, site: ms.site, chargePos: ms.phase === 'planted' ? effects.charge.position : null, time,
    });
  }
  syncCamera();
}

const EMPTY_KEYS = new Set();

function handleKeys(dt) {
  const keys = input.state.keys;
  if (keys.has('KeyB') && ms.phase === 'live' && ms.timer > ROUND_TIME - 12) { /* buy is pre-round only; B is a reminder */ }
  if (keys.has('Digit1')) switchGun('pistol');
  if (keys.has('Digit2') && ms.loadout.primary) switchGun(ms.loadout.primary);
  const wheel = input.takeWheel();
  if (wheel !== 0 && ms.loadout.primary) switchGun(currentGun === 'pistol' ? ms.loadout.primary : 'pistol');
  if (keys.has('KeyR')) startReload();
  if (keys.has('KeyG')) { keys.delete('KeyG'); throwGrenade('he'); }
  if (keys.has('KeyF')) { keys.delete('KeyF'); throwGrenade('smoke'); }
  void dt;
}

function switchGun(id) {
  if (id === currentGun || equipT > 0) return;
  currentGun = id;
  equipT = 0.32;
  viewModels.show(id);
  refreshAmmoHud();
}

function startReload() {
  const gun = guns[currentGun];
  const def = WEAPONS[currentGun];
  if (gun.reloadT > 0 || gun.mag >= def.mag || gun.reserve <= 0) return;
  gun.reloadT = def.reload;
  audio.reload();
  refreshAmmoHud();
}

function stepWeapons(dt, canAct) {
  for (const gun of Object.values(guns)) {
    gun.cooldown = Math.max(0, gun.cooldown - dt);
    if (gun.reloadT > 0) {
      gun.reloadT -= dt;
      if (gun.reloadT <= 0) {
        const def = WEAPONS[currentGun];
        const cur = guns[currentGun];
        if (gun === cur) {
          const need = def.mag - cur.mag;
          const take = Math.min(need, cur.reserve);
          cur.mag += take;
          cur.reserve -= take;
        }
        refreshAmmoHud();
      }
    }
  }
  equipT = Math.max(0, equipT - dt);
  flashT = Math.max(0, flashT - dt);
  viewModels.setFlash(currentGun, flashT > 0);
  viewModels.group.position.z += ((-0.45) - viewModels.group.position.z) * Math.min(1, dt * 16);
  viewKick *= Math.pow(0.0001, dt); // fast decay back to point of aim
  if (!canAct) { firedLatch = false; return; }
  const def = WEAPONS[currentGun];
  const gun = guns[currentGun];
  const wantFire = input.state.firing && equipT <= 0 && gun.reloadT <= 0;
  if (wantFire && gun.cooldown <= 0) {
    if (gun.mag <= 0) { audio.dry(); gun.cooldown = 0.3; startReload(); }
    else if (def.auto || !firedLatch) playerShoot();
  }
  firedLatch = input.state.firing;
}

function stepBots(dt) {
  bots.step(dt, {
    time,
    phase: ms.phase === 'planted' ? 'planted' : 'live',
    site: ms.site,
    chargePos: ms.phase === 'planted' ? effects.charge.position : null,
    recentShots,
    foesOf,
    smokeBlocks: (x1, z1, x2, z2) => effects.smokeBlocks(x1, z1, x2, z2, time),
    onBotFire: botFire,
    onDefuse: (bot, ddt) => {
      void bot;
      defuseProgress += ddt / 5;
      lastDefuseAt = time;
      hud.setObjective(`The charge is being defused — ${Math.round(defuseProgress * 100)}%`);
      if (defuseProgress >= 1) {
        audio.defused();
        endRound('jackal', 'Charge defused');
      }
    },
  });
  for (const bot of bots.bots) if (bot.lastShotAt && time - bot.lastShotAt > 3.2) bot.lastShotAt = 0;
}

function stepPlant(dt, canAct) {
  if (ms.phase !== 'live') return;
  const site = SITES[ms.site];
  const dx = player.state.position.x - site.x;
  const dz = player.state.position.z - site.z;
  const inSite = Math.hypot(dx, dz) < site.radius;
  if (canAct && inSite && input.state.keys.has('KeyE') && player.speed() < 0.6) {
    plantProgress += dt / 3.2;
    hud.setObjective(`Planting the charge — ${Math.round(plantProgress * 100)}%`);
    if (plantProgress >= 1) {
      ms.phase = 'planted';
      ms.timer = 38;
      ms.money += 300;
      hud.setMoney(ms.money);
      effects.charge.position.set(player.state.position.x, 0, player.state.position.z);
      effects.charge.visible = true;
      audio.planted();
      hud.banner('CHARGE PLANTED', 'Hold the site for 38 seconds', 2.2);
      hud.setObjective('Defend the charge');
    }
  } else {
    plantProgress = Math.max(0, plantProgress - dt * 0.7);
    if (inSite && player.state.alive) hud.setObjective(`Hold E to plant at ${site.name}`);
    else if (player.state.alive) hud.setObjective(`Plant the charge at ${site.name} — hold E on the site`);
  }
}

function syncCamera() {
  if (!player.state.alive && (ms.phase === 'live' || ms.phase === 'planted')) {
    const ally = bots.bots.find((b) => b.team === 'warden' && b.alive);
    viewModels.group.visible = false;
    viewModels.flash.visible = false;
    if (ally) {
      camera.position.set(ally.position.x, 1.52, ally.position.z);
      camera.rotation.set(0, ally.yaw, 0, 'YXZ');
      hud.setSpectate(ally.name.toUpperCase());
    } else if (ms.phase === 'planted') {
      const c = effects.charge.position;
      camera.position.set(c.x + 7, 7.5, c.z + 7);
      camera.lookAt(c.x, 0, c.z);
      hud.setSpectate('THE CHARGE');
    }
    return;
  }
  viewModels.group.visible = true;
  const body = player.state;
  bobT += player.speed() * 0.028;
  const bob = player.state.onGround && player.speed() > 0.5 ? Math.sin(bobT * 2) * 0.028 : 0;
  camera.position.set(body.position.x, body.position.y + body.eye + bob, body.position.z);
  camera.rotation.set(body.pitch + viewKick, body.yaw, 0, 'YXZ');
  if (shake > 0) {
    camera.position.x += (rand() - 0.5) * shake * 0.12;
    camera.position.y += (rand() - 0.5) * shake * 0.12;
    shake = Math.max(0, shake - 0.03);
  }
  const targetFov = input.state.ads && player.state.alive ? 74 / WEAPONS[currentGun].zoom : 74;
  if (Math.abs(camera.fov - targetFov) > 0.2) {
    camera.fov += (targetFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
  const spread = spreadFor(WEAPONS[currentGun], player.speed(), player.state.crouching, input.state.ads, !player.state.onGround);
  hud.setCrosshair(Math.min(26, spread * 900));
}

// --- frame loop ---
let accumulator = 0;
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    scene.updateMatrixWorld(true);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- staging for screenshots and the scripted test ---
function aimAt(x, y, z) {
  const dx = x - player.state.position.x;
  const dy = y - (player.state.position.y + player.state.eye);
  const dz = z - player.state.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
}

function placeBot(team, slot, x, z, yaw) {
  const bot = bots.bots.filter((b) => b.team === team)[slot];
  if (!bot) return null;
  bot.position.set(x, 0, z);
  bot.yaw = yaw;
  bot.group.rotation.y = yaw;
  return bot;
}

function runShot(name) {
  playing = true;
  hud.hideBuy();
  hud.hideBanner();
  if (name === 'buy') {
    hud.showBuy(ms, () => false, () => {});
    hud.banner('', '', 0);
    hud.hideBanner();
    player.state.position.set(0, 0, 24);
    player.state.yaw = 0.5;
    syncCamera();
  } else if (name === 'combat') {
    ms.phase = 'live';
    ms.timer = 63;
    ms.round = 5;
    ms.score.warden = 3;
    ms.score.jackal = 2;
    ms.money = 2600;
    ms.loadout.primary = 'rifle';
    currentGun = 'rifle';
    viewModels.show('rifle');
    guns.rifle.mag = 24;
    player.state.position.set(3.2, 0, 12.5);
    player.state.hp = 82;
    placeBot('jackal', 0, 1.2, 4.2, Math.PI);
    placeBot('jackal', 1, 9.5, 0.5, Math.PI * 0.85);
    placeBot('warden', 0, -3.5, 14, 0.2);
    placeBot('warden', 1, 6.2, 16, -0.3);
    aimAt(1.2, 1.3, 4.2);
    ms.loadout.armour = 1;
    hud.setHealth(82, 1);
    refreshAmmoHud();
    hud.setMoney(ms.money);
    hud.hitMarker(false);
    tmpVec.set(3.0, 1.45, 11.4);
    tmpVec2.set(1.2, 1.3, 4.2);
    effects.tracer(tmpVec, tmpVec2);
    effects.impact(tmpVec2, 8);
    tmpVec.set(9.5, 1.4, 0.5);
    tmpVec2.set(4.8, 1.1, 11.6);
    effects.tracer(tmpVec, tmpVec2);
    hud.drawMinimap({
      colliders: world.colliders, playerPos: player.state.position, playerYaw: player.state.yaw,
      bots: bots.bots, site: ms.site, chargePos: null, time,
    });
    syncCamera();
  } else if (name === 'plant') {
    ms.phase = 'live';
    ms.timer = 47;
    ms.round = 8;
    ms.score.warden = 5;
    ms.score.jackal = 4;
    ms.site = 'A';
    ms.money = 2150;
    ms.loadout.primary = 'rifle';
    ms.loadout.armour = 1;
    currentGun = 'rifle';
    viewModels.show('rifle');
    guns.rifle.mag = 27;
    hud.setHealth(100, 1);
    refreshAmmoHud();
    player.state.position.set(-19, 0, -16.4);
    placeBot('warden', 0, -16.2, -19.5, -2.26);
    placeBot('jackal', 0, -23.5, -25.5, 0.46);
    aimAt(-21.5, 1.2, -24);
    hud.setObjective('Planting the charge — 62%');
    hud.drawMinimap({
      colliders: world.colliders, playerPos: player.state.position, playerYaw: player.state.yaw,
      bots: bots.bots, site: ms.site, chargePos: null, time,
    });
    syncCamera();
  } else if (name === 'scope') {
    ms.phase = 'live';
    ms.timer = 47;
    ms.round = 6;
    ms.score.warden = 3;
    ms.score.jackal = 3;
    ms.site = 'B';
    ms.money = 3900;
    ms.loadout.primary = 'sniper';
    ms.loadout.armour = 1;
    currentGun = 'sniper';
    viewModels.show('sniper');
    guns.sniper.mag = 4;
    player.state.position.set(19.5, 0, 3.5);
    player.state.hp = 100;
    placeBot('jackal', 0, 18.2, -11.5, Math.PI);
    placeBot('jackal', 1, 23.5, -19, Math.PI * 1.1);
    placeBot('warden', 0, 14.5, 6.5, -0.4);
    aimAt(18.2, 1.35, -11.5);
    hud.setObjective('Plant the charge at B — Fuel Row — hold E on the site');
    input.state.ads = true;
    hud.setHealth(100, 1);
    refreshAmmoHud();
    hud.setMoney(ms.money);
    hud.drawMinimap({
      colliders: world.colliders, playerPos: player.state.position, playerYaw: player.state.yaw,
      bots: bots.bots, site: ms.site, chargePos: null, time,
    });
    syncCamera();
    camera.fov = 74 / WEAPONS.sniper.zoom;
    camera.updateProjectionMatrix();
  } else if (name === 'victory') {
    ms.phase = 'end';
    ms.score.warden = 7;
    ms.score.jackal = 4;
    ms.round = 11;
    player.state.position.set(-17, 0, -17.5);
    placeBot('warden', 0, -20.5, -19.5, -0.6);
    placeBot('warden', 1, -14.5, -20, 0.9);
    aimAt(-19, 1.6, -21);
    hud.banner('DEPOT SECURED', 'Wardens win the match 7 — 4', 60);
    hud.drawMinimap({
      colliders: world.colliders, playerPos: player.state.position, playerYaw: player.state.yaw,
      bots: bots.bots, site: ms.site, chargePos: null, time,
    });
    syncCamera();
  }
  hud.setTop(ms);
  hud.setMoney(ms.money);
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 3) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// The scripted test is driven by the game's own clock (the module's `time`), never by wall
// time: a throttled or slow renderer stretches real seconds, but the sequence — walk, fire,
// plant, detonate, score — must still run in simulation order.
function runTest() {
  playing = true;
  hud.hideBuy();
  ms.phase = 'live';
  ms.timer = ROUND_TIME;
  ms.loadout.primary = 'rifle';
  ms.loadout.he = 1;
  currentGun = 'rifle';
  viewModels.show('rifle');
  inv = { he: 1, smoke: 0 };
  const target = placeBot('jackal', 0, 0, 12, Math.PI);
  const result = { moved: false, fired: false, damaged: false, planted: false, roundScored: false };
  const startPos = player.state.position.clone();
  const startHp = target.hp;
  const t0 = time;
  let plantSetup = false;
  let plantCheckedAt = -1;
  const keys = input.state.keys;
  const timer = window.setInterval(() => {
    const gt = time - t0;
    if (gt < 1.2) {
      keys.add('KeyW');
    } else if (gt < 3.2) {
      keys.delete('KeyW');
      result.moved = player.state.position.distanceTo(startPos) > 1.5;
      aimAt(target.position.x, 1.25, target.position.z);
      input.state.firing = true;
      result.fired = guns.rifle.mag < WEAPONS.rifle.mag;
      result.damaged = target.hp < startHp;
    } else if (gt < 8.5) {
      input.state.firing = false;
      if (!plantSetup) {
        plantSetup = true;
        // a fair plant test: the site is cleared first (the defenders are sent to the far
        // corner, from where they must path back), the player steps on site A fresh
        player.state.position.set(SITES.A.x + 2, 0, SITES.A.z + 2);
        player.state.velocity.set(0, 0, 0);
        player.state.hp = 100;
        player.state.alive = true;
        ms.site = 'A';
        ms.phase = 'live';
        ms.timer = ROUND_TIME;
        for (const bot of bots.bots) {
          if (bot.team === 'jackal' && bot.alive) {
            bot.position.set(26, 0, 26);
            bot.target = null;
            bot.lastKnown = null;
            bot.path = [];
            bot.pathI = 0;
          }
        }
      }
      keys.add('KeyE');
      if (ms.phase === 'planted' && plantCheckedAt < 0) {
        result.planted = true;
        plantCheckedAt = gt;
        ms.timer = 0.05; // fast-forward the fuse: detonation should score the round
      }
    } else {
      keys.delete('KeyE');
      result.planted = result.planted || ms.phase === 'planted';
      result.roundScored = ms.score.warden >= 1;
      window.__testResult = result;
      window.__testDone = true;
      window.clearInterval(timer);
    }
  }, 50);
}

startRound();
if (shot) runShot(shot);
else {
  if (testMode) runTest();
  requestAnimationFrame(frame);
}
