export interface Descriptor {
  configurable?: boolean;
  enumerable?: boolean;
  writable?: boolean;
  get?(): any;
  set?(v: any): void;
  initializer?: () => any;
  value?: any;
}
export type LegacyDecorator = (
  target: object,
  prop: string,
  desc: Descriptor
) => Descriptor | null | undefined | void;

export type LegacyClassDecorator = (target: new (...args: any) => any) =>
  | {
      new (...args: any): any;
    }
  | null
  | undefined
  | void;

const deferred = new WeakMap();

function deferDecorator(proto: object, prop: string, desc: Descriptor): void {
  let map = deferred.get(proto);
  if (!map) {
    map = new Map();
    deferred.set(proto, map);
  }
  map.set(prop, desc);
}

function findDeferredDecorator(
  target: object,
  prop: string
): Descriptor | undefined {
  let cursor: object = (target as any).prototype;
  while (cursor) {
    let desc = deferred.get(cursor)?.get(prop);
    if (desc) {
      return desc;
    }
    cursor = (cursor as any).prototype;
  }
}

// decorateField
export function f(
  target: { prototype: object },
  prop: string,
  decorators: LegacyDecorator[],
  initializer?: () => any
): void {
  let desc: Descriptor = {
    configurable: true,
    enumerable: true,
    writable: true,
  };
  if (initializer) {
    desc.initializer = initializer;
  }
  for (let decorator of decorators) {
    desc = decorator(target.prototype, prop, desc) || desc;
  }
  if (desc.initializer === undefined) {
    Object.defineProperty(target.prototype, prop, desc);
  } else {
    deferDecorator(target.prototype, prop, desc);
  }
}

// decorateMethod
export function m(
  { prototype }: { prototype: object },
  prop: string,
  decorators: LegacyDecorator[]
): void {
  const origDesc = Object.getOwnPropertyDescriptor(prototype, prop);
  let desc: Descriptor = { ...origDesc };
  for (let decorator of decorators) {
    desc = decorator(prototype, prop, desc) || desc;
  }
  if (desc.initializer !== undefined) {
    desc.value = desc.initializer ? desc.initializer.call(prototype) : void 0;
    desc.initializer = undefined;
  }
  Object.defineProperty(prototype, prop, desc);
}

// initializeDeferredDecorator
export function i(target: object, prop: string): void {
  let desc = findDeferredDecorator(target.constructor, prop);
  if (desc) {
    Object.defineProperty(target, prop, {
      enumerable: desc.enumerable,
      configurable: desc.configurable,
      writable: desc.writable,
      value: desc.initializer ? desc.initializer.call(target) : undefined,
    });
  }
}

// decorateClass
export function c(
  target: new (...args: any) => any,
  decorators: LegacyClassDecorator[]
): new (...args: any) => any {
  return decorators.reduce(
    (accum, decorator) => decorator(accum) || accum,
    target
  );
}
