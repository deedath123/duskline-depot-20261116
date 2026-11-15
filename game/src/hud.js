// The HUD: pure DOM over the canvas. Health, armour, ammunition, money, the round clock and
// score up top, a live minimap, a killfeed, hit and damage feedback, round banners, and the
// buy menu that opens every round. It reads match state and writes elements; it owns no game
// numbers of its own beyond fade timers.
import { WEAPONS, GRENADES, ARMOUR } from './weapons.js';
import { SITES } from './world.js';

const BUY_ITEMS = [
  ['smg', WEAPONS.smg.name, WEAPONS.smg.price], ['shotgun', WEAPONS.shotgun.name, WEAPONS.shotgun.price],
  ['rifle', WEAPONS.rifle.name, WEAPONS.rifle.price], ['sniper', WEAPONS.sniper.name, WEAPONS.sniper.price],
  ['he', GRENADES.he.name, GRENADES.he.price], ['smoke', GRENADES.smoke.name, GRENADES.smoke.price],
  ['vest', ARMOUR.vest.name, ARMOUR.vest.price], ['full', ARMOUR.full.name, ARMOUR.full.price],
];

function el(id) { return document.getElementById(id); }

export function createHud() {
  const healthBar = el('healthbar');
  const mapCtx = el('minimap').getContext('2d');
  let hitT = 0;
  let hurtT = 0;
  let bannerT = 0;

  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  const hud = {
    setHealth(hp, armour) {
      el('healthnum').textContent = String(Math.max(0, Math.ceil(hp)));
      healthBar.style.width = `${Math.max(0, hp)}%`;
      healthBar.style.background = hp <= 30 ? 'var(--jackal)' : 'var(--warden)';
      el('armournum').textContent = armour === 2 ? 'VEST + HELM' : armour === 1 ? 'VEST' : '';
    },
    setAmmo(mag, reserve, reloading) {
      el('ammo-mag').textContent = String(mag);
      el('ammo-reserve').textContent = `/ ${reserve}`;
      el('ammo').classList.toggle('empty', mag === 0);
      el('reload-hint').textContent = reloading ? 'RELOADING' : mag === 0 ? 'R — RELOAD' : '';
    },
    setWeapon(name, grenades) {
      el('weapon-name').textContent = name;
      el('grenade-line').textContent =
        `HE ×${grenades.he} · SMOKE ×${grenades.smoke}`;
    },
    setMoney(money) { el('money').textContent = `$${money}`; },
    setTop(state) {
      el('timer').textContent = state.phase === 'planted' ? 'CHARGE SET' : fmtTime(state.timer);
      el('timer').classList.toggle('urgent', state.timer <= 10 || state.phase === 'planted');
      el('score-line').innerHTML = `<b class="w">${state.score.warden}</b> — <b class="j">${state.score.jackal}</b>`;
      el('round-line').textContent = `ROUND ${state.round} · FIRST TO 7`;
    },
    setObjective(text) { el('objective').textContent = text; },
    setCrosshair(spreadPx) { el('crosshair').style.setProperty('--gap', `${6 + spreadPx}px`); },
    hitMarker(kill = false) {
      hitT = kill ? 0.28 : 0.14;
      el('hitmarker').classList.add('on');
      el('hitmarker').classList.toggle('kill', kill);
    },
    hurt(angleRad) {
      hurtT = 0.5;
      el('vignette').style.opacity = '1';
      const dir = el('dirhit');
      dir.style.opacity = '1';
      dir.style.transform = `translate(-50%,-50%) rotate(${angleRad}rad)`;
    },
    killfeed(text, teamClass) {
      const feed = el('killfeed');
      const line = document.createElement('div');
      line.className = `feed ${teamClass || ''}`;
      line.textContent = text;
      feed.appendChild(line);
      while (feed.children.length > 5) feed.removeChild(feed.firstChild);
      window.setTimeout(() => line.remove(), 4200);
    },
    banner(title, sub = '', holdSec = 0) {
      el('banner-title').textContent = title;
      el('banner-sub').textContent = sub;
      el('banner').hidden = false;
      bannerT = holdSec;
    },
    hideBanner() { el('banner').hidden = true; bannerT = 0; },
    setSpectate(name) {
      el('spectate').hidden = !name;
      if (name) el('spectate').textContent = `SPECTATING ${name} — the round plays out`;
    },
    showOverlay(title, copy, button, onClick) {
      el('overlay-title').textContent = title;
      el('overlay-copy').textContent = copy;
      const btn = el('overlay-btn');
      btn.textContent = button;
      btn.onclick = onClick;
      el('overlay').hidden = false;
    },
    hideOverlay() { el('overlay').hidden = true; },
    overlayVisible() { return !el('overlay').hidden; },

    showBuy(state, onBuy, onPlay) {
      const grid = el('buy-grid');
      grid.innerHTML = '';
      for (const [id, name, price] of BUY_ITEMS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-item';
        button.dataset.buy = id;
        button.innerHTML = `<span>${name}</span><b>$${price}</b>`;
        button.addEventListener('click', () => { if (onBuy(id)) hud.refreshBuy(state); });
        grid.appendChild(button);
      }
      el('buy-play').onclick = onPlay;
      el('buy').hidden = false;
      hud.refreshBuy(state);
    },
    refreshBuy(state) {
      el('buy-money').textContent = `$${state.money}`;
      el('buy-site').textContent = `Objective: plant the charge at ${SITES[state.site].name}`;
      for (const button of el('buy-grid').children) {
        const id = button.dataset.buy;
        const price = BUY_ITEMS.find((item) => item[0] === id)[2];
        let owned = false;
        if (WEAPONS[id]) owned = state.loadout.primary === id;
        else if (id === 'he') owned = state.loadout.he > 0;
        else if (id === 'smoke') owned = state.loadout.smoke > 0;
        else if (id === 'vest') owned = state.loadout.armour >= 1;
        else if (id === 'full') owned = state.loadout.armour >= 2;
        button.disabled = owned || state.money < price;
        button.classList.toggle('owned', owned);
      }
    },
    hideBuy() { el('buy').hidden = true; },
    buyVisible() { return !el('buy').hidden; },

    drawMinimap(view) {
      const { colliders, playerPos, playerYaw, bots, site, chargePos, time } = view;
      const S = 168;
      const scale = S / 64;
      mapCtx.clearRect(0, 0, S, S);
      mapCtx.fillStyle = 'rgba(23,26,33,0.82)';
      mapCtx.fillRect(0, 0, S, S);
      mapCtx.fillStyle = '#39404e';
      for (const box of colliders) {
        if (box.max.y < 1) continue;
        mapCtx.fillRect((box.min.x + 32) * scale, (box.min.z + 32) * scale,
          Math.max(1.5, (box.max.x - box.min.x) * scale), Math.max(1.5, (box.max.z - box.min.z) * scale));
      }
      for (const [key, s] of Object.entries(SITES)) {
        mapCtx.strokeStyle = key === site ? '#f2a33c' : '#8f97a5';
        mapCtx.lineWidth = 1.5;
        mapCtx.beginPath();
        mapCtx.arc((s.x + 32) * scale, (s.z + 32) * scale, s.radius * scale, 0, Math.PI * 2);
        mapCtx.stroke();
        mapCtx.fillStyle = mapCtx.strokeStyle;
        mapCtx.font = 'bold 10px ui-monospace, monospace';
        mapCtx.fillText(key, (s.x + 32) * scale - 3, (s.z + 32) * scale + 3);
      }
      if (chargePos) {
        mapCtx.fillStyle = Math.floor(time * 3) % 2 ? '#e4572e' : '#f2a33c';
        mapCtx.fillRect((chargePos.x + 32) * scale - 3, (chargePos.z + 32) * scale - 3, 6, 6);
      }
      for (const bot of bots) {
        if (!bot.alive) continue;
        if (bot.team === 'warden') {
          mapCtx.fillStyle = '#3ec6b8';
        } else {
          const recent = ctx_shotRecent(bot, time);
          if (!recent) continue;
          mapCtx.fillStyle = '#e4572e';
        }
        mapCtx.beginPath();
        mapCtx.arc((bot.position.x + 32) * scale, (bot.position.z + 32) * scale, 2.6, 0, Math.PI * 2);
        mapCtx.fill();
      }
      // the player as a facing wedge
      const px = (playerPos.x + 32) * scale;
      const py = (playerPos.z + 32) * scale;
      const fx = -Math.sin(playerYaw);
      const fz = -Math.cos(playerYaw);
      mapCtx.fillStyle = '#ece7da';
      mapCtx.beginPath();
      mapCtx.moveTo(px + fx * 6, py + fz * 6);
      mapCtx.lineTo(px - fx * 4 - fz * 3.4, py - fz * 4 + fx * 3.4);
      mapCtx.lineTo(px - fx * 4 + fz * 3.4, py - fz * 4 - fx * 3.4);
      mapCtx.closePath();
      mapCtx.fill();
    },

    step(dt) {
      if (hitT > 0) {
        hitT -= dt;
        if (hitT <= 0) el('hitmarker').classList.remove('on');
      }
      if (hurtT > 0) {
        hurtT -= dt;
        const o = Math.max(0, hurtT / 0.5);
        el('vignette').style.opacity = String(o * 0.85);
        el('dirhit').style.opacity = String(o);
      }
      if (bannerT > 0) {
        bannerT -= dt;
        if (bannerT <= 0) el('banner').hidden = true;
      }
    },
  };

  function ctx_shotRecent(bot, time) {
    return bot.lastShotAt && time - bot.lastShotAt < 3;
  }

  return hud;
}
