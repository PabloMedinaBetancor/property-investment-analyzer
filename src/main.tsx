import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/form.css';
import './styles/analyze.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
createRoot(root).render(<Root />);
