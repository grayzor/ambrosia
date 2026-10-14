// Island panel for Courrier: the shared triage view, with mail words.
import { triageView } from '../../renderer/triage-view.js';

export default triageView({
  source: 'Gmail',
  where: 'ta boîte',
  badge: '✉',
  one: 'mail',
  many: 'mails',
  open: 'Ouvrir dans Gmail',
  readLabel: 'le mail',
  color: '#E8B923',
});
