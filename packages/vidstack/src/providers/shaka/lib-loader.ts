import { DOMEvent, isFunction, isString, isUndefined } from 'maverick.js/std';

import { coerceToError } from '../../utils/error';
import { loadScript } from '../../utils/network';
import type { MediaContext } from '../../core/api/media-context';
import type {
  ShakaConstructor,
  ShakaConstructorLoader,
  ShakaLibrary,
  ShakaNamespace,
} from './types';

interface LoadShakaConstructorCallbacks {
  onLoadStart?: () => void;
  onLoaded?: (ctor: ShakaConstructor) => void;
  onLoadError?: (err: Error) => void;
}

export class ShakaLibLoader {
  #lib: ShakaLibrary;
  #ctx: MediaContext;
  #callback: (ctor: ShakaConstructor) => void;

  constructor(lib: ShakaLibrary, ctx: MediaContext, callback: (ctor: ShakaConstructor) => void) {
    this.#lib = lib;
    this.#ctx = ctx;
    this.#callback = callback;
    this.#startLoading();
  }

  async #startLoading() {
    if (__DEV__) this.#ctx.logger?.info('🏗️ Loading Shaka Player Library');

    const callbacks: LoadShakaConstructorCallbacks = {
      onLoadStart: this.#onLoadStart.bind(this),
      onLoaded: this.#onLoaded.bind(this),
      onLoadError: this.#onLoadError.bind(this),
    };

    // If not a string it'll return undefined.
    let ctor = await loadShakaScript(this.#lib, callbacks);

    // If it's not a remote source, it must of been passed in directly as a static/dynamic import.
    if (isUndefined(ctor) && !isString(this.#lib)) ctor = await importShaka(this.#lib, callbacks);

    // We failed loading the constructor.
    if (!ctor) return null;

    // Not supported - check if MediaSource is available
    if (typeof MediaSource === 'undefined') {
      const message = '[vidstack] Shaka Player is not supported in this environment';
      if (__DEV__) this.#ctx.logger?.error(message);
      this.#ctx.player.dispatch(new DOMEvent<void>('shaka-unsupported'));
      this.#ctx.notify('error', { message, code: 4 });
      return null;
    }

    return ctor;
  }

  #onLoadStart() {
    if (__DEV__) {
      this.#ctx.logger
        ?.infoGroup('Starting to load Shaka Player')
        .labelledLog('URL', this.#lib)
        .dispatch();
    }

    this.#ctx.player.dispatch(new DOMEvent<void>('shaka-lib-load-start'));
  }

  #onLoaded(ctor: ShakaConstructor) {
    if (__DEV__) {
      this.#ctx.logger
        ?.infoGroup('Loaded Shaka Player')
        .labelledLog('Library', this.#lib)
        .labelledLog('Constructor', ctor)
        .dispatch();
    }

    this.#ctx.player.dispatch(
      new DOMEvent<ShakaConstructor>('shaka-lib-loaded', {
        detail: ctor,
      }),
    );

    this.#callback(ctor);
  }

  #onLoadError(e: any) {
    const error = coerceToError(e);

    if (__DEV__) {
      this.#ctx.logger
        ?.errorGroup('[vidstack] Failed to load Shaka Player')
        .labelledLog('Library', this.#lib)
        .labelledLog('Error', e)
        .dispatch();
    }

    this.#ctx.player.dispatch(
      new DOMEvent<any>('shaka-lib-load-error', {
        detail: error,
      }),
    );

    this.#ctx.notify('error', {
      message: error.message,
      code: 4,
      error,
    });
  }
}

async function importShaka(
  loader: ShakaNamespace | ShakaConstructorLoader | undefined,
  callbacks: LoadShakaConstructorCallbacks = {},
): Promise<ShakaConstructor | undefined> {
  if (isUndefined(loader)) return undefined;

  callbacks.onLoadStart?.();

  if (isShakaNamespace(loader)) {
    // Install polyfills
    loader.polyfill?.installAll?.();
    const ctor = loader.Player;
    callbacks.onLoaded?.(ctor);
    return ctor;
  }

  try {
    const result = await (loader as ShakaConstructorLoader)();
    const ns = result?.default;

    if (isShakaNamespace(ns)) {
      // Install polyfills
      ns.polyfill?.installAll?.();
      callbacks.onLoaded?.(ns.Player);
      return ns.Player;
    }

    throw Error(
      __DEV__
        ? '[vidstack] failed importing Shaka Player. Dynamic import returned invalid object.'
        : '',
    );
  } catch (err) {
    callbacks.onLoadError?.(err as Error);
  }

  return undefined;
}

/**
 * Loads Shaka Player from the remote source given via `library` into the window namespace.
 * This method will return `undefined` if it fails to load the script. Listen to
 * `shaka-lib-load-error` to be notified of any failures.
 */
async function loadShakaScript(
  src: unknown,
  callbacks: LoadShakaConstructorCallbacks = {},
): Promise<ShakaConstructor | undefined> {
  if (!isString(src)) return undefined;

  callbacks.onLoadStart?.();

  try {
    await loadScript(src);

    const shaka = (window as any).shaka as ShakaNamespace | undefined;

    if (!shaka || !isFunction(shaka.Player)) {
      throw Error(
        __DEV__
          ? '[vidstack] failed loading Shaka Player. Could not find a valid `shaka.Player` constructor on window'
          : '',
      );
    }

    // Install polyfills
    shaka.polyfill?.installAll?.();

    const ctor = shaka.Player;
    callbacks.onLoaded?.(ctor);
    return ctor;
  } catch (err) {
    callbacks.onLoadError?.(err as Error);
  }

  return undefined;
}

function isShakaNamespace(value: any): value is ShakaNamespace {
  return value && 'Player' in value && isFunction(value.Player);
}
