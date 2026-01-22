import {  peek } from 'maverick.js';
import { isString } from 'maverick.js/std';

import { preconnect } from '../../utils/network';
import { isShakaSupported } from '../../utils/support';
import { VideoProvider } from '../video/provider';
import { ShakaLibLoader } from './lib-loader';
import { ShakaController } from './shaka';
import type {Dispose} from 'maverick.js';
import type { MediaProviderAdapter } from '../types';
import type { Src } from '../../core/api/src-types';
import type {
  ShakaConstructor,
  ShakaInstanceCallback,
  ShakaLibrary,
  ShakaProviderConfig,
  ShakaRequestFilter,
  ShakaResponseFilter,
} from './types';

const JS_DELIVR_CDN = 'https://cdn.jsdelivr.net';

/**
 * The Shaka provider introduces support for DASH and HLS streaming via Google's `shaka-player`
 * library. Shaka Player can handle both DASH and HLS content, providing a unified API for
 * adaptive bitrate streaming.
 *
 * **Key Features:**
 * - Supports both DASH (.mpd) and HLS (.m3u8) formats
 * - Built-in DRM support (Widevine, PlayReady, FairPlay)
 * - Network request/response filtering for authentication
 * - Adaptive bitrate streaming with ABR controls
 *
 * **Usage with Vidstack:**
 *
 * The Shaka provider can be used by adding it to your custom loaders:
 *
 * ```ts
 * import { ShakaProviderLoader } from 'vidstack/exports/providers';
 *
 * // Add Shaka loader to prioritize it for DASH/HLS content
 * const customLoaders = [new ShakaProviderLoader()];
 * ```
 *
 * **Accessing the Shaka Instance:**
 *
 * ```ts
 * import { isShakaProvider } from 'vidstack/exports/providers';
 *
 * player.addEventListener('provider-change', (event) => {
 *   const provider = event.detail;
 *   if (isShakaProvider(provider)) {
 *     // Access the Shaka Player instance
 *     const shakaInstance = provider.instance;
 *
 *     // Configure DRM
 *     provider.config = {
 *       config: {
 *         drm: {
 *           servers: {
 *             'com.widevine.alpha': 'https://license.example.com/widevine'
 *           }
 *         }
 *       }
 *     };
 *
 *     // Or configure via onInstance callback
 *     provider.onInstance((shaka) => {
 *       shaka.configure({
 *         streaming: {
 *           bufferingGoal: 60,
 *           rebufferingGoal: 2
 *         }
 *       });
 *     });
 *   }
 * });
 * ```
 *
 * **Network Interceptors:**
 *
 * ```ts
 * // Add authentication to license requests
 * provider.registerRequestFilter((type, request) => {
 *   if (type === 2) { // LICENSE request type
 *     request.headers['Authorization'] = 'Bearer ' + authToken;
 *   }
 * });
 *
 * // Process license responses
 * provider.registerResponseFilter((type, response) => {
 *   if (type === 2) { // LICENSE request type
 *     // Unwrap license from custom response format
 *     const wrapper = JSON.parse(new TextDecoder().decode(response.data));
 *     response.data = base64ToArrayBuffer(wrapper.license);
 *   }
 * });
 * ```
 *
 * @docs {@link https://www.vidstack.io/docs/player/providers/shaka}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video}
 * @see {@link https://shaka-player-demo.appspot.com/docs/api/index.html}
 * @example
 * ```html
 * <media-player
 *   src="https://files.vidstack.io/dash/manifest.mpd"
 *   poster="https://files.vidstack.io/poster.png"
 * >
 *   <media-provider></media-provider>
 * </media-player>
 * ```
 */
export class ShakaProvider extends VideoProvider implements MediaProviderAdapter {
  protected override $$PROVIDER_TYPE = 'SHAKA';

  #ctor: ShakaConstructor | null = null;
  readonly #controller = new ShakaController(this.video, this.ctx);

  /**
   * The Shaka Player constructor.
   */
  get ctor() {
    return this.#ctor;
  }

  /**
   * The current Shaka Player instance. Use this to access Shaka's full API.
   *
   * **Important:** This is `null` until the Shaka library is loaded and the player
   * is initialized. Use `onInstance()` to safely access the instance.
   *
   * @example
   * ```ts
   * const shakaInstance = provider.instance;
   * if (shakaInstance) {
   *   // Get variant tracks (quality levels)
   *   const variants = shakaInstance.getVariantTracks();
   *
   *   // Get text tracks
   *   const textTracks = shakaInstance.getTextTracks();
   *
   *   // Access networking engine
   *   const networkingEngine = shakaInstance.getNetworkingEngine();
   * }
   * ```
   */
  get instance() {
    return this.#controller.instance;
  }

  /**
   * Whether Shaka Player is supported in this environment.
   * Requires MediaSource Extensions (MSE) support.
   */
  static supported = isShakaSupported();

  override get type() {
    return 'shaka';
  }

  get canLiveSync() {
    return true;
  }

  #library: ShakaLibrary = `${JS_DELIVR_CDN}/npm/shaka-player@4.15.1/dist/shaka-player.compiled${__DEV__ ? '.debug.js' : '.js'
    }`;

  /**
   * The Shaka Player configuration object. Set this before the source is loaded
   * to configure DRM, streaming parameters, ABR settings, and network filters.
   *
   * @see {@link https://shaka-player-demo.appspot.com/docs/api/shaka.Player.html#configure}
   *
   * @example
   * ```ts
   * provider.config = {
   *   // Shaka player configuration
   *   config: {
   *     drm: {
   *       servers: {
   *         'com.widevine.alpha': 'https://license.example.com/widevine',
   *         'com.microsoft.playready': 'https://license.example.com/playready'
   *       },
   *       advanced: {
   *         'com.widevine.alpha': {
   *           videoRobustness: 'SW_SECURE_CRYPTO',
   *           audioRobustness: 'SW_SECURE_CRYPTO'
   *         }
   *       }
   *     },
   *     streaming: {
   *       bufferingGoal: 30,
   *       rebufferingGoal: 2
   *     },
   *     abr: {
   *       enabled: true,
   *       defaultBandwidthEstimate: 5000000
   *     }
   *   },
   *   // Request filter for authentication
   *   requestFilter: (type, request) => {
   *     request.headers['X-Custom-Header'] = 'value';
   *   },
   *   // Response filter for processing
   *   responseFilter: (type, response) => {
   *     console.log('Response received:', response.status);
   *   }
   * };
   * ```
   */
  get config(): ShakaProviderConfig {
    return this.#controller.config;
  }

  set config(config: ShakaProviderConfig) {
    this.#controller.config = config;
  }

  /**
   * The Shaka Player library source. Can be:
   * - A URL string to load from CDN
   * - The Shaka namespace object (pre-loaded)
   * - A dynamic import function
   *
   * @defaultValue `https://cdn.jsdelivr.net/npm/shaka-player@4.15.1/dist/shaka-player.compiled.js`
   *
   * @example
   * ```ts
   * // Load from custom CDN
   * provider.library = 'https://cdn.example.com/shaka-player.js';
   *
   * // Use pre-loaded Shaka
   * provider.library = window.shaka;
   *
   * // Dynamic import (for bundlers)
   * provider.library = () => import('shaka-player');
   * ```
   */
  get library() {
    return this.#library;
  }

  set library(library) {
    this.#library = library;
  }

  preconnect(): void {
    if (!isString(this.#library)) return;
    preconnect(this.#library);
  }

  override setup() {
    super.setup();
    new ShakaLibLoader(this.#library, this.ctx, (ctor) => {
      this.#ctor = ctor;
      this.#controller.setup(ctor);
      this.ctx.notify('provider-setup', this);
      const src = peek(this.ctx.$state.source);
      if (src) this.loadSource(src);
    });
  }

  override async loadSource(src: Src, preload?: HTMLMediaElement['preload']) {
    if (!isString(src.src)) {
      this.removeSource();
      return;
    }

    this.media.preload = preload || '';
    this.appendSource(src as Src<string>, src.type || 'application/dash+xml');
    await this.#controller.loadSource(src);
    this.currentSrc = src as Src<string>;
  }

  /**
   * Register a callback to be invoked when the Shaka Player instance is created.
   * This is the recommended way to access and configure the Shaka instance.
   *
   * @param callback - Function called with the Shaka Player instance
   * @returns A dispose function to remove the callback
   *
   * @example
   * ```ts
   * const dispose = provider.onInstance((shaka) => {
   *   // Configure DRM
   *   shaka.configure({
   *     drm: {
   *       servers: {
   *         'com.widevine.alpha': 'https://license.example.com'
   *       }
   *     }
   *   });
   *
   *   // Add network filters
   *   const networkingEngine = shaka.getNetworkingEngine();
   *   networkingEngine?.registerRequestFilter((type, request) => {
   *     request.headers['Authorization'] = 'Bearer ' + token;
   *   });
   *
   *   // Listen to Shaka events
   *   shaka.addEventListener('error', (event) => {
   *     console.error('Shaka error:', event.detail);
   *   });
   * });
   *
   * // Later: remove the callback
   * dispose();
   * ```
   */
  onInstance(callback: ShakaInstanceCallback): Dispose {
    const instance = this.#controller.instance;
    if (instance) callback(instance);
    return this.#controller.onInstance(callback);
  }

  /**
   * Register a request filter with the Shaka networking engine.
   * This allows you to modify requests before they are sent.
   *
   * **Common use cases:**
   * - Adding authentication headers to DRM license requests
   * - Adding CDN tokens to segment URLs
   * - Logging requests for debugging
   *
   * @param filter - The request filter function
   *
   * @see {@link https://shaka-player-demo.appspot.com/docs/api/shaka.net.NetworkingEngine.html#registerRequestFilter}
   *
   * @example
   * ```ts
   * // Add auth token to license requests
   * provider.registerRequestFilter((type, request) => {
   *   if (type === 2) { // ShakaRequestType.LICENSE
   *     request.headers['Authorization'] = 'Bearer ' + authToken;
   *   }
   * });
   *
   * // Add CDN token to all requests
   * provider.registerRequestFilter((type, request) => {
   *   request.uris = request.uris.map(uri =>
   *     uri + (uri.includes('?') ? '&' : '?') + 'token=' + cdnToken
   *   );
   * });
   *
   * // Async filter (e.g., fetch fresh token)
   * provider.registerRequestFilter(async (type, request) => {
   *   if (type === 2) {
   *     const token = await fetchAuthToken();
   *     request.headers['Authorization'] = 'Bearer ' + token;
   *   }
   * });
   * ```
   */
  registerRequestFilter(filter: ShakaRequestFilter): void {
    this.#controller.registerRequestFilter(filter);
  }

  /**
   * Register a response filter with the Shaka networking engine.
   * This allows you to modify responses after they are received.
   *
   * **Common use cases:**
   * - Processing wrapped license responses
   * - Logging responses for debugging
   * - Modifying response data
   *
   * @param filter - The response filter function
   *
   * @see {@link https://shaka-player-demo.appspot.com/docs/api/shaka.net.NetworkingEngine.html#registerResponseFilter}
   *
   * @example
   * ```ts
   * // Process wrapped license response
   * provider.registerResponseFilter((type, response) => {
   *   if (type === 2) { // ShakaRequestType.LICENSE
   *     // Server wraps license in JSON
   *     const wrapper = JSON.parse(new TextDecoder().decode(response.data));
   *     // Extract and decode the actual license
   *     response.data = Uint8Array.from(atob(wrapper.license), c => c.charCodeAt(0)).buffer;
   *   }
   * });
   *
   * // Log all responses
   * provider.registerResponseFilter((type, response) => {
   *   console.log(`Response for type ${type}:`, {
   *     uri: response.uri,
   *     status: response.status,
   *     timeMs: response.timeMs
   *   });
   * });
   * ```
   */
  registerResponseFilter(filter: ShakaResponseFilter): void {
    this.#controller.registerResponseFilter(filter);
  }

  destroy() {
    this.#controller.destroy();
  }
}
