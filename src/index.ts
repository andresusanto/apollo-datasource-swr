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

export type InflightDeduper = Record<string, Promise<any>>;

export type SWROptions = {
  /** Maximum number of seconds in which the data can live in cache, defaults to 1 hr */
  maxTTL?: number;

  /** Logger fn, defaults to silent logger */
  logger?: Logger;
};

export abstract class SWRDataSource<
  TArg extends Array<any>,
  TResult,
  TContext = any
> extends DataSource {
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

  /**
   * Revalidate the current request. This method must be implemented by the
   * child class.
   *
   * @param ctx The apollo context of the request
   * @param args Function arguments needed to perform revalidation
   */
  protected async onRevalidate(ctx: TContext, ...args: TArg): Promise<TResult> {
    throw new Error("onRevalidate: Method not implemented.");
  }

  /**
   * Perform SWR request.
   *
   * @param ctx The apollo context of the request
   * @param args Function arguments passed to the revalidation fn
   */
  protected async doSWR(...args: TArg): Promise<TResult> {
    const cacheKey = `${SWRDataSource.name}:${this.constructor.name}:${sha1(
      args
    )}`;

    this.logger.debug(`Getting stale item with cache-key ${cacheKey}`);
    const stale = await this.cache.get(cacheKey);
    if (stale !== undefined) {
      // instead of making current IO Loop process the fn,
      // we put `revalidate` into the queue instead
      setImmediate(() => this.revalidate(cacheKey, this.context, ...args));

      this.logger.debug(
        `Found stale item with cache-key ${cacheKey}! Returning Immediately.`
      );
      return JSON.parse(stale);
    }
    this.logger.debug(
      `NOT Found stale item with cache-key ${cacheKey}. Waiting for revalidation.`
    );
    const fresh = await this.revalidate(cacheKey, this.context, ...args);
    return fresh;
  }

  private async revalidate(cacheKey: string, ctx: TContext, ...args: TArg) {
    this.logger.debug(`Performing revalidation for ${cacheKey}.`);
    const inflight = SWRDataSource.inflightDeduper[cacheKey];
    if (inflight) {
      this.logger.debug(
        `Found inflight request for ${cacheKey}. Reusing the inflight instead of making a new one.`
      );
      return inflight;
    }

    this.logger.debug(
      `NOT found inflight request for ${cacheKey}. Making a new onRevalidate call.`
    );
    const promise = this.onRevalidate(ctx, ...args);
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
