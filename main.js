// Box Of Synths for LUNA: DOM wiring. One panel per session: it follows the track selected in
// LUNA, or stays on one track while pinned.

const $ = (id) => document.getElementById(id);
const L = globalThis.SynthsLogic;
let luna;
let session;
let pluginIds = []; // editions LUNA offers, preferred first
let sounds = [];
let current = { kind: 'none' };
let releases = [];
let trackReleases = [];
let renderQueued = false;
let busy = false;
let pinnedId = ''; // the track the panel stays on while pinned; empty = follow LUNA's selection
let synthBindings = []; // disposers for the synth section's controls (bindRange and listeners)
let synthToken = 0;

const keep = (u) => releases.push(u);
const releaseAll = (list) => {
  for (const u of list.splice(0)) {
    try {
      u();
    } catch {
      // a listener on a disposed node
    }
  }
};

function say(el, text, isError = false) {
  el.textContent = text ?? '';
  el.hidden = !text;
  el.classList.toggle('error', Boolean(isError));
}

// ---------------------------------------------------------------- the track

function scheduleTrack() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    void renderTrack();
  });
}

async function renderTrack() {
  releaseAll(trackReleases);
  current = { kind: 'none' };
  const pinned = pinnedId ? session?.visibleTracks.find((t) => t.id === pinnedId) : undefined;
  if (pinnedId && !pinned) pinnedId = ''; // the pinned track was deleted
  const track = pinned ?? session?.focusedTrack.value;
  paintScope(track);
  void paintTrackMenu(track);
  for (const id of ['put', 'new-track', 'editor']) $(id).hidden = true;
  $('output-row').hidden = true;
  void renderSynth(undefined);
  if (!session) {
    say($('track-message'), 'Open a session in LUNA.');
    return;
  }
  if (!pluginIds.length) {
    say($('track-message'), 'LUNA does not list Box Of Synths. Install it from boxofsynths.com and rescan plug-ins in LUNA.', true);
    return;
  }
  try {
    current = await L.trackState(track);
  } catch {
    current = { kind: 'none' }; // the track went while LUNA answered; the next change redraws
    return;
  }
  if (track) trackReleases.push(track.name.onChange(scheduleTrack));
  if (current.slot) {
    trackReleases.push(current.slot.pluginId.onChange(scheduleTrack));
    trackReleases.push(current.slot.pluginError.onChange(scheduleTrack));
  }
  $('new-track').hidden = false;
  switch (current.kind) {
    case 'none':
      say($('track-message'), 'Select an instrument track, or make a new one.');
      break;
    case 'audio':
      say($('track-message'), 'This is not an instrument track.');
      break;
    case 'empty':
      say($('track-message'), current.other ? 'This track has another instrument on it.' : 'No instrument on this track yet.');
      $('put').hidden = false;
      $('put').textContent = current.other ? `Replace it with ${L.nameFor(pluginIds[0])}` : `Put ${L.nameFor(pluginIds[0])} on this track`;
      break;
    case 'failed':
      say($('track-message'), L.loadErrorText({ code: current.code }, current.pluginId), true);
      $('put').hidden = false;
      $('put').textContent = 'Try again';
      break;
    case 'ready':
      say($('track-message'), '');
      $('new-track').hidden = true;
      paintEditor();
      paintOutput();
      void renderSynth(current.slot);
      if (current.slot.presetUid) trackReleases.push(current.slot.presetUid.onChange(renderSounds));
      break;
  }
  renderSounds(); // the lit sound follows the track
}

/** The panel's title: which track it is on, in that track's colour, and whether it follows LUNA. */
function paintScope(track) {
  $('track-name').textContent = track ? (track.name.value ?? 'Untitled track') : 'No track selected';
  $('track-colour').style.background = L.colourCss(track?.color?.value) ?? '';
  const scope = $('track-scope');
  scope.textContent = pinnedId ? 'Pinned: stays here while you select other tracks' : 'Follows the track you select in LUNA';
  scope.classList.toggle('pinned', Boolean(pinnedId));
  const pin = $('pin');
  pin.hidden = !track;
  pin.textContent = pinnedId ? 'Unpin' : 'Pin';
  pin.setAttribute('aria-pressed', String(Boolean(pinnedId)));
  if (track) trackReleases.push(track.color.onChange(() => paintScope(track)));
}

let menuToken = 0;
/** Every Box Of Synths track in the session, to jump between them. Hidden when there is none. */
async function paintTrackMenu(track) {
  const token = ++menuToken;
  const menu = $('track-menu');
  if (!session) {
    menu.hidden = true;
    return;
  }
  const found = await L.synthTracks(session).catch(() => []);
  if (token !== menuToken) return; // a newer paint overtook this one
  const onOurs = found.some((f) => f.track.id === track?.id);
  menuTracks = found;
  menu.textContent = found.length === 1 ? '1 Box Of Synths track in this session' : `${found.length} Box Of Synths tracks in this session`;
  menu.hidden = found.length === 0 || (found.length === 1 && onOurs);
}
let menuTracks = [];

/** Go to a track: when pinned, move the pin; otherwise select it in LUNA, which the panel follows. */
async function goToTrack(id) {
  if (!id || !session) return;
  if (pinnedId) {
    pinnedId = id;
    scheduleTrack();
    return;
  }
  const context = session.context;
  await context?.selectionTracks?.set([id]).catch(() => {});
  await context?.lastSelectedTrack?.set(id).catch(() => {});
}

$('track-menu').onclick = async () => {
  const at = menuTracks.findIndex((f) => f.track.id === (current.track?.id ?? session?.focusedTrack.value?.id));
  const i = await W.menu($('track-menu'), menuTracks.map((f) => f.track.name.value ?? 'Untitled track'), at, D.MOSS.accent);
  if (i !== undefined) void goToTrack(menuTracks[i].track.id);
};
$('pin').onclick = () => {
  pinnedId = pinnedId ? '' : (current.track?.id ?? session?.focusedTrack.value?.id ?? '');
  scheduleTrack();
};

function paintEditor() {
  const { slot } = current;
  const key = $('editor');
  if (!slot || slot.editorOpen?.value === undefined) {
    key.hidden = true;
    return;
  }
  key.hidden = false;
  const open = slot.editorOpen.value === true;
  key.textContent = open ? 'Hide the synth' : 'Show the synth';
  key.setAttribute('aria-pressed', String(open));
  trackReleases.push(slot.editorOpen.onChange(paintEditor));
}

function paintOutput() {
  const control = L.outputControl(current.slot);
  if (!control) return;
  $('output-row').hidden = false;
  const input = $('output');
  input.min = '0';
  input.max = '1000';
  const paint = () => ($('output-value').textContent = control.display.value ? `${control.display.value} dB` : '');
  paint();
  const binding = Luna.bindRange(input, control, {
    label: 'Output',
    onError: (e) => say($('track-message'), e.message ?? String(e), true),
    render: (n) => input.style.setProperty('--p', `${(n * 100).toFixed(1)}%`),
  });
  input.style.setProperty('--p', `${((control.normalized.value ?? 0) * 100).toFixed(1)}%`);
  trackReleases.push(() => binding.dispose(), control.display.onChange(paint));
}

// ---------------------------------------------------------------- the synth (Box Of Synths 1.1.0)

/** Which sections are open, remembered in this browser only (per viewer, not shared). */
const openState = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`bos-open:${key}`);
      return v === null ? fallback : v === '1';
    } catch {
      return fallback;
    }
  },
  set(key, open) {
    try {
      localStorage.setItem(`bos-open:${key}`, open ? '1' : '0');
    } catch {
      // storage blocked: the panel still works, it just forgets
    }
  },
};

/** ?open=macros,lfo 1 opens exactly those sections, for demos and pictures; normal use remembers. */
const openFromUrl = (() => {
  const v = new URLSearchParams(location.search).get('open');
  return v ? new Set(v.split(',').map((x) => x.trim().toLowerCase())) : undefined;
})();

function disposeSynth() {
  releaseAll(synthBindings);
}

const D = globalThis.SynthsDial;

/**
 * One control as the plug-in draws it: a dial (or the compact choice key, or a switch), the
 * plug-in's own value text in mono and the label under it, in the section's colour. Bound to
 * LUNA so a drag is one undo step; its disposers go on `into`. `nameOf` turns the value text into
 * the label (a macro carries its name there).
 */
function controlCell(c, into, { colour, nameOf } = {}) {
  const { control, label, kind, steps, choices, zero = 0 } = c;
  const cell = document.createElement('div');
  cell.className = `cell ${kind}`;
  cell.style.setProperty('--c', colour);
  const lab = document.createElement('span');
  lab.className = 'lab';
  const val = document.createElement('span');
  val.className = 'val';
  const paintText = () => {
    const text = control.display.value ?? '';
    const name = nameOf ? nameOf(text) : label;
    lab.textContent = name;
    cell.title = `${name}: ${text}`;
    val.textContent = nameOf ? text.slice(String(L.macroName(text) ?? '').length).trim() : text;
  };
  const fail = (e) => say($('synth-message'), e?.message ?? String(e), true);
  let element;

  if (kind === 'choice' && choices?.length === steps && steps > 1) return choiceCell(c, into, { colour });
  if (kind === 'bool') return checkCell(c, into, { colour });
  {
    element = document.createElement('canvas');
    element.className = 'dial';
    element.tabIndex = 0;
    let norm = control.normalized.value ?? 0;
    let hover = false;
    const draw = () => D.paint(element, { norm, zero, colour, hover });
    element.addEventListener('pointerenter', () => ((hover = true), draw()));
    element.addEventListener('pointerleave', () => ((hover = false), draw()));
    // A stepped dial (octave, unison) moves a notch per ~26 px, as in the plug-in, and is drawn on
    // whole steps; the plug-in rounds what it is given, so LUNA's drag binding does the rest.
    const stepped = kind === 'int' && steps > 1;
    const snap = (n) => (stepped ? Math.round(n * (steps - 1)) / (steps - 1) : n);
    norm = snap(norm);
    const binding = Luna.bindDrag(element, control, {
      axis: 'y',
      pixelsPerUnit: stepped && steps <= 12 ? 26 * (steps - 1) : 200,
      label,
      onError: fail,
      render: (n) => {
        norm = snap(n);
        draw();
      },
    });
    into.push(() => binding.dispose());
    if (typeof c.home === 'number')
      element.addEventListener('dblclick', (e) => {
        e.preventDefault();
        void control.normalized.set(c.home).catch(fail); // LUNA's own reset does nothing here
      });
    requestAnimationFrame(draw); // after layout, so the canvas knows its size
    cell.append(element, val, lab);
  }
  element.setAttribute('aria-label', label);
  paintText();
  into.push(control.display.onChange(paintText));
  return cell;
}

const W = globalThis.SynthsWidgets;
const fail = (e) => say($('synth-message'), e?.message ?? String(e), true);
const indexOf = (control, steps) => Math.max(0, Math.min(steps - 1, Math.round((control.normalized.value ?? 0) * (steps - 1))));
const setIndex = (control, steps, i) => control.normalized.set(i / (steps - 1)).catch(fail);

/**
 * How many leading choices carry a mark on a selector dial: every one of a short list, the
 * glyph-drawn waves of a long one (the rest through the menu), or none (a popup key instead).
 */
function marksFor(choices) {
  if (choices.length <= 6) return choices.length;
  let k = 0;
  while (k < choices.length && W.GLYPHS[String(choices[k]).toUpperCase()]) k++;
  return k >= 2 ? k : 0;
}

/** A choice: the plug-in's selector dial with a mark per choice, or for a long list a popup key. */
function choiceCell(c, into, { colour }) {
  const { control, label, steps, choices } = c;
  const marks = marksFor(choices);
  const cell = document.createElement('div');
  cell.className = 'cell choice';
  cell.style.setProperty('--c', colour);
  const lab = document.createElement('span');
  lab.className = 'lab';
  lab.textContent = label;
  const val = document.createElement('button');
  val.type = 'button';
  val.className = 'val pick';
  val.title = `Choose ${label.toLowerCase()}`;
  const paintText = () => {
    const i = indexOf(control, steps);
    val.textContent = L.sentence(choices[i] ?? control.display.value ?? '');
    cell.title = `${label}: ${choices[i] ?? ''}`;
  };
  const openList = async (anchor) => {
    const i = await W.menu(anchor, choices.map((n) => L.sentence(n)), indexOf(control, steps), colour);
    if (i !== undefined) void setIndex(control, steps, i);
  };
  val.onclick = () => void openList(val);

  if (!marks) {
    // a long list with no glyphs (a vowel, a note value): the plug-in's compact key
    val.className = 'key';
    cell.classList.add('wide');
    cell.append(val, lab);
  } else {
    const canvas = document.createElement('canvas');
    canvas.className = 'selector';
    canvas.tabIndex = 0;
    let hover = false;
    const draw = () => W.paintSelector(canvas, { names: choices, index: indexOf(control, steps), marks, colour, hover });
    canvas.addEventListener('pointerenter', () => ((hover = true), draw()));
    canvas.addEventListener('pointerleave', () => ((hover = false), draw()));
    // drag steps through the choices a notch at a time; a click on a mark picks it
    const binding = Luna.bindDrag(canvas, control, { axis: 'y', pixelsPerUnit: 26 * Math.min(steps - 1, 12), label, onError: fail, render: () => draw() });
    let downAt;
    canvas.addEventListener('pointerdown', (e) => (downAt = [e.offsetX, e.offsetY]));
    canvas.addEventListener('click', (e) => {
      if (!downAt || Math.hypot(e.offsetX - downAt[0], e.offsetY - downAt[1]) > 3) return;
      const m = W.markAt(canvas, choices, marks, e.offsetX, e.offsetY);
      if (m < 0) return;
      if (m >= Math.min(marks, choices.length)) void openList(canvas);
      else void setIndex(control, steps, m);
    });
    into.push(() => binding.dispose(), control.normalized.onChange(draw));
    requestAnimationFrame(draw);
    cell.append(canvas, val, lab);
  }
  paintText();
  into.push(control.normalized.onChange(paintText), control.display.onChange(paintText));
  return cell;
}

/** On/off: the plug-in's check key, the word and a box. */
function checkCell({ control, label }, into, { colour, inline = false }) {
  const key = document.createElement('button');
  key.type = 'button';
  key.className = 'check' + (inline ? ' inline' : '');
  key.style.setProperty('--c', colour);
  key.innerHTML = '<span class="word"></span><span class="box" aria-hidden="true"></span>';
  key.querySelector('.word').textContent = label;
  const sync = () => key.setAttribute('aria-pressed', String((control.normalized.value ?? 0) >= 0.5));
  sync();
  key.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation(); // on a section's title it must not fold the section
    void control.normalized.set((control.normalized.value ?? 0) >= 0.5 ? 0 : 1).catch(fail);
  };
  into.push(control.normalized.onChange(sync));
  if (inline) return key;
  const cell = document.createElement('div');
  cell.className = 'cell bool';
  cell.append(key);
  return cell;
}

/**
 * RATE (or TIME) with its SYNC list: the plug-in's HZ | SYNC toggle under one dial. In HZ the dial
 * is the rate; in SYNC it steps through the note values.
 */
function syncCell(rate, sync, into, { colour }) {
  const cell = document.createElement('div');
  cell.className = 'cell sync';
  cell.style.setProperty('--c', colour);
  const slot = document.createElement('div');
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.innerHTML = '<button type="button" data-k="hz">HZ</button><button type="button" data-k="sync">SYNC</button>';
  let own = [];
  const synced = () => indexOf(sync.control, sync.steps) > 0;
  const build = () => {
    releaseAll(own);
    const on = synced();
    seg.querySelector('[data-k=hz]').setAttribute('aria-pressed', String(!on));
    seg.querySelector('[data-k=sync]').setAttribute('aria-pressed', String(on));
    const inner = on
      ? controlCell({ control: sync.control, label: rate.label, kind: 'int', steps: sync.steps, zero: 0 }, own, { colour })
      : controlCell(rate, own, { colour });
    slot.replaceChildren(...inner.childNodes);
  };
  const eighth = Math.max(1, sync.choices.indexOf('1/8'));
  seg.querySelector('[data-k=hz]').onclick = () => synced() && void setIndex(sync.control, sync.steps, 0);
  seg.querySelector('[data-k=sync]').onclick = () => !synced() && void setIndex(sync.control, sync.steps, eighth);
  let was = synced();
  into.push(
    sync.control.normalized.onChange(() => {
      if (synced() !== was) {
        was = synced();
        build();
      }
    }),
    () => releaseAll(own),
  );
  build();
  slot.className = 'cell-inner';
  slot.style.setProperty('--c', colour);
  cell.append(slot, seg);
  return cell;
}

/**
 * The envelope, drawn as the plug-in draws it, across the section: a handle on the attack's peak,
 * on the decay corner (decay sideways, sustain up and down) and on the release's end. A drag is
 * one undo step in LUNA for the controls it moves.
 */
function envelopeCell(env, into, { colour }) {
  const wrap = document.createElement('div');
  wrap.className = 'envelope';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Envelope: drag the corners');
  canvas.title = 'Drag the corners';
  wrap.append(canvas);
  const { attack, decay, sustain, release } = env;
  let handles = [];
  let hot = -1;
  const draw = () => {
    handles = W.paintEnvelope(canvas, {
      a: W.readNumber(attack.control.display.value),
      d: W.readNumber(decay.control.display.value),
      s: sustain.control.normalized.value ?? 0,
      r: W.readNumber(release.control.display.value),
      colour,
      hot,
    });
  };
  const controls = [attack, decay, sustain, release].map((x) => x.control);
  const gesture = Luna.bindGesture(canvas, controls, { onError: fail });
  let start;
  const near = (x, y) => handles.findIndex((h) => Math.hypot(h.x - x, h.y - y) < 12);
  canvas.addEventListener('pointerdown', (e) => {
    const i = near(e.offsetX, e.offsetY);
    start = i < 0 ? undefined : { i, x: e.clientX, y: e.clientY, a: attack.control.normalized.value ?? 0, d: decay.control.normalized.value ?? 0, s: sustain.control.normalized.value ?? 0, r: release.control.normalized.value ?? 0 };
  });
  const move = (e) => {
    if (!start || !gesture.active) return;
    const dx = (e.clientX - start.x) / 160, dy = (start.y - e.clientY) / Math.max(40, canvas.clientHeight - 16);
    const clamp = (v) => Math.max(0, Math.min(1, v));
    if (start.i === 0) void attack.control.normalized.set(clamp(start.a + dx)).catch(fail);
    if (start.i === 1) {
      void decay.control.normalized.set(clamp(start.d + dx)).catch(fail);
      void sustain.control.normalized.set(clamp(start.s + dy)).catch(fail);
    }
    if (start.i === 2) void release.control.normalized.set(clamp(start.r + dx)).catch(fail);
  };
  const up = () => (start = undefined);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  canvas.addEventListener('pointermove', (e) => {
    if (start) return;
    const i = near(e.offsetX, e.offsetY);
    canvas.style.cursor = i < 0 ? 'default' : 'grab';
    if (i !== hot) ((hot = i), draw());
  });
  canvas.addEventListener('pointerleave', () => hot >= 0 && ((hot = -1), draw()));
  for (const c of controls) into.push(c.normalized.onChange(draw), c.display.onChange(draw));
  into.push(() => gesture.dispose(), () => window.removeEventListener('pointermove', move), () => window.removeEventListener('pointerup', up));
  requestAnimationFrame(draw);
  new ResizeObserver(draw).observe(canvas);
  return wrap;
}

/** A section's own on/off switch: the bool named after it (FILTER in FILTER, BIT CRUSH in CRUSH). */
function enableOf(g) {
  const G = g.name.toUpperCase();
  return g.controls.find((c) => c.kind === 'bool' && (c.label.toUpperCase() === G || G.includes(c.label.toUpperCase().split(' ').pop()) || c.label.toUpperCase().startsWith(G)));
}

/** A section's on/off as a box on its title (no word: the title is the word). */
function titleSwitch(g, enable) {
  const key = checkCell({ control: enable.control, label: '' }, synthBindings, { colour: D.groupColour(g.name), inline: true });
  key.setAttribute('aria-label', `${g.title} on`);
  key.title = `Switch ${g.title.toLowerCase()} on or off`;
  return key;
}

/** Everything in a section but its on/off switch, laid out the plug-in's way. */
function buildGroup(g, own, enable) {
  const colourOf = (c) => D.controlColour(g.name, c.label);
  const by = (label) => g.controls.find((c) => c.label.toUpperCase() === label);
  const used = new Set(enable ? [enable] : []);
  const out = [];
  const env = { attack: by('ATTACK'), decay: by('DECAY'), sustain: by('SUSTAIN'), release: by('RELEASE') };
  if (env.attack && env.decay && env.sustain && env.release) out.push(envelopeCell(env, own, { colour: D.groupColour(g.name) }));
  const sync = g.controls.find((c) => c.kind === 'choice' && c.label.toUpperCase() === 'SYNC' && String(c.choices?.[0]).toUpperCase() === 'FREE');
  const rate = sync && (by('RATE') ?? by('TIME'));
  for (const c of g.controls) {
    if (used.has(c)) continue;
    if (sync && (c === sync || c === rate)) {
      if (c === rate || (c === sync && !rate)) out.push(rate ? syncCell(rate, sync, own, { colour: colourOf(rate) }) : controlCell(c, own, { colour: colourOf(c) }));
      used.add(c);
      continue;
    }
    out.push(controlCell(c, own, { colour: colourOf(c) }));
  }
  return out;
}

/** A collapsible section; its controls are built and bound only while it is open. */
function section({ key, title, meta, className, colour, defaultOpen, build, header }) {
  const box = document.createElement('details');
  box.className = `group ${className ?? ''}`.trim();
  if (colour) box.style.setProperty('--c', colour);
  const summary = document.createElement('summary');
  summary.innerHTML = '<span class="title"></span><span class="head-extra"></span><span class="meta"></span>';
  summary.querySelector('.title').textContent = title;
  summary.querySelector('.meta').textContent = meta ?? '';
  if (header) summary.querySelector('.head-extra').append(header);
  const body = document.createElement('div');
  body.className = 'dials';
  box.append(summary, body);
  let own = [];
  const fill = () => {
    releaseAll(own);
    body.replaceChildren(...build(own));
  };
  box.addEventListener('toggle', () => {
    openState.set(key, box.open);
    if (box.open) fill();
    else {
      releaseAll(own);
      body.replaceChildren();
    }
  });
  synthBindings.push(() => releaseAll(own));
  box.open = openFromUrl ? openFromUrl.has(title.toLowerCase()) : openState.get(key, defaultOpen);
  if (box.open) fill();
  return box;
}

// ---------------------------------------------------------------- the chat (Box Of Synths 1.1.0's panel link)

const chat = { link: undefined, slot: undefined, mode: 'generate', waiting: false, sentKey: '', sawWork: false, sentTime: 0, openedWindow: false, sig: '' };
const lineKey = (l) => (l ? `${l.i}|${l.who}|${l.text}` : '');

/** Start talking to the plug-in on `slot` through its Panel link parameter; stops with the section. */
function startChat(slot, linkControl) {
  const box = $('chat');
  chat.slot = slot;
  chat.sig = '';
  if (!linkControl) {
    chat.link = undefined;
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const read = () => (chat.link = L.parseLink(linkControl.display.value));
  read();
  // LUNA can hold an old copy of the text: an unchanged write makes it read again
  const refresh = () => void linkControl.normalized.set(linkControl.normalized.value ?? 0).catch(() => {});
  if (!chat.link) refresh();
  let alive = true;
  let timer;
  const poll = async () => {
    if (!alive) return;
    if (chat.link) {
      try {
        const r = await L.ask(chat.link, 'GET', '/chat');
        if (!alive) return;
        if (r.status === 200) {
          say($('chat-message'), '');
          paintChat(r.body);
        } else if (r.status === 403) refresh();
      } catch {
        say($('chat-message'), 'Box Of Synths is not answering. Close and reopen the synth on this track, then try again.', true);
        refresh();
      }
    } else say($('chat-message'), 'Waiting for Box Of Synths on this track.');
    timer = setTimeout(poll, document.hidden ? 4000 : 1100);
  };
  void poll();
  synthBindings.push(linkControl.display.onChange(read), () => {
    alive = false;
    clearTimeout(timer);
  });
}

function paintChat(body) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  const last = lines[lines.length - 1];
  const sig = `${body.total}|${lineKey(last)}|${body.busy}|${chat.waiting}|${(body.takes?.takes ?? []).map((t) => t.name).join('/')}`;
  $('chat-meta').textContent = [body.sound, body.method && L.sentence(String(body.method))].filter(Boolean).join(' · ');
  // the reply to what the panel sent has landed: give the window back if the panel opened it. Generate starts
  // a fresh conversation (line numbers restart), so the test is: the synth was seen at work (designing, or
  // offering takes), and now a new synth line stands last with nothing pending.
  const takesOn = Array.isArray(body.takes?.takes) && body.takes.takes.length > 0;
  if (chat.waiting) {
    if (body.busy || takesOn) chat.sawWork = true;
    // a new synth line, nothing pending, and not a fresh conversation's opening line (Generate's reset)
    const done = !body.busy && !takesOn && last?.who === 'box' && lineKey(last) !== chat.sentKey && (chat.sawWork || last.i > 0);
    if (done || Date.now() - chat.sentTime > 120000) {
      chat.waiting = false;
      if (chat.openedWindow) {
        chat.openedWindow = false;
        void chat.slot?.closeEditor().catch(() => {});
      }
    }
  }
  if (sig === chat.sig) return;
  chat.sig = sig;
  const list = $('chat-lines');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.replaceChildren(
    ...lines.slice(-40).map((l) => {
      const li = document.createElement('li');
      li.className = l.who;
      li.textContent = l.text;
      if (l.how && l.who === 'box') {
        const how = document.createElement('span');
        how.className = 'how';
        how.textContent = L.sentence(String(l.how));
        li.append(how);
      }
      return li;
    }),
  );
  const takes = body.takes?.takes;
  if (Array.isArray(takes) && takes.length) list.append(takesCard(body.takes));
  else if (body.busy || chat.waiting) {
    const li = document.createElement('li');
    li.className = 'note thinking';
    li.textContent = 'Designing…';
    list.append(li);
  }
  if (atBottom || chat.waiting) list.scrollTop = list.scrollHeight;
}

/** The plug-in's "Choose a take": each take in its chooser's colour, Play held to hear it, Use to keep it. */
function takesCard(t) {
  const li = document.createElement('li');
  li.className = 'takes';
  const head = document.createElement('div');
  head.className = 'takes-head';
  head.innerHTML = '<strong>Choose a take</strong><span></span>';
  head.querySelector('span').textContent = t.prompt ? `"${t.prompt}"` : '';
  li.append(head);
  const colours = ['#5FD08A', '#F2A20C', '#69AFBF', '#B58CFF'];
  t.takes.forEach((take, k) => {
    const row = document.createElement('div');
    row.className = 'take';
    row.style.setProperty('--c', colours[k % colours.length]);
    row.innerHTML = '<span class="letter"></span><span class="name"></span><button type="button" class="play">Play</button><button type="button" class="use">Use</button>';
    row.querySelector('.letter').textContent = `Take ${String(take.letter ?? String.fromCharCode(65 + k)).toUpperCase()}`;
    row.querySelector('.name').textContent = take.name;
    const play = row.querySelector('.play');
    const act = (action) => chat.link && void L.ask(chat.link, 'POST', '/take', { k, action }).catch(() => {});
    // Play sounds while it is held, as in the plug-in
    play.addEventListener('pointerdown', (e) => {
      play.setPointerCapture?.(e.pointerId);
      play.classList.add('down');
      act('play');
    });
    const up = () => {
      if (!play.classList.contains('down')) return;
      play.classList.remove('down');
      act('stop');
    };
    play.addEventListener('pointerup', up);
    play.addEventListener('pointercancel', up);
    play.addEventListener('lostpointercapture', up);
    row.querySelector('.use').onclick = () => act('use');
    li.append(row);
  });
  const foot = document.createElement('p');
  foot.className = 'takes-foot';
  foot.textContent = 'Hold Play to hear one, then use the one that fits.';
  li.append(foot);
  return li;
}

function setMode(mode) {
  chat.mode = mode;
  for (const b of document.querySelectorAll('.mode button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  $('chat-field').placeholder = mode === 'edit' ? 'What needs improving' : 'Tell me what to make';
  $('chat').style.setProperty('--mode', mode === 'edit' ? '#4FA3FF' : '#F2A20C');
}

async function sendChat() {
  const field = $('chat-field');
  const text = field.value.trim();
  if (!text || !chat.link || !chat.slot) return;
  const send = $('chat-send');
  send.disabled = true;
  const msg = $('chat-message');
  try {
    const before = (await L.ask(chat.link, 'GET', '/chat')).body;
    const lastBefore = Array.isArray(before.lines) ? before.lines[before.lines.length - 1] : undefined;
    let r = await L.ask(chat.link, 'POST', '/send', { text, mode: chat.mode });
    if (r.status === 409 && r.body.error === 'needs_window') {
      // the design runs in the synth, as typing does: open it, send, and close it after the reply
      say(msg, 'Opening Box Of Synths to design it.');
      await chat.slot.openEditor();
      chat.openedWindow = true;
      for (let i = 0; i < 25 && r.status === 409 && r.body.error === 'needs_window'; i++) {
        await new Promise((res) => setTimeout(res, 300));
        r = await L.ask(chat.link, 'POST', '/send', { text, mode: chat.mode });
      }
    }
    if (r.status === 202) {
      field.value = '';
      chat.waiting = true;
      chat.sawWork = false;
      chat.sentKey = lineKey(lastBefore);
      chat.sentTime = Date.now();
      say(msg, '');
      setMode('edit'); // after a design the next words revise it, as in the plug-in
    } else
      say(
        msg,
        r.body.error === 'busy' ? 'Box Of Synths is still designing the last one.' : r.body.error === 'needs_window' ? 'Box Of Synths did not open. Open it with Show the synth, then send again.' : `Box Of Synths said no: ${r.body.error ?? r.status}.`,
        true,
      );
  } catch {
    say(msg, 'Box Of Synths is not answering.', true);
  } finally {
    send.disabled = false;
  }
}

for (const b of document.querySelectorAll('.mode button')) b.onclick = () => setMode(b.dataset.mode);
$('chat-send').onclick = () => void sendChat();
$('chat-field').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void sendChat();
  }
});
setMode('generate');

async function renderSynth(slot) {
  const token = ++synthToken;
  disposeSynth();
  const panel = $('synth');
  const groups = $('synth-groups');
  if (!slot) {
    panel.hidden = true;
    groups.replaceChildren();
    $('chat').hidden = true;
    return;
  }
  await slot.controls.load().catch(() => {});
  if (token !== synthToken) return; // the track changed while LUNA answered
  const sc = L.synthControls(slot);
  panel.hidden = false;
  startChat(slot, sc.link);
  if (!sc.macros.length && !sc.groups.length) {
    groups.replaceChildren();
    say($('synth-message'), 'This Box Of Synths shows LUNA no controls. Update to Box Of Synths 1.1 or later to see them here.');
    return;
  }
  say($('synth-message'), '');
  const sections = [
    section({
      key: 'macros',
      title: 'Macros',
      meta: 'this sound\'s own controls',
      className: 'macros',
      colour: D.MOSS.accent,
      defaultOpen: true,
      build: (own) => {
        const rows = sc.macros.map((m) => {
          const row = controlCell({ control: m.control, label: `Macro ${m.slot}`, kind: 'float', zero: 0 }, own, {
            colour: D.controlColour('MACROS', '', m.slot),
            nameOf: (text) => L.sentence(L.macroName(text) ?? `Macro ${m.slot}`),
          });
          const hide = () => (row.hidden = !L.macroName(m.control.display.value));
          hide();
          own.push(m.control.display.onChange(hide));
          return row;
        });
        // the names come from the value text, which LUNA only re-reads when asked:
        // ask when the section opens, when the sound changes, and when a macro moves from elsewhere
        const controls = sc.macros.map((m) => m.control);
        let timer;
        let quietUntil = 0;
        const refresh = () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            quietUntil = Date.now() + 600; // our own writes come back as changes; let them pass
            void L.refreshTexts(controls).catch(() => {});
          }, 250);
        };
        own.push(() => clearTimeout(timer));
        for (const c of controls) own.push(c.normalized.onChange(() => (Date.now() > quietUntil ? refresh() : undefined)));
        if (slot.presetUid) own.push(slot.presetUid.onChange(refresh));
        refresh();
        return rows;
      },
    }),
    ...sc.groups.map((g) => {
      const enable = enableOf(g);
      return section({
        key: `group:${g.name}`,
        title: g.title,
        meta: String(g.controls.length - (enable ? 1 : 0)),
        colour: D.groupColour(g.name),
        defaultOpen: false,
        // the section's own on/off sits on its title, as in the plug-in, open or folded
        header: enable ? titleSwitch(g, enable) : undefined,
        build: (own) => buildGroup(g, own, enable),
      });
    }),
  ];
  groups.replaceChildren(...sections);
}

async function run(label, work) {
  if (busy) return;
  busy = true;
  document.body.classList.add('busy');
  $('status').textContent = label;
  try {
    await work();
  } catch (e) {
    say($('track-message'), e.message, true);
  } finally {
    busy = false;
    document.body.classList.remove('busy');
    $('status').textContent = L.sessionLabel(session);
    scheduleTrack();
  }
}

$('put').onclick = () =>
  void run('Loading Box Of Synths', async () => {
    await L.putOnTrack(current.track, pluginIds[0]);
  });

$('new-track').onclick = () =>
  void run('Making a track', async () => {
    const { track } = await L.newSynthTrack(session, pluginIds[0]);
    if (pinnedId) pinnedId = track.id;
    else await goToTrack(track.id);
  });

$('editor').onclick = () => {
  const { slot } = current;
  if (!slot) return;
  (slot.editorOpen.value ? slot.closeEditor() : slot.openEditor()).catch((e) => say($('track-message'), e.message, true));
};

// ---------------------------------------------------------------- sounds

async function loadSounds() {
  if (!pluginIds.length) return;
  say($('sounds-message'), 'Reading the sounds LUNA lists.');
  try {
    sounds = await L.sounds(luna, pluginIds[0]);
  } catch (e) {
    say($('sounds-message'), `LUNA did not list the sounds: ${e.code ?? e.message}.`, true);
    return;
  }
  paintCategory();
  say($('sounds-message'), sounds.length ? '' : 'No saved sounds yet. Sounds you save in Box Of Synths appear here.');
  renderSounds();
}

function renderSounds() {
  const shown = L.filter(sounds, { search: $('search').value, category });
  $('count').textContent = sounds.length ? `${shown.length} of ${sounds.length}` : '';
  const list = $('list');
  list.replaceChildren(
    ...shown.slice(0, 400).map((s) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.tabIndex = 0;
      li.innerHTML = '<span class="name"></span><span class="cat"></span>';
      li.querySelector('.name').textContent = s.name;
      li.querySelector('.cat').textContent = s.category;
      li.classList.toggle('on', s.uids.includes(current.slot?.presetUid?.value));
      li.onclick = () => void pick(s);
      li.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void pick(s);
        }
      };
      return li;
    }),
  );
  if (shown.length > 400) {
    const more = document.createElement('li');
    more.className = 'more';
    more.textContent = `${shown.length - 400} more: search to narrow it down`;
    list.append(more);
  }
}

function pick(sound) {
  return run(`Loading ${sound.name}`, async () => {
    let slot = current.kind === 'ready' ? current.slot : undefined;
    if (!slot && current.kind === 'empty' && !current.other) slot = await L.putOnTrack(current.track, pluginIds[0]);
    if (!slot) {
      let track;
      ({ track, slot } = await L.newSynthTrack(session, pluginIds[0], sound.name));
      if (pinnedId) pinnedId = track.id;
      else await goToTrack(track.id);
    }
    await L.loadSound(slot, sound);
    say($('track-message'), '');
  }).then(renderSounds);
}

{
  const box = $('sounds-box');
  box.open = openState.get('sounds', false);
  box.addEventListener('toggle', () => openState.set('sounds', box.open));
}
$('search').oninput = renderSounds;
let category = '';
function paintCategory() {
  const n = category ? L.categories(sounds).find((c) => c.name === category)?.count ?? 0 : sounds.length;
  $('category').textContent = `${category || 'All categories'} (${n})`;
}
$('category').onclick = async () => {
  const cats = L.categories(sounds);
  const names = [`All categories (${sounds.length})`, ...cats.map((c) => `${c.name} (${c.count})`)];
  const i = await W.menu($('category'), names, category ? cats.findIndex((c) => c.name === category) + 1 : 0, D.MOSS.accent);
  if (i === undefined) return;
  category = i === 0 ? '' : cats[i - 1].name;
  paintCategory();
  renderSounds();
};

// ---------------------------------------------------------------- LUNA

async function bindSession() {
  releaseAll(releases);
  session = luna.sessions.current();
  if (session) {
    try {
      await session.ready();
    } catch {
      // the session closed while LUNA was answering (switching sessions): the next change rebinds
      session = undefined;
      $('status').textContent = L.sessionLabel(undefined);
      scheduleTrack();
      return;
    }
    keep(session.name.onChange(() => ($('status').textContent = L.sessionLabel(session))));
    keep(session.focusedTrack.onChange(() => (pinnedId ? undefined : scheduleTrack())));
    if (session.tracks?.onChange) keep(session.tracks.onChange(scheduleTrack));
  }
  $('status').textContent = L.sessionLabel(session);
  scheduleTrack();
}

async function connect() {
  for (;;) {
    try {
      luna = await Luna.connect();
      break;
    } catch (e) {
      $('status').textContent = e instanceof Luna.NotRunning ? 'Waiting for LUNA' : e.message;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  Luna.bindShortcuts?.(luna);
  try {
    pluginIds = await L.installedIds(luna);
  } catch (e) {
    say($('track-message'), `LUNA did not list its instruments: ${e.code ?? e.message}.`, true);
  }
  await luna.sessions.ready();
  const rebind = () => void bindSession().catch(() => {});
  luna.sessions.focused.onChange(rebind);
  luna.sessions.items.onChange(rebind);
  luna.status.onChange(() => {
    if (luna.status.value === 'disconnected') $('status').textContent = 'Reconnecting to LUNA';
    if (luna.status.value === 'connected') rebind();
  });
  await bindSession();
  await loadSounds();
}

void connect();
