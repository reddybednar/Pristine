(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = global || self, global.Pristine = factory());
}(this, (function () { 'use strict';

  /**
   * Copyright (c) 2014-present, Facebook, Inc.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   */

  var runtime = (function (exports) {

    var Op = Object.prototype;
    var hasOwn = Op.hasOwnProperty;
    var undefined$1; // More compressible than void 0.
    var $Symbol = typeof Symbol === "function" ? Symbol : {};
    var iteratorSymbol = $Symbol.iterator || "@@iterator";
    var asyncIteratorSymbol = $Symbol.asyncIterator || "@@asyncIterator";
    var toStringTagSymbol = $Symbol.toStringTag || "@@toStringTag";

    function wrap(innerFn, outerFn, self, tryLocsList) {
      // If outerFn provided and outerFn.prototype is a Generator, then outerFn.prototype instanceof Generator.
      var protoGenerator = outerFn && outerFn.prototype instanceof Generator ? outerFn : Generator;
      var generator = Object.create(protoGenerator.prototype);
      var context = new Context(tryLocsList || []);

      // The ._invoke method unifies the implementations of the .next,
      // .throw, and .return methods.
      generator._invoke = makeInvokeMethod(innerFn, self, context);

      return generator;
    }
    exports.wrap = wrap;

    // Try/catch helper to minimize deoptimizations. Returns a completion
    // record like context.tryEntries[i].completion. This interface could
    // have been (and was previously) designed to take a closure to be
    // invoked without arguments, but in all the cases we care about we
    // already have an existing method we want to call, so there's no need
    // to create a new function object. We can even get away with assuming
    // the method takes exactly one argument, since that happens to be true
    // in every case, so we don't have to touch the arguments object. The
    // only additional allocation required is the completion record, which
    // has a stable shape and so hopefully should be cheap to allocate.
    function tryCatch(fn, obj, arg) {
      try {
        return { type: "normal", arg: fn.call(obj, arg) };
      } catch (err) {
        return { type: "throw", arg: err };
      }
    }

    var GenStateSuspendedStart = "suspendedStart";
    var GenStateSuspendedYield = "suspendedYield";
    var GenStateExecuting = "executing";
    var GenStateCompleted = "completed";

    // Returning this object from the innerFn has the same effect as
    // breaking out of the dispatch switch statement.
    var ContinueSentinel = {};

    // Dummy constructor functions that we use as the .constructor and
    // .constructor.prototype properties for functions that return Generator
    // objects. For full spec compliance, you may wish to configure your
    // minifier not to mangle the names of these two functions.
    function Generator() {}
    function GeneratorFunction() {}
    function GeneratorFunctionPrototype() {}

    // This is a polyfill for %IteratorPrototype% for environments that
    // don't natively support it.
    var IteratorPrototype = {};
    IteratorPrototype[iteratorSymbol] = function () {
      return this;
    };

    var getProto = Object.getPrototypeOf;
    var NativeIteratorPrototype = getProto && getProto(getProto(values([])));
    if (NativeIteratorPrototype &&
        NativeIteratorPrototype !== Op &&
        hasOwn.call(NativeIteratorPrototype, iteratorSymbol)) {
      // This environment has a native %IteratorPrototype%; use it instead
      // of the polyfill.
      IteratorPrototype = NativeIteratorPrototype;
    }

    var Gp = GeneratorFunctionPrototype.prototype =
      Generator.prototype = Object.create(IteratorPrototype);
    GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
    GeneratorFunctionPrototype.constructor = GeneratorFunction;
    GeneratorFunctionPrototype[toStringTagSymbol] =
      GeneratorFunction.displayName = "GeneratorFunction";

    // Helper for defining the .next, .throw, and .return methods of the
    // Iterator interface in terms of a single ._invoke method.
    function defineIteratorMethods(prototype) {
      ["next", "throw", "return"].forEach(function(method) {
        prototype[method] = function(arg) {
          return this._invoke(method, arg);
        };
      });
    }

    exports.isGeneratorFunction = function(genFun) {
      var ctor = typeof genFun === "function" && genFun.constructor;
      return ctor
        ? ctor === GeneratorFunction ||
          // For the native GeneratorFunction constructor, the best we can
          // do is to check its .name property.
          (ctor.displayName || ctor.name) === "GeneratorFunction"
        : false;
    };

    exports.mark = function(genFun) {
      if (Object.setPrototypeOf) {
        Object.setPrototypeOf(genFun, GeneratorFunctionPrototype);
      } else {
        genFun.__proto__ = GeneratorFunctionPrototype;
        if (!(toStringTagSymbol in genFun)) {
          genFun[toStringTagSymbol] = "GeneratorFunction";
        }
      }
      genFun.prototype = Object.create(Gp);
      return genFun;
    };

    // Within the body of any async function, `await x` is transformed to
    // `yield regeneratorRuntime.awrap(x)`, so that the runtime can test
    // `hasOwn.call(value, "__await")` to determine if the yielded value is
    // meant to be awaited.
    exports.awrap = function(arg) {
      return { __await: arg };
    };

    function AsyncIterator(generator, PromiseImpl) {
      function invoke(method, arg, resolve, reject) {
        var record = tryCatch(generator[method], generator, arg);
        if (record.type === "throw") {
          reject(record.arg);
        } else {
          var result = record.arg;
          var value = result.value;
          if (value &&
              typeof value === "object" &&
              hasOwn.call(value, "__await")) {
            return PromiseImpl.resolve(value.__await).then(function(value) {
              invoke("next", value, resolve, reject);
            }, function(err) {
              invoke("throw", err, resolve, reject);
            });
          }

          return PromiseImpl.resolve(value).then(function(unwrapped) {
            // When a yielded Promise is resolved, its final value becomes
            // the .value of the Promise<{value,done}> result for the
            // current iteration.
            result.value = unwrapped;
            resolve(result);
          }, function(error) {
            // If a rejected Promise was yielded, throw the rejection back
            // into the async generator function so it can be handled there.
            return invoke("throw", error, resolve, reject);
          });
        }
      }

      var previousPromise;

      function enqueue(method, arg) {
        function callInvokeWithMethodAndArg() {
          return new PromiseImpl(function(resolve, reject) {
            invoke(method, arg, resolve, reject);
          });
        }

        return previousPromise =
          // If enqueue has been called before, then we want to wait until
          // all previous Promises have been resolved before calling invoke,
          // so that results are always delivered in the correct order. If
          // enqueue has not been called before, then it is important to
          // call invoke immediately, without waiting on a callback to fire,
          // so that the async generator function has the opportunity to do
          // any necessary setup in a predictable way. This predictability
          // is why the Promise constructor synchronously invokes its
          // executor callback, and why async functions synchronously
          // execute code before the first await. Since we implement simple
          // async functions in terms of async generators, it is especially
          // important to get this right, even though it requires care.
          previousPromise ? previousPromise.then(
            callInvokeWithMethodAndArg,
            // Avoid propagating failures to Promises returned by later
            // invocations of the iterator.
            callInvokeWithMethodAndArg
          ) : callInvokeWithMethodAndArg();
      }

      // Define the unified helper method that is used to implement .next,
      // .throw, and .return (see defineIteratorMethods).
      this._invoke = enqueue;
    }

    defineIteratorMethods(AsyncIterator.prototype);
    AsyncIterator.prototype[asyncIteratorSymbol] = function () {
      return this;
    };
    exports.AsyncIterator = AsyncIterator;

    // Note that simple async functions are implemented on top of
    // AsyncIterator objects; they just return a Promise for the value of
    // the final result produced by the iterator.
    exports.async = function(innerFn, outerFn, self, tryLocsList, PromiseImpl) {
      if (PromiseImpl === void 0) PromiseImpl = Promise;

      var iter = new AsyncIterator(
        wrap(innerFn, outerFn, self, tryLocsList),
        PromiseImpl
      );

      return exports.isGeneratorFunction(outerFn)
        ? iter // If outerFn is a generator, return the full iterator.
        : iter.next().then(function(result) {
            return result.done ? result.value : iter.next();
          });
    };

    function makeInvokeMethod(innerFn, self, context) {
      var state = GenStateSuspendedStart;

      return function invoke(method, arg) {
        if (state === GenStateExecuting) {
          throw new Error("Generator is already running");
        }

        if (state === GenStateCompleted) {
          if (method === "throw") {
            throw arg;
          }

          // Be forgiving, per 25.3.3.3.3 of the spec:
          // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorresume
          return doneResult();
        }

        context.method = method;
        context.arg = arg;

        while (true) {
          var delegate = context.delegate;
          if (delegate) {
            var delegateResult = maybeInvokeDelegate(delegate, context);
            if (delegateResult) {
              if (delegateResult === ContinueSentinel) continue;
              return delegateResult;
            }
          }

          if (context.method === "next") {
            // Setting context._sent for legacy support of Babel's
            // function.sent implementation.
            context.sent = context._sent = context.arg;

          } else if (context.method === "throw") {
            if (state === GenStateSuspendedStart) {
              state = GenStateCompleted;
              throw context.arg;
            }

            context.dispatchException(context.arg);

          } else if (context.method === "return") {
            context.abrupt("return", context.arg);
          }

          state = GenStateExecuting;

          var record = tryCatch(innerFn, self, context);
          if (record.type === "normal") {
            // If an exception is thrown from innerFn, we leave state ===
            // GenStateExecuting and loop back for another invocation.
            state = context.done
              ? GenStateCompleted
              : GenStateSuspendedYield;

            if (record.arg === ContinueSentinel) {
              continue;
            }

            return {
              value: record.arg,
              done: context.done
            };

          } else if (record.type === "throw") {
            state = GenStateCompleted;
            // Dispatch the exception by looping back around to the
            // context.dispatchException(context.arg) call above.
            context.method = "throw";
            context.arg = record.arg;
          }
        }
      };
    }

    // Call delegate.iterator[context.method](context.arg) and handle the
    // result, either by returning a { value, done } result from the
    // delegate iterator, or by modifying context.method and context.arg,
    // setting context.delegate to null, and returning the ContinueSentinel.
    function maybeInvokeDelegate(delegate, context) {
      var method = delegate.iterator[context.method];
      if (method === undefined$1) {
        // A .throw or .return when the delegate iterator has no .throw
        // method always terminates the yield* loop.
        context.delegate = null;

        if (context.method === "throw") {
          // Note: ["return"] must be used for ES3 parsing compatibility.
          if (delegate.iterator["return"]) {
            // If the delegate iterator has a return method, give it a
            // chance to clean up.
            context.method = "return";
            context.arg = undefined$1;
            maybeInvokeDelegate(delegate, context);

            if (context.method === "throw") {
              // If maybeInvokeDelegate(context) changed context.method from
              // "return" to "throw", let that override the TypeError below.
              return ContinueSentinel;
            }
          }

          context.method = "throw";
          context.arg = new TypeError(
            "The iterator does not provide a 'throw' method");
        }

        return ContinueSentinel;
      }

      var record = tryCatch(method, delegate.iterator, context.arg);

      if (record.type === "throw") {
        context.method = "throw";
        context.arg = record.arg;
        context.delegate = null;
        return ContinueSentinel;
      }

      var info = record.arg;

      if (! info) {
        context.method = "throw";
        context.arg = new TypeError("iterator result is not an object");
        context.delegate = null;
        return ContinueSentinel;
      }

      if (info.done) {
        // Assign the result of the finished delegate to the temporary
        // variable specified by delegate.resultName (see delegateYield).
        context[delegate.resultName] = info.value;

        // Resume execution at the desired location (see delegateYield).
        context.next = delegate.nextLoc;

        // If context.method was "throw" but the delegate handled the
        // exception, let the outer generator proceed normally. If
        // context.method was "next", forget context.arg since it has been
        // "consumed" by the delegate iterator. If context.method was
        // "return", allow the original .return call to continue in the
        // outer generator.
        if (context.method !== "return") {
          context.method = "next";
          context.arg = undefined$1;
        }

      } else {
        // Re-yield the result returned by the delegate method.
        return info;
      }

      // The delegate iterator is finished, so forget it and continue with
      // the outer generator.
      context.delegate = null;
      return ContinueSentinel;
    }

    // Define Generator.prototype.{next,throw,return} in terms of the
    // unified ._invoke helper method.
    defineIteratorMethods(Gp);

    Gp[toStringTagSymbol] = "Generator";

    // A Generator should always return itself as the iterator object when the
    // @@iterator function is called on it. Some browsers' implementations of the
    // iterator prototype chain incorrectly implement this, causing the Generator
    // object to not be returned from this call. This ensures that doesn't happen.
    // See https://github.com/facebook/regenerator/issues/274 for more details.
    Gp[iteratorSymbol] = function() {
      return this;
    };

    Gp.toString = function() {
      return "[object Generator]";
    };

    function pushTryEntry(locs) {
      var entry = { tryLoc: locs[0] };

      if (1 in locs) {
        entry.catchLoc = locs[1];
      }

      if (2 in locs) {
        entry.finallyLoc = locs[2];
        entry.afterLoc = locs[3];
      }

      this.tryEntries.push(entry);
    }

    function resetTryEntry(entry) {
      var record = entry.completion || {};
      record.type = "normal";
      delete record.arg;
      entry.completion = record;
    }

    function Context(tryLocsList) {
      // The root entry object (effectively a try statement without a catch
      // or a finally block) gives us a place to store values thrown from
      // locations where there is no enclosing try statement.
      this.tryEntries = [{ tryLoc: "root" }];
      tryLocsList.forEach(pushTryEntry, this);
      this.reset(true);
    }

    exports.keys = function(object) {
      var keys = [];
      for (var key in object) {
        keys.push(key);
      }
      keys.reverse();

      // Rather than returning an object with a next method, we keep
      // things simple and return the next function itself.
      return function next() {
        while (keys.length) {
          var key = keys.pop();
          if (key in object) {
            next.value = key;
            next.done = false;
            return next;
          }
        }

        // To avoid creating an additional object, we just hang the .value
        // and .done properties off the next function object itself. This
        // also ensures that the minifier will not anonymize the function.
        next.done = true;
        return next;
      };
    };

    function values(iterable) {
      if (iterable) {
        var iteratorMethod = iterable[iteratorSymbol];
        if (iteratorMethod) {
          return iteratorMethod.call(iterable);
        }

        if (typeof iterable.next === "function") {
          return iterable;
        }

        if (!isNaN(iterable.length)) {
          var i = -1, next = function next() {
            while (++i < iterable.length) {
              if (hasOwn.call(iterable, i)) {
                next.value = iterable[i];
                next.done = false;
                return next;
              }
            }

            next.value = undefined$1;
            next.done = true;

            return next;
          };

          return next.next = next;
        }
      }

      // Return an iterator with no values.
      return { next: doneResult };
    }
    exports.values = values;

    function doneResult() {
      return { value: undefined$1, done: true };
    }

    Context.prototype = {
      constructor: Context,

      reset: function(skipTempReset) {
        this.prev = 0;
        this.next = 0;
        // Resetting context._sent for legacy support of Babel's
        // function.sent implementation.
        this.sent = this._sent = undefined$1;
        this.done = false;
        this.delegate = null;

        this.method = "next";
        this.arg = undefined$1;

        this.tryEntries.forEach(resetTryEntry);

        if (!skipTempReset) {
          for (var name in this) {
            // Not sure about the optimal order of these conditions:
            if (name.charAt(0) === "t" &&
                hasOwn.call(this, name) &&
                !isNaN(+name.slice(1))) {
              this[name] = undefined$1;
            }
          }
        }
      },

      stop: function() {
        this.done = true;

        var rootEntry = this.tryEntries[0];
        var rootRecord = rootEntry.completion;
        if (rootRecord.type === "throw") {
          throw rootRecord.arg;
        }

        return this.rval;
      },

      dispatchException: function(exception) {
        if (this.done) {
          throw exception;
        }

        var context = this;
        function handle(loc, caught) {
          record.type = "throw";
          record.arg = exception;
          context.next = loc;

          if (caught) {
            // If the dispatched exception was caught by a catch block,
            // then let that catch block handle the exception normally.
            context.method = "next";
            context.arg = undefined$1;
          }

          return !! caught;
        }

        for (var i = this.tryEntries.length - 1; i >= 0; --i) {
          var entry = this.tryEntries[i];
          var record = entry.completion;

          if (entry.tryLoc === "root") {
            // Exception thrown outside of any try block that could handle
            // it, so set the completion value of the entire function to
            // throw the exception.
            return handle("end");
          }

          if (entry.tryLoc <= this.prev) {
            var hasCatch = hasOwn.call(entry, "catchLoc");
            var hasFinally = hasOwn.call(entry, "finallyLoc");

            if (hasCatch && hasFinally) {
              if (this.prev < entry.catchLoc) {
                return handle(entry.catchLoc, true);
              } else if (this.prev < entry.finallyLoc) {
                return handle(entry.finallyLoc);
              }

            } else if (hasCatch) {
              if (this.prev < entry.catchLoc) {
                return handle(entry.catchLoc, true);
              }

            } else if (hasFinally) {
              if (this.prev < entry.finallyLoc) {
                return handle(entry.finallyLoc);
              }

            } else {
              throw new Error("try statement without catch or finally");
            }
          }
        }
      },

      abrupt: function(type, arg) {
        for (var i = this.tryEntries.length - 1; i >= 0; --i) {
          var entry = this.tryEntries[i];
          if (entry.tryLoc <= this.prev &&
              hasOwn.call(entry, "finallyLoc") &&
              this.prev < entry.finallyLoc) {
            var finallyEntry = entry;
            break;
          }
        }

        if (finallyEntry &&
            (type === "break" ||
             type === "continue") &&
            finallyEntry.tryLoc <= arg &&
            arg <= finallyEntry.finallyLoc) {
          // Ignore the finally entry if control is not jumping to a
          // location outside the try/catch block.
          finallyEntry = null;
        }

        var record = finallyEntry ? finallyEntry.completion : {};
        record.type = type;
        record.arg = arg;

        if (finallyEntry) {
          this.method = "next";
          this.next = finallyEntry.finallyLoc;
          return ContinueSentinel;
        }

        return this.complete(record);
      },

      complete: function(record, afterLoc) {
        if (record.type === "throw") {
          throw record.arg;
        }

        if (record.type === "break" ||
            record.type === "continue") {
          this.next = record.arg;
        } else if (record.type === "return") {
          this.rval = this.arg = record.arg;
          this.method = "return";
          this.next = "end";
        } else if (record.type === "normal" && afterLoc) {
          this.next = afterLoc;
        }

        return ContinueSentinel;
      },

      finish: function(finallyLoc) {
        for (var i = this.tryEntries.length - 1; i >= 0; --i) {
          var entry = this.tryEntries[i];
          if (entry.finallyLoc === finallyLoc) {
            this.complete(entry.completion, entry.afterLoc);
            resetTryEntry(entry);
            return ContinueSentinel;
          }
        }
      },

      "catch": function(tryLoc) {
        for (var i = this.tryEntries.length - 1; i >= 0; --i) {
          var entry = this.tryEntries[i];
          if (entry.tryLoc === tryLoc) {
            var record = entry.completion;
            if (record.type === "throw") {
              var thrown = record.arg;
              resetTryEntry(entry);
            }
            return thrown;
          }
        }

        // The context.catch method must only be called with a location
        // argument that corresponds to a known catch block.
        throw new Error("illegal catch attempt");
      },

      delegateYield: function(iterable, resultName, nextLoc) {
        this.delegate = {
          iterator: values(iterable),
          resultName: resultName,
          nextLoc: nextLoc
        };

        if (this.method === "next") {
          // Deliberately forget the last sent value so that we don't
          // accidentally pass it on to the delegate.
          this.arg = undefined$1;
        }

        return ContinueSentinel;
      }
    };

    // Regardless of whether this script is executing as a CommonJS module
    // or not, return the runtime object so that we can declare the variable
    // regeneratorRuntime in the outer scope, which allows this module to be
    // injected easily by `bin/regenerator --include-runtime script.js`.
    return exports;

  }(
    // If this script is executing as a CommonJS module, use module.exports
    // as the regeneratorRuntime namespace. Otherwise create a new empty
    // object. Either way, the resulting object will be used to initialize
    // the regeneratorRuntime variable at the top of this file.
    typeof module === "object" ? module.exports : {}
  ));

  try {
    regeneratorRuntime = runtime;
  } catch (accidentalStrictMode) {
    // This module should not be running in strict mode, so the above
    // assignment should always work unless something is misconfigured. Just
    // in case runtime.js accidentally runs in strict mode, we can escape
    // strict mode using a global Function call. This could conceivably fail
    // if a Content Security Policy forbids using Function, but in that case
    // the proper solution is to fix the accidental strict mode problem. If
    // you've misconfigured your bundler to force strict mode and applied a
    // CSP to forbid Function, and you're not willing to fix either of those
    // problems, please detail your unique predicament in a GitHub issue.
    Function("r", "regeneratorRuntime = r")(runtime);
  }

  var lang = {
      required: "This field is required",
      email: "This field requires a valid e-mail address",
      number: "This field requires a number",
      url: "This field requires a valid website URL",
      tel: "This field requires a valid telephone number",
      maxlength: "This fields length must be < ${1}",
      minlength: "This fields length must be > ${1}",
      min: "Minimum value for this field is ${1}",
      max: "Maximum value for this field is ${1}",
      pattern: "Please match the requested format"
  };

  function findAncestor(el, cls) {
      while ((el = el.parentElement) && !el.classList.contains(cls)) {}
      return el;
  }

  function findAncestorByAttr(el, attr) {
      while ((el = el.parentElement) && !el.hasAttribute(attr)) {}
      return el;
  }

  function tmpl(o) {
      var _arguments = arguments;

      return this.replace(/\${([^{}]*)}/g, function (a, b) {
          return _arguments[b];
      });
  }

  function groupedElemCount(input) {
      return input.pristine.self.form.querySelectorAll('input[name="' + input.getAttribute('name') + '"]:checked').length;
  }

  function mergeConfig(obj1, obj2) {
      for (var attr in obj2) {
          if (!(attr in obj1)) {
              obj1[attr] = obj2[attr];
          }
      }
      return obj1;
  }

  function isFunction(obj) {
      return !!(obj && obj.constructor && obj.call && obj.apply);
  }

  var asyncToGenerator = function (fn) {
    return function () {
      var gen = fn.apply(this, arguments);
      return new Promise(function (resolve, reject) {
        function step(key, arg) {
          try {
            var info = gen[key](arg);
            var value = info.value;
          } catch (error) {
            reject(error);
            return;
          }

          if (info.done) {
            resolve(value);
          } else {
            return Promise.resolve(value).then(function (value) {
              step("next", value);
            }, function (err) {
              step("throw", err);
            });
          }
        }

        return step("next");
      });
    };
  };

  var defaultConfig = {
      classTo: 'form-group',
      errorClass: 'has-danger',
      successClass: 'has-success',
      loadingClass: 'has-loading',
      errorTextParent: 'form-group',
      errorTextTag: 'div',
      errorTextClass: 'text-help',
      loadingText: 'Validating&hellip;'
  };

  var PRISTINE_ERROR = 'pristine-error';
  var PRISTINE_EXCLUDE_ATTRIBUTE = 'data-pristine-exclude';
  var SELECTOR = "input:not([type^=hidden]):not([type^=submit]), select, textarea";
  var ALLOWED_ATTRIBUTES = ["required", "min", "max", 'minlength', 'maxlength', 'pattern'];
  var EMAIL_REGEX = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

  var validators = {};

  var _ = function _(name, validator) {
      validator.name = name;
      if (!validator.msg) validator.msg = lang[name];
      if (validator.priority === undefined) validator.priority = 1;
      validators[name] = validator;
  };

  _('text', { fn: function fn(val) {
          return true;
      }, priority: 0 });
  _('required', { fn: function fn(val) {
          return this.type === 'radio' || this.type === 'checkbox' ? groupedElemCount(this) : val !== undefined && val !== '';
      }, priority: 99, halt: true });
  _('email', { fn: function fn(val) {
          return !val || EMAIL_REGEX.test(val);
      } });
  _('number', { fn: function fn(val) {
          return !val || !isNaN(parseFloat(val));
      }, priority: 2 });
  _('integer', { fn: function fn(val) {
          return val && /^\d+$/.test(val);
      } });
  _('minlength', { fn: function fn(val, length) {
          return !val || val.length >= parseInt(length);
      } });
  _('maxlength', { fn: function fn(val, length) {
          return !val || val.length <= parseInt(length);
      } });
  _('min', { fn: function fn(val, limit) {
          return !val || (this.type === 'checkbox' ? groupedElemCount(this) >= parseInt(limit) : parseFloat(val) >= parseFloat(limit));
      } });
  _('max', { fn: function fn(val, limit) {
          return !val || (this.type === 'checkbox' ? groupedElemCount(this) <= parseInt(limit) : parseFloat(val) <= parseFloat(limit));
      } });
  _('pattern', { fn: function fn(val, pattern) {
          var m = pattern.match(new RegExp('^/(.*?)/([gimy]*)$'));return !val || new RegExp(m[1], m[2]).test(val);
      } });

  function Pristine(form, config, live) {

      /***
       * Validates a single field, all validator functions are called and error messages are generated
       * when a validator fails
       * @param field
       * @returns {boolean}
       * @private
       */
      var _validateField = function () {
          var _ref2 = asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2(field) {
              var i, validator, params, result, error;
              return regeneratorRuntime.wrap(function _callee2$(_context2) {
                  while (1) {
                      switch (_context2.prev = _context2.next) {
                          case 0:
                              field.errors = [];

                              _context2.t0 = regeneratorRuntime.keys(field.validators);

                          case 2:
                              if ((_context2.t1 = _context2.t0()).done) {
                                  _context2.next = 17;
                                  break;
                              }

                              i = _context2.t1.value;
                              validator = field.validators[i];
                              params = field.params[validator.name] ? field.params[validator.name] : [];

                              params[0] = field.input.value;

                              _showLoading(field);
                              _context2.next = 10;
                              return validator.fn.apply(field.input, params);

                          case 10:
                              result = _context2.sent;


                              field.errors = [];

                              if (result) {
                                  _context2.next = 15;
                                  break;
                              }

                              if (isFunction(validator.msg)) {
                                  field.errors.push(validator.msg(field.input.value, params));
                              } else {
                                  error = field.messages[validator.name] || validator.msg;

                                  field.errors.push(tmpl.apply(error, params));
                              }

                              return _context2.abrupt('return', false);

                          case 15:
                              _context2.next = 2;
                              break;

                          case 17:
                              return _context2.abrupt('return', true);

                          case 18:
                          case 'end':
                              return _context2.stop();
                      }
                  }
              }, _callee2, this);
          }));

          return function _validateField(_x3) {
              return _ref2.apply(this, arguments);
          };
      }();

      var _performFieldValidation = function () {
          var _ref3 = asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee3(field) {
              var isFieldValid;
              return regeneratorRuntime.wrap(function _callee3$(_context3) {
                  while (1) {
                      switch (_context3.prev = _context3.next) {
                          case 0:
                              _context3.next = 2;
                              return _validateField(field);

                          case 2:
                              isFieldValid = _context3.sent;

                              if (isFieldValid) {
                                  _showSuccess(field);
                              } else {
                                  _showError(field);
                              }

                              return _context3.abrupt('return', isFieldValid);

                          case 5:
                          case 'end':
                              return _context3.stop();
                      }
                  }
              }, _callee3, this);
          }));

          return function _performFieldValidation(_x4) {
              return _ref3.apply(this, arguments);
          };
      }();

      /***
       *
       * @param elem => The dom element where the validator is applied to
       * @param fn => validator function
       * @param msg => message to show when validation fails. Supports templating. ${0} for the input's value, ${1} and
       * so on are for the attribute values
       * @param priority => priority of the validator function, higher valued function gets called first.
       * @param halt => whether validation should stop for this field after current validation function
       */


      var self = this;

      init(form, config, live);

      function init(form, config, live) {

          form.setAttribute("novalidate", "true");

          self.form = form;
          self.config = mergeConfig(config || {}, defaultConfig);
          self.live = !(live === false);
          self.fields = Array.from(form.querySelectorAll(SELECTOR)).map(function (input) {

              var fns = [];
              var params = {};
              var messages = {};

              [].forEach.call(input.attributes, function (attr) {
                  if (/^data-pristine-/.test(attr.name)) {
                      var name = attr.name.substr(14);
                      if (name.endsWith('-message')) {
                          messages[name.slice(0, name.length - 8)] = attr.value;
                          return;
                      }
                      if (name === 'type') name = attr.value;
                      _addValidatorToField(fns, params, name, attr.value);
                  } else if (~ALLOWED_ATTRIBUTES.indexOf(attr.name)) {
                      _addValidatorToField(fns, params, attr.name, attr.value);
                  } else if (attr.name === 'type') {
                      _addValidatorToField(fns, params, attr.value);
                  }
              });

              fns.sort(function (a, b) {
                  return b.priority - a.priority;
              });

              self.live && input.addEventListener(!~['radio', 'checkbox'].indexOf(input.getAttribute('type')) ? 'input' : 'change', function (e) {
                  self.validate(e.target);
              }.bind(self));

              return input.pristine = { input: input, validators: fns, params: params, messages: messages, self: self };
          }.bind(self));
      }

      function _addValidatorToField(fns, params, name, value) {
          var validator = validators[name];
          if (validator) {
              fns.push(validator);
              if (value) {
                  var valueParams = name === 'pattern' ? [value] : value.split(',');
                  valueParams.unshift(null); // placeholder for input's value
                  params[name] = valueParams;
              }
          }
      }

      function _isFieldExcluded(field) {
          var input = field.input;
          if (input.hasAttribute(PRISTINE_EXCLUDE_ATTRIBUTE) || findAncestorByAttr(input, PRISTINE_EXCLUDE_ATTRIBUTE)) {
              return true;
          }
      }

      /***
       * Checks whether the form/input elements are valid
       * @param input => input element(s) or a jquery selector, null for full form validation
       * @param silent => do not show error messages, just return true/false
       * @returns {boolean} return true when valid false otherwise
       */
      self.validate = function () {
          var _ref = asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee(input, silent) {
              var fields, promises, i, field, validationResults, _i, fieldResult;

              return regeneratorRuntime.wrap(function _callee$(_context) {
                  while (1) {
                      switch (_context.prev = _context.next) {
                          case 0:
                              fields = self.fields;

                              if (input !== true && input !== false) {
                                  if (input instanceof HTMLElement) {
                                      fields = [input.pristine];
                                  } else if (input instanceof NodeList || input instanceof (window.$ || Array) || input instanceof Array) {
                                      fields = Array.from(input).map(function (el) {
                                          return el.pristine;
                                      });
                                  }
                              }

                              promises = [];
                              _context.t0 = regeneratorRuntime.keys(fields);

                          case 5:
                              if ((_context.t1 = _context.t0()).done) {
                                  _context.next = 14;
                                  break;
                              }

                              i = _context.t1.value;
                              field = fields[i];

                              if (!_isFieldExcluded(field)) {
                                  _context.next = 11;
                                  break;
                              }

                              if (field.errors !== undefined && field.errors.length > 0) {
                                  field.errors = [];
                                  _removeError(field);
                              }
                              return _context.abrupt('continue', 5);

                          case 11:

                              promises.push(_performFieldValidation(field));
                              _context.next = 5;
                              break;

                          case 14:
                              _context.next = 16;
                              return Promise.all(promises);

                          case 16:
                              validationResults = _context.sent;
                              _context.t2 = regeneratorRuntime.keys(validationResults);

                          case 18:
                              if ((_context.t3 = _context.t2()).done) {
                                  _context.next = 25;
                                  break;
                              }

                              _i = _context.t3.value;
                              fieldResult = validationResults[_i];

                              if (fieldResult) {
                                  _context.next = 23;
                                  break;
                              }

                              return _context.abrupt('return', false);

                          case 23:
                              _context.next = 18;
                              break;

                          case 25:
                              return _context.abrupt('return', true);

                          case 26:
                          case 'end':
                              return _context.stop();
                      }
                  }
              }, _callee, this);
          }));

          return function (_x, _x2) {
              return _ref.apply(this, arguments);
          };
      }();

      /***
       * Get errors of a specific field or the whole form
       * @param input
       * @returns {Array|*}
       */
      self.getErrors = function (input) {
          if (!input) {
              var erroneousFields = [];
              for (var i = 0; i < self.fields.length; i++) {
                  var field = self.fields[i];
                  if (field.errors.length) {
                      erroneousFields.push({ input: field.input, errors: field.errors });
                  }
              }
              return erroneousFields;
          }
          return input.length ? input[0].pristine.errors : input.pristine.errors;
      };self.addValidator = function (elem, fn, msg, priority, halt) {
          if (elem instanceof HTMLElement) {
              elem.pristine.validators.push({ fn: fn, msg: msg, priority: priority, halt: halt });
              elem.pristine.validators.sort(function (a, b) {
                  return b.priority - a.priority;
              });
          } else {
              console.warn("The parameter elem must be a dom element");
          }
      };

      /***
       * An utility function that returns a 2-element array, first one is the element where error/success class is
       * applied. 2nd one is the element where error message is displayed. 2nd element is created if doesn't exist and cached.
       * @param field
       * @returns {*}
       * @private
       */
      function _getErrorElements(field) {
          if (field.errorElements) {
              return field.errorElements;
          }
          var errorClassElement = findAncestor(field.input, self.config.classTo);
          var errorTextParent = null,
              errorTextElement = null;
          if (self.config.classTo === self.config.errorTextParent) {
              errorTextParent = errorClassElement;
          } else {
              errorTextParent = errorClassElement.querySelector('.' + self.config.errorTextParent);
          }
          if (errorTextParent) {
              errorTextElement = errorTextParent.querySelector('.' + PRISTINE_ERROR);
              if (!errorTextElement) {
                  errorTextElement = document.createElement(self.config.errorTextTag);
                  errorTextElement.className = PRISTINE_ERROR + ' ' + self.config.errorTextClass;
                  errorTextParent.appendChild(errorTextElement);
                  errorTextElement.pristineDisplay = errorTextElement.style.display;
              }
          }
          return field.errorElements = [errorClassElement, errorTextElement];
      }

      function _showError(field) {
          var errorElements = _getErrorElements(field);
          var errorClassElement = errorElements[0],
              errorTextElement = errorElements[1];

          if (errorClassElement) {
              errorClassElement.classList.remove(self.config.successClass);
              errorClassElement.classList.remove(self.config.loadingClass);
              errorClassElement.classList.add(self.config.errorClass);
          }

          if (errorTextElement) {
              errorTextElement.innerHTML = field.errors.join('<br/>');
              errorTextElement.classList.remove(self.config.loadingClass);
              errorTextElement.classList.remove(self.config.successClass);
              errorTextElement.style.display = errorTextElement.pristineDisplay || '';
          }
      }

      function _showLoading(field) {
          var errorElements = _getErrorElements(field);
          var errorClassElement = errorElements[0],
              errorTextElement = errorElements[1];

          if (errorClassElement) {
              errorClassElement.classList.remove(self.config.successClass);
              errorClassElement.classList.remove(self.config.errorClass);
              errorClassElement.classList.add(self.config.loadingClass);
          }

          if (errorTextElement) {
              errorTextElement.innerHTML = self.config.loadingText;
              errorTextElement.classList.remove(self.config.successClass);
              errorTextElement.classList.add(self.config.loadingClass);
              errorTextElement.style.display = errorTextElement.pristineDisplay || '';
          }
      }

      /***
       * Adds error to a specific field
       * @param input
       * @param error
       */
      self.addError = function (input, error) {
          input = input.length ? input[0] : input;
          input.pristine.errors.push(error);
          _showError(input.pristine);
      };

      function _removeError(field) {
          var errorElements = _getErrorElements(field);
          var errorClassElement = errorElements[0],
              errorTextElement = errorElements[1];
          if (errorClassElement) {
              // IE > 9 doesn't support multiple class removal
              errorClassElement.classList.remove(self.config.errorClass);
              errorClassElement.classList.remove(self.config.successClass);
              errorClassElement.classList.remove(self.config.loadingClass);
          }
          if (errorTextElement) {
              errorTextElement.innerHTML = '';
              errorTextElement.classList.remove(self.config.loadingClass);
              errorTextElement.classList.remove(self.config.successClass);
              errorTextElement.style.display = 'none';
          }
          return errorElements;
      }

      function _showSuccess(field) {
          var errorElements = _removeError(field);

          if (!field.input.required && field.input.value === '') {
              return;
          }

          var errorClassElement = errorElements[0],
              errorTextElement = errorElements[1];
          if (errorClassElement) {
              errorClassElement.classList.add(self.config.successClass);
          }

          if (errorTextElement) {
              if (field.input.getAttribute('data-pristine-success-message') !== null) {
                  errorTextElement.innerHTML = field.input.getAttribute('data-pristine-success-message');
                  errorTextElement.classList.remove(self.config.loadingClass);
                  errorTextElement.classList.add(self.config.successClass);
                  errorTextElement.style.display = errorTextElement.pristineDisplay || '';
              }
          }
      }

      /***
       * Resets the errors
       */
      self.reset = function () {
          for (var i in self.fields) {
              self.fields[i].errorElements = null;
          }
          Array.from(self.form.querySelectorAll('.' + PRISTINE_ERROR)).map(function (elem) {
              elem.parentNode.removeChild(elem);
          });
          Array.from(self.form.querySelectorAll('.' + self.config.classTo)).map(function (elem) {
              elem.classList.remove(self.config.successClass);
              elem.classList.remove(self.config.errorClass);
              elem.classList.remove(self.config.loadingClass);
          });
      };

      /***
       * Resets the errors and deletes all pristine fields
       */
      self.destroy = function () {
          self.reset();
          self.fields.forEach(function (field) {
              delete field.input.pristine;
          });
          self.fields = [];
      };

      self.setGlobalConfig = function (config) {
          defaultConfig = config;
      };

      return self;
  }

  /***
   *
   * @param name => Name of the global validator
   * @param fn => validator function
   * @param msg => message to show when validation fails. Supports templating. ${0} for the input's value, ${1} and
   * so on are for the attribute values
   * @param priority => priority of the validator function, higher valued function gets called first.
   * @param halt => whether validation should stop for this field after current validation function
   */
  Pristine.addValidator = function (name, fn, msg, priority, halt) {
      _(name, { fn: fn, msg: msg, priority: priority, halt: halt });
  };

  return Pristine;

})));
