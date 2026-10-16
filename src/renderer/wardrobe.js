// Gany's wardrobe — skins and accessories, as data. Pure logic (no DOM, no
// timers): tested in tests/gany-wardrobe.test.js, used by the island and the
// settings window (`import './wardrobe.js'` then globalThis.AmbrosiaWardrobe),
// and by the gany module (require) for its settings.
//
// A look is a value per slot (head, glasses, wings, palette, shape, face, extra,
// companion).
// A skin is a ready-made set of slot values. The user's choice is stored in the
// settings, section `gany`, key `look`: { skin: null | id, slots: { slot: value } }.
//   * skin null = « selon la saison »: the season's skin (Halloween in October),
//     the classic Ganymède otherwise;
//   * slots = what the user changed by hand, on top of the skin.
// An explicit choice (a skin, or one slot) always wins over the season. Resetting
// (look = { skin: null, slots: {} }) goes back to the seasonal default.
//
// Sounds follow the same idea (`gany.soundTheme`): 'auto' takes the sound theme
// of the skin in place (the Halloween skin plays the Halloween theme), else a
// theme by name (src/renderer/sound.js → THEMES).

(function (root) {
  // [id, label]: the first one is the classic Ganymède.
  const SLOTS = [
    {
      id: 'head',
      label: 'Sur la tête',
      options: [['laurel', 'Couronne de laurier'], ['horns', 'Deux cornes'], ['witch', 'Chapeau de sorcière'], ['beanie', 'Bonnet'], ['flowers', 'Couronne de fleurs'], ['none', 'Rien']],
    },
    {
      id: 'glasses',
      label: 'Lunettes',
      options: [['none', 'Aucune'], ['round', 'Rondes'], ['square', 'Carrées'], ['sun', 'Solaires'], ['heart', 'En cœur'], ['monocle', 'Monocle']],
    },
    {
      id: 'wings',
      label: 'Ailes',
      options: [['feathers', 'Plumes'], ['bat', 'Chauve-souris'], ['butterfly', 'Papillon'], ['none', 'Aucune']],
    },
    {
      id: 'palette',
      label: 'Couleurs',
      options: [['marble', 'Marbre'], ['mauve', 'Mauve'], ['mint', 'Menthe'], ['sky', 'Ciel'], ['rose', 'Rose'], ['gold', 'Or'], ['night', 'Nuit']],
    },
    {
      id: 'shape',
      label: 'Forme',
      options: [['soft', 'Galet'], ['round', 'Bulle'], ['pear', 'Poire'], ['cube', 'Cube']],
    },
    {
      id: 'face',
      label: 'Visage',
      options: [['none', 'Rien de plus'], ['fangs', 'Crocs de vampire'], ['freckles', 'Taches de rousseur'], ['mustache', 'Moustache']],
    },
    {
      id: 'extra',
      label: 'Petit plus',
      options: [['none', 'Rien'], ['cape', 'Cape de vampire'], ['bowtie', 'Nœud papillon'], ['scarf', 'Écharpe']],
    },
    {
      id: 'companion',
      label: 'Compagnon',
      options: [['none', 'Aucun'], ['bats', 'Chauves-souris'], ['pumpkin', 'Citrouille'], ['fireflies', 'Lucioles']],
    },
  ];

  const CLASSIC = Object.fromEntries(SLOTS.map((s) => [s.id, s.options[0][0]]));

  // `sound`: the sound theme the skin brings when soundTheme is 'auto'.
  const SKINS = [
    { id: 'classic', label: 'Ganymède', sound: 'lyre', slots: { ...CLASSIC } },
    {
      id: 'halloween',
      label: 'Halloween',
      sound: 'halloween',
      slots: { head: 'horns', glasses: 'none', wings: 'bat', palette: 'mauve', shape: 'soft', face: 'fangs', extra: 'cape', companion: 'bats' },
    },
    {
      id: 'wizard',
      label: 'Petit sorcier',
      sound: 'lyre',
      slots: { head: 'witch', glasses: 'round', wings: 'feathers', palette: 'night', shape: 'pear', face: 'none', extra: 'scarf', companion: 'fireflies' },
    },
    {
      id: 'winter',
      label: 'Hiver',
      sound: 'lyre',
      slots: { head: 'beanie', glasses: 'none', wings: 'feathers', palette: 'sky', shape: 'round', face: 'freckles', extra: 'scarf', companion: 'none' },
    },
    {
      id: 'scholar',
      label: 'Érudit',
      sound: 'lyre',
      slots: { head: 'laurel', glasses: 'monocle', wings: 'feathers', palette: 'gold', shape: 'cube', face: 'mustache', extra: 'bowtie', companion: 'none' },
    },
    {
      id: 'spring',
      label: 'Printemps',
      sound: 'lyre',
      slots: { head: 'flowers', glasses: 'heart', wings: 'butterfly', palette: 'mint', shape: 'pear', face: 'freckles', extra: 'none', companion: 'none' },
    },
  ];

  const SOUND_THEMES = [['auto', 'Selon le skin (Halloween en octobre)'], ['lyre', 'La lyre de l’Olympe'], ['halloween', 'Halloween (harpe hantée)']];

  // Seasons: [from month, from day] → [to month, to day], inclusive, local date.
  // Halloween takes the whole of October: the user asked for « la période » and
  // for the spooky sounds « pendant le reste du mois »; a single day (Oct 31,
  // already the witch's hat of logic.occasion) would be over before it is seen.
  const SEASONS = [{ id: 'halloween', skin: 'halloween', from: [10, 1], to: [10, 31] }];

  const skinById = (id) => SKINS.find((s) => s.id === id) || null;
  const slotById = (id) => SLOTS.find((s) => s.id === id) || null;
  const validOption = (slot, value) => !!slotById(slot)?.options.some(([v]) => v === value);

  /** The season of a date, or null. */
  function season(date = new Date()) {
    const md = (date.getMonth() + 1) * 100 + date.getDate();
    return SEASONS.find((s) => md >= s.from[0] * 100 + s.from[1] && md <= s.to[0] * 100 + s.to[1]) || null;
  }

  /** The skin used when the user chose none: the season's, else the classic one. */
  function seasonalSkin(date = new Date()) {
    return skinById(season(date)?.skin) || SKINS[0];
  }

  /** A stored look, cleaned: unknown skins and slot values are dropped. */
  function normalize(look) {
    const skin = look && typeof look === 'object' && skinById(look.skin) ? look.skin : null;
    const slots = {};
    const raw = look && typeof look === 'object' && look.slots && typeof look.slots === 'object' ? look.slots : {};
    for (const s of SLOTS) if (validOption(s.id, raw[s.id])) slots[s.id] = raw[s.id];
    return { skin, slots };
  }

  /**
   * What Gany wears now.
   * @returns {{ skin, auto: boolean, season: string|null, slots: {}, overridden: string[], sound: string }}
   *   skin: the base skin id; auto: true when the season chose it; overridden:
   *   the slots the user set by hand (they win over the skin); sound: the
   *   resolved sound theme ('lyre' | 'halloween').
   */
  function resolve(look, { date = new Date(), soundTheme = 'auto' } = {}) {
    const n = normalize(look);
    const base = n.skin ? skinById(n.skin) : seasonalSkin(date);
    const slots = { ...CLASSIC, ...base.slots, ...n.slots };
    const sound = soundTheme !== 'auto' && SOUND_THEMES.some(([v]) => v === soundTheme) ? soundTheme : base.sound || 'lyre';
    return { skin: base.id, auto: !n.skin, season: season(date)?.id || null, slots, overridden: Object.keys(n.slots), sound };
  }

  /** The look after choosing a skin: hand-made changes are dropped (a skin is a whole outfit). */
  function chooseSkin(look, skin) {
    return { skin: skinById(skin) ? skin : null, slots: {} };
  }

  /**
   * The look after changing one slot. Choosing the value the skin already has
   * removes the override (so the slot follows the skin again); `null` too.
   */
  function chooseSlot(look, slot, value, { date = new Date() } = {}) {
    const n = normalize(look);
    const base = n.skin ? skinById(n.skin) : seasonalSkin(date);
    const slots = { ...n.slots };
    if (value == null || !validOption(slot, value) || base.slots[slot] === value) delete slots[slot];
    else slots[slot] = value;
    return { skin: n.skin, slots };
  }

  /** Back to the default: the season decides. */
  function reset() {
    return { skin: null, slots: {} };
  }

  /** Every skin, every slot option, for menus. */
  function catalog() {
    return { slots: SLOTS, skins: SKINS, soundThemes: SOUND_THEMES, seasons: SEASONS };
  }

  const api = { SLOTS, SKINS, CLASSIC, SEASONS, SOUND_THEMES, season, seasonalSkin, normalize, resolve, chooseSkin, chooseSlot, reset, catalog, skinById };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AmbrosiaWardrobe = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
