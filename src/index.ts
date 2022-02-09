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

interface SWRPropertyDescriptor extends PropertyDescriptor {
  value?: Fn;
}

export type SWROptions = {
  /** Maximum number of seconds in which the data can live in cache, defaults to 1 hr */
  maxTTL?: number;

  /** Logger fn, defaults to silent logger */
  logger?: Logger;
};

export abstract class SWRDataSource<TContext = any> extends DataSource {
  public context!: TContext;

  private static inflightDeduper: InflightDeduper = {};
  private cache!: KeyValueCache;
  private maxTTL: number;
  private logger: Logger;

  constructor(opts?: SWROptions) {
    super();
    this.maxTTL = opts?.maxTTL ?? 3600;
    this.logger = opts?.logger ?? silentLogger;
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

  /**
   * Perform SWR request.
   *
   * @param ctx The apollo context of the request
   * @param args Function arguments passed to the revalidation fn
   */
  private async doSWR(
    fn: Fn,
    propertyKey: string,
    ...args: FnArg
  ): Promise<any> {
    const cacheKey = `${SWRDataSource.name}:${
      this.constructor.name
    }:${propertyKey}:${sha1(args)}`;

    this.logger.debug(`Getting stale item with cache-key ${cacheKey}`);
    const stale = await this.cache.get(cacheKey);
    if (stale !== undefined) {
      // instead of making current IO Loop process the fn,
      // we put `revalidate` into the queue instead
      setImmediate(() => this.revalidate(cacheKey, fn, ...args));

      this.logger.debug(
        `Found stale item with cache-key ${cacheKey}! Returning Immediately.`
      );
      return JSON.parse(stale);
    }
    this.logger.debug(
      `NOT Found stale item with cache-key ${cacheKey}. Waiting for revalidation.`
    );
    const fresh = await this.revalidate(cacheKey, fn, ...args);
    return fresh;
  }

  private async revalidate(cacheKey: string, fn: Fn, ...args: FnArg) {
    this.logger.debug(`Performing revalidation for ${cacheKey}.`);
    const inflight = SWRDataSource.inflightDeduper[cacheKey];
    if (inflight) {
      this.logger.debug(
        `Found inflight request for ${cacheKey}. Reusing the inflight instead of making a new one.`
      );
      return inflight;
    }

    this.logger.debug(
      `NOT found inflight request for ${cacheKey}. Making an underlying function call.`
    );
    const promise = fn(...args);
    SWRDataSource.inflightDeduper[cacheKey] = promise;

    const result = await promise;
    this.cache.set(cacheKey, JSON.stringify(result), { ttl: this.maxTTL });
    delete SWRDataSource.inflightDeduper[cacheKey];
    this.logger.debug(
      `Revalidation for ${cacheKey} completed. Returning result.`
    );
    return result;
  }
}
