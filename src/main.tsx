/**
 * @fileoverview Entry point for the dropconvert-wasm SPA.
 *
 * This project is licensed under the MIT License.
 * See LICENSE and /public/licenses/ for licensing details.
 *
 * Dependencies:
 * - Solid.js (MIT): https://solidjs.com
 * - Tailwind CSS (MIT): https://tailwindcss.com
 * - FFmpeg WASM (MIT wrapper, LGPL/GPL binary): https://github.com/ffmpegwasm/ffmpeg.wasm
 *
 * For complete third-party license information, see /public/licenses/
 */

import './index.css';

import { render } from 'solid-js/web';
import App from './app/App';

render(() => <App />, document.getElementById('root')!);
