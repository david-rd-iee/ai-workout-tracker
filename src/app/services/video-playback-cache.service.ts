import { Injectable } from '@angular/core';

type CachedVideoEntry = {
  sourceUrl: string;
  playbackUrl: string;
  sizeBytes: number;
  lastAccessedAt: number;
};

type PrefetchVideoOptions = {
  force?: boolean;
  maxEntryBytes?: number;
  timeoutMs?: number;
};

@Injectable({ providedIn: 'root' })
export class VideoPlaybackCacheService {
  private readonly cacheBySourceUrl = new Map<string, CachedVideoEntry>();
  private readonly inFlightBySourceUrl = new Map<string, Promise<string>>();

  private readonly maxEntries = 8;
  private readonly maxTotalBytes = 320 * 1024 * 1024;
  private readonly maxEntryBytes = 95 * 1024 * 1024;
  private readonly backgroundFetchTimeoutMs = 10_000;
  private readonly forcedFetchTimeoutMs = 30_000;

  private readonly userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  private readonly isIPhoneDevice = /iPhone/i.test(this.userAgent);
  private readonly isIPadDevice =
    /iPad/i.test(this.userAgent) ||
    (/Macintosh/i.test(this.userAgent) &&
      typeof navigator !== 'undefined' &&
      Number(navigator.maxTouchPoints || 0) > 1);
  private readonly backgroundPrefetchEnabled = !(this.isIPhoneDevice || this.isIPadDevice);

  private totalCachedBytes = 0;

  shouldPrefetchInBackground(): boolean {
    return this.backgroundPrefetchEnabled;
  }

  resolvePlaybackUrl(sourceUrl: string): string {
    const normalizedUrl = this.normalizeUrl(sourceUrl);
    if (!normalizedUrl) {
      return '';
    }

    const cachedEntry = this.cacheBySourceUrl.get(normalizedUrl);
    if (!cachedEntry) {
      return normalizedUrl;
    }

    cachedEntry.lastAccessedAt = Date.now();
    return cachedEntry.playbackUrl;
  }

  isCachedUrl(sourceUrl: string): boolean {
    const normalizedUrl = this.normalizeUrl(sourceUrl);
    if (!normalizedUrl) {
      return false;
    }

    return this.cacheBySourceUrl.has(normalizedUrl);
  }

  async prefetchUrl(sourceUrl: string, options: PrefetchVideoOptions = {}): Promise<string> {
    const force = options.force === true;
    const normalizedUrl = this.normalizeUrl(sourceUrl);
    if (!normalizedUrl || this.isLocalPlaybackUrl(normalizedUrl)) {
      return normalizedUrl;
    }

    if (!force && !this.backgroundPrefetchEnabled) {
      return normalizedUrl;
    }

    const cachedEntry = this.cacheBySourceUrl.get(normalizedUrl);
    if (cachedEntry) {
      cachedEntry.lastAccessedAt = Date.now();
      return cachedEntry.playbackUrl;
    }

    const inFlight = this.inFlightBySourceUrl.get(normalizedUrl);
    if (inFlight) {
      return inFlight;
    }

    const maxEntryBytes = Math.max(1, Number(options.maxEntryBytes ?? this.maxEntryBytes));
    const timeoutMs = Math.max(
      1_000,
      Number(options.timeoutMs ?? (force ? this.forcedFetchTimeoutMs : this.backgroundFetchTimeoutMs))
    );

    const loadPromise = this.fetchAndCacheVideo(normalizedUrl, { maxEntryBytes, timeoutMs })
      .catch(() => normalizedUrl)
      .finally(() => {
        this.inFlightBySourceUrl.delete(normalizedUrl);
      });

    this.inFlightBySourceUrl.set(normalizedUrl, loadPromise);
    return loadPromise;
  }

  prefetchUrls(sourceUrls: string[], maxUrls = 6): void {
    if (!this.backgroundPrefetchEnabled) {
      return;
    }

    const uniqueUrls = Array.from(
      new Set(
        sourceUrls
          .map((url) => this.normalizeUrl(url))
          .filter((url): url is string => !!url)
      )
    ).slice(0, maxUrls);

    if (!uniqueUrls.length) {
      return;
    }

    void (async () => {
      for (const url of uniqueUrls) {
        await this.prefetchUrl(url);
      }
    })();
  }

  private async fetchAndCacheVideo(
    sourceUrl: string,
    options: { maxEntryBytes: number; timeoutMs: number }
  ): Promise<string> {
    const response = await this.fetchWithTimeout(sourceUrl, options.timeoutMs);
    if (!response.ok) {
      throw new Error(`Video prefetch failed with status ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob.size || blob.size > options.maxEntryBytes) {
      return sourceUrl;
    }

    const playbackUrl = URL.createObjectURL(blob);
    this.storeEntry({
      sourceUrl,
      playbackUrl,
      sizeBytes: blob.size,
      lastAccessedAt: Date.now(),
    });

    return playbackUrl;
  }

  private async fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    if (typeof AbortController === 'undefined') {
      return fetch(url);
    }

    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timerId);
    }
  }

  private storeEntry(entry: CachedVideoEntry): void {
    const existing = this.cacheBySourceUrl.get(entry.sourceUrl);
    if (existing) {
      this.totalCachedBytes = Math.max(0, this.totalCachedBytes - existing.sizeBytes);
      URL.revokeObjectURL(existing.playbackUrl);
    }

    this.cacheBySourceUrl.set(entry.sourceUrl, entry);
    this.totalCachedBytes += entry.sizeBytes;
    this.trimCacheIfNeeded();
  }

  private trimCacheIfNeeded(): void {
    while (
      this.cacheBySourceUrl.size > this.maxEntries ||
      this.totalCachedBytes > this.maxTotalBytes
    ) {
      const leastRecentlyUsed = Array.from(this.cacheBySourceUrl.values())
        .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)[0];

      if (!leastRecentlyUsed) {
        return;
      }

      this.cacheBySourceUrl.delete(leastRecentlyUsed.sourceUrl);
      this.totalCachedBytes = Math.max(0, this.totalCachedBytes - leastRecentlyUsed.sizeBytes);
      URL.revokeObjectURL(leastRecentlyUsed.playbackUrl);
    }
  }

  private normalizeUrl(value: string): string {
    return String(value || '').trim();
  }

  private isLocalPlaybackUrl(url: string): boolean {
    return url.startsWith('blob:') || url.startsWith('data:');
  }
}
