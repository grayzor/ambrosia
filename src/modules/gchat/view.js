// Island panel for Google Chat: the shared triage view, with Chat words.
import { triageView } from '../../renderer/triage-view.js';

export default triageView({
  source: 'Google Chat',
  where: 'Google Chat',
  badge: '❝',
  one: 'message',
  many: 'messages',
  qualifier: 'Chat',
  open: 'Ouvrir dans Chat',
  color: '#34C46A',
});
