import { Logger } from "apollo-server-types";
import { InMemoryLRUCache } from "apollo-server-caching";
import { SWRDataSource } from ".";

test("performing revalidation when calling doSWR", async () => {
  const onRevalidate = jest.fn().mockImplementation(async (_, a) => "foo-" + a);

  class TestClassA extends SWRDataSource<string> {
    @SWRDataSource.useSWR
    public async testMethod(a: string, b: number) {
      return onRevalidate(this.context, a, b);
    }
  }

  const testClass = new TestClassA();
  testClass.initialize({ context: "ctx", cache: new InMemoryLRUCache() });

  await expect(testClass.testMethod("a", 2)).resolves.toEqual("foo-a");
  expect(onRevalidate).toBeCalledTimes(1);
  expect(onRevalidate).toHaveBeenNthCalledWith(1, "ctx", "a", 2);

  // request using differnt key should ivoke new onRevalidate request
  await expect(testClass.testMethod("b", 2)).resolves.toEqual("foo-b");
  expect(onRevalidate).toBeCalledTimes(2);
  expect(onRevalidate).toHaveBeenNthCalledWith(2, "ctx", "b", 2);
});

test("using stale data on subsequent request with the same key", async () => {
  let requestNumber = 0;
  const onRevalidate = jest
    .fn()
    .mockImplementation(
      () =>
        new Promise((res) => setTimeout(() => res(`${requestNumber++}`), 100))
    );

  class TestClassB extends SWRDataSource<string> {
    @SWRDataSource.useSWR
    public async testMethod(a: string, b: number) {
      return onRevalidate(this.context, a, b);
    }
  }

  const testClass = new TestClassB();
  testClass.initialize({ context: "ctx", cache: new InMemoryLRUCache() });

  await expect(testClass.testMethod("a", 2)).resolves.toEqual("0");
  await expect(testClass.testMethod("a", 2)).resolves.toEqual("0");

  // We put the onRevalidate in a setImmediate so that it can wait for
  // the next tick. So, onRevalidate should not have been called yet.
  expect(onRevalidate).toBeCalledTimes(1);
  expect(onRevalidate).toBeCalledWith("ctx", "a", 2);

  // Wait for the next tick. After this tick, we should have performed
  // the second onRevalidate because it was put in the IOLoop queue before this.
  await new Promise((res) => setImmediate(res));
  expect(onRevalidate).toBeCalledTimes(2);
  expect(onRevalidate).toBeCalledWith("ctx", "a", 2);
});

test("isolating cache and inflight-deduper for different subclasses", async () => {
  const onRevalidateC = jest
    .fn()
    .mockImplementation(
      () => new Promise((res) => setTimeout(() => res("C"), 100))
    );
  const onRevalidateD_A = jest
    .fn()
    .mockImplementation(
      () => new Promise((res) => setTimeout(() => res("DA"), 100))
    );
  const onRevalidateD_B = jest
    .fn()
    .mockImplementation(
      () => new Promise((res) => setTimeout(() => res("DB"), 100))
    );

  class TestClassC extends SWRDataSource<string> {
    @SWRDataSource.useSWR
    public async testMethod(a: string, b: number) {
      return onRevalidateC(this.context, a, b);
    }
  }

  class TestClassD extends SWRDataSource<string> {
    @SWRDataSource.useSWR
    public async testMethodA(a: string, b: number) {
      return onRevalidateD_A(this.context, a, b);
    }

    @SWRDataSource.useSWR
    public async testMethodB(a: string, b: number) {
      return onRevalidateD_B(this.context, a, b);
    }
  }

  // share the same cache, it should be isolated
  const cache = new InMemoryLRUCache();
  const testClassC = new TestClassC();
  const testClassD = new TestClassD();
  testClassC.initialize({ context: "ctx", cache });
  testClassD.initialize({ context: "ctx", cache });

  await expect(testClassC.testMethod("a", 2)).resolves.toEqual("C");
  await expect(testClassD.testMethodA("a", 2)).resolves.toEqual("DA");
  await expect(testClassD.testMethodB("a", 2)).resolves.toEqual("DB");
  expect(onRevalidateC).toBeCalledTimes(1);
  expect(onRevalidateC).toBeCalledWith("ctx", "a", 2);
  expect(onRevalidateD_A).toBeCalledTimes(1);
  expect(onRevalidateD_A).toBeCalledWith("ctx", "a", 2);
  expect(onRevalidateD_B).toBeCalledTimes(1);
  expect(onRevalidateD_B).toBeCalledWith("ctx", "a", 2);

  // using stale data on subsequent request with the same key
  await expect(testClassC.testMethod("a", 2)).resolves.toEqual("C");
  await expect(testClassD.testMethodA("a", 2)).resolves.toEqual("DA");
  await expect(testClassD.testMethodB("a", 2)).resolves.toEqual("DB");
  expect(onRevalidateC).toBeCalledTimes(1);
  expect(onRevalidateC).toBeCalledWith("ctx", "a", 2);
  expect(onRevalidateD_A).toBeCalledTimes(1);
  expect(onRevalidateD_A).toBeCalledWith("ctx", "a", 2);
  expect(onRevalidateD_B).toBeCalledTimes(1);
  expect(onRevalidateD_B).toBeCalledWith("ctx", "a", 2);
});

test("should not revalidate when ttlMaxAge is provided and item is fresh", async () => {
  const onRevalidate = jest.fn().mockImplementation(async (_, a) => "foo-" + a);

  class TestClassE extends SWRDataSource<string> {
    constructor() {
      super({
        ttlMaxAge: 0.05,
        ttlSWR: 1,
      });
    }

    @SWRDataSource.useSWR
    public async testMethod(a: string, b: number) {
      return onRevalidate(this.context, a, b);
    }
  }

  const testClass = new TestClassE();
  testClass.initialize({ context: "ctx", cache: new InMemoryLRUCache() });

  await expect(testClass.testMethod("a", 2)).resolves.toEqual("foo-a");
  expect(onRevalidate).toBeCalledTimes(1);
  expect(onRevalidate).toHaveBeenNthCalledWith(1, "ctx", "a", 2);

  // item is considered fresh for 50ms
  await new Promise((res) => setTimeout(res, 10));

  await expect(testClass.testMethod("a", 2)).resolves.toEqual("foo-a");
  await new Promise((res) => setImmediate(res));

  expect(onRevalidate).toBeCalledTimes(1);
  expect(onRevalidate).toHaveBeenNthCalledWith(1, "ctx", "a", 2);
});

test("should serve stale item and revalidate when ttlMaxAge is provided and item is stale", async () => {
  let requestNumber = 0;
  const onRevalidate = jest
    .fn()
    .mockImplementation(async (_, a) => `${requestNumber++}-foo-` + a);

  class TestClassF extends SWRDataSource<string> {
    constructor() {
      super({
        ttlMaxAge: 0.05,
        ttlSWR: 1,
      });
    }

    @SWRDataSource.useSWR
    public async testMethod(a: string, b: number) {
      return onRevalidate(this.context, a, b);
    }
  }

  const testClass = new TestClassF();
  testClass.initialize({ context: "ctx", cache: new InMemoryLRUCache() });

  await expect(testClass.testMethod("a", 2)).resolves.toEqual("0-foo-a");
  expect(onRevalidate).toBeCalledTimes(1);
  expect(onRevalidate).toHaveBeenNthCalledWith(1, "ctx", "a", 2);

  // item is considered fresh for 50ms
  await new Promise((res) => setTimeout(res, 60));

  // item is now stale
  await expect(testClass.testMethod("a", 2)).resolves.toEqual("0-foo-a"); // should return stale item (0)
  await new Promise((res) => setImmediate(res));

  expect(onRevalidate).toBeCalledTimes(2);
  expect(onRevalidate).toHaveBeenNthCalledWith(1, "ctx", "a", 2);
});

test("should not serve stale item when it is older than the stale period", async () => {
  let requestNumber = 0;
  const onRevalidate = jest
    .fn()
    .mockImplementation(async (_, a) => `${requestNumber++}-foo-` + a);

  class TestClassF extends SWRDataSource<string> {
    constructor() {
      super({
        ttlMaxAge: 0.05,
        ttlSWR: 0.05,
      });
    }

    @SWRDataSource.useSWR
    public async testMethod(a: string, b: number) {
      return onRevalidate(this.context, a, b);
    }
  }

  const testClass = new TestClassF();
  testClass.initialize({ context: "ctx", cache: new InMemoryLRUCache() });

  await expect(testClass.testMethod("a", 2)).resolves.toEqual("0-foo-a");
  expect(onRevalidate).toBeCalledTimes(1);
  expect(onRevalidate).toHaveBeenNthCalledWith(1, "ctx", "a", 2);

  // 50ms + 50ms = 100ms, item shouldn't exist in cache anymore
  await new Promise((res) => setTimeout(res, 150));

  await expect(testClass.testMethod("a", 2)).resolves.toEqual("1-foo-a"); // should return fresh item (1)
  await new Promise((res) => setImmediate(res));

  expect(onRevalidate).toBeCalledTimes(2);
  expect(onRevalidate).toHaveBeenNthCalledWith(1, "ctx", "a", 2);
});

test("using object logger", async () => {
  const objLogger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const onRevalidate = jest.fn().mockImplementation(async (_, a) => "foo-" + a);

  class TestClassG extends SWRDataSource<string> {
    constructor() {
      super({
        logger: objLogger,
      });
    }

    @SWRDataSource.useSWR
    public async testMethod(a: string, b: number) {
      return onRevalidate(this.context, a, b);
    }
  }

  const testClass = new TestClassG();
  testClass.initialize({ context: "ctx", cache: new InMemoryLRUCache() });

  await expect(testClass.testMethod("a", 2)).resolves.toEqual("foo-a");
  expect(onRevalidate).toBeCalledTimes(1);
  expect(onRevalidate).toHaveBeenNthCalledWith(1, "ctx", "a", 2);

  expect(objLogger.debug).toBeCalledTimes(5);
});

test("using function logger", async () => {
  const objLogger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const onRevalidate = jest.fn().mockImplementation(async (_, a) => "foo-" + a);

  class TestClassH extends SWRDataSource<string> {
    constructor() {
      super({
        logger: () => objLogger,
      });
    }

    @SWRDataSource.useSWR
    public async testMethod(a: string, b: number) {
      return onRevalidate(this.context, a, b);
    }
  }

  const testClass = new TestClassH();
  testClass.initialize({ context: "ctx", cache: new InMemoryLRUCache() });

  await expect(testClass.testMethod("a", 2)).resolves.toEqual("foo-a");
  expect(onRevalidate).toBeCalledTimes(1);
  expect(onRevalidate).toHaveBeenNthCalledWith(1, "ctx", "a", 2);

  expect(objLogger.debug).toBeCalledTimes(5);
});
