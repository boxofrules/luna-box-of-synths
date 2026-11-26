// Box Of Synths for LUNA: LUNA logic with no DOM, so the tests run it against Luna.MockEngine.
// Functions take SDK objects and return plain data or perform engine actions.
//
// Box Of Synths 1.1 and later show the host every control (macros and each section) plus a
// read-only "Panel link" parameter for the chat; 1.0 shows Output only. Where a comment says
// LUNA or the SDK does something odd, that was seen in LUNA 3.1.2 with SDK 3.1.1.44.

const SynthsLogic = {
  /** LUNA's ids for the two editions, in order of preference. */
  PLUGIN_IDS: ['com.BxRl.au.aumu_BoSy', 'com.BxRl.au.aumu_BoSF'],
  NAMES: { 'com.BxRl.au.aumu_BoSy': 'Box Of Synths', 'com.BxRl.au.aumu_BoSF': 'Box Of Synths Free' },
  INSTRUMENT_SLOT: 'instrument',

  /** Text for the header: the session's name, or that none is open. */
  sessionLabel(session) {
    if (!session) return 'No session open';
    return session.name.value ?? 'Untitled session';
  },

  /**
   * The editions LUNA offers for an instrument slot, preferred first. Asks LUNA directly rather
   * than `luna.plugins.load()`, which can sit on 20 second timeouts.
   */
  async installedIds(luna) {
    const rows = await luna.plugins.query({ insertType: 'instrument' });
    const offered = new Set(rows.map((r) => r.pluginId));
    return SynthsLogic.PLUGIN_IDS.filter((id) => offered.has(id));
  },

  isOurs(pluginId) {
    return SynthsLogic.PLUGIN_IDS.includes(String(pluginId ?? ''));
  },

  /** The display name for a plug-in id. The slot's own `pluginName` is null on instrument slots. */
  nameFor(pluginId) {
    return SynthsLogic.NAMES[pluginId] ?? 'Box Of Synths';
  },

  /**
   * What the selected track offers, as plain data:
   *   { kind: 'none' }                       no track selected
   *   { kind: 'audio', track }               not an instrument track
   *   { kind: 'empty', track, slot }         an instrument track with nothing (or something else) loaded
   *   { kind: 'failed', track, slot, code }  ours is in the slot and did not load
   *   { kind: 'ready', track, slot, pluginId }
   */
  async trackState(track) {
    if (!track) return { kind: 'none' };
    if (track.trackType.value !== 'instrument') return { kind: 'audio', track };
    await track.effects.load();
    const slot = track.effects.byId(SynthsLogic.INSTRUMENT_SLOT);
    if (!slot) return { kind: 'audio', track };
    const pluginId = slot.pluginId.value;
    if (!SynthsLogic.isOurs(pluginId)) return { kind: 'empty', track, slot, other: slot.isEmpty ? null : pluginId };
    if (slot.pluginError.value || slot.loaded?.value === false) return { kind: 'failed', track, slot, code: slot.pluginError.value ?? 'not_loaded', pluginId };
    return { kind: 'ready', track, slot, pluginId };
  },

  /**
   * Load `pluginId` into the instrument slot and resolve to the slot once it has loaded.
   * Works round two SDK faults: a slot holding a failed load refuses the next plug-in until
   * it is cleared, and `setPlugin` can resolve on a failed load.
   */
  async putOnTrack(track, pluginId) {
    await track.effects.load();
    const slot = track.effects.byId(SynthsLogic.INSTRUMENT_SLOT);
    if (!slot) throw Object.assign(new Error(SynthsLogic.loadErrorText({ code: 'not_instrument' })), { code: 'not_instrument' });
    if (slot.pluginError.value) await slot.clear().catch(() => {});
    try {
      await slot.setPlugin(pluginId);
    } catch (e) {
      await slot.clear().catch(() => {});
      throw Object.assign(new Error(SynthsLogic.loadErrorText(e, pluginId)), { code: e.code, cause: e });
    }
    if (slot.pluginError.value) {
      const code = slot.pluginError.value;
      await slot.clear().catch(() => {});
      throw Object.assign(new Error(SynthsLogic.loadErrorText({ code }, pluginId)), { code });
    }
    await slot.controls.load();
    return slot;
  },

  /** Make a new instrument track called `name` with `pluginId` on it, as one undo step. */
  async newSynthTrack(session, pluginId, name = SynthsLogic.nameFor(pluginId)) {
    let track;
    await session.transaction(`New ${name} track`, async () => {
      [track] = await session.newTrack({ name, trackType: 'instrument', stemFormat: 'stereo' });
    });
    const slot = await SynthsLogic.putOnTrack(track, pluginId);
    return { track, slot };
  },

  /**
   * Every instrument track in the session with Box Of Synths on it, in track order:
   * [{ track, pluginId }]. Loads each instrument track's slots, so call it sparingly.
   */
  async synthTracks(session) {
    const found = [];
    for (const track of session.visibleTracks) {
      if (track.trackType.value !== 'instrument') continue;
      await track.effects.load();
      const pluginId = track.effects.byId(SynthsLogic.INSTRUMENT_SLOT)?.pluginId.value;
      if (SynthsLogic.isOurs(pluginId)) found.push({ track, pluginId });
    }
    return found;
  },

  /** A track's colour (ARGB packed, as LUNA stores it) as CSS, or undefined. */
  colourCss(argb) {
    if (typeof argb !== 'number' || !Number.isFinite(argb)) return undefined;
    const v = argb >>> 0;
    return `rgb(${(v >>> 16) & 255}, ${(v >>> 8) & 255}, ${v & 255})`;
  },

  /** What to tell the user when LUNA refuses to load the plug-in. */
  loadErrorText(e, pluginId) {
    const name = SynthsLogic.nameFor(pluginId);
    switch (e?.code) {
      case 'mixer.audio_unit_error':
        return `LUNA could not open ${name}. Reinstall it from boxofsynths.com, rescan plug-ins in LUNA, then try again.`;
      case 'mixer.missing_plug-in':
        return `LUNA cannot find ${name}. Install it, rescan plug-ins in LUNA, then try again.`;
      case 'not_instrument':
        return 'This is not an instrument track. Make a new Box Of Synths track instead.';
      default:
        return `LUNA could not load ${name}: ${e?.code ?? e?.message ?? 'unknown error'}.`;
    }
  },

  // ---------------------------------------------------------------- sounds (presets)

  /**
   * The sounds LUNA lists for `pluginId`, one row per name and folder. LUNA lists every
   * .vstpreset beside an .aupreset as a second, identical row, and only one of the
   * two loads; nothing in the row says which. So a row keeps every uid, first seen first, and
   * `loadSound` tries them in turn.
   * Each row: { uid, uids, name, category, favourite, factory, path }. Category is the folder's name.
   */
  async sounds(luna, pluginId) {
    const rows = await luna.presets.query({ pluginId });
    const seen = new Map();
    for (const r of rows) {
      if (SynthsLogic.isPlaceholder(r)) continue;
      const key = `${r.path ?? ''}\u0000${r.name}`;
      if (seen.has(key)) {
        seen.get(key).uids.push(r.uid);
        continue;
      }
      seen.set(key, {
        uid: r.uid,
        uids: [r.uid],
        name: r.name,
        category: SynthsLogic.categoryOf(r.path),
        favourite: Boolean(r.favorite),
        factory: Boolean(r.factory),
        path: r.path ?? '',
      });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' }));
  },

  /**
   * LUNA lists the AU's one unnamed factory program as "0 Untitled" once the plug-in has been
   * opened. It is not a sound, so the list leaves it out.
   */
  isPlaceholder(row) {
    return Boolean(row.factory) && /^\d+ Untitled$/.test(row.name ?? '');
  },

  /** The last folder of a preset's path, or "Sounds" when there is none. */
  categoryOf(path) {
    const parts = String(path ?? '').split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : 'Sounds';
  },

  /** Categories in name order with their counts. */
  categories(sounds) {
    const counts = new Map();
    for (const s of sounds) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  },

  /** Filter by words (every word must appear in the name or category) and by category. */
  filter(sounds, { search = '', category = '' } = {}) {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return sounds.filter((s) => {
      if (category && s.category !== category) return false;
      const hay = `${s.name} ${s.category}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  },

  /**
   * Load a sound onto the instrument in `slot`. LUNA refuses the .vstpreset twin of a sound
   * with `uasrv.invalid_object`, so on that refusal the next uid is tried. Resolves to the uid
   * that loaded.
   */
  async loadSound(slot, sound) {
    const uids = sound.uids?.length ? sound.uids : [sound.uid];
    let last;
    for (const uid of uids) {
      try {
        await slot.loadPreset(uid);
        return uid;
      } catch (e) {
        last = e;
        if (e?.code !== 'uasrv.invalid_object') break;
      }
    }
    throw Object.assign(new Error(`LUNA could not load ${sound.name}: ${last?.code ?? last?.message ?? 'unknown error'}.`), { code: last?.code, cause: last });
  },

  // ---------------------------------------------------------------- the synth's controls (Box Of Synths 1.1.0)

  /** Words kept in capitals when a label is put in sentence case. */
  ACRONYMS: new Set(['OSC', 'LFO', 'IR', 'OTT', 'FM', 'BR108', 'PW', 'EQ', 'HP', 'LP', 'BP', 'MS', 'DB', 'HZ']),

  /** "AMP ENV" -> "Amp env", "OSC 1" -> "OSC 1", "FM INDEX" -> "FM index". */
  sentence(text) {
    const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
    return words
      .map((w, i) => {
        const up = w.toUpperCase();
        if (SynthsLogic.ACRONYMS.has(up) || /\d/.test(w)) return up;
        const low = w.toLowerCase();
        return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low;
      })
      .join(' ');
  },

  /**
   * A control's default as a normalised position, the plug-in's own way (its registry's range and
   * skew). LUNA's resetToDefault does nothing for an AU parameter, so the panel
   * resets with this instead. Undefined when the layout does not know the control.
   */
  defaultOf(m) {
    if (!m || !(m.max > m.min) || typeof m.default !== 'number') return undefined;
    const t = Math.max(0, Math.min(1, (m.default - m.min) / (m.max - m.min)));
    return m.skew && m.kind === 'float' ? Math.pow(t, m.skew) : t;
  },

  /** Where a dial's value arc grows from: the middle of a two-sided range (-1..1), else the start. */
  zeroOf(m) {
    if (!m || !(m.min < 0 && m.max > 0)) return 0;
    return (0 - m.min) / (m.max - m.min);
  },

  /**
   * A macro slot's own name, from its value text: the plug-in writes "BRIGHT 0.42" (the host keeps
   * the parameter name "Macro 1" forever). Undefined for an empty slot.
   */
  macroName(display) {
    const text = String(display ?? '').trim();
    if (!text || text === 'Empty') return undefined;
    return text.replace(/\s+-?\d+(\.\d+)?$/, '') || text;
  },

  /**
   * The synth's controls on `slot`, for the panel:
   *   { macros: [{ control, slot }], groups: [{ name, title, controls: [{ control, label, discrete, steps, bool }] }], output }
   * Ordered and grouped the way the synth lays them out (`layout`, from layout.js); anything the
   * layout does not know goes at the end of its group, or in a group of its own. A plug-in before
   * 1.1.0 has no macro slots and no groups.
   */
  synthControls(slot, layout = globalThis.SynthsLayout) {
    const order = new Map((layout?.params ?? []).map((p, i) => [p.name, i]));
    const meta = new Map((layout?.params ?? []).map((p) => [p.name, p]));
    const groupOrder = new Map((layout?.groups ?? []).map((g, i) => [g, i]));
    const macros = [];
    const groups = new Map();
    let output;
    let link;
    for (const control of slot.params) {
      const name = String(control.name.value ?? '');
      const macro = /^Macro (\d+)$/.exec(name);
      if (macro) {
        macros.push({ control, slot: Number(macro[1]) });
        continue;
      }
      const cut = name.indexOf(': ');
      if (cut < 0) {
        if (/^output$/i.test(name)) output = control;
        if (/^panel link$/i.test(name)) link = control;
        continue;
      }
      const group = name.slice(0, cut);
      const steps = Number(control.numSteps?.value ?? 0);
      const discrete = control.discrete?.value === true || (steps > 0 && steps <= 64);
      if (!groups.has(group)) groups.set(group, []);
      const m = meta.get(name);
      const kind = m?.kind ?? (discrete ? (steps === 2 ? 'bool' : 'int') : 'float');
      groups.get(group).push({
        control,
        name,
        group,
        label: SynthsLogic.sentence(name.slice(cut + 2)),
        kind,
        discrete: kind !== 'float',
        steps: kind === 'float' ? 0 : Number.isFinite(m?.max - m?.min) ? Math.round(m.max - m.min) + 1 : steps,
        bool: kind === 'bool',
        choices: m?.choices,
        zero: SynthsLogic.zeroOf(m),
        home: SynthsLogic.defaultOf(m),
      });
    }
    macros.sort((a, b) => a.slot - b.slot);
    const rank = (name) => (order.has(name) ? order.get(name) : Number.MAX_SAFE_INTEGER);
    const groupRank = (g) => (groupOrder.has(g) ? groupOrder.get(g) : Number.MAX_SAFE_INTEGER);
    const list = [...groups]
      .map(([name, controls]) => ({ name, title: SynthsLogic.sentence(name), controls: controls.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)) }))
      .sort((a, b) => groupRank(a.name) - groupRank(b.name) || a.name.localeCompare(b.name));
    return { macros, groups: list, output, link };
  },

  /**
   * Make LUNA read the macros' value text again. LUNA takes a value the plug-in changes but keeps
   * its old text, so after a new sound the macros would wear the last sound's names.
   * Writing each value back unchanged makes LUNA ask the plug-in, and costs no undo step (checked:
   * the session's undo_uid does not move).
   */
  async refreshTexts(controls) {
    for (const control of controls) {
      const v = control.normalized.value;
      if (typeof v === 'number') await control.normalized.set(v);
    }
  },

  /**
   * The plug-in's panel link from its "Panel link" parameter's text, "bos-link 1 <port> <secret>"
   * (Box Of Synths 1.1.0): { base, secret }, or undefined when there is none or it is off.
   */
  parseLink(text) {
    const m = /^bos-link 1 (\d{2,5}) ([0-9a-f]{40})$/.exec(String(text ?? '').trim());
    return m ? { base: `http://127.0.0.1:${m[1]}`, secret: m[2] } : undefined;
  },

  /** Ask the plug-in's panel link. Resolves to { status, body }. */
  async ask(link, method, path, body) {
    const r = await fetch(link.base + path, {
      method,
      headers: { 'X-Panel-Token': link.secret, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    let json = {};
    try {
      json = await r.json();
    } catch {
      // an empty answer
    }
    return { status: r.status, body: json };
  },

  // ---------------------------------------------------------------- the one host parameter

  /** The Output control, or undefined. Box Of Synths names it "Output" (-24 to +12 dB). */
  outputControl(slot) {
    return slot.params.find((c) => /^output$/i.test(c.name.value ?? '')) ?? slot.params[0];
  },

  /** Write Output as normalised 0..1, one undo step. */
  async setNormalised(control, value) {
    const v = Math.min(1, Math.max(0, Number(value)));
    if (!Number.isFinite(v)) throw new Error('A value from 0 to 1.');
    await control.normalized.set(v);
  },
};

globalThis.SynthsLogic = SynthsLogic;
