// The nine bots: four Warden allies who push the round's site with the player, five Jackal
// defenders who hold it. One brain for all of them, driven by perception, not scripts:
// - sight: a foe inside the view cone with a clear, smoke-free line at eye height is seen;
//   crouching behind low cover genuinely breaks the line, because sight is height-aware
// - hearing: a recent enemy shot nearby sets a last-known position worth checking
// - fire discipline: bursts are fired standing still or creeping, the way the spread maths
//   rewards; a hurt or reloading bot breaks for the nearest cover node first
// Movement follows the world's waypoint graph (A* in world.js) and simple separation keeps
// bots out of each other's bodies.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS, buildBotGun } from './weapons.js';
import { SPAWNS, SITES, COVER_NODES } from './world.js';

const BOT_DEFS = [
  // team, callsign, weapon, role
  ['warden', 'Rook', 'rifle'], ['warden', 'Sable', 'smg'], ['warden', 'Tern', 'rifle'], ['warden', 'Ostro', 'shotgun'],
  ['jackal', 'Vex', 'rifle'], ['jackal', 'Mora', 'rifle'], ['jackal', 'Hale', 'smg'], ['jackal', 'Ilya', 'rifle'], ['jackal', 'Nox', 'sniper'],
];
const SKIN = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a186'), roughness: 0.8 });
const DARK = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.85 });

function box(w, h, d, x, y, z, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function buildHumanoid(teamMat, darkMat) {
  const group = new THREE.Group();
  const legL = box(0.17, 0.78, 0.21, -0.12, 0.39, 0, darkMat);
  const legR = box(0.17, 0.78, 0.21, 0.12, 0.39, 0, darkMat);
  const torso = box(0.54, 0.62, 0.3, 0, 1.09, 0, teamMat);
  const head = new THREE.Group();
  head.position.y = 1.56;
  const skull = box(0.27, 0.29, 0.27, 0, 0, 0, SKIN);
  const helmet = box(0.31, 0.13, 0.31, 0, 0.15, 0, teamMat);
  const visor = box(0.24, 0.07, 0.02, 0, 0.01, -0.14, DARK);
  head.add(skull, helmet, visor);
  const gun = buildBotGun();
  gun.position.set(0.3, 1.3, -0.1);
  group.add(legL, legR, torso, head, gun);
  return { group, legL, legR, torso, skull, head, gun };
}

export function createBots(scene, world) {
  const teamMats = {
    warden: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.warden), roughness: 0.75 }),
    jackal: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.jackal), roughness: 0.75 }),
  };
  const bots = [];
  const hitMeshes = [];

  BOT_DEFS.forEach(([team, name, weaponId], index) => {
    const parts = buildHumanoid(teamMats[team], DARK);
    scene.add(parts.group);
    const bot = {
      isPlayer: false,
      index,
      team,
      name,
      weaponId,
      def: WEAPONS[weaponId],
      group: parts.group,
      parts,
      position: parts.group.position,
      yaw: 0,
      hp: 100,
      armour: team === 'jackal' && index % 2 === 0 ? 1 : 0,
      alive: true,
      crouching: false,
      speedNow: 0,
      walkCycle: Math.random() * 6,
      fallT: 0,
      // brain
      state: 'objective',
      path: [],
      pathI: 0,
      repathT: Math.random() * 0.5,
      perceiveT: Math.random() * 0.12,
      target: null,
      lastKnown: null,
      seenAt: -99,
      reactT: 0,
      burstLeft: 0,
      burstPause: 0,
      shotCd: 0,
      mag: WEAPONS[weaponId].mag,
      reloadT: 0,
      strafeDir: index % 2 === 0 ? 1 : -1,
      strafeT: 1 + Math.random(),
      coverUntil: 0,
      home: null,
      goalOffset: ((index % 3) - 1) * 3.2,
    };
    parts.torso.userData = { actor: bot, part: 'body' };
    parts.skull.userData = { actor: bot, part: 'head' };
    parts.legL.userData = { actor: bot, part: 'leg' };
    parts.legR.userData = { actor: bot, part: 'leg' };
    hitMeshes.push(parts.torso, parts.skull, parts.legL, parts.legR);
    bots.push(bot);
  });

  function reset(match) {
    for (const bot of bots) {
      const spawnPool = bot.team === 'warden' ? SPAWNS.attack : SPAWNS.defend;
      const slot = bot.team === 'warden' ? bot.index + 1 : bot.index - 4;
      const spawn = spawnPool[slot % spawnPool.length];
      bot.position.set(spawn[0], 0, spawn[1]);
      bot.yaw = bot.team === 'warden' ? 0 : Math.PI; // wardens face north, jackals face south
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.visible = true;
      bot.hp = 100;
      bot.alive = true;
      bot.fallT = 0;
      bot.crouching = false;
      bot.state = 'objective';
      bot.path = [];
      bot.pathI = 0;
      bot.target = null;
      bot.lastKnown = null;
      bot.mag = bot.def.mag;
      bot.reloadT = 0;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      if (bot.team === 'jackal') {
        // two hold the round's site, one holds mid, two hold the far site against a late switch
        const near = match.site === 'A' ? SPAWNS.defendHome.A : SPAWNS.defendHome.B;
        const far = match.site === 'A' ? SPAWNS.defendHome.B : SPAWNS.defendHome.A;
        const homes = [near[0], near[1], SPAWNS.defendHome.mid[0], far[0], far[1]];
        bot.home = homes[bot.index - 4] || [0, -24];
      }
    }
  }

  function blockedAt(x, z) {
    for (const box of world.colliders) {
      if (box.max.y < 0.6) continue;
      if (x > box.min.x - 0.34 && x < box.max.x + 0.34 && z > box.min.z - 0.34 && z < box.max.z + 0.34) return true;
    }
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.08) { bot.speedNow = 0; return true; }
    const stepLen = Math.min(dist, speed * dt);
    const nx = bot.position.x + (dx / dist) * stepLen;
    const nz = bot.position.z + (dz / dist) * stepLen;
    if (!blockedAt(nx, bot.position.z)) bot.position.x = nx;
    if (!blockedAt(bot.position.x, nz)) bot.position.z = nz;
    bot.speedNow = speed;
    bot.walkCycle += dt * speed * 2.1;
    const targetYaw = Math.atan2(-dx, -dz);
    let diff = targetYaw - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += diff * Math.min(1, dt * 10);
    return dist < 0.5;
  }

  function followPath(bot, dt, speed) {
    if (bot.pathI >= bot.path.length) { bot.speedNow = 0; return true; }
    const node = bot.path[bot.pathI];
    if (moveToward(bot, node.x, node.z, dt, speed)) bot.pathI += 1;
    return bot.pathI >= bot.path.length;
  }

  function setGoal(bot, gx, gz) {
    bot.path = world.findPath(bot.position.x, bot.position.z, gx, gz);
    bot.pathI = 0;
  }

  function eyeOf(actor) {
    return actor.crouching ? 1.02 : 1.5;
  }

  function perceive(bot, foes, ctx) {
    let best = null;
    let bestDist = Infinity;
    for (const foe of foes) {
      if (!foe.alive) continue;
      const dx = foe.position.x - bot.position.x;
      const dz = foe.position.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 46 || dist >= bestDist) continue;
      if (dist > 4) {
        const fx = -Math.sin(bot.yaw);
        const fz = -Math.cos(bot.yaw);
        const dot = (dx * fx + dz * fz) / (dist || 1);
        if (dot < -0.15) continue; // outside the view cone and not close enough to feel
      }
      const eye = eyeOf(bot);
      const foeEye = foe.isPlayer ? foe.eyePosY : eyeOf(foe);
      if (world.losBlocked(bot.position.x, bot.position.z, foe.position.x, foe.position.z, Math.min(eye, foeEye) - 0.06)) continue;
      if (ctx.smokeBlocks(bot.position.x, bot.position.z, foe.position.x, foe.position.z)) continue;
      best = foe;
      bestDist = dist;
    }
    if (best) {
      if (bot.target !== best) bot.reactT = 0.28 + Math.random() * 0.25;
      bot.target = best;
      bot.lastKnown = { x: best.position.x, z: best.position.z };
      bot.seenAt = ctx.time;
    } else if (ctx.time - bot.seenAt > 1.6) {
      bot.target = null;
    }
    // hearing: an enemy shot close by is worth a look even unseen
    if (!bot.target) {
      for (const shot of ctx.recentShots) {
        if (shot.team === bot.team) continue;
        if (Math.hypot(shot.x - bot.position.x, shot.z - bot.position.z) < 17) {
          bot.lastKnown = { x: shot.x, z: shot.z };
          bot.seenAt = Math.max(bot.seenAt, shot.time - 1);
        }
      }
    }
  }

  function step(dt, ctx) {
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fallT < 1) {
          bot.fallT = Math.min(1, bot.fallT + dt * 3.2);
          bot.group.rotation.x = -Math.PI / 2 * bot.fallT * 0.92;
          bot.group.position.y = 0.12 * bot.fallT;
        }
        continue;
      }
      bot.perceiveT -= dt;
      if (bot.perceiveT <= 0) {
        bot.perceiveT = 0.12;
        perceive(bot, ctx.foesOf(bot), ctx);
      }
      bot.shotCd -= dt;
      bot.reactT -= dt;
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) { bot.strafeT = 1.1 + Math.random() * 1.2; bot.strafeDir *= -1; }

      if (bot.reloadT > 0) {
        bot.reloadT -= dt;
        if (bot.reloadT <= 0) bot.mag = bot.def.mag;
      }

      const foe = bot.target;
      const foeDist = foe ? Math.hypot(foe.position.x - bot.position.x, foe.position.z - bot.position.z) : Infinity;
      const wantsCover = (bot.hp < 38 || bot.reloadT > 0.4) && ctx.time - bot.seenAt < 4 && bot.state !== 'defuse';

      if (ctx.phase === 'planted' && bot.team === 'jackal' && ctx.chargePos && !foe) {
        bot.state = 'defuse';
      } else if (wantsCover) {
        bot.state = 'cover';
      } else if (foe && bot.reactT <= 0) {
        bot.state = 'engage';
      } else if (bot.state === 'engage' || bot.state === 'cover' || bot.state === 'defuse') {
        bot.state = 'objective';
      }

      bot.crouching = bot.state === 'cover' && bot.arrivedCover === true;
      bot.speedNow = 0;

      if (bot.state === 'defuse' && ctx.chargePos) {
        const d = Math.hypot(ctx.chargePos.x - bot.position.x, ctx.chargePos.z - bot.position.z);
        if (d > 1.5) {
          bot.repathT -= dt;
          if (bot.repathT <= 0 || bot.pathI >= bot.path.length) { bot.repathT = 0.9; setGoal(bot, ctx.chargePos.x, ctx.chargePos.z); }
          followPath(bot, dt, 4.6);
        } else {
          ctx.onDefuse(bot, dt);
        }
      } else if (bot.state === 'cover') {
        let coverNode = null;
        let bestD = Infinity;
        for (const i of COVER_NODES) {
          const node = world.nodes[i];
          const d = Math.hypot(node.x - bot.position.x, node.z - bot.position.z);
          if (d < bestD) { bestD = d; coverNode = node; }
        }
        const arrived = Math.hypot(coverNode.x - bot.position.x, coverNode.z - bot.position.z) < 0.7;
        bot.arrivedCover = arrived;
        if (!arrived) {
          bot.repathT -= dt;
          if (bot.repathT <= 0 || bot.pathI >= bot.path.length) { bot.repathT = 0.8; setGoal(bot, coverNode.x, coverNode.z); }
          followPath(bot, dt, 4.4);
        } else if (bot.reloadT <= 0 && bot.hp >= 38) {
          bot.state = 'objective';
        }
      } else if (bot.state === 'engage' && foe) {
        // face the foe, hold or close to range, strafe between bursts
        const dx = foe.position.x - bot.position.x;
        const dz = foe.position.z - bot.position.z;
        const targetYaw = Math.atan2(-dx, -dz);
        let diff = targetYaw - bot.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        bot.yaw += diff * Math.min(1, dt * 12);
        const bursting = bot.burstLeft > 0;
        if (foeDist > 24) moveToward(bot, foe.position.x, foe.position.z, dt, 3.9);
        else if (!bursting) {
          const sx = -Math.cos(bot.yaw) * bot.strafeDir;
          const sz = Math.sin(bot.yaw) * bot.strafeDir;
          moveToward(bot, bot.position.x + sx * 3, bot.position.z + sz * 3, dt, 1.7);
        }
        if (bot.mag <= 0 && bot.reloadT <= 0) bot.reloadT = bot.def.reload;
        if (bot.burstPause > 0) bot.burstPause -= dt;
        else if (bot.shotCd <= 0 && bot.reloadT <= 0 && bot.speedNow < 2.4) {
          if (bot.burstLeft <= 0) bot.burstLeft = 3 + Math.floor(Math.random() * 3);
          bot.burstLeft -= 1;
          bot.shotCd = 60 / bot.def.rpm;
          bot.mag -= 1;
          ctx.onBotFire(bot, foe);
          if (bot.burstLeft <= 0) bot.burstPause = 0.45 + Math.random() * 0.5;
        }
      } else {
        // objective movement
        let gx;
        let gz;
        if (bot.team === 'warden') {
          const site = SITES[ctx.site];
          gx = site.x + bot.goalOffset;
          gz = site.z + (bot.index % 2 === 0 ? 2.4 : -1.6);
          if (ctx.phase === 'planted') { gx = ctx.chargePos ? ctx.chargePos.x + bot.goalOffset : gx; gz = ctx.chargePos ? ctx.chargePos.z + 2 : gz; }
        } else if (bot.lastKnown && ctx.time - bot.seenAt < 6 && ctx.phase === 'live') {
          gx = bot.lastKnown.x;
          gz = bot.lastKnown.z;
        } else {
          gx = bot.home ? bot.home[0] : 0;
          gz = bot.home ? bot.home[1] : -24;
        }
        const distGoal = Math.hypot(gx - bot.position.x, gz - bot.position.z);
        if (distGoal > 1.2) {
          bot.repathT -= dt;
          if (bot.repathT <= 0 || bot.pathI >= bot.path.length) { bot.repathT = 1; setGoal(bot, gx, gz); }
          const far = distGoal > 16 && ctx.time - bot.seenAt > 3;
          followPath(bot, dt, far ? 5.4 : 4.1);
        } else if (bot.team === 'jackal') {
          // hold: slow scan across the lane the home point watches
          bot.yaw += Math.sin(ctx.time * 0.45 + bot.index * 1.7) * dt * 0.5;
        }
      }

      // separation: never stand inside a teammate
      for (const other of bots) {
        if (other === bot || !other.alive) continue;
        const dx = bot.position.x - other.position.x;
        const dz = bot.position.z - other.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.001 && d2 < 0.64) {
          const d = Math.sqrt(d2);
          const push = (0.8 - d) * 0.5;
          const nx = bot.position.x + (dx / d) * push;
          const nz = bot.position.z + (dz / d) * push;
          if (!blockedAt(nx, bot.position.z)) bot.position.x = nx;
          if (!blockedAt(bot.position.x, nz)) bot.position.z = nz;
        }
      }

      // dress the figure: walk swing, crouch dip, aim the gun at the foe when engaged
      const swing = Math.sin(bot.walkCycle * 3.4) * (bot.speedNow > 0.2 ? 0.5 : 0);
      bot.parts.legL.rotation.x = swing;
      bot.parts.legR.rotation.x = -swing;
      bot.group.position.y = bot.crouching ? -0.34 : 0;
      bot.group.rotation.y = bot.yaw;
      if (foe && bot.state === 'engage') {
        const dy = (foe.isPlayer ? foe.eyePosY : 1.35) - 1.3;
        bot.parts.gun.rotation.x = Math.max(-0.5, Math.min(0.5, -Math.atan2(dy, Math.max(1, foeDist)) * 0.4));
      } else {
        bot.parts.gun.rotation.x = 0;
      }
    }
  }

  function kill(bot) {
    bot.alive = false;
    bot.fallT = 0;
    bot.target = null;
  }

  return { bots, hitMeshes, reset, step, kill };
}
