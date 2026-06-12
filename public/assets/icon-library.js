/**
 * Colony Sim Icon Library — master registry
 * ~90 pixel-style SVG icons across 9 categories.
 * Single source of truth: the showcase card and the Icon component both render from here.
 *
 * Usage:
 *   <script src="assets/icon-library.js"></script>
 *   ColonyIcons.svg('cabin', 24)        // -> svg markup string
 *   ColonyIcons.element('cabin', 24)    // -> SVGElement
 *   ColonyIcons.names                   // -> all icon names
 *   ColonyIcons.byGroup()               // -> { group: [names] }
 */
(function () {
  // palette
  var O = '#26201a';   // outline
  var W = '#9c7544';   // wood
  var WD = '#6b5138';  // wood dark
  var RF = '#4a3a2c';  // roof dark
  var ST = '#787469';  // stone
  var SD = '#5a504a';  // stone dark
  var BL = '#3d586b';  // water / glass
  var GR = '#c2a14d';  // grain / gold
  var AC = '#e8d27a';  // accent gold
  var LF = '#566445';  // leaf dark
  var LL = '#5a7d47';  // leaf light
  var DG = '#e07a5a';  // danger / warm
  var OK = '#8fc26a';  // success
  var IN = '#9ab0c4';  // info
  var TX = '#dfe6ee';  // light text
  var DK = '#241c12';  // near-black interior

  var I = {};
  function d(group, svg) { return { g: group, s: svg }; }

  /* ============ BUILDINGS ============ */
  I.cabin = d('Buildings', '<rect x="4" y="16" width="24" height="12" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><polygon points="4,16 16,4 28,16" fill="' + RF + '" stroke="' + O + '" stroke-width="2"/><rect x="10" y="20" width="4" height="4" fill="' + BL + '" stroke="' + O + '"/><rect x="18" y="20" width="4" height="4" fill="' + BL + '" stroke="' + O + '"/>');
  I.hearth = d('Buildings', '<rect x="7" y="12" width="18" height="16" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><rect x="11" y="16" width="10" height="12" fill="' + DK + '" stroke="' + O + '"/><polygon points="16,17 19,24 13,24" fill="' + DG + '" stroke="' + O + '"/><rect x="15" y="21" width="2" height="3" fill="' + AC + '"/>');
  I.hall = d('Buildings', '<rect x="3" y="14" width="26" height="14" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><polygon points="3,14 16,3 29,14" fill="' + WD + '" stroke="' + O + '" stroke-width="2"/><rect x="7" y="18" width="4" height="6" fill="' + BL + '" stroke="' + O + '"/><rect x="14" y="18" width="4" height="10" fill="' + RF + '" stroke="' + O + '"/><rect x="21" y="18" width="4" height="6" fill="' + BL + '" stroke="' + O + '"/>');
  I.cookhouse = d('Buildings', '<rect x="5" y="14" width="22" height="14" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><polygon points="5,14 16,5 27,14" fill="#8b4a3a" stroke="' + O + '" stroke-width="2"/><rect x="20" y="6" width="4" height="6" fill="' + ST + '" stroke="' + O + '"/><circle cx="22" cy="3" r="1.5" fill="' + IN + '"/><rect x="9" y="18" width="6" height="10" fill="' + RF + '" stroke="' + O + '"/><rect x="18" y="19" width="5" height="4" fill="' + BL + '" stroke="' + O + '"/>');
  I.bakery = d('Buildings', '<rect x="4" y="13" width="24" height="15" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><polygon points="4,13 16,4 28,13" fill="#8b4a3a" stroke="' + O + '" stroke-width="2"/><path d="M8 28 v-5 a4 4 0 0 1 8 0 v5 z" fill="' + DK + '" stroke="' + O + '"/><rect x="10" y="24" width="4" height="3" fill="' + DG + '"/><rect x="19" y="18" width="5" height="4" fill="' + BL + '" stroke="' + O + '"/>');
  I.granary = d('Buildings', '<rect x="6" y="14" width="20" height="14" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><polygon points="6,14 16,4 26,14" fill="' + GR + '" stroke="' + O + '" stroke-width="2"/><line x1="16" y1="14" x2="16" y2="28" stroke="' + O + '"/><rect x="12" y="20" width="8" height="8" fill="' + WD + '" stroke="' + O + '"/>');
  I.lodge = d('Buildings', '<rect x="5" y="15" width="22" height="13" fill="#7a6248" stroke="' + O + '" stroke-width="2"/><polygon points="5,15 16,5 27,15" fill="' + LF + '" stroke="' + O + '" stroke-width="2"/><rect x="13" y="20" width="6" height="8" fill="' + RF + '" stroke="' + O + '"/><path d="M13 18 l-2 -3 m2 3 l1 -3 m4 3 l-1 -3 m1 3 l2 -3" stroke="#d8cdb2" fill="none"/>');
  I.dock = d('Buildings', '<rect x="3" y="20" width="26" height="4" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><line x1="7" y1="24" x2="7" y2="29" stroke="' + WD + '" stroke-width="2"/><line x1="16" y1="24" x2="16" y2="29" stroke="' + WD + '" stroke-width="2"/><line x1="25" y1="24" x2="25" y2="29" stroke="' + WD + '" stroke-width="2"/><path d="M2 28 h4 m4 0 h5 m4 0 h5 m4 0 h4" stroke="' + BL + '" stroke-width="2" fill="none"/><rect x="13" y="12" width="6" height="8" fill="' + WD + '" stroke="' + O + '"/>');
  I.forester = d('Buildings', '<circle cx="16" cy="16" r="13" fill="none" stroke="' + GR + '" stroke-dasharray="3,3"/><polygon points="10,6 15,16 5,16" fill="' + LF + '" stroke="' + O + '" stroke-width="2"/><rect x="9" y="16" width="2" height="4" fill="' + WD + '"/><polygon points="21,10 26,20 16,20" fill="' + LL + '" stroke="' + O + '" stroke-width="2"/><rect x="20" y="20" width="2" height="4" fill="' + WD + '"/>');
  I.mine = d('Buildings', '<path d="M4 28 L10 10 H22 L28 28 Z" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><path d="M12 28 v-7 a4 4 0 0 1 8 0 v7 z" fill="' + DK + '" stroke="' + O + '"/><line x1="12" y1="21" x2="12" y2="28" stroke="' + WD + '" stroke-width="2"/><line x1="20" y1="21" x2="20" y2="28" stroke="' + WD + '" stroke-width="2"/>');
  I.farm = d('Buildings', '<rect x="4" y="8" width="24" height="20" fill="' + WD + '" stroke="' + O + '" stroke-width="2"/><line x1="9" y1="10" x2="9" y2="26" stroke="' + LL + '" stroke-width="2"/><line x1="14" y1="10" x2="14" y2="26" stroke="' + LL + '" stroke-width="2"/><line x1="19" y1="10" x2="19" y2="26" stroke="' + LL + '" stroke-width="2"/><line x1="24" y1="10" x2="24" y2="26" stroke="' + LL + '" stroke-width="2"/>');
  I.tailor = d('Buildings', '<rect x="6" y="6" width="20" height="20" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><line x1="10" y1="9" x2="10" y2="23" stroke="' + WD + '"/><line x1="13" y1="9" x2="13" y2="23" stroke="' + WD + '"/><line x1="16" y1="9" x2="16" y2="23" stroke="' + WD + '"/><line x1="19" y1="9" x2="19" y2="23" stroke="' + WD + '"/><line x1="22" y1="9" x2="22" y2="23" stroke="' + WD + '"/><line x1="8" y1="16" x2="24" y2="16" stroke="' + AC + '" stroke-width="2"/>');
  I.armory = d('Buildings', '<rect x="5" y="12" width="22" height="16" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><polygon points="5,12 16,4 27,12" fill="' + SD + '" stroke="' + O + '" stroke-width="2"/><line x1="16" y1="16" x2="16" y2="25" stroke="' + TX + '" stroke-width="2"/><line x1="13" y1="18" x2="19" y2="18" stroke="' + TX + '" stroke-width="2"/>');
  I.graveyard = d('Buildings', '<rect x="6" y="8" width="6" height="16" rx="3" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><line x1="9" y1="12" x2="9" y2="18" stroke="' + SD + '"/><line x1="7" y1="14" x2="11" y2="14" stroke="' + SD + '"/><rect x="19" y="12" width="6" height="12" rx="3" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><line x1="3" y1="26" x2="29" y2="26" stroke="' + WD + '" stroke-width="2"/>');
  I.market = d('Buildings', '<rect x="6" y="12" width="20" height="14" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><polygon points="4,12 9,5 23,5 28,12" fill="' + DG + '" stroke="' + O + '" stroke-width="2"/><rect x="9" y="16" width="5" height="4" fill="' + GR + '" stroke="' + O + '"/><rect x="18" y="16" width="5" height="4" fill="' + LF + '" stroke="' + O + '"/><rect x="13" y="22" width="6" height="4" fill="' + WD + '" stroke="' + O + '"/>');
  I.clinic = d('Buildings', '<rect x="5" y="11" width="22" height="17" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><polygon points="5,11 16,4 27,11" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><rect x="14" y="15" width="4" height="10" fill="' + DG + '"/><rect x="11" y="18" width="10" height="4" fill="' + DG + '"/>');
  I.well = d('Buildings', '<polygon points="6,9 16,3 26,9" fill="' + RF + '" stroke="' + O + '" stroke-width="2"/><line x1="9" y1="9" x2="9" y2="18" stroke="' + WD + '" stroke-width="2"/><line x1="23" y1="9" x2="23" y2="18" stroke="' + WD + '" stroke-width="2"/><line x1="16" y1="9" x2="16" y2="14" stroke="' + SD + '"/><rect x="13" y="14" width="6" height="4" fill="' + W + '" stroke="' + O + '"/><rect x="8" y="18" width="16" height="9" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><line x1="8" y1="22" x2="24" y2="22" stroke="' + SD + '"/><line x1="13" y1="18" x2="13" y2="22" stroke="' + SD + '"/><line x1="19" y1="22" x2="19" y2="27" stroke="' + SD + '"/>');
  I.wall = d('Buildings', '<rect x="4" y="8" width="24" height="20" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><line x1="4" y1="14" x2="28" y2="14" stroke="' + SD + '"/><line x1="4" y1="21" x2="28" y2="21" stroke="' + SD + '"/><line x1="12" y1="8" x2="12" y2="14" stroke="' + SD + '"/><line x1="20" y1="14" x2="20" y2="21" stroke="' + SD + '"/><line x1="10" y1="21" x2="10" y2="28" stroke="' + SD + '"/><line x1="22" y1="21" x2="22" y2="28" stroke="' + SD + '"/>');
  I.gate = d('Buildings', '<rect x="3" y="8" width="7" height="20" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><rect x="22" y="8" width="7" height="20" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><path d="M10 28 v-11 a6 6 0 0 1 12 0 v11 z" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><line x1="16" y1="12" x2="16" y2="28" stroke="' + WD + '"/>');
  I.watchtower = d('Buildings', '<rect x="11" y="13" width="10" height="15" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><rect x="8" y="8" width="16" height="5" fill="' + WD + '" stroke="' + O + '" stroke-width="2"/><polygon points="8,8 16,2 24,8" fill="' + RF + '" stroke="' + O + '" stroke-width="2"/><rect x="14" y="17" width="4" height="4" fill="' + DK + '" stroke="' + O + '"/>');
  I.storehouse = d('Buildings', '<rect x="3" y="12" width="26" height="16" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><polygon points="3,12 16,5 29,12" fill="' + WD + '" stroke="' + O + '" stroke-width="2"/><rect x="6" y="16" width="8" height="12" fill="' + RF + '" stroke="' + O + '"/><rect x="17" y="17" width="5" height="5" fill="' + GR + '" stroke="' + O + '"/><rect x="21" y="22" width="5" height="6" fill="' + GR + '" stroke="' + O + '"/>');

  /* ============ RESOURCES ============ */
  I.grain = d('Resources', '<path d="M12 6 L10 26 M16 5 L16 26 M20 6 L22 26" stroke="' + GR + '" stroke-width="2" fill="none"/><rect x="10" y="16" width="12" height="3" fill="' + WD + '" stroke="' + O + '"/><path d="M12 6 l-2 -3 m6 2 l0 -3 m6 4 l2 -3" stroke="' + AC + '" stroke-width="2"/>');
  I.wood = d('Resources', '<circle cx="11" cy="21" r="5" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><circle cx="11" cy="21" r="2" fill="none" stroke="' + WD + '"/><circle cx="21" cy="21" r="5" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><circle cx="21" cy="21" r="2" fill="none" stroke="' + WD + '"/><circle cx="16" cy="13" r="5" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><circle cx="16" cy="13" r="2" fill="none" stroke="' + WD + '"/>');
  I.stone = d('Resources', '<polygon points="14,6 22,9 20,17 10,15" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><polygon points="20,16 27,18 24,25 17,23" fill="' + SD + '" stroke="' + O + '" stroke-width="2"/><polygon points="6,17 13,18 12,26 5,24" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/>');
  I.meat = d('Resources', '<ellipse cx="13" cy="13" rx="8" ry="7" fill="#a85540" stroke="' + O + '" stroke-width="2"/><ellipse cx="11" cy="12" rx="4" ry="3" fill="#c1694f"/><line x1="19" y1="18" x2="25" y2="24" stroke="#e8e0cc" stroke-width="3"/><circle cx="26" cy="26" r="2.5" fill="#e8e0cc" stroke="' + O + '"/>');
  I.fish = d('Resources', '<ellipse cx="14" cy="16" rx="9" ry="5" fill="' + BL + '" stroke="' + O + '" stroke-width="2"/><polygon points="22,16 28,11 28,21" fill="' + BL + '" stroke="' + O + '" stroke-width="2"/><circle cx="9" cy="15" r="1" fill="' + O + '"/><path d="M13 12 a4 4 0 0 1 0 8" stroke="' + O + '" fill="none"/>');
  I.berries = d('Resources', '<path d="M16 8 q3 -4 6 -3" stroke="' + LF + '" stroke-width="2" fill="none"/><circle cx="11" cy="18" r="4" fill="#a8392b" stroke="' + O + '" stroke-width="2"/><circle cx="19" cy="20" r="4" fill="#c14a36" stroke="' + O + '" stroke-width="2"/><circle cx="16" cy="12" r="4" fill="#a8392b" stroke="' + O + '" stroke-width="2"/>');
  I.herb = d('Resources', '<line x1="16" y1="6" x2="16" y2="26" stroke="' + LF + '" stroke-width="2"/><path d="M16 10 q-6 -2 -8 3 q6 2 8 -3" fill="' + LL + '" stroke="' + O + '"/><path d="M16 14 q6 -2 8 3 q-6 2 -8 -3" fill="' + LL + '" stroke="' + O + '"/><path d="M16 19 q-6 -2 -8 3 q6 2 8 -3" fill="' + LF + '" stroke="' + O + '"/>');
  I.cloth = d('Resources', '<rect x="5" y="10" width="22" height="5" fill="' + BL + '" stroke="' + O + '" stroke-width="2"/><rect x="5" y="15" width="22" height="5" fill="#4d6175" stroke="' + O + '" stroke-width="2"/><rect x="5" y="20" width="22" height="5" fill="' + BL + '" stroke="' + O + '" stroke-width="2"/><line x1="8" y1="10" x2="8" y2="25" stroke="' + O + '"/>');
  I.leather = d('Resources', '<path d="M8 6 L24 6 L27 12 L24 26 L8 26 L5 12 Z" fill="#8a6242" stroke="' + O + '" stroke-width="2"/><circle cx="10" cy="10" r="1" fill="' + O + '"/><circle cx="22" cy="10" r="1" fill="' + O + '"/><circle cx="10" cy="22" r="1" fill="' + O + '"/><circle cx="22" cy="22" r="1" fill="' + O + '"/>');
  I.ore = d('Resources', '<polygon points="9,8 23,8 27,18 20,26 9,25 5,16" fill="' + SD + '" stroke="' + O + '" stroke-width="2"/><rect x="12" y="13" width="3" height="3" fill="' + AC + '"/><rect x="18" y="17" width="3" height="3" fill="' + AC + '"/><rect x="15" y="20" width="2" height="2" fill="' + GR + '"/>');
  I.coal = d('Resources', '<polygon points="9,8 23,8 27,18 20,26 9,25 5,16" fill="#2c2825" stroke="' + O + '" stroke-width="2"/><rect x="12" y="12" width="3" height="2" fill="#5a544c"/><rect x="18" y="17" width="2" height="2" fill="#5a544c"/>');
  I.coins = d('Resources', '<ellipse cx="14" cy="22" rx="8" ry="3" fill="' + GR + '" stroke="' + O + '" stroke-width="2"/><ellipse cx="14" cy="18" rx="8" ry="3" fill="' + AC + '" stroke="' + O + '" stroke-width="2"/><ellipse cx="14" cy="14" rx="8" ry="3" fill="' + GR + '" stroke="' + O + '" stroke-width="2"/><circle cx="24" cy="10" r="4" fill="' + AC + '" stroke="' + O + '" stroke-width="2"/>');
  I.bucket = d('Resources', '<path d="M9 12 L23 12 L21 26 L11 26 Z" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><ellipse cx="16" cy="12" rx="7" ry="2.5" fill="' + BL + '" stroke="' + O + '" stroke-width="2"/><path d="M9 12 A 8 8 0 0 1 23 12" fill="none" stroke="' + WD + '" stroke-width="2"/>');
  I.tools = d('Resources', '<line x1="8" y1="24" x2="20" y2="12" stroke="' + W + '" stroke-width="3"/><rect x="17" y="6" width="9" height="7" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><line x1="24" y1="24" x2="12" y2="12" stroke="' + SD + '" stroke-width="3"/><polygon points="10,8 14,12 12,14 8,10" fill="' + ST + '" stroke="' + O + '"/>');

  /* ============ NEEDS & MOODS ============ */
  I.food = d('Needs & Moods', '<path d="M12 10 q1 -2 0 -4 M16 10 q1 -2 0 -4 M20 10 q1 -2 0 -4" stroke="' + IN + '" fill="none"/><ellipse cx="16" cy="14" rx="8" ry="3" fill="' + GR + '" stroke="' + O + '"/><path d="M5 14 H27 A11 9 0 0 1 5 14 Z" fill="' + WD + '" stroke="' + O + '" stroke-width="2"/>');
  I.sleep = d('Needs & Moods', '<rect x="4" y="16" width="24" height="8" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><rect x="5" y="12" width="7" height="5" fill="' + TX + '" stroke="' + O + '"/><line x1="4" y1="24" x2="4" y2="27" stroke="' + O + '" stroke-width="2"/><line x1="28" y1="24" x2="28" y2="27" stroke="' + O + '" stroke-width="2"/><path d="M19 5 h5 l-5 5 h5" stroke="' + IN + '" stroke-width="2" fill="none"/>');
  I.health = d('Needs & Moods', '<path d="M16 27 L6 17 A6.5 6.5 0 0 1 16 9 A6.5 6.5 0 0 1 26 17 Z" fill="' + DG + '" stroke="' + O + '" stroke-width="2"/><rect x="11" y="13" width="3" height="2" fill="#f0a285"/>');
  I.comfort = d('Needs & Moods', '<rect x="8" y="6" width="4" height="18" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><rect x="8" y="16" width="16" height="5" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><rect x="9" y="13" width="13" height="4" fill="' + DG + '" stroke="' + O + '"/><line x1="22" y1="21" x2="22" y2="27" stroke="' + O + '" stroke-width="2"/><line x1="10" y1="24" x2="10" y2="27" stroke="' + O + '" stroke-width="2"/>');
  I.joy = d('Needs & Moods', '<polygon points="16,4 19,12 28,13 21,18 23,27 16,22 9,27 11,18 4,13 13,12" fill="' + AC + '" stroke="' + O + '" stroke-width="2"/>');
  I['mood-happy'] = d('Needs & Moods', '<circle cx="16" cy="16" r="11" fill="' + GR + '" stroke="' + O + '" stroke-width="2"/><rect x="11" y="12" width="2" height="3" fill="' + O + '"/><rect x="19" y="12" width="2" height="3" fill="' + O + '"/><path d="M10 19 q6 6 12 0" stroke="' + O + '" stroke-width="2" fill="none"/>');
  I['mood-sad'] = d('Needs & Moods', '<circle cx="16" cy="16" r="11" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><rect x="11" y="12" width="2" height="3" fill="' + O + '"/><rect x="19" y="12" width="2" height="3" fill="' + O + '"/><path d="M10 22 q6 -5 12 0" stroke="' + O + '" stroke-width="2" fill="none"/>');
  I.temperature = d('Needs & Moods', '<rect x="14" y="5" width="4" height="16" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><circle cx="16" cy="24" r="5" fill="' + DG + '" stroke="' + O + '" stroke-width="2"/><rect x="15" y="12" width="2" height="10" fill="' + DG + '"/>');

  /* ============ WORK ============ */
  I.build = d('Work', '<rect x="9" y="5" width="12" height="7" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><rect x="14" y="12" width="4" height="15" fill="' + W + '" stroke="' + O + '" stroke-width="2"/>');
  I.chop = d('Work', '<line x1="10" y1="27" x2="21" y2="9" stroke="' + W + '" stroke-width="3"/><path d="M17 5 q7 1 8 8 q-5 1 -9 -2 z" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/>');
  I.harvest = d('Work', '<path d="M22 5 A 11 11 0 1 0 27 17" fill="none" stroke="' + ST + '" stroke-width="3"/><rect x="24" y="17" width="4" height="9" fill="' + W + '" stroke="' + O + '"/>');
  I.haul = d('Work', '<rect x="6" y="14" width="14" height="12" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><line x1="6" y1="20" x2="20" y2="20" stroke="' + WD + '"/><line x1="13" y1="14" x2="13" y2="26" stroke="' + WD + '"/><path d="M25 14 v-8 m0 0 l-3 3 m3 -3 l3 3" stroke="' + TX + '" stroke-width="2" fill="none"/>');
  I.cook = d('Work', '<path d="M12 9 q1 -2 0 -4 M16 9 q1 -2 0 -4 M20 9 q1 -2 0 -4" stroke="' + IN + '" fill="none"/><rect x="8" y="14" width="16" height="10" fill="' + SD + '" stroke="' + O + '" stroke-width="2"/><ellipse cx="16" cy="14" rx="8" ry="2.5" fill="' + DK + '" stroke="' + O + '"/><line x1="5" y1="15" x2="8" y2="15" stroke="' + ST + '" stroke-width="2"/><line x1="24" y1="15" x2="27" y2="15" stroke="' + ST + '" stroke-width="2"/>');
  I.craft = d('Work', '<rect x="10" y="10" width="16" height="5" fill="' + SD + '" stroke="' + O + '" stroke-width="2"/><path d="M10 10 q-5 1 -5 5 q3 0 5 -2 z" fill="' + SD + '" stroke="' + O + '"/><rect x="14" y="15" width="6" height="6" fill="' + SD + '" stroke="' + O + '"/><rect x="11" y="21" width="12" height="4" fill="' + SD + '" stroke="' + O + '" stroke-width="2"/>');
  I.research = d('Work', '<path d="M16 8 q-5 -3 -11 -2 v18 q6 -1 11 2 q5 -3 11 -2 v-18 q-6 -1 -11 2 z" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><line x1="16" y1="8" x2="16" y2="26" stroke="' + O + '"/><line x1="8" y1="11" x2="13" y2="11" stroke="' + IN + '"/><line x1="8" y1="14" x2="13" y2="14" stroke="' + IN + '"/><line x1="19" y1="11" x2="24" y2="11" stroke="' + IN + '"/><line x1="19" y1="14" x2="24" y2="14" stroke="' + IN + '"/>');
  I.hunt = d('Work', '<path d="M9 5 q14 11 0 22" fill="none" stroke="' + W + '" stroke-width="2"/><line x1="9" y1="5" x2="9" y2="27" stroke="' + TX + '"/><line x1="9" y1="16" x2="25" y2="16" stroke="' + WD + '" stroke-width="2"/><polygon points="27,16 22,13 22,19" fill="' + ST + '" stroke="' + O + '"/>');
  I.guard = d('Work', '<line x1="16" y1="8" x2="16" y2="3" stroke="' + DG + '" stroke-width="2"/><path d="M8 16 a8 8 0 0 1 16 0 v8 h-16 z" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><rect x="13" y="15" width="6" height="5" fill="' + DK + '" stroke="' + O + '"/>');

  /* ============ COMBAT ============ */
  I.sword = d('Combat', '<line x1="9" y1="23" x2="23" y2="9" stroke="#c9c4b8" stroke-width="3"/><line x1="23" y1="9" x2="25" y2="7" stroke="#e8e4da" stroke-width="2"/><line x1="7" y1="17" x2="15" y2="25" stroke="' + GR + '" stroke-width="2"/><line x1="6" y1="26" x2="9" y2="23" stroke="' + WD + '" stroke-width="3"/>');
  I.shield = d('Combat', '<path d="M16 3 L27 7 V15 C27 21 22 26 16 29 C10 26 5 21 5 15 V7 Z" fill="' + BL + '" stroke="' + O + '" stroke-width="2"/><line x1="16" y1="3" x2="16" y2="29" stroke="' + O + '"/><line x1="5" y1="13" x2="27" y2="13" stroke="' + O + '"/>');
  I.raid = d('Combat', '<line x1="7" y1="7" x2="25" y2="25" stroke="#c9c4b8" stroke-width="3"/><line x1="25" y1="7" x2="7" y2="25" stroke="#c9c4b8" stroke-width="3"/><line x1="5" y1="5" x2="9" y2="9" stroke="' + WD + '" stroke-width="3"/><line x1="27" y1="5" x2="23" y2="9" stroke="' + WD + '" stroke-width="3"/><circle cx="16" cy="16" r="3" fill="' + DG + '" stroke="' + O + '"/>');
  I.armor = d('Combat', '<path d="M10 6 h12 l3 6 -2 14 h-14 l-2 -14 z" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><path d="M13 6 a3 3 0 0 0 6 0" fill="none" stroke="' + O + '" stroke-width="2"/><line x1="16" y1="12" x2="16" y2="24" stroke="' + SD + '"/>');

  /* ============ PEOPLE ============ */
  I.settler = d('People', '<circle cx="16" cy="9" r="5" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><path d="M6 28 a10 9 0 0 1 20 0 z" fill="' + BL + '" stroke="' + O + '" stroke-width="2"/>');
  I.family = d('People', '<circle cx="11" cy="9" r="4" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><path d="M4 26 a7 8 0 0 1 14 0 z" fill="' + BL + '" stroke="' + O + '" stroke-width="2"/><circle cx="22" cy="11" r="3" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><path d="M16 26 a6 7 0 0 1 12 0 z" fill="' + LF + '" stroke="' + O + '" stroke-width="2"/>');
  I.child = d('People', '<circle cx="16" cy="13" r="4" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><path d="M9 27 a7 7 0 0 1 14 0 z" fill="' + GR + '" stroke="' + O + '" stroke-width="2"/>');
  I.death = d('People', '<path d="M7 13 a9 9 0 0 1 18 0 v5 h-3 v4 h-12 v-4 h-3 z" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><circle cx="12" cy="13" r="2" fill="' + O + '"/><circle cx="20" cy="13" r="2" fill="' + O + '"/><rect x="13" y="22" width="2" height="4" fill="' + TX + '" stroke="' + O + '"/><rect x="17" y="22" width="2" height="4" fill="' + TX + '" stroke="' + O + '"/>');
  I.caravan = d('People', '<path d="M5 10 a9 6 0 0 1 18 0" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><rect x="5" y="10" width="18" height="9" fill="' + W + '" stroke="' + O + '" stroke-width="2"/><circle cx="10" cy="23" r="4" fill="' + WD + '" stroke="' + O + '" stroke-width="2"/><circle cx="19" cy="23" r="4" fill="' + WD + '" stroke="' + O + '" stroke-width="2"/><line x1="23" y1="15" x2="29" y2="13" stroke="' + WD + '" stroke-width="2"/>');

  /* ============ TIME & WEATHER ============ */
  I.sun = d('Time & Weather', '<g stroke="' + GR + '" stroke-width="2"><line x1="16" y1="3" x2="16" y2="7"/><line x1="16" y1="25" x2="16" y2="29"/><line x1="3" y1="16" x2="7" y2="16"/><line x1="25" y1="16" x2="29" y2="16"/><line x1="7" y1="7" x2="10" y2="10"/><line x1="22" y1="22" x2="25" y2="25"/><line x1="25" y1="7" x2="22" y2="10"/><line x1="10" y1="22" x2="7" y2="25"/></g><circle cx="16" cy="16" r="6" fill="' + AC + '" stroke="' + O + '" stroke-width="2"/>');
  I.moon = d('Time & Weather', '<path d="M20 4 a12 12 0 1 0 0 24 a14 14 0 0 1 0 -24 z" fill="' + IN + '" stroke="' + O + '" stroke-width="2"/><rect x="13" y="10" width="2" height="2" fill="#7d92a6"/><rect x="10" y="18" width="3" height="3" fill="#7d92a6"/>');
  I.hourglass = d('Time & Weather', '<line x1="9" y1="5" x2="23" y2="5" stroke="' + W + '" stroke-width="3"/><line x1="9" y1="27" x2="23" y2="27" stroke="' + W + '" stroke-width="3"/><path d="M10 7 H22 L17 16 L22 25 H10 L15 16 Z" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><polygon points="13,9 19,9 16,13" fill="' + GR + '"/><polygon points="13,24 19,24 16,20" fill="' + GR + '"/>');
  I.calendar = d('Time & Weather', '<rect x="5" y="7" width="22" height="20" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><rect x="5" y="7" width="22" height="5" fill="' + DG + '" stroke="' + O + '" stroke-width="2"/><line x1="10" y1="4" x2="10" y2="9" stroke="' + O + '" stroke-width="2"/><line x1="22" y1="4" x2="22" y2="9" stroke="' + O + '" stroke-width="2"/><g fill="' + SD + '"><rect x="9" y="15" width="3" height="3"/><rect x="15" y="15" width="3" height="3"/><rect x="21" y="15" width="3" height="3"/><rect x="9" y="21" width="3" height="3"/><rect x="15" y="21" width="3" height="3"/></g>');
  I.rain = d('Time & Weather', '<path d="M9 18 a5 5 0 0 1 1 -10 a7 7 0 0 1 13 2 a4.5 4.5 0 0 1 -1 8 z" fill="' + IN + '" stroke="' + O + '" stroke-width="2"/><g stroke="' + BL + '" stroke-width="2"><line x1="11" y1="21" x2="9" y2="26"/><line x1="17" y1="21" x2="15" y2="26"/><line x1="23" y1="21" x2="21" y2="26"/></g>');
  I.snow = d('Time & Weather', '<g stroke="' + TX + '" stroke-width="2"><line x1="16" y1="4" x2="16" y2="28"/><line x1="6" y1="10" x2="26" y2="22"/><line x1="26" y1="10" x2="6" y2="22"/></g><circle cx="16" cy="16" r="2" fill="' + TX + '"/>');
  I.wind = d('Time & Weather', '<path d="M4 11 h14 a4 4 0 1 0 -4 -5" fill="none" stroke="' + IN + '" stroke-width="2"/><path d="M4 17 h20 a4 4 0 1 1 -4 5" fill="none" stroke="' + TX + '" stroke-width="2"/><path d="M4 23 h10" stroke="' + IN + '" stroke-width="2"/>');
  I.season = d('Time & Weather', '<path d="M24 6 q-14 0 -16 16 q14 2 16 -8 z" fill="' + LL + '" stroke="' + O + '" stroke-width="2"/><path d="M10 24 q6 -8 12 -14" stroke="' + LF + '" fill="none" stroke-width="2"/>');

  /* ============ STATUS ============ */
  I.ready = d('Status', '<circle cx="16" cy="16" r="12" fill="none" stroke="' + OK + '" stroke-width="2"/><polyline points="10,16 14,20 22,10" fill="none" stroke="' + OK + '" stroke-width="2" stroke-linecap="round"/>');
  I.blocked = d('Status', '<circle cx="16" cy="16" r="12" fill="none" stroke="' + DG + '" stroke-width="2"/><line x1="10" y1="10" x2="22" y2="22" stroke="' + DG + '" stroke-width="2" stroke-linecap="round"/><line x1="22" y1="10" x2="10" y2="22" stroke="' + DG + '" stroke-width="2" stroke-linecap="round"/>');
  I.warning = d('Status', '<polygon points="16,4 28,26 4,26" fill="none" stroke="' + GR + '" stroke-width="2"/><circle cx="16" cy="22" r="1.5" fill="' + GR + '"/><line x1="16" y1="11" x2="16" y2="18" stroke="' + GR + '" stroke-width="2"/>');
  I.info = d('Status', '<circle cx="16" cy="16" r="12" fill="none" stroke="' + IN + '" stroke-width="2"/><circle cx="16" cy="9" r="1.5" fill="' + IN + '"/><line x1="16" y1="13" x2="16" y2="22" stroke="' + IN + '" stroke-width="2"/>');
  I.settings = d('Status', '<circle cx="16" cy="16" r="8" fill="none" stroke="' + TX + '" stroke-width="2"/><circle cx="16" cy="16" r="3" fill="none" stroke="' + TX + '" stroke-width="2"/><g stroke="' + TX + '" stroke-width="2"><line x1="16" y1="4" x2="16" y2="8"/><line x1="16" y1="24" x2="16" y2="28"/><line x1="4" y1="16" x2="8" y2="16"/><line x1="24" y1="16" x2="28" y2="16"/></g>');
  I.pause = d('Status', '<rect x="8" y="6" width="5" height="20" fill="' + TX + '" stroke="' + O + '"/><rect x="19" y="6" width="5" height="20" fill="' + TX + '" stroke="' + O + '"/>');
  I.play = d('Status', '<polygon points="9,6 9,26 25,16" fill="' + OK + '" stroke="' + O + '" stroke-width="2"/>');
  I.speed = d('Status', '<polygon points="6,9 6,23 13,16" fill="' + AC + '" stroke="' + O + '" stroke-width="2"/><polygon points="13,9 13,23 20,16" fill="' + AC + '" stroke="' + O + '" stroke-width="2"/><polygon points="20,9 20,23 27,16" fill="' + AC + '" stroke="' + O + '" stroke-width="2"/>');

  /* ============ INTERFACE ============ */
  I.plus = d('Interface', '<line x1="16" y1="7" x2="16" y2="25" stroke="' + TX + '" stroke-width="3"/><line x1="7" y1="16" x2="25" y2="16" stroke="' + TX + '" stroke-width="3"/>');
  I.minus = d('Interface', '<line x1="7" y1="16" x2="25" y2="16" stroke="' + TX + '" stroke-width="3"/>');
  I.close = d('Interface', '<line x1="8" y1="8" x2="24" y2="24" stroke="' + TX + '" stroke-width="3"/><line x1="24" y1="8" x2="8" y2="24" stroke="' + TX + '" stroke-width="3"/>');
  I['arrow-up'] = d('Interface', '<polyline points="8,20 16,10 24,20" fill="none" stroke="' + TX + '" stroke-width="3"/>');
  I['arrow-down'] = d('Interface', '<polyline points="8,12 16,22 24,12" fill="none" stroke="' + TX + '" stroke-width="3"/>');
  I['arrow-left'] = d('Interface', '<polyline points="20,8 10,16 20,24" fill="none" stroke="' + TX + '" stroke-width="3"/>');
  I['arrow-right'] = d('Interface', '<polyline points="12,8 22,16 12,24" fill="none" stroke="' + TX + '" stroke-width="3"/>');
  I.search = d('Interface', '<circle cx="14" cy="13" r="7" fill="none" stroke="' + TX + '" stroke-width="2"/><line x1="19" y1="18" x2="26" y2="25" stroke="' + TX + '" stroke-width="3"/>');
  I.bell = d('Interface', '<path d="M16 4 a8 8 0 0 1 8 8 v6 l3 4 h-22 l3 -4 v-6 a8 8 0 0 1 8 -8 z" fill="' + GR + '" stroke="' + O + '" stroke-width="2"/><path d="M13 26 a3 3 0 0 0 6 0" fill="none" stroke="' + TX + '" stroke-width="2"/>');
  I.lock = d('Interface', '<path d="M11 14 v-4 a5 5 0 0 1 10 0 v4" fill="none" stroke="' + ST + '" stroke-width="3"/><rect x="8" y="14" width="16" height="13" fill="' + GR + '" stroke="' + O + '" stroke-width="2"/><rect x="15" y="18" width="2" height="5" fill="' + O + '"/>');
  I.eye = d('Interface', '<path d="M3 16 q13 -12 26 0 q-13 12 -26 0 z" fill="' + TX + '" stroke="' + O + '" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="' + BL + '" stroke="' + O + '"/><circle cx="16" cy="16" r="1.5" fill="' + O + '"/>');
  I.trash = d('Interface', '<rect x="9" y="10" width="14" height="17" fill="' + ST + '" stroke="' + O + '" stroke-width="2"/><rect x="7" y="7" width="18" height="3" fill="' + SD + '" stroke="' + O + '"/><line x1="14" y1="6" x2="18" y2="6" stroke="' + O + '" stroke-width="2"/><g stroke="' + SD + '"><line x1="13" y1="13" x2="13" y2="24"/><line x1="16" y1="13" x2="16" y2="24"/><line x1="19" y1="13" x2="19" y2="24"/></g>');

  var GROUP_ORDER = ['Buildings', 'Resources', 'Needs & Moods', 'Work', 'Combat', 'People', 'Time & Weather', 'Status', 'Interface'];

  var ColonyIcons = {
    viewBox: '0 0 32 32',
    defs: I,
    names: Object.keys(I),
    groupOrder: GROUP_ORDER,
    byGroup: function () {
      var out = {};
      GROUP_ORDER.forEach(function (g) { out[g] = []; });
      Object.keys(I).forEach(function (n) {
        var g = I[n].g;
        if (!out[g]) out[g] = [];
        out[g].push(n);
      });
      return out;
    },
    svg: function (name, size, attrs) {
      var def = I[name.replace(/^icon-/, '')];
      if (!def) return '';
      size = size || 24;
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"' + (attrs ? ' ' + attrs : '') + '>' + def.s + '</svg>';
    },
    element: function (name, size) {
      var tmp = document.createElement('div');
      tmp.innerHTML = this.svg(name, size);
      return tmp.firstChild;
    },
  };

  if (typeof window !== 'undefined') window.ColonyIcons = ColonyIcons;
  if (typeof module !== 'undefined' && module.exports) module.exports = ColonyIcons;
})();
