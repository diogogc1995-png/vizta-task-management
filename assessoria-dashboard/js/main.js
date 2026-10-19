import { html, render } from './lib.js';
import { App } from './app.js';
import { setApi as setDataApi } from './data.js';
import { setApi as setStoreApi } from './store.js';
import { setApi as setEditorsApi } from './editors.js';

// ?demo abre o dashboard com dados fictícios em memória, sem Google (para experimentar o layout).
const demo = new URLSearchParams(location.search).has('demo');
const api = demo ? await import('./mock.js') : await import('./google.js');
setDataApi(api);
setStoreApi(api);
setEditorsApi(api);

render(html`<${App} api=${api} demo=${demo} />`, document.getElementById('app'));
