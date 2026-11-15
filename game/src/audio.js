// Procedural sound: every effect is synthesised with WebAudio, so the game ships no audio
// files and makes no network request. One shared noise buffer, one master gain; each call
// builds a short node chain and lets it be collected when it ends.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function burst({ at = 0, dur = 0.12, freq = 1800, gain = 0.5, type = 'lowpass', sweepTo = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t, Math.random() * 0.4, dur + 0.05);
  }

  function tone({ at = 0, dur = 0.09, freq = 880, gain = 0.18, type = 'square', slideTo = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    ensure,
    // distance 0..1 scales a shot fired across the map down to a crack in the distance.
    shot(distance = 0) {
      const g = 0.55 * (1 - distance * 0.75);
      burst({ dur: 0.14, freq: 2600, gain: g, sweepTo: 300 });
      burst({ dur: 0.05, freq: 5200, gain: g * 0.6, type: 'highpass' });
    },
    shotgun(distance = 0) {
      const g = 0.7 * (1 - distance * 0.7);
      burst({ dur: 0.24, freq: 1500, gain: g, sweepTo: 160 });
    },
    sniper(distance = 0) {
      const g = 0.65 * (1 - distance * 0.7);
      burst({ dur: 0.3, freq: 3200, gain: g, sweepTo: 200 });
      tone({ dur: 0.18, freq: 160, gain: g * 0.5, type: 'sawtooth', slideTo: 55 });
    },
    dry() { tone({ dur: 0.04, freq: 1400, gain: 0.12 }); },
    reload() {
      tone({ dur: 0.05, freq: 700, gain: 0.14 });
      tone({ at: 0.16, dur: 0.05, freq: 480, gain: 0.16 });
      tone({ at: 0.34, dur: 0.06, freq: 950, gain: 0.18 });
    },
    hit(head = false) {
      tone({ dur: 0.05, freq: head ? 1560 : 1050, gain: 0.16, type: 'sine' });
      if (head) tone({ at: 0.05, dur: 0.07, freq: 2100, gain: 0.14, type: 'sine' });
    },
    kill() { tone({ dur: 0.1, freq: 620, gain: 0.2, type: 'triangle', slideTo: 880 }); },
    hurt() { burst({ dur: 0.1, freq: 500, gain: 0.3 }); },
    throwWhoosh() { burst({ dur: 0.18, freq: 900, gain: 0.12, type: 'bandpass', sweepTo: 2400 }); },
    grenadeBoom(distance = 0) {
      const g = 0.9 * (1 - distance * 0.6);
      burst({ dur: 0.7, freq: 900, gain: g, sweepTo: 60 });
      tone({ dur: 0.55, freq: 110, gain: g * 0.7, type: 'sine', slideTo: 36 });
    },
    smokePop() { burst({ dur: 0.3, freq: 1100, gain: 0.2, sweepTo: 500 }); },
    plantBeep(fast = false) { tone({ dur: 0.06, freq: fast ? 1320 : 990, gain: 0.16, type: 'sine' }); },
    planted() { tone({ dur: 0.09, freq: 990, gain: 0.2 }); tone({ at: 0.12, dur: 0.12, freq: 1320, gain: 0.2 }); },
    defused() { tone({ dur: 0.12, freq: 880, gain: 0.2, slideTo: 440 }); },
    buy() { tone({ dur: 0.06, freq: 1240, gain: 0.15 }); tone({ at: 0.07, dur: 0.09, freq: 1660, gain: 0.15 }); },
    denied() { tone({ dur: 0.1, freq: 220, gain: 0.16, type: 'sawtooth' }); },
    roundWin() { [523, 659, 784].forEach((f, i) => tone({ at: i * 0.09, dur: 0.14, freq: f, gain: 0.16, type: 'triangle' })); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone({ at: i * 0.1, dur: 0.16, freq: f, gain: 0.16, type: 'triangle' })); },
    explosion() {
      burst({ dur: 1.4, freq: 1100, gain: 1, sweepTo: 40 });
      tone({ dur: 1.1, freq: 90, gain: 0.8, type: 'sine', slideTo: 28 });
    },
  };
}
