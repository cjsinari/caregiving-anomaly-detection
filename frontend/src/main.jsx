import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/tokens.css';
import './styles/base.css';

/*
 * StrictMode is on deliberately, including for the sign-in flow. It runs
 * effects twice in development, which is exactly the condition that exposes a
 * refresh timer that is set up but never torn down, or a request fired from an
 * effect without a cancellation guard — both of which would otherwise show up
 * first as a duplicate token rotation against the live service.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
