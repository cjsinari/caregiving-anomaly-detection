import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/*
 * Test environment setup.
 *
 * Three things jsdom does not provide that this application uses, stubbed here
 * rather than in each test file:
 *
 *  - matchMedia, which the theme hook reads.
 *  - ResizeObserver, which Recharts' responsive container needs to measure.
 *  - a measurable element size, because jsdom reports every element as 0x0 and
 *    a chart with no width renders nothing at all, so chart assertions would
 *    pass or fail for reasons unrelated to the chart.
 */

afterEach(() => cleanup());

if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Give every element a usable size so the responsive chart container renders.
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 400 });

// Nothing in a test should reach the network. A test that tries has a missing
// stub, and failing loudly is better than a silent pending promise.
if (!globalThis.fetch) globalThis.fetch = vi.fn(() => Promise.reject(new Error('fetch not stubbed in this test')));
