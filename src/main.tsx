import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/shared';
import '@xterm/xterm/css/xterm.css';
import './app.css';
import { I18nProvider } from './i18n';
import { ConfirmDialogOverlay } from './components/shared/ConfirmDialogOverlay';

const isDialogOverlay = window.location.hash === '#/dialog-overlay';
if (isDialogOverlay) document.documentElement.classList.add('dialog-overlay-root');
const root = isDialogOverlay ? <ConfirmDialogOverlay /> : <App />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>{root}</I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
