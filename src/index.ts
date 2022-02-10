import { sha1 } from "object-hash";
import { DataSource, DataSourceConfig } from "apollo-datasource";
import { KeyValueCache, InMemoryLRUCache } from "apollo-server-caching";
import { Logger } from "apollo-server-types";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

type InflightDeduper = Record<string, Promise<any>>;
type FnArg = Array<any>;
type Fn = (...args: FnArg) => Promise<any>;
type CacheItem = { exp: number; item: any };

interface SWRPropertyDescriptor extends PropertyDescriptor {
  value?: Fn;
}

export type SWROptions = {
  /** Duration of which object is considered fresh in seconds. Defaults to 0. See https://datatracker.ietf.org/doc/html/rfc5861#section-3.1 for details and example. */
  ttlMaxAge?: number;

  /** Maximum duration of which object can be served after it has become stale in seconds. Defaults to 1 hr. See https://datatracker.ietf.org/doc/html/rfc5861#section-3.1 for details and example. */
  ttlSWR?: number;

  /** Logger fn, defaults to silent logger */
  logger?: Logger | (() => Logger);
};

export abstract class SWRDataSource<TContext = any> extends DataSource {
  public context!: TContext;

  private static inflightDeduper: InflightDeduper = {};
  private cache!: KeyValueCache;
  private ttlSWR: number;
  private ttlMaxAge: number;
  private logger: () => Logger;

  constructor(opts?: SWROptions) {
    super();
    this.ttlSWR = opts?.ttlSWR ?? 3600;
    this.ttlMaxAge = opts?.ttlMaxAge ?? 0;

    const logger = opts?.logger ?? silentLogger;
    if (typeof logger === "function") {
      this.logger = logger;
    } else {
      this.logger = () => logger;
    }
  }

  /**
   * Initialize the datasource with apollo internals (context, cache).
   *
   * @param config
   */
  initialize(config: DataSourceConfig<TContext>): void {
    this.context = config.context;
    this.cache = config.cache || new InMemoryLRUCache({ maxSize: 1000 });
  }

  /**
   * Hook to be used by the class extending this class to define methods
   * using SWR.
   *
   * See README.md for more details.
   */
  protected static useSWR(
    target: SWRDataSource,
    propertyKey: string,
    d: SWRPropertyDescriptor
  ) {
    const fn = d.value;
    if (typeof fn !== "function")
      throw new Error("SWRDataSource.useSWR() requires a function");

    d.value = function _useSWR(...args: FnArg) {
      return target.doSWR.call(this, fn.bind(this), propertyKey, ...args);
    };
  }

  private async doSWR(
    fn: Fn,
    propertyKey: string,
    ...args: FnArg
  ): Promise<any> {
    const cacheKey = `${SWRDataSource.name}:${
      this.constructor.name
    }:${propertyKey}:${sha1(args)}`;

    this.logger().debug(`Getting stale item with cache-key ${cacheKey}`);
    const cached = await this.cache.get(cacheKey);
    if (cached !== undefined) {
      const item: CacheItem = JSON.parse(cached);

      if (Date.now() >= item.exp) {
        // item has become stale. need to revalidate.
        // but instead of making current IO Loop process
        // the 'revalidate' fn, we put the fn into
        // the queue, and process it after this tick
        setImmediate(() => this.revalidate(cacheKey, fn, ...args));
        this.logger().debug(
          `Found stale item with cache-key ${cacheKey}! Will perform revalidation.`
        );
      } else {
        this.logger().debug(
          `Found fresh item with cache-key ${cacheKey}! Will return without performing revalidation.`
        );
      }

      return item.item;
    }
    this.logger().debug(
      `NOT Found cached item with cache-key ${cacheKey}. Waiting for revalidation.`
    );
    const fresh = await this.revalidate(cacheKey, fn, ...args);
    return fresh;
  }

  private async revalidate(cacheKey: string, fn: Fn, ...args: FnArg) {
    this.logger().debug(`Performing revalidation for ${cacheKey}.`);
    const inflight = SWRDataSource.inflightDeduper[cacheKey];
    if (inflight) {
      this.logger().debug(
        `Found inflight request for ${cacheKey}. Reusing the inflight instead of making a new one.`
      );
      return inflight;
    }

    this.logger().debug(
      `NOT found inflight request for ${cacheKey}. Making an underlying function call.`
    );
    const promise = fn(...args);
    SWRDataSource.inflightDeduper[cacheKey] = promise;

    const result = await promise;
    const item: CacheItem = {
      exp: Date.now() + this.ttlMaxAge * 1000,
      item: result,
    };
    this.cache.set(cacheKey, JSON.stringify(item), {
      ttl: this.ttlMaxAge + this.ttlSWR,
    });
    delete SWRDataSource.inflightDeduper[cacheKey];
    this.logger().debug(
      `Revalidation for ${cacheKey} completed. Returning result.`
    );
    return result;
  }
}
