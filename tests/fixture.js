// A mock LUNA shaped like the one measured on 25 Nov 2026: both editions of Box Of
// Synths in the catalogue, two audio tracks, and sounds listed twice, as LUNA lists an
// .aupreset and its .vstpreset twin. The mock's presets carry no folder path, so the tests
// of grouping use plain rows instead.
//
// Used by the tests, and by `npx ua-builder probe <url> --mock tests/fixture.js`, which runs
// this file as a classic script in the page and calls globalThis.LunaMockSetup(engine).

(() => {
  const FULL = 'com.BxRl.au.aumu_BoSy';
  const FREE = 'com.BxRl.au.aumu_BoSF';
  const FOLDER = '/Users/someone/Library/Audio/Presets/Box of Rules/Box Of Synths/Pending by category';

  function setup(engine, { editions = [FULL, FREE], presets = true } = {}) {
    engine.addSession('abc', { name: 'Demo', tracks: ['Keys', 'Vocal'] });
    for (const id of editions) engine.addPlugin(id, { name: id === FULL ? 'Box Of Synths' : 'Box Of Synths Free', manufacturer: 'Box of Rules', effectType: 'instrument' });
    if (presets && editions.includes(FULL)) {
      for (const name of ['Abyss Sonar', 'Accelerant', 'Glass Choir']) {
        engine.addPreset(FULL, name, { uid: `${name}-au` });
        engine.addPreset(FULL, name, { uid: `${name}-vst` }); // the .vstpreset twin
      }
    }
  }

  /**
   * Give an instrument track the `instrument` slot real LUNA has. The SDK's MockEngine leaves
   * it out, so without this no instrument can be loaded in a test.
   */
  function addInstrumentSlot(engine, sessionUid, trackId) {
    const track = `/sessions/${sessionUid}/tracks/${trackId}`;
    const path = `${track}/effects/instrument`;
    if (engine.has(path)) return path;
    // The same shape the MockEngine gives its own slots.
    engine.addNode(path, {
      properties: { uid: `${track}_instrument`, insert_type: 'instrument', plugin_id: null, plugin_name: null, external_sdk_instance_id: null, bypass_control: null, bypass_control_active_low: null, enabled: true, plugin_power: true, preset_name: null, preset_uid: null, preset_uid_dirty: false, frozen: false, sidechain_allowed: false, sidechain_in_use: false, plugin_error: null, plugin_license_error: null },
      readOnly: ['uid', 'insert_type', 'plugin_id', 'plugin_name'],
    });
    engine.addNode(`${path}/controls`);
    engine.addNode(`${path}/commands`, { commands: { preset_browser_increment: () => null, preset_browser_decrement: () => null, preset_browser_toggle: () => null } });
    return path;
  }

  /** Make `session.newTrack` add that slot to every instrument track it makes. */
  function patchNewTrack(engine, session) {
    const make = session.newTrack.bind(session);
    session.newTrack = async (options) => {
      const tracks = await make(options);
      if (options?.trackType === 'instrument') {
        for (const t of tracks) addInstrumentSlot(engine, session.uid ?? 'abc', t.id);
        await engine.settled();
      }
      return tracks;
    };
  }

  globalThis.SynthsFixture = { FULL, FREE, FOLDER, setup, addInstrumentSlot, patchNewTrack };
  globalThis.LunaMockSetup = (engine) => setup(engine);
})();
