import type * as Babel from "@babel/core";
import type { types as t, NodePath } from "@babel/core";
import { createRequire } from "node:module";
import { ImportUtil } from "babel-import-util";
const req = createRequire(import.meta.url);
const { default: decoratorSyntax } = req("@babel/plugin-syntax-decorators");

interface State extends Babel.PluginPass {
  currentClassBodies: t.ClassBody[];
  opts: Options;
  runtime: (target: NodePath<t.Node>, fnName: string) => t.Identifier;
  optsWithDefaults: Required<Options>;
}

export interface Options {
  runtime?: "globals" | { import: string };
}

export default function legacyDecoratorCompat(
  babel: typeof Babel
): Babel.PluginObj<State> {
  const t = babel.types;
  return {
    inherits: (api: unknown, _options: unknown, dirname: unknown) =>
      decoratorSyntax(api, { legacy: true }, dirname),
    visitor: {
      Program(path: NodePath<t.Program>, state: State) {
        state.currentClassBodies = [];
        state.optsWithDefaults = {
          runtime: "globals",
          ...state.opts,
        };
        let importUtil = new ImportUtil(t, path);
        state.runtime = (target: NodePath<t.Node>, fnName: string) => {
          const { runtime } = state.optsWithDefaults;
          if (runtime === "globals") {
            return t.identifier(fnName);
          } else {
            return importUtil.import(target, runtime.import, fnName);
          }
        };
      },
      ClassBody: {
        enter(path, state) {
          state.currentClassBodies.unshift(path.node);
        },
        exit(_path, state) {
          state.currentClassBodies.pop();
        },
      },
      Class(path, state) {
        let decorators = path.get("decorators") as
          | NodePath<t.Decorator>[]
          | NodePath<undefined>;
        if (Array.isArray(decorators)) {
          path.get("body").pushContainer(
            "body",
            t.staticBlock([
              t.expressionStatement(
                t.callExpression(state.runtime(path, "decorateClass"), [
                  t.identifier("this"),
                  t.arrayExpression(
                    decorators
                      .slice()
                      .reverse()
                      .map((d) => d.node.expression)
                  ),
                ])
              ),
            ])
          );
          for (let decorator of decorators) {
            decorator.remove();
          }
        }
      },
      ClassProperty(path, state) {
        let decorators = path.get("decorators") as
          | NodePath<t.Decorator>[]
          | NodePath<undefined>;
        if (Array.isArray(decorators)) {
          let args: t.Expression[] = [
            t.identifier("this"),
            t.stringLiteral(propName(path.node.key)),
            t.arrayExpression(
              decorators
                .slice()
                .reverse()
                .map((d) => d.node.expression)
            ),
          ];
          if (path.node.value) {
            args.push(
              t.functionExpression(
                null,
                [],
                t.blockStatement([t.returnStatement(path.node.value)])
              )
            );
          }
          path.insertBefore(
            t.staticBlock([
              t.expressionStatement(
                t.callExpression(state.runtime(path, "decorateField"), args)
              ),
            ])
          );
          path.insertBefore(
            t.classPrivateProperty(
              t.privateName(
                t.identifier(
                  unusedPrivateNameLike(state, propName(path.node.key))
                )
              ),
              t.sequenceExpression([
                t.callExpression(state.runtime(path, "initDecorator"), [
                  t.identifier("this"),
                  t.stringLiteral(propName(path.node.key)),
                ]),
                t.identifier("void 0"),
              ])
            )
          );
          path.remove();
        }
      },
      ClassMethod(path, state) {
        let decorators = path.get("decorators") as
          | NodePath<t.Decorator>[]
          | NodePath<undefined>;
        if (Array.isArray(decorators)) {
          path.insertAfter(
            t.staticBlock([
              t.expressionStatement(
                t.callExpression(state.runtime(path, "decorateMethod"), [
                  t.identifier("this"),
                  t.stringLiteral(propName(path.node.key)),
                  t.arrayExpression(
                    decorators
                      .slice()
                      .reverse()
                      .map((d) => d.node.expression)
                  ),
                ])
              ),
            ])
          );
          for (let decorator of decorators) {
            decorator.remove();
          }
        }
      },
    },
  };
}

function unusedPrivateNameLike(state: State, name: string): string {
  let classBody = state.currentClassBodies[0];
  if (!classBody) {
    throw new Error(
      `bug: no current class body around our class field decorator`
    );
  }
  let usedNames = new Set();
  for (let element of classBody.body) {
    if (
      (element.type === "ClassPrivateProperty" ||
        element.type === "ClassPrivateMethod" ||
        element.type === "ClassAccessorProperty") &&
      element.key.type === "PrivateName"
    ) {
      usedNames.add(element.key.id.name);
    }
  }
  let candidate = name;
  while (usedNames.has("#" + candidate)) {
    candidate = candidate + "_";
  }
  return candidate;
}

function propName(expr: t.Expression): string {
  if (expr.type === "Identifier") {
    return expr.name;
  }
  throw new Error(`unexpected decorator property name ${expr.type}`);
}
