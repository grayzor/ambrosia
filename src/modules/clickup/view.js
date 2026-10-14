// Island panel for ClickUp: the shared triage view, with ClickUp words.
import { triageView } from '../../renderer/triage-view.js';

export default triageView({
  source: 'ClickUp',
  where: 'ClickUp',
  badge: '✓',
  one: 'interaction',
  many: 'interactions',
  feminine: true,
  qualifier: 'ClickUp',
  open: 'Ouvrir dans ClickUp',
  readLabel: 'le commentaire',
  color: '#9B8CFF',
});
