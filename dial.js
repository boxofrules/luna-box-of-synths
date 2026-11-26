// Box Of Synths' dial and section colours, for the panel. A canvas port of the plug-in's
// BoxOfSynthsLookAndFeel::drawRotarySlider (itself the Box of Bass KnobLnf::drawCap) in the MOSS
// theme: a 2 px travel ring, a 2 px value arc (from zero on a two-sided control), and a machined
// cap with a seat shadow, a sheen, a dark rim and a bone pointer. No DOM beyond the canvas it is
// given; logic.js and main.js decide what it shows.

(() => {
  // MOSS, the plug-in's default theme (Source/Theme.h)
  const MOSS = {
    ink: '#17181A',
    card: '#1C1E20',
    rule: '#2C2E30',
    bone: '#F0EEE9',
    label: '#A8AAAD',
    mute: '#8E9094',
    track: '#47494D',
    accent: '#5FD08A',
    accentChat: '#69AFBF',
    amber: '#F2A20C',
    filterOrange: '#F07A2A',
    engineRed: '#E0524A',
    lfoLilac: '#B58CFF',
    glide: '#4FC8B0',
    attack: '#A78BFA',
    decay: '#7F9FB5',
    sustain: '#F2A20C',
    release: '#D48FB0',
  };

  // ---------------------------------------------------------------- colour maths (JUCE's)

  function hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function rgbToHsb([r, g, b]) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [((h * 60 + 360) % 360) / 360, max ? d / max : 0, max / 255];
  }
  function hsbToHex([h, s, v]) {
    const f = (n) => {
      const k = (n + h * 6) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return '#' + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  /** juce::Colour::brighter / darker */
  const brighter = (hex, amount) => {
    const [h, s, v] = rgbToHsb(hexToRgb(hex));
    return hsbToHex([h, s, 1 - (1 - v) / (1 + amount)]);
  };
  const darker = (hex, amount) => {
    const [h, s, v] = rgbToHsb(hexToRgb(hex));
    return hsbToHex([h, s, v / (1 + amount)]);
  };
  /** bos::shade on a dark theme: medium to bright across a family of n. */
  function shade(hex, k, n) {
    const t = n <= 1 ? 0 : Math.max(0, Math.min(1, k / (n - 1)));
    const [h, s, v] = rgbToHsb(hexToRgb(hex));
    return hsbToHex([h, Math.min(1, s * (1 - 0.3 * t)), Math.min(1, v * (0.85 + 0.5 * t))]);
  }
  const alpha = (hex, a) => {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };

  // ---------------------------------------------------------------- section colours

  /** The post chain's modules, in the order the plug-in's effects family is shaded. */
  const EFFECTS = ['CHORUS', 'DELAY', 'IR', 'ANALOGUE', 'BR108', 'OCTAVE', 'FLANGE', 'PHASER', 'FUZZ', 'CRUSH', 'FORMANT', 'COMPRESSOR', 'REVERB', 'OTT', 'FOLD'];
  const ENVELOPE = { GLIDE: MOSS.glide, ATTACK: MOSS.attack, DECAY: MOSS.decay, SUSTAIN: MOSS.sustain, RELEASE: MOSS.release };

  /** The colour a group wears, as the plug-in's wide sections do (EnginePanel::sectionColour). */
  function groupColour(group) {
    const g = String(group).toUpperCase();
    if (g === 'OSC 1') return MOSS.accent;
    if (g === 'OSC 2') return MOSS.accent;
    if (g === 'OSC 3') return MOSS.glide;
    if (g === 'FILTER') return MOSS.filterOrange;
    if (g === 'FILTER ENV') return shade(MOSS.filterOrange, 1, 2);
    if (g === 'FILTER 2') return shade(MOSS.filterOrange, 1, 3);
    if (g.startsWith('LFO ')) return MOSS.lfoLilac;
    if (g === 'SUB') return MOSS.release;
    if (g === 'GRANULAR') return MOSS.sustain;
    if (g === 'PITCH ENV') return MOSS.engineRed;
    if (g === 'AMP ENV') return MOSS.accentChat;
    const fx = EFFECTS.indexOf(g);
    if (fx >= 0) return shade(MOSS.amber, fx % 6, 6);
    return MOSS.accent;
  }

  /** One control's colour: envelope stages wear their own hue; macros are shades of the green. */
  function controlColour(group, label, macroSlot) {
    if (macroSlot) return shade(MOSS.accent, macroSlot - 1, 6);
    const g = String(group).toUpperCase();
    if (g === 'AMP ENV' || g === 'VOICE') {
      const hue = ENVELOPE[String(label).toUpperCase().split(' ')[0]];
      if (hue) return hue;
    }
    return groupColour(group);
  }

  // ---------------------------------------------------------------- the dial

  const A0 = Math.PI * 1.2; // JUCE's default rotary travel, clockwise from twelve o'clock
  const A1 = Math.PI * 2.8;

  /**
   * Paint one dial. `norm` 0..1; `zero` the normalised position the value arc grows from
   * (0, or the middle of a two-sided control); `hover` lights the halo.
   */
  function paint(canvas, { norm, zero = 0, colour = MOSS.accent, hover = false, enabled = true }) {
    const size = canvas.clientWidth || canvas.width;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const inset = Math.min(6, size * 0.13); // bos::pad::dialInset
    const rad = (size - inset * 2) / 2;
    const cx = size / 2, cy = size / 2;
    const toCanvas = (a) => a - Math.PI / 2; // JUCE angles start at twelve o'clock
    const at = (p) => A0 + Math.max(0, Math.min(1, p)) * (A1 - A0);

    if (hover && enabled)
      [0.26, 0.18, 0.1, 0.02].forEach((a, i) => {
        g.beginPath();
        g.arc(cx, cy, rad + i + 1, 0, Math.PI * 2);
        g.strokeStyle = alpha(colour, a);
        g.lineWidth = 1.5;
        g.stroke();
      });

    g.lineCap = 'butt';
    g.beginPath();
    g.arc(cx, cy, rad, toCanvas(A0), toCanvas(A1));
    g.strokeStyle = MOSS.track;
    g.lineWidth = 2;
    g.stroke();

    const aZ = at(zero), aV = at(norm);
    if (Math.abs(aV - aZ) > 1e-3) {
      g.beginPath();
      g.arc(cx, cy, rad, toCanvas(Math.min(aZ, aV)), toCanvas(Math.max(aZ, aV)));
      g.strokeStyle = enabled ? colour : MOSS.mute;
      g.lineWidth = 2;
      g.stroke();
    }

    const capR = Math.max(3, rad - 3.5);
    g.beginPath();
    g.arc(cx, cy + 1.2, capR, 0, Math.PI * 2);
    g.fillStyle = alpha(MOSS.ink, enabled ? 0.4 : 0.2);
    g.fill();
    const body = g.createLinearGradient(cx, cy - capR, cx, cy + capR);
    body.addColorStop(0, brighter(MOSS.card, 0.28));
    body.addColorStop(1, darker(MOSS.card, 0.35));
    g.beginPath();
    g.arc(cx, cy, capR, 0, Math.PI * 2);
    g.fillStyle = body;
    g.fill();
    const sx = cx - capR * 0.35, sy = cy - capR * 0.5;
    const sheen = g.createRadialGradient(sx, sy, 0, sx, sy, Math.hypot(capR * 0.75, capR * 1.2));
    sheen.addColorStop(0, alpha(MOSS.bone, enabled ? 0.1 : 0.05));
    sheen.addColorStop(1, alpha(MOSS.bone, 0));
    g.fillStyle = sheen;
    g.fill();
    g.strokeStyle = alpha(MOSS.ink, enabled ? 0.9 : 0.45);
    g.lineWidth = 1;
    g.stroke();

    const s = Math.sin(aV), c = Math.cos(aV);
    g.beginPath();
    g.moveTo(cx + s * capR * 0.35, cy - c * capR * 0.35);
    g.lineTo(cx + s * (capR - 1.5), cy - c * (capR - 1.5));
    g.strokeStyle = enabled ? MOSS.bone : MOSS.mute;
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.stroke();
  }

  globalThis.SynthsDial = { MOSS, paint, groupColour, controlColour, shade, brighter, darker };
})();
