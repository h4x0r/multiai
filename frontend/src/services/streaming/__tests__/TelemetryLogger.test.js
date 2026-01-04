import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelemetryLogger } from '../TelemetryLogger';

describe('TelemetryLogger', () => {
  let mockFetch;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('uses default options when none provided', () => {
      const logger = new TelemetryLogger();

      expect(logger.endpoint).toBe('https://multiai-telemetry.vercel.app/api/telemetry');
      expect(logger.batchSize).toBe(10);
      expect(logger.flushInterval).toBe(5000);
    });

    it('accepts custom options', () => {
      const logger = new TelemetryLogger({
        endpoint: 'https://custom.endpoint/api',
        batchSize: 5,
        flushInterval: 10000,
        appVersion: '1.0.0',
      });

      expect(logger.endpoint).toBe('https://custom.endpoint/api');
      expect(logger.batchSize).toBe(5);
      expect(logger.flushInterval).toBe(10000);
      expect(logger.appVersion).toBe('1.0.0');
    });

    it('allows null endpoint for console-only mode', () => {
      const logger = new TelemetryLogger({ endpoint: null });
      expect(logger.endpoint).toBeNull();
    });
  });

  describe('log', () => {
    it('adds event to queue with timestamp', () => {
      const logger = new TelemetryLogger({ endpoint: null });
      const now = Date.now();
      vi.setSystemTime(now);

      logger.log({ type: 'test', data: 'value' });

      expect(logger.queue).toHaveLength(1);
      expect(logger.queue[0].type).toBe('test');
      expect(logger.queue[0].data).toBe('value');
      expect(logger.queue[0].timestamp).toBe(now);
    });

    it('includes appVersion and platform in each event', () => {
      const logger = new TelemetryLogger({
        endpoint: null,
        appVersion: '2.0.0',
      });

      logger.log({ type: 'test' });

      expect(logger.queue[0].appVersion).toBe('2.0.0');
      expect(logger.queue[0].platform).toBeDefined();
    });

    it('triggers flush when queue reaches batchSize', async () => {
      const logger = new TelemetryLogger({ batchSize: 3, endpoint: null });
      const flushSpy = vi.spyOn(logger, 'flush');

      logger.log({ type: 'event1' });
      logger.log({ type: 'event2' });
      expect(flushSpy).not.toHaveBeenCalled();

      logger.log({ type: 'event3' });

      expect(flushSpy).toHaveBeenCalledTimes(1);
      expect(logger.queue).toHaveLength(0);
    });
  });

  describe('logError', () => {
    it('logs with type streaming_error', () => {
      const logger = new TelemetryLogger({ endpoint: null });

      logger.logError({
        requestId: '123',
        model: 'gpt-4',
        error: { name: 'NetworkError', message: 'Failed' },
      });

      expect(logger.queue[0].type).toBe('streaming_error');
      expect(logger.queue[0].requestId).toBe('123');
      expect(logger.queue[0].model).toBe('gpt-4');
    });
  });

  describe('logSuccess', () => {
    it('logs with type streaming_success', () => {
      const logger = new TelemetryLogger({ endpoint: null });

      logger.logSuccess({
        requestId: '456',
        model: 'claude-3',
        responseTimeMs: 1500,
        ttftMs: 200,
      });

      expect(logger.queue[0].type).toBe('streaming_success');
      expect(logger.queue[0].responseTimeMs).toBe(1500);
      expect(logger.queue[0].ttftMs).toBe(200);
    });
  });

  describe('flush', () => {
    it('sends batch to endpoint', async () => {
      const logger = new TelemetryLogger({
        endpoint: 'https://test.com/api/telemetry',
      });

      logger.log({ type: 'event1' });
      logger.log({ type: 'event2' });

      await logger.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.com/api/telemetry',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.events).toHaveLength(2);
    });

    it('clears queue after successful flush', async () => {
      const logger = new TelemetryLogger();

      logger.log({ type: 'event1' });
      await logger.flush();

      expect(logger.queue).toHaveLength(0);
    });

    it('does nothing when queue is empty', async () => {
      const logger = new TelemetryLogger();
      await logger.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not send when endpoint is null', async () => {
      const logger = new TelemetryLogger({ endpoint: null });

      logger.log({ type: 'event1' });
      await logger.flush();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.queue).toHaveLength(0);
    });

    it('silently fails on network error (does not throw)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const logger = new TelemetryLogger();
      logger.log({ type: 'event1' });

      await expect(logger.flush()).resolves.not.toThrow();
    });
  });

  describe('automatic flushing', () => {
    it('flushes on interval', async () => {
      const logger = new TelemetryLogger({
        flushInterval: 5000,
      });
      const flushSpy = vi.spyOn(logger, 'flush');

      logger.log({ type: 'event1' });

      // Advance just past one interval
      vi.advanceTimersByTime(5001);

      expect(flushSpy).toHaveBeenCalled();

      // Cleanup
      logger.destroy();
    });
  });

  describe('destroy', () => {
    it('flushes remaining events and stops interval', async () => {
      const logger = new TelemetryLogger();

      logger.log({ type: 'event1' });
      await logger.destroy();

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
