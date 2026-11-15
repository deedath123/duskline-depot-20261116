// Match state, kept in one place: the round machine, the score, the clock, and the player's
// money and loadout. Nothing else in the game keeps a second copy of these numbers; the HUD
// reads them, main.js moves them.
// Phases: buy (freeze + shop) -> live -> planted (charge ticking) -> end (banner) -> buy ...
// and matchend when a team reaches ROUNDS_TO_WIN.
import { WEAPONS, GRENADES, ARMOUR } from './weapons.js';

export const ROUND_TIME = 105;
export const PLANT_TIME = 38;
export const BUY_TIME = 14;
export const END_TIME = 4.5;
export const ROUNDS_TO_WIN = 7;
export const START_MONEY = 1400;

export function createMatch() {
  const state = {
    phase: 'buy',
    round: 1,
    score: { warden: 0, jackal: 0 },
    timer: BUY_TIME,
    site: 'A',
    money: START_MONEY,
    loadout: { primary: null, he: 0, smoke: 0, armour: 0 }, // armour: 0 none, 1 vest, 2 vest+helm
    plantedAt: null,
    winner: null, // 'warden' | 'jackal' for the round that just ended
    matchWinner: null,
    kills: 0,
    deaths: 0,
  };

  function resetLoadoutAfterDeath() {
    state.loadout.primary = null;
    state.loadout.he = 0;
    state.loadout.smoke = 0;
    state.loadout.armour = 0;
  }

  function buy(id) {
    if (state.phase !== 'buy') return false;
    if (WEAPONS[id]) {
      const def = WEAPONS[id];
      if (def.slot !== 'primary' || state.money < def.price) return false;
      state.money -= def.price;
      state.loadout.primary = id;
      return true;
    }
    if (GRENADES[id]) {
      const def = GRENADES[id];
      const held = id === 'he' ? state.loadout.he : state.loadout.smoke;
      if (held >= 1 || state.money < def.price) return false;
      state.money -= def.price;
      if (id === 'he') state.loadout.he = 1;
      else state.loadout.smoke = 1;
      return true;
    }
    if (ARMOUR[id]) {
      const level = id === 'vest' ? 1 : 2;
      if (state.loadout.armour >= level || state.money < ARMOUR[id].price) return false;
      state.money -= ARMOUR[id].price;
      state.loadout.armour = level;
      return true;
    }
    return false;
  }

  function endRound(winner) {
    state.winner = winner;
    if (winner === 'warden') {
      state.score.warden += 1;
      state.money += 2400;
    } else {
      state.score.jackal += 1;
      state.money += 1400;
    }
    state.phase = 'end';
    state.timer = END_TIME;
    if (state.score.warden >= ROUNDS_TO_WIN) state.matchWinner = 'warden';
    if (state.score.jackal >= ROUNDS_TO_WIN) state.matchWinner = 'jackal';
  }

  function nextRound(sitePicker) {
    state.round += 1;
    state.site = sitePicker();
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.winner = null;
    state.plantedAt = null;
  }

  function restartMatch(sitePicker) {
    state.round = 1;
    state.score.warden = 0;
    state.score.jackal = 0;
    state.money = START_MONEY;
    state.kills = 0;
    state.deaths = 0;
    state.matchWinner = null;
    resetLoadoutAfterDeath();
    state.site = sitePicker();
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.winner = null;
    state.plantedAt = null;
  }

  return { state, buy, endRound, nextRound, restartMatch, resetLoadoutAfterDeath };
}
