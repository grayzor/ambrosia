// Island panel for Drive: the shared triage view, with document words.
import { triageView } from '../../renderer/triage-view.js';

export default triageView({
  source: 'Gmail',
  where: 'tes documents Google',
  badge: '✎',
  one: 'demande',
  many: 'demandes',
  feminine: true,
  qualifier: 'Drive',
  open: 'Ouvrir le document',
  color: '#5B9BFF',
});
