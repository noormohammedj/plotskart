import './lib/storageMigration';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DataProvider } from './data/DataProvider';
import { watchScrollHints } from './lib/scrollHints';
import { hideSplash, keepFieldsAboveKeyboard, lockZoom, routeExternalLinks, syncStatusBar } from './lib/native';
import './styles.css';

lockZoom();
routeExternalLinks();
watchScrollHints();
syncStatusBar();
keepFieldsAboveKeyboard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <App />
    </DataProvider>
  </StrictMode>,
);
hideSplash();
