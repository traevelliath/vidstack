import { effect, peek } from 'maverick.js';
import { DOMEvent, camelToKebabCase, isString, listenEvent } from 'maverick.js/std';

import { QualitySymbol } from '../../core/quality/symbols';
import { TextTrackSymbol } from '../../core/tracks/text/symbols';
import { TextTrack } from '../../core/tracks/text/text-track';
import { ListSymbol } from '../../foundation/list/symbols';
import { RAFLoop } from '../../foundation/observers/raf-loop';
import { getLangName } from '../../utils/language';
import { IS_CHROME } from '../../utils/support';
import type { Src } from '../../core/api/src-types';
import type { MediaContext } from '../../core/api/media-context';
import type {
  ShakaConstructor,
  ShakaError,
  ShakaEvent,
  ShakaInstanceCallback,
  ShakaPlayer,
  ShakaProviderConfig,
  ShakaRequestFilter,
  ShakaResponseFilter,
  ShakaTextTrack as ShakaTextTrackType,
  ShakaVariantTrack,
} from './types';

const toDOMEventType = (type: string) => `shaka-${camelToKebabCase(type)}`;

export class ShakaController {
  #video: HTMLVideoElement;
  #ctx: MediaContext;

  #instance: ShakaPlayer | null = null;
  #callbacks = new Set<ShakaInstanceCallback>();
  #stopLiveSync: (() => void) | null = null;

  config: ShakaProviderConfig = {};

  get instance() {
    return this.#instance;
  }

  constructor(video: HTMLVideoElement, ctx: MediaContext) {
    this.#video = video;
    this.#ctx = ctx;
  }

  setup(ctor: ShakaConstructor) {
    this.#instance = new ctor(this.#video);

    // Setup event listeners
    const eventHandler = this.#dispatchShakaEvent.bind(this);
    const events = [
      'buffering',
      'loading',
      'loaded',
      'unloading',
      'adaptation',
      'trackschanged',
      'variantchanged',
      'textchanged',
      'texttrackvisibility',
      'streaming',
      'manifestparsed',
    ];

    for (const event of events) {
      this.#instance.addEventListener(event, eventHandler);
    }

    this.#instance.addEventListener(
      'error',
      this.#onError.bind(this) as (event: ShakaEvent) => void,
    );
    for (const callback of this.#callbacks) callback(this.#instance);

    this.#ctx.player.dispatch('shaka-instance' as any, {
      detail: this.#instance,
    });

    // Apply configuration
    if (this.config.config) {
      this.#instance.configure(this.config.config);
    }

    // Register network filters before load
    const networkingEngine = this.#instance.getNetworkingEngine();
    if (networkingEngine) {
      if (this.config.requestFilter) {
        networkingEngine.registerRequestFilter(this.config.requestFilter);
      }
      if (this.config.responseFilter) {
        networkingEngine.registerResponseFilter(this.config.responseFilter);
      }
    }

    // Listen to Shaka events for track updates
    this.#instance.addEventListener(
      'adaptation',
      this.#onAdaptation.bind(this) as (event: ShakaEvent) => void,
    );
    this.#instance.addEventListener(
      'trackschanged',
      this.#onTracksChanged.bind(this) as (event: ShakaEvent) => void,
    );
    this.#instance.addEventListener(
      'loaded',
      this.#onLoaded.bind(this) as (event: ShakaEvent) => void,
    );
    this.#instance.addEventListener(
      'buffering',
      this.#onBuffering.bind(this) as (event: ShakaEvent) => void,
    );

    this.#ctx.qualities[QualitySymbol.enableAuto] = this.#enableAutoQuality.bind(this);

    // Register event listeners on the context for user interactions (using listenEvent like HLS/DASH)
    listenEvent(this.#ctx.qualities, 'change', this.#onUserQualityChange.bind(this));
    listenEvent(this.#ctx.audioTracks, 'change', this.#onUserAudioChange.bind(this));

    this.#stopLiveSync = effect(this.#liveSync.bind(this));
  }

  #createDOMEvent<T>(type: string, data?: T): DOMEvent<T> {
    return new DOMEvent<any>(toDOMEventType(type), { detail: data });
  }

  #liveSync() {
    if (!this.#ctx.$state.live()) return;
    const raf = new RAFLoop(this.#liveSyncPosition.bind(this));
    raf.start();
    return raf.stop.bind(raf);
  }

  #liveSyncPosition() {
    if (!this.#instance) return;
    const seekRange = this.#instance.seekRange();
    const position = seekRange.end - this.#video.currentTime;
    this.#ctx.$state.liveSyncPosition.set(!isNaN(position) ? position : Infinity);
  }

  #dispatchShakaEvent(event: ShakaEvent) {
    this.#ctx.player?.dispatch(this.#createDOMEvent(event.type, event));
  }

  #onBuffering(event: ShakaEvent) {
    const bufferingEvent = event as ShakaEvent & { buffering: boolean };
    const trigger = this.#createDOMEvent('buffering', event);
    if (bufferingEvent.buffering) {
      this.#ctx.notify('waiting', undefined, trigger);
    }
  }

  #onLoaded() {
    if (this.#ctx.$state.canPlay() || !this.#instance) return;

    const trigger = this.#createDOMEvent('loaded', null);

    // Determine stream type
    const isLive = this.#instance.isLive();
    this.#ctx.notify('stream-type-change', isLive ? 'live' : 'on-demand', trigger);

    // Get duration from seek range for live streams, or from video element
    if (isLive) {
      const seekRange = this.#instance.seekRange();
      const duration = seekRange.end - seekRange.start;
      if (duration > 0) {
        this.#ctx.notify('duration-change', duration, trigger);
      }
    }

    this.#ctx.qualities[QualitySymbol.setAuto](true, trigger);

    // Map variant tracks to qualities
    this.#updateQualityTracks(trigger);

    // Map audio tracks
    this.#updateAudioTracks(trigger);

    // Map text tracks
    this.#updateTextTracks(trigger);

    // Fire canplay event
    this.#video.dispatchEvent(new DOMEvent<void>('canplay', { trigger }));
  }

  #updateQualityTracks(trigger: DOMEvent) {
    if (!this.#instance) return;

    const variantTracks = this.#instance.getVariantTracks();
    const uniqueQualities = new Map<string, ShakaVariantTrack>();

    // Group by resolution to avoid duplicates
    for (const track of variantTracks) {
      if (track.height && track.width) {
        const key = `${track.height}`;
        if (!uniqueQualities.has(key) || track.bandwidth > uniqueQualities.get(key)!.bandwidth) {
          uniqueQualities.set(key, track);
        }
      }
    }

    // Sort by height descending
    const sortedQualities = Array.from(uniqueQualities.values()).sort(
      (a, b) => (b.height || 0) - (a.height || 0),
    );

    for (let i = 0; i < sortedQualities.length; i++) {
      const track = sortedQualities[i];
      const quality = {
        id: `shaka-quality-${track.id}`,
        width: track.width || 0,
        height: track.height || 0,
        bitrate: track.bandwidth || 0,
        codec: track.videoCodec || track.codecs || '',
        index: i,
      };

      this.#ctx.qualities[ListSymbol.add](quality, trigger);
    }

    // Select current active quality
    const activeTrack = variantTracks.find((t) => t.active);
    if (activeTrack) {
      const activeQuality = this.#ctx.qualities
        .toArray()
        .find((q) => q.height === activeTrack.height);
      if (activeQuality) {
        this.#ctx.qualities[ListSymbol.select](activeQuality, true, trigger);
      }
    }
  }

  #updateAudioTracks(trigger: DOMEvent) {
    if (!this.#instance) return;

    const audioLanguagesAndRoles = this.#instance.getAudioLanguagesAndRoles();

    audioLanguagesAndRoles.forEach((langRole, index) => {
      const localTrack = {
        id: `shaka-audio-${index}`,
        label: langRole.label || getLangName(langRole.language) || langRole.language || '',
        language: langRole.language || '',
        kind: langRole.role || 'main',
      };

      this.#ctx.audioTracks[ListSymbol.add](localTrack, trigger);
    });
  }

  #updateTextTracks(trigger: DOMEvent) {
    if (!this.#instance) return;

    const textTracks = this.#instance.getTextTracks();

    textTracks.forEach((shakaTrack: ShakaTextTrackType, index) => {
      const track = new TextTrack({
        id: `shaka-text-${shakaTrack.id}`,
        label: shakaTrack.label || getLangName(shakaTrack.language) || shakaTrack.language || '',
        language: shakaTrack.language || '',
        kind: (shakaTrack.kind as TextTrackKind) || 'subtitles',
        default: shakaTrack.primary || false,
      });

      track[TextTrackSymbol.readyState] = 2;

      track[TextTrackSymbol.onModeChange] = () => {
        if (!this.#instance) return;
        if (track.mode === 'showing') {
          const shakaTextTracks = this.#instance.getTextTracks();
          const targetTrack = shakaTextTracks.find((t) => t.id === shakaTrack.id);
          if (targetTrack) {
            this.#instance.selectTextTrack(targetTrack);
            this.#instance.setTextTrackVisibility(true);
          }
        } else {
          this.#instance.setTextTrackVisibility(false);
        }
      };

      this.#ctx.textTracks.add(track, trigger);
    });
  }

  #onTracksChanged(event: ShakaEvent) {
    // Re-sync tracks when they change
    const trigger = this.#createDOMEvent('trackschanged', event);

    // Only update if we haven't already initialized
    if (this.#ctx.qualities.length === 0) {
      this.#updateQualityTracks(trigger);
    }
  }

  #onAdaptation(event: ShakaEvent) {
    const adaptationEvent = event as ShakaEvent & { newTrack?: ShakaVariantTrack };
    const newTrack = adaptationEvent.newTrack;
    if (!newTrack || newTrack.type !== 'variant') return;

    const quality = this.#ctx.qualities.toArray().find((q) => q.height === newTrack.height);

    if (quality) {
      const trigger = this.#createDOMEvent('adaptation', event);
      this.#ctx.qualities[ListSymbol.select](quality, true, trigger);
    }
  }

  #onError(event: ShakaEvent) {
    const errorEvent = event as ShakaEvent & { detail?: ShakaError };
    const error = errorEvent.detail;

    if (!error) return;

    if (__DEV__) {
      this.#ctx.logger
        ?.errorGroup(`[vidstack] Shaka error code: ${error.code}`)
        .labelledLog('Media Element', this.#video)
        .labelledLog('Shaka Instance', this.#instance)
        .labelledLog('Error', error)
        .labelledLog('Src', peek(this.#ctx.$state.source))
        .labelledLog('Media Store', { ...this.#ctx.$state })
        .dispatch();
    }

    this.#onFatalError(error);
  }

  #onFatalError(error: ShakaError) {
    this.#ctx.notify('error', {
      message: error.message || `Shaka error code: ${error.code}`,
      code: 1,
      error: error as any,
    });
  }

  #enableAutoQuality() {
    if (!this.#instance) return;

    // Configure ABR to be enabled
    this.#instance.configure({
      abr: {
        enabled: true,
      },
    });
  }

  #onUserQualityChange() {
    const { qualities } = this.#ctx;

    if (!this.#instance || qualities.auto || !qualities.selected) return;

    // Disable ABR when user manually selects quality
    this.#instance.configure({
      abr: {
        enabled: false,
      },
    });

    // Find the variant track that matches the selected quality
    const variantTracks = this.#instance.getVariantTracks();
    const selectedQuality = qualities.selected;
    const matchingTrack = variantTracks.find((track) => track.height === selectedQuality.height);

    if (matchingTrack) {
      this.#instance.selectVariantTrack(matchingTrack, qualities.switch === 'current');
    }

    /**
     * Chrome has some strange issue with detecting keyframes inserted before the current
     * playhead position. This can cause playback to freeze until a new keyframe. It seems
     * setting the current time forces chrome to seek back to the last keyframe and adjust
     * playback. Weird fix, but it works!
     */
    if (IS_CHROME) {
      this.#video.currentTime = this.#video.currentTime;
    }
  }

  #onUserAudioChange() {
    if (!this.#instance) return;

    const { audioTracks } = this.#ctx;
    const selectedTrack = audioTracks.selected;

    if (selectedTrack) {
      const audioLanguagesAndRoles = this.#instance.getAudioLanguagesAndRoles();
      const index = audioTracks.selectedIndex;
      if (index >= 0 && index < audioLanguagesAndRoles.length) {
        const langRole = audioLanguagesAndRoles[index];
        this.#instance.selectAudioLanguage(langRole.language, langRole.role);
      }
    }
  }

  /**
   * Register a request filter with the networking engine.
   */
  registerRequestFilter(filter: ShakaRequestFilter) {
    const networkingEngine = this.#instance?.getNetworkingEngine();
    if (networkingEngine) {
      networkingEngine.registerRequestFilter(filter);
    }
  }

  /**
   * Register a response filter with the networking engine.
   */
  registerResponseFilter(filter: ShakaResponseFilter) {
    const networkingEngine = this.#instance?.getNetworkingEngine();
    if (networkingEngine) {
      networkingEngine.registerResponseFilter(filter);
    }
  }

  onInstance(callback: ShakaInstanceCallback) {
    this.#callbacks.add(callback);
    return () => this.#callbacks.delete(callback);
  }

  #reset() {
    // Reset state when loading new source
  }

  async loadSource(src: Src) {
    this.#reset();
    if (!isString(src.src) || !this.#instance) return;

    try {
      await this.#instance.load(src.src);
    } catch (error) {
      if (__DEV__) {
        this.#ctx.logger
          ?.errorGroup('[vidstack] Shaka load error')
          .labelledLog('Error', error)
          .labelledLog('Src', src)
          .dispatch();
      }

      // Notify error to Vidstack
      this.#ctx.notify('error', {
        message: error instanceof Error ? error.message : 'Failed to load source',
        code: 1,
        error: error as any,
      });
    }
  }

  async destroy() {
    this.#reset();
    if (this.#instance) {
      await this.#instance.destroy();
      this.#instance = null;
    }
    this.#stopLiveSync?.();
    this.#stopLiveSync = null;
    if (__DEV__) this.#ctx?.logger?.info('🏗️ Destroyed Shaka instance');
  }
}
