import type { DOMEvent } from 'maverick.js/std';

import type { MediaPlayer } from '../../components/player';
import type {
  ShakaAdaptationEvent as ShakaAdaptationEventType,
  ShakaBufferingEvent as ShakaBufferingEventType,
  ShakaConstructor,
  ShakaError,
  ShakaLoadedEvent as ShakaLoadedEventType,
  ShakaPlayer,
  ShakaTextChangedEvent as ShakaTextChangedEventType,
  ShakaTextTrackVisibilityEvent as ShakaTextTrackVisibilityEventType,
  ShakaTracksChangedEvent as ShakaTracksChangedEventType,
  ShakaUnloadingEvent as ShakaUnloadingEventType,
  ShakaVariantChangedEvent as ShakaVariantChangedEventType,
} from './types';

export interface ShakaProviderEvents {
  'shaka-lib-load-start': ShakaLibLoadStartEvent;
  'shaka-lib-loaded': ShakaLibLoadedEvent;
  'shaka-lib-load-error': ShakaLibLoadErrorEvent;
  'shaka-instance': ShakaInstanceEvent;
  'shaka-unsupported': ShakaUnsupportedEvent;
  // re-dispatched Shaka events below
  'shaka-error': ShakaPlayerErrorEvent;
  'shaka-buffering': ShakaPlayerBufferingEvent;
  'shaka-loading': ShakaLoadingEvent;
  'shaka-loaded': ShakaPlayerLoadedEvent;
  'shaka-unloading': ShakaPlayerUnloadingEvent;
  'shaka-adaptation': ShakaPlayerAdaptationEvent;
  'shaka-tracks-changed': ShakaPlayerTracksChangedEvent;
  'shaka-variant-changed': ShakaPlayerVariantChangedEvent;
  'shaka-text-changed': ShakaPlayerTextChangedEvent;
  'shaka-text-track-visibility': ShakaPlayerTextTrackVisibilityEvent;
  'shaka-streaming': ShakaStreamingEvent;
  'shaka-manifest-parsed': ShakaManifestParsedEvent;
}

export interface ShakaMediaEvent<DetailType = unknown> extends DOMEvent<DetailType> {
  target: MediaPlayer;
}

/**
 * Fired when the browser begins downloading the Shaka Player library.
 */
export interface ShakaLibLoadStartEvent extends ShakaMediaEvent<void> {}

/**
 * Fired when the Shaka Player library has been loaded.
 *
 * @detail constructor
 */
export interface ShakaLibLoadedEvent extends ShakaMediaEvent<ShakaConstructor> {}

/**
 * Fired when the Shaka Player library fails during the download process.
 *
 * @detail error
 */
export interface ShakaLibLoadErrorEvent extends ShakaMediaEvent<Error> {}

/**
 * Fired when the Shaka Player instance is built. This will not fire if the browser does not
 * support Shaka Player.
 *
 * @detail instance
 */
export interface ShakaInstanceEvent extends ShakaMediaEvent<ShakaPlayer> {}

/**
 * Fired when the browser doesn't support Shaka Player natively, most likely due to
 * missing Media Source Extensions or video codecs.
 */
export interface ShakaUnsupportedEvent extends ShakaMediaEvent<void> {}

/**
 * Fired when an error has occurred in Shaka Player.
 *
 * @detail error
 */
export interface ShakaPlayerErrorEvent extends ShakaMediaEvent<ShakaError> {}

/**
 * Fired when Shaka Player's buffering state changes.
 *
 * @detail data
 */
export interface ShakaPlayerBufferingEvent extends ShakaMediaEvent<ShakaBufferingEventType> {}

/**
 * Fired when Shaka Player starts loading a manifest.
 */
export interface ShakaLoadingEvent extends ShakaMediaEvent<void> {}

/**
 * Fired when Shaka Player has finished loading a manifest.
 *
 * @detail data
 */
export interface ShakaPlayerLoadedEvent extends ShakaMediaEvent<ShakaLoadedEventType> {}

/**
 * Fired when Shaka Player starts unloading content.
 *
 * @detail data
 */
export interface ShakaPlayerUnloadingEvent extends ShakaMediaEvent<ShakaUnloadingEventType> {}

/**
 * Fired when Shaka Player adapts to a different variant (bitrate/quality).
 *
 * @detail data
 */
export interface ShakaPlayerAdaptationEvent extends ShakaMediaEvent<ShakaAdaptationEventType> {}

/**
 * Fired when Shaka Player's available tracks change.
 *
 * @detail data
 */
export interface ShakaPlayerTracksChangedEvent extends ShakaMediaEvent<ShakaTracksChangedEventType> {}

/**
 * Fired when Shaka Player's active variant changes.
 *
 * @detail data
 */
export interface ShakaPlayerVariantChangedEvent extends ShakaMediaEvent<ShakaVariantChangedEventType> {}

/**
 * Fired when Shaka Player's active text track changes.
 *
 * @detail data
 */
export interface ShakaPlayerTextChangedEvent extends ShakaMediaEvent<ShakaTextChangedEventType> {}

/**
 * Fired when Shaka Player's text track visibility changes.
 *
 * @detail data
 */
export interface ShakaPlayerTextTrackVisibilityEvent extends ShakaMediaEvent<ShakaTextTrackVisibilityEventType> {}

/**
 * Fired when streaming begins in Shaka Player.
 */
export interface ShakaStreamingEvent extends ShakaMediaEvent<void> {}

/**
 * Fired when the manifest has been parsed by Shaka Player.
 */
export interface ShakaManifestParsedEvent extends ShakaMediaEvent<void> {}
