// The click-through window across the top of the screen (src/main/glow.js): it only draws.
import { GlowView } from './glow.js';

const view = new GlowView(document.getElementById('glow'));
window.ambrosia.on('glow', (g) => view.set(g || {}));
