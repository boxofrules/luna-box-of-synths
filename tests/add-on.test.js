// Runs against Luna.MockEngine and plain data: no LUNA needed. `npm test`.
import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';

globalThis.Luna = Luna; // logic.js is a classic script that reads the Luna global
await import('../logic.js');
await import('./fixture.js');
const logic = globalThis.SynthsLogic;
const fixture = globalThis.SynthsFixture;

async function connected(options) {
  const engine = new Luna.MockEngine();
  fixture.setup(engine, options);
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  fixture.patchNewTrack(engine, session);
  const track = (name) => session.visibleTracks.find((t) => t.name.value === name);
  return { engine, luna, session, track };
}

describe('session label', () => {
  it('names the session, or says none is open', async () => {
    const { session } = await connected();
    expect(logic.sessionLabel(session)).toBe('Demo');
    expect(logic.sessionLabel(undefined)).toBe('No session open');
  });
});

describe('which edition', () => {
  it('prefers the full edition and falls back to Free', async () => {
    expect(await logic.installedIds((await connected()).luna)).toEqual([fixture.FULL, fixture.FREE]);
    expect(await logic.installedIds((await connected({ editions: [fixture.FREE] })).luna)).toEqual([fixture.FREE]);
    expect(await logic.installedIds((await connected({ editions: [] })).luna)).toEqual([]);
  });

  it('names the plug-in from its id, since the slot does not', () => {
    expect(logic.nameFor(fixture.FULL)).toBe('Box Of Synths');
    expect(logic.nameFor(fixture.FREE)).toBe('Box Of Synths Free');
  });
});

describe('the track', () => {
  it('says when nothing is selected and when the track is not an instrument track', async () => {
    const { track } = await connected();
    expect((await logic.trackState(undefined)).kind).toBe('none');
    expect((await logic.trackState(track('Vocal'))).kind).toBe('audio');
  });

  it('makes a Box Of Synths track and sees it as ready', async () => {
    const { session } = await connected();
    const { track, slot } = await logic.newSynthTrack(session, fixture.FULL);
    expect(track.trackType.value).toBe('instrument');
    expect(track.name.value).toBe('Box Of Synths');
    expect(slot.pluginId.value).toBe(fixture.FULL);
    const state = await logic.trackState(track);
    expect(state.kind).toBe('ready');
    expect(state.pluginId).toBe(fixture.FULL);
  });

  it('puts it on an empty instrument track', async () => {
    const { session } = await connected();
    const [track] = await session.newTrack({ name: 'Empty', trackType: 'instrument', stemFormat: 'stereo' });
    expect((await logic.trackState(track)).kind).toBe('empty');
    await logic.putOnTrack(track, fixture.FREE);
    expect((await logic.trackState(track)).kind).toBe('ready');
  });

  it('refuses a track with no instrument slot', async () => {
    const { track } = await connected();
    await expect(logic.putOnTrack(track('Vocal'), fixture.FULL)).rejects.toMatchObject({ code: 'not_instrument' });
  });

  it('explains a load LUNA refused', () => {
    expect(logic.loadErrorText({ code: 'mixer.audio_unit_error' }, fixture.FULL)).toMatch(/could not open Box Of Synths\. Reinstall/);
    expect(logic.loadErrorText({ code: 'something' }, fixture.FREE)).toBe('LUNA could not load Box Of Synths Free: something.');
  });
});

describe('which tracks', () => {
  it('lists only instrument tracks that hold Box Of Synths, in track order', async () => {
    const { session } = await connected();
    const { track: a } = await logic.newSynthTrack(session, fixture.FULL, 'Lead');
    const [empty] = await session.newTrack({ name: 'Empty', trackType: 'instrument', stemFormat: 'stereo' });
    const { track: b } = await logic.newSynthTrack(session, fixture.FREE, 'Pad');
    const found = await logic.synthTracks(session);
    expect(found.map((f) => [f.track.name.value, f.pluginId])).toEqual([['Lead', fixture.FULL], ['Pad', fixture.FREE]]);
    expect(found.map((f) => f.track.id)).not.toContain(empty.id);
    expect([a.id, b.id]).toEqual(found.map((f) => f.track.id));
  });

  it('turns LUNA\'s packed ARGB colour into CSS', () => {
    expect(logic.colourCss(0xff5fd08a)).toBe('rgb(95, 208, 138)');
    expect(logic.colourCss(0xff5fd08a | 0)).toBe('rgb(95, 208, 138)'); // the same colour as a signed int
    expect(logic.colourCss(undefined)).toBeUndefined();
  });
});

describe('sounds', () => {
  const folder = '/Users/someone/Library/Audio/Presets/Box of Rules/Box Of Synths/Pending by category';
  // Two rows per sound, as LUNA lists an .aupreset and its .vstpreset twin.
  const rows = [
    { uid: 'a1', name: 'Accelerant', path: `${folder}/Bass`, favorite: false, factory: false },
    { uid: 'a2', name: 'Accelerant', path: `${folder}/Bass`, favorite: false, factory: false },
    { uid: 'b1', name: 'abyss Sonar', path: `${folder}/Future` },
    { uid: 'b2', name: 'abyss Sonar', path: `${folder}/Future` },
    { uid: 'c1', name: 'Accelerant', path: `${folder}/Future` }, // same name, another folder: kept
    { uid: 'd1', name: 'Loose', path: '' },
    { uid: 'z1', name: '0 Untitled', path: 'Box of Rules/Box Of Synths', factory: true }, // the AU's unnamed program
  ];
  const luna = { presets: { query: async () => rows } };

  it('keeps one row per name and folder, the first uid, in name order', async () => {
    const list = await logic.sounds(luna, fixture.FULL);
    expect(list.map((s) => [s.name, s.category, s.uids])).toEqual([
      ['abyss Sonar', 'Future', ['b1', 'b2']],
      ['Accelerant', 'Bass', ['a1', 'a2']],
      ['Accelerant', 'Future', ['c1']],
      ['Loose', 'Sounds', ['d1']],
    ]);
  });

  it('loads the twin uid when LUNA refuses the first, and stops on any other refusal', async () => {
    const fail = (code) => Object.assign(new Error(code), { code });
    const tried = [];
    const slot = (refuse) => ({ loadPreset: async (uid) => { tried.push(uid); if (refuse[uid]) throw fail(refuse[uid]); } });
    expect(await logic.loadSound(slot({ a1: 'uasrv.invalid_object' }), { name: 'A', uids: ['a1', 'a2'] })).toBe('a2');
    expect(tried).toEqual(['a1', 'a2']);
    tried.length = 0;
    await expect(logic.loadSound(slot({ a1: 'unavailable' }), { name: 'A', uids: ['a1', 'a2'] })).rejects.toMatchObject({ code: 'unavailable' });
    expect(tried).toEqual(['a1']);
    await expect(logic.loadSound(slot({ a1: 'uasrv.invalid_object', a2: 'uasrv.invalid_object' }), { name: 'A', uids: ['a1', 'a2'] })).rejects.toThrow('LUNA could not load A: uasrv.invalid_object.');
  });

  it('counts categories and filters by every word and by category', async () => {
    const list = await logic.sounds(luna, fixture.FULL);
    expect(logic.categories(list)).toEqual([
      { name: 'Bass', count: 1 },
      { name: 'Future', count: 2 },
      { name: 'Sounds', count: 1 },
    ]);
    expect(logic.filter(list, { search: 'acc fut' }).map((s) => s.uid)).toEqual(['c1']);
    expect(logic.filter(list, { category: 'Bass' }).map((s) => s.uid)).toEqual(['a1']);
    expect(logic.filter(list, { search: '  ' })).toHaveLength(4);
  });

  it('reads the category from either kind of path separator', () => {
    expect(logic.categoryOf('C:\\Presets\\Box Of Synths\\Pads')).toBe('Pads');
    expect(logic.categoryOf(undefined)).toBe('Sounds');
  });
});

describe('the synth\'s controls (1.1.0)', () => {
  const c = (name, display = '', steps = 0) => ({ name: { value: name }, display: { value: display }, numSteps: { value: steps }, discrete: { value: steps > 0 } });
  const layout = {
    groups: ['OSC 1', 'FILTER', 'AMP ENV'],
    params: [{ name: 'OSC 1: WAVE' }, { name: 'FILTER: CUTOFF' }, { name: 'FILTER: RES' }, { name: 'AMP ENV: ATTACK' }, { name: 'AMP ENV: DECAY' }, { name: 'AMP ENV: SUSTAIN' }, { name: 'AMP ENV: RELEASE' }],
  };

  it('groups and orders what LUNA lists by hashed id the way the synth lays it out', () => {
    const slot = { params: [c('AMP ENV: RELEASE'), c('Macro 2', 'RES 0.10'), c('FILTER: RES'), c('Output'), c('AMP ENV: ATTACK'), c('NEW GROUP: THING'), c('Macro 1', 'BRIGHT 0.42'), c('OSC 1: WAVE', 'Saw', 6), c('AMP ENV: SUSTAIN'), c('FILTER: CUTOFF'), c('AMP ENV: DECAY'), c('VOICE: MONO', 'ON', 2)] };
    const sc = logic.synthControls(slot, layout);
    expect(sc.macros.map((m) => m.slot)).toEqual([1, 2]);
    expect(sc.output.name.value).toBe('Output');
    expect(sc.groups.map((g) => g.title)).toEqual(['OSC 1', 'Filter', 'Amp env', 'New group', 'Voice']);
    expect(sc.groups[2].controls.map((x) => x.label)).toEqual(['Attack', 'Decay', 'Sustain', 'Release']);
    expect(sc.groups[0].controls[0]).toMatchObject({ discrete: true, steps: 6, bool: false });
    expect(sc.groups[4].controls[0]).toMatchObject({ bool: true });
  });

  it('reads a macro\'s name from its value text, and none from an empty slot', () => {
    expect(logic.macroName('BRIGHT 0.42')).toBe('BRIGHT');
    expect(logic.macroName('SUB OCT -1.00')).toBe('SUB OCT');
    expect(logic.macroName('Empty')).toBeUndefined();
    expect(logic.sentence('FM INDEX')).toBe('FM index');
  });

  it('knows each control\'s default position, skew included, for the panel\'s own reset', () => {
    expect(logic.defaultOf({ kind: 'float', min: 5, max: 12000, default: 150, skew: 0.35 })).toBeCloseTo(0.2132, 4);
    expect(logic.defaultOf({ kind: 'int', min: -3, max: 3, default: 0 })).toBe(0.5);
    expect(logic.defaultOf({ kind: 'choice', min: 0, max: 3, default: 1 })).toBeCloseTo(1 / 3);
    expect(logic.defaultOf(undefined)).toBeUndefined();
  });

  it('finds nothing to show on a plug-in before 1.1.0', () => {
    const sc = logic.synthControls({ params: [c('Output', '0.0')] }, layout);
    expect(sc.macros).toEqual([]);
    expect(sc.groups).toEqual([]);
  });
});

describe('the panel link (chat)', () => {
  it('reads the plug-in\'s Panel link text, and nothing else', () => {
    const secret = 'ab'.repeat(20);
    expect(logic.parseLink(`bos-link 1 51234 ${secret}`)).toEqual({ base: 'http://127.0.0.1:51234', secret });
    expect(logic.parseLink('off')).toBeUndefined();
    expect(logic.parseLink(`bos-link 1 51234 ${secret.slice(2)}`)).toBeUndefined(); // too short a secret
    expect(logic.parseLink(`bos-link 2 51234 ${secret}`)).toBeUndefined(); // a future format is not guessed at
    expect(logic.parseLink(`bos-link 1 evil.example ${secret}`)).toBeUndefined(); // never a host other than 127.0.0.1
  });
});

describe('output', () => {
  it('finds Output and clamps what it writes', async () => {
    const writes = [];
    const control = { name: { value: 'Output' }, normalized: { set: async (v) => writes.push(v) } };
    expect(logic.outputControl({ params: [{ name: { value: 'Other' } }, control] })).toBe(control);
    await logic.setNormalised(control, 1.7);
    await logic.setNormalised(control, -1);
    expect(writes).toEqual([1, 0]);
    await expect(logic.setNormalised(control, 'x')).rejects.toThrow();
  });
});
