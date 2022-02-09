import { InMemoryLRUCache } from "apollo-server-caching";
import { SWRDataSource } from ".";

test("performing revalidation when calling doSWR", async () => {
  const onRevalidate = jest.fn().mockImplementation(async (_, a) => "foo-" + a);

  class TestClassA extends SWRDataSource<[string, number], string, string> {
    protected async onRevalidate(
      ctx: any,
      a: string,
      b: number
    ): Promise<string> {
      return onRevalidate(ctx, a, b);
    }

    public async testMethod(a: string, b: number) {
      return this.doSWR(a, b);
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

  class TestClassB extends SWRDataSource<[string, number], string, string> {
    protected async onRevalidate(
      ctx: any,
      a: string,
      b: number
    ): Promise<string> {
      return onRevalidate(ctx, a, b);
    }

    public async testMethod(a: string, b: number) {
      return this.doSWR(a, b);
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
  const onRevalidateD = jest
    .fn()
    .mockImplementation(
      () => new Promise((res) => setTimeout(() => res("D"), 100))
    );

  class TestClassC extends SWRDataSource<[string, number], string, string> {
    protected async onRevalidate(
      ctx: any,
      a: string,
      b: number
    ): Promise<string> {
      return onRevalidateC(ctx, a, b);
    }

    public async testMethod(a: string, b: number) {
      return this.doSWR(a, b);
    }
  }

  class TestClassD extends SWRDataSource<[string, number], string, string> {
    protected async onRevalidate(
      ctx: any,
      a: string,
      b: number
    ): Promise<string> {
      return onRevalidateD(ctx, a, b);
    }

    public async testMethod(a: string, b: number) {
      return this.doSWR(a, b);
    }
  }

  // share the same cache, it should be isolated
  const cache = new InMemoryLRUCache();
  const testClassC = new TestClassC();
  const testClassD = new TestClassD();
  testClassC.initialize({ context: "ctx", cache });
  testClassD.initialize({ context: "ctx", cache });

  await expect(testClassC.testMethod("a", 2)).resolves.toEqual("C");
  await expect(testClassD.testMethod("a", 2)).resolves.toEqual("D");
  expect(onRevalidateC).toBeCalledTimes(1);
  expect(onRevalidateC).toBeCalledWith("ctx", "a", 2);
  expect(onRevalidateD).toBeCalledTimes(1);
  expect(onRevalidateD).toBeCalledWith("ctx", "a", 2);

  // using stale data on subsequent request with the same key
  await expect(testClassC.testMethod("a", 2)).resolves.toEqual("C");
  await expect(testClassD.testMethod("a", 2)).resolves.toEqual("D");
  expect(onRevalidateC).toBeCalledTimes(1);
  expect(onRevalidateC).toBeCalledWith("ctx", "a", 2);
  expect(onRevalidateD).toBeCalledTimes(1);
  expect(onRevalidateD).toBeCalledWith("ctx", "a", 2);
});
