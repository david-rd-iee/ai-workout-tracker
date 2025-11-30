import {
  FunctionsError,
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  httpsCallableFromURL
} from "./chunk-NSULPCVT.js";
import {
  AuthInstances
} from "./chunk-WV6RZIGD.js";
import {
  AppCheckInstances
} from "./chunk-FPEQ7UO7.js";
import "./chunk-ZO67XBGE.js";
import {
  FirebaseApp,
  FirebaseApps
} from "./chunk-R62VQ5UR.js";
import "./chunk-6A7NGCQP.js";
import {
  VERSION,
  ɵAngularFireSchedulers,
  ɵgetAllInstancesOf,
  ɵgetDefaultInstanceOf,
  ɵzoneWrap
} from "./chunk-W76PCQAQ.js";
import {
  registerVersion
} from "./chunk-ZMMZFQVD.js";
import {
  InjectionToken,
  Injector,
  NgModule,
  NgZone,
  Optional,
  makeEnvironmentProviders,
  setClassMetadata,
  ɵɵdefineInjector,
  ɵɵdefineNgModule
} from "./chunk-6RHLTVIT.js";
import "./chunk-A4HOGWHI.js";
import "./chunk-7W67SMPV.js";
import {
  concatMap,
  distinct,
  from,
  map,
  timer
} from "./chunk-UP6CNWOR.js";
import "./chunk-BBC5QSU6.js";
import "./chunk-4VWZEZJW.js";

// node_modules/rxfire/functions/index.esm.js
function httpsCallable2(functions, name, options) {
  var callable = httpsCallable(functions, name, options);
  return function(data) {
    return from(callable(data)).pipe(map(function(r) {
      return r.data;
    }));
  };
}

// node_modules/@angular/fire/fesm2022/angular-fire-functions.mjs
var Functions = class {
  constructor(functions) {
    return functions;
  }
};
var FUNCTIONS_PROVIDER_NAME = "functions";
var FunctionsInstances = class {
  constructor() {
    return ɵgetAllInstancesOf(FUNCTIONS_PROVIDER_NAME);
  }
};
var functionInstance$ = timer(0, 300).pipe(concatMap(() => from(ɵgetAllInstancesOf(FUNCTIONS_PROVIDER_NAME))), distinct());
var PROVIDED_FUNCTIONS_INSTANCES = new InjectionToken("angularfire2.functions-instances");
function defaultFunctionsInstanceFactory(provided, defaultApp) {
  const defaultAuth = ɵgetDefaultInstanceOf(FUNCTIONS_PROVIDER_NAME, provided, defaultApp);
  return defaultAuth && new Functions(defaultAuth);
}
function functionsInstanceFactory(fn) {
  return (zone, injector) => {
    const functions = zone.runOutsideAngular(() => fn(injector));
    return new Functions(functions);
  };
}
var FUNCTIONS_INSTANCES_PROVIDER = {
  provide: FunctionsInstances,
  deps: [[new Optional(), PROVIDED_FUNCTIONS_INSTANCES]]
};
var DEFAULT_FUNCTIONS_INSTANCE_PROVIDER = {
  provide: Functions,
  useFactory: defaultFunctionsInstanceFactory,
  deps: [[new Optional(), PROVIDED_FUNCTIONS_INSTANCES], FirebaseApp]
};
var FunctionsModule = class _FunctionsModule {
  constructor() {
    registerVersion("angularfire", VERSION.full, "fn");
  }
  static ɵfac = function FunctionsModule_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _FunctionsModule)();
  };
  static ɵmod = ɵɵdefineNgModule({
    type: _FunctionsModule
  });
  static ɵinj = ɵɵdefineInjector({
    providers: [DEFAULT_FUNCTIONS_INSTANCE_PROVIDER, FUNCTIONS_INSTANCES_PROVIDER]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(FunctionsModule, [{
    type: NgModule,
    args: [{
      providers: [DEFAULT_FUNCTIONS_INSTANCE_PROVIDER, FUNCTIONS_INSTANCES_PROVIDER]
    }]
  }], () => [], null);
})();
function provideFunctions(fn, ...deps) {
  registerVersion("angularfire", VERSION.full, "fn");
  return makeEnvironmentProviders([DEFAULT_FUNCTIONS_INSTANCE_PROVIDER, FUNCTIONS_INSTANCES_PROVIDER, {
    provide: PROVIDED_FUNCTIONS_INSTANCES,
    useFactory: functionsInstanceFactory(fn),
    multi: true,
    deps: [
      NgZone,
      Injector,
      ɵAngularFireSchedulers,
      FirebaseApps,
      // Defensively load Auth first, if provided
      [new Optional(), AuthInstances],
      [new Optional(), AppCheckInstances],
      ...deps
    ]
  }]);
}
var httpsCallableData = ɵzoneWrap(httpsCallable2, true);
var connectFunctionsEmulator2 = ɵzoneWrap(connectFunctionsEmulator, true);
var getFunctions2 = ɵzoneWrap(getFunctions, true);
var httpsCallable3 = ɵzoneWrap(httpsCallable, true);
var httpsCallableFromURL2 = ɵzoneWrap(httpsCallableFromURL, true);
export {
  Functions,
  FunctionsError,
  FunctionsInstances,
  FunctionsModule,
  connectFunctionsEmulator2 as connectFunctionsEmulator,
  functionInstance$,
  getFunctions2 as getFunctions,
  httpsCallable3 as httpsCallable,
  httpsCallableData,
  httpsCallableFromURL2 as httpsCallableFromURL,
  provideFunctions
};
/*! Bundled license information:

rxfire/functions/index.esm.js:
  (**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
*/
//# sourceMappingURL=@angular_fire_functions.js.map
