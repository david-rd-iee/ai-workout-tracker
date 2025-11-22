import { ApplicationRef, createComponent, inject, Injectable, InjectionToken, Injector, NgZone, } from '@angular/core';
import { LIFECYCLE_DID_ENTER, LIFECYCLE_DID_LEAVE, LIFECYCLE_WILL_ENTER, LIFECYCLE_WILL_LEAVE, LIFECYCLE_WILL_UNLOAD, } from '@ionic/core/components';
import { NavParams } from '../directives/navigation/nav-params';
import { ConfigToken } from './config';
import * as i0 from "@angular/core";
// Token for injecting the modal element
export const IonModalToken = new InjectionToken('IonModalToken');
// TODO(FW-2827): types
class AngularDelegate {
    zone = inject(NgZone);
    applicationRef = inject(ApplicationRef);
    config = inject(ConfigToken);
    create(environmentInjector, injector, elementReferenceKey) {
        return new AngularFrameworkDelegate(environmentInjector, injector, this.applicationRef, this.zone, elementReferenceKey, this.config.useSetInputAPI ?? false);
    }
    /** @nocollapse */ static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: AngularDelegate, deps: [], target: i0.ɵɵFactoryTarget.Injectable });
    /** @nocollapse */ static ɵprov = i0.ɵɵngDeclareInjectable({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: AngularDelegate });
}
export { AngularDelegate };
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: AngularDelegate, decorators: [{
            type: Injectable
        }] });
export class AngularFrameworkDelegate {
    environmentInjector;
    injector;
    applicationRef;
    zone;
    elementReferenceKey;
    enableSignalsSupport;
    elRefMap = new WeakMap();
    elEventsMap = new WeakMap();
    constructor(environmentInjector, injector, applicationRef, zone, elementReferenceKey, enableSignalsSupport) {
        this.environmentInjector = environmentInjector;
        this.injector = injector;
        this.applicationRef = applicationRef;
        this.zone = zone;
        this.elementReferenceKey = elementReferenceKey;
        this.enableSignalsSupport = enableSignalsSupport;
    }
    attachViewToDom(container, component, params, cssClasses) {
        return this.zone.run(() => {
            return new Promise((resolve) => {
                const componentProps = {
                    ...params,
                };
                /**
                 * Ionic Angular passes a reference to a modal
                 * or popover that can be accessed using a
                 * variable in the overlay component. If
                 * elementReferenceKey is defined, then we should
                 * pass a reference to the component using
                 * elementReferenceKey as the key.
                 */
                if (this.elementReferenceKey !== undefined) {
                    componentProps[this.elementReferenceKey] = container;
                }
                const el = attachView(this.zone, this.environmentInjector, this.injector, this.applicationRef, this.elRefMap, this.elEventsMap, container, component, componentProps, cssClasses, this.elementReferenceKey, this.enableSignalsSupport);
                resolve(el);
            });
        });
    }
    removeViewFromDom(_container, component) {
        return this.zone.run(() => {
            return new Promise((resolve) => {
                const componentRef = this.elRefMap.get(component);
                if (componentRef) {
                    componentRef.destroy();
                    this.elRefMap.delete(component);
                    const unbindEvents = this.elEventsMap.get(component);
                    if (unbindEvents) {
                        unbindEvents();
                        this.elEventsMap.delete(component);
                    }
                }
                resolve();
            });
        });
    }
}
export const attachView = (zone, environmentInjector, injector, applicationRef, elRefMap, elEventsMap, container, component, params, cssClasses, elementReferenceKey, enableSignalsSupport) => {
    /**
     * Wraps the injector with a custom injector that
     * provides NavParams to the component.
     *
     * NavParams is a legacy feature from Ionic v3 that allows
     * Angular developers to provide data to a component
     * and access it by providing NavParams as a dependency
     * in the constructor.
     *
     * The modern approach is to access the data directly
     * from the component's class instance.
     */
    const providers = getProviders(params);
    // If this is an ion-modal, provide the modal element as an injectable
    // so components inside the modal can inject it directly
    if (container.tagName.toLowerCase() === 'ion-modal') {
        providers.push({
            provide: IonModalToken,
            useValue: container,
        });
    }
    const childInjector = Injector.create({
        providers,
        parent: injector,
    });
    const componentRef = createComponent(component, {
        environmentInjector,
        elementInjector: childInjector,
    });
    const instance = componentRef.instance;
    const hostElement = componentRef.location.nativeElement;
    if (params) {
        /**
         * For modals and popovers, a reference to the component is
         * added to `params` during the call to attachViewToDom. If
         * a reference using this name is already set, this means
         * the app is trying to use the name as a component prop,
         * which will cause collisions.
         */
        if (elementReferenceKey && instance[elementReferenceKey] !== undefined) {
            console.error(`[Ionic Error]: ${elementReferenceKey} is a reserved property when using ${container.tagName.toLowerCase()}. Rename or remove the "${elementReferenceKey}" property from ${component.name}.`);
        }
        /**
         * Angular 14.1 added support for setInput
         * so we need to fall back to Object.assign
         * for Angular 14.0.
         */
        if (enableSignalsSupport === true && componentRef.setInput !== undefined) {
            const { modal, popover, ...otherParams } = params;
            /**
             * Any key/value pairs set in componentProps
             * must be set as inputs on the component instance.
             */
            for (const key in otherParams) {
                componentRef.setInput(key, otherParams[key]);
            }
            /**
             * Using setInput will cause an error when
             * setting modal/popover on a component that
             * does not define them as an input. For backwards
             * compatibility purposes we fall back to using
             * Object.assign for these properties.
             */
            if (modal !== undefined) {
                Object.assign(instance, { modal });
            }
            if (popover !== undefined) {
                Object.assign(instance, { popover });
            }
        }
        else {
            Object.assign(instance, params);
        }
    }
    if (cssClasses) {
        for (const cssClass of cssClasses) {
            hostElement.classList.add(cssClass);
        }
    }
    const unbindEvents = bindLifecycleEvents(zone, instance, hostElement);
    container.appendChild(hostElement);
    applicationRef.attachView(componentRef.hostView);
    elRefMap.set(hostElement, componentRef);
    elEventsMap.set(hostElement, unbindEvents);
    return hostElement;
};
const LIFECYCLES = [
    LIFECYCLE_WILL_ENTER,
    LIFECYCLE_DID_ENTER,
    LIFECYCLE_WILL_LEAVE,
    LIFECYCLE_DID_LEAVE,
    LIFECYCLE_WILL_UNLOAD,
];
export const bindLifecycleEvents = (zone, instance, element) => {
    return zone.run(() => {
        const unregisters = LIFECYCLES.filter((eventName) => typeof instance[eventName] === 'function').map((eventName) => {
            const handler = (ev) => instance[eventName](ev.detail);
            element.addEventListener(eventName, handler);
            return () => element.removeEventListener(eventName, handler);
        });
        return () => unregisters.forEach((fn) => fn());
    });
};
const NavParamsToken = new InjectionToken('NavParamsToken');
const getProviders = (params) => {
    return [
        {
            provide: NavParamsToken,
            useValue: params,
        },
        {
            provide: NavParams,
            useFactory: provideNavParamsInjectable,
            deps: [NavParamsToken],
        },
    ];
};
const provideNavParamsInjectable = (params) => {
    return new NavParams(params);
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhci1kZWxlZ2F0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL2NvbW1vbi9zcmMvcHJvdmlkZXJzL2FuZ3VsYXItZGVsZWdhdGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUNMLGNBQWMsRUFFZCxlQUFlLEVBRWYsTUFBTSxFQUNOLFVBQVUsRUFDVixjQUFjLEVBQ2QsUUFBUSxFQUNSLE1BQU0sR0FDUCxNQUFNLGVBQWUsQ0FBQztBQUN2QixPQUFPLEVBRUwsbUJBQW1CLEVBQ25CLG1CQUFtQixFQUNuQixvQkFBb0IsRUFDcEIsb0JBQW9CLEVBQ3BCLHFCQUFxQixHQUN0QixNQUFNLHdCQUF3QixDQUFDO0FBRWhDLE9BQU8sRUFBRSxTQUFTLEVBQUUsTUFBTSxxQ0FBcUMsQ0FBQztBQUVoRSxPQUFPLEVBQUUsV0FBVyxFQUFFLE1BQU0sVUFBVSxDQUFDOztBQUV2Qyx3Q0FBd0M7QUFDeEMsTUFBTSxDQUFDLE1BQU0sYUFBYSxHQUFHLElBQUksY0FBYyxDQUFzQixlQUFlLENBQUMsQ0FBQztBQUV0Rix1QkFBdUI7QUFFdkIsTUFDYSxlQUFlO0lBQ2xCLElBQUksR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDdEIsY0FBYyxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQztJQUN4QyxNQUFNLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBRXJDLE1BQU0sQ0FDSixtQkFBd0MsRUFDeEMsUUFBa0IsRUFDbEIsbUJBQTRCO1FBRTVCLE9BQU8sSUFBSSx3QkFBd0IsQ0FDakMsbUJBQW1CLEVBQ25CLFFBQVEsRUFDUixJQUFJLENBQUMsY0FBYyxFQUNuQixJQUFJLENBQUMsSUFBSSxFQUNULG1CQUFtQixFQUNuQixJQUFJLENBQUMsTUFBTSxDQUFDLGNBQWMsSUFBSSxLQUFLLENBQ3BDLENBQUM7SUFDSixDQUFDOzJIQWxCVSxlQUFlOytIQUFmLGVBQWU7O1NBQWYsZUFB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QyxNQUE4QixFQUFFLEVBQUU7SUFDcEUsT0FBTyxJQUFJLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUMvQixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBBcHBsaWNhdGlvblJlZixcbiAgQ29tcG9uZW50UmVmLFxuICBjcmVhdGVDb21wb25lbnQsXG4gIEVudmlyb25tZW50SW5qZWN0b3IsXG4gIGluamVjdCxcbiAgSW5qZWN0YWJsZSxcbiAgSW5qZWN0aW9uVG9rZW4sXG4gIEluamVjdG9yLFxuICBOZ1pvbmUsXG59IGZyb20gJ0Bhbmd1bGFyL2NvcmUnO1xuaW1wb3J0IHtcbiAgRnJhbWV3b3JrRGVsZWdhdGUsXG4gIExJRkVDWUNMRV9ESURfRU5URVIsXG4gIExJRkVDWUNMRV9ESURfTEVBVkUsXG4gIExJRkVDWUNMRV9XSUxMX0VOVEVSLFxuICBMSUZFQ1lDTEVfV0lMTF9MRUFWRSxcbiAgTElGRUNZQ0xFX1dJTExfVU5MT0FELFxufSBmcm9tICdAaW9uaWMvY29yZS9jb21wb25lbnRzJztcblxuaW1wb3J0IHsgTmF2UGFyYW1zIH0gZnJvbSAnLi4vZGlyZWN0aXZlcy9uYXZpZ2F0aW9uL25hdi1wYXJhbXMnO1xuXG5pbXBvcnQgeyBDb25maWdUb2tlbiB9IGZyb20gJy4vY29uZmlnJztcblxuLy8gVG9rZW4gZm9yIGluamVjdGluZyB0aGUgbW9kYWwgZWxlbWVudFxuZXhwb3J0IGNvbnN0IElvbk1vZGFsVG9rZW4gPSBuZXcgSW5qZWN0aW9uVG9rZW48SFRNTElvbk1vZGFsRWxlbWVudD4oJ0lvbk1vZGFsVG9rZW4nKTtcblxuLy8gVE9ETyhGVy0yODI3KTogdHlwZXNcblxuQEluamVjdGFibGUoKVxuZXhwb3J0IGNsYXNzIEFuZ3VsYXJEZWxlZ2F0ZSB7XG4gIHByaXZhdGUgem9uZSA9IGluamVjdChOZ1pvbmUpO1xuICBwcml2YXRlIGFwcGxpY2F0aW9uUmVmID0gaW5qZWN0KEFwcGxpY2F0aW9uUmVmKTtcbiAgcHJpdmF0ZSBjb25maWcgPSBpbmplY3QoQ29uZmlnVG9rZW4pO1xuXG4gIGNyZWF0ZShcbiAgICBlbnZpcm9ubWVudEluamVjdG9yOiBFbnZpcm9ubWVudEluamVjdG9yLFxuICAgIGluamVjdG9yOiBJbmplY3RvcixcbiAgICBlbGVtZW50UmVmZXJlbmNlS2V5Pzogc3RyaW5nXG4gICk6IEFuZ3VsYXJGcmFtZXdvcmtEZWxlZ2F0ZSB7XG4gICAgcmV0dXJuIG5ldyBBbmd1bGFyRnJhbWV3b3JrRGVsZWdhdGUoXG4gICAgICBlbnZpcm9ubWVudEluamVjdG9yLFxuICAgICAgaW5qZWN0b3IsXG4gICAgICB0aGlzLmFwcGxpY2F0aW9uUmVmLFxuICAgICAgdGhpcy56b25lLFxuICAgICAgZWxlbWVudFJlZmVyZW5jZUtleSxcbiAgICAgIHRoaXMuY29uZmlnLnVzZVNldElucHV0QVBJID8/IGZhbHNlXG4gICAgKTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgQW5ndWxhckZyYW1ld29ya0RlbGVnYXRlIGltcGxlbWVudHMgRnJhbWV3b3JrRGVsZWdhdGUge1xuICBwcml2YXRlIGVsUmVmTWFwID0gbmV3IFdlYWtNYXA8SFRNTEVsZW1lbnQsIENvbXBvbmVudFJlZjxhbnk+PigpO1xuICBwcml2YXRlIGVsRXZlbnRzTWFwID0gbmV3IFdlYWtNYXA8SFRNTEVsZW1lbnQsICgpID0+IHZvaWQ+KCk7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSBlbnZpcm9ubWVudEluamVjdG9yOiBFbnZpcm9ubWVudEluamVjdG9yLFxuICAgIHByaXZhdGUgaW5qZWN0b3I6IEluamVjdG9yLFxuICAgIHByaXZhdGUgYXBwbGljYXRpb25SZWY6IEFwcGxpY2F0aW9uUmVmLFxuICAgIHByaXZhdGUgem9uZTogTmdab25lLFxuICAgIHByaXZhdGUgZWxlbWVudFJlZmVyZW5jZUtleT86IHN0cmluZyxcbiAgICBwcml2YXRlIGVuYWJsZVNpZ25hbHNTdXBwb3J0PzogYm9vbGVhblxuICApIHt9XG5cbiAgYXR0YWNoVmlld1RvRG9tKGNvbnRhaW5lcjogYW55LCBjb21wb25lbnQ6IGFueSwgcGFyYW1zPzogYW55LCBjc3NDbGFzc2VzPzogc3RyaW5nW10pOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB0aGlzLnpvbmUucnVuKCgpID0+IHtcbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICBjb25zdCBjb21wb25lbnRQcm9wcyA9IHtcbiAgICAgICAgICAuLi5wYXJhbXMsXG4gICAgICAgIH07XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIElvbmljIEFuZ3VsYXIgcGFzc2VzIGEgcmVmZXJlbmNlIHRvIGEgbW9kYWxcbiAgICAgICAgICogb3IgcG9wb3ZlciB0aGF0IGNhbiBiZSBhY2Nlc3NlZCB1c2luZyBhXG4gICAgICAgICAqIHZhcmlhYmxlIGluIHRoZSBvdmVybGF5IGNvbXBvbmVudC4gSWZcbiAgICAgICAgICogZWxlbWVudFJlZmVyZW5jZUtleSBpcyBkZWZpbmVkLCB0aGVuIHdlIHNob3VsZFxuICAgICAgICAgKiBwYXNzIGEgcmVmZXJlbmNlIHRvIHRoZSBjb21wb25lbnQgdXNpbmdcbiAgICAgICAgICogZWxlbWVudFJlZmVyZW5jZUtleSBhcyB0aGUga2V5LlxuICAgICAgICAgKi9cbiAgICAgICAgaWYgKHRoaXMuZWxlbWVudFJlZmVyZW5jZUtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY29tcG9uZW50UHJvcHNbdGhpcy5lbGVtZW50UmVmZXJlbmNlS2V5XSA9IGNvbnRhaW5lcjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVsID0gYXR0YWNoVmlldyhcbiAgICAgICAgICB0aGlzLnpvbmUsXG4gICAgICAgICAgdGhpcy5lbnZpcm9ubWVudEluamVjdG9yLFxuICAgICAgICAgIHRoaXMuaW5qZWN0b3IsXG4gICAgICAgICAgdGhpcy5hcHBsaWNhdGlvblJlZixcbiAgICAgICAgICB0aGlzLmVsUmVmTWFwLFxuICAgICAgICAgIHRoaXMuZWxFdmVudHNNYXAsXG4gICAgICAgICAgY29udGFpbmVyLFxuICAgICAgICAgIGNvbXBvbmVudCxcbiAgICAgICAgICBjb21wb25lbnRQcm9wcyxcbiAgICAgICAgICBjc3NDbGFzc2VzLFxuICAgICAgICAgIHRoaXMuZWxlbWVudFJlZmVyZW5jZUtleSxcbiAgICAgICAgICB0aGlzLmVuYWJsZVNpZ25hbHNTdXBwb3J0XG4gICAgICAgICk7XG4gICAgICAgIHJlc29sdmUoZWwpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICByZW1vdmVWaWV3RnJvbURvbShfY29udGFpbmVyOiBhbnksIGNvbXBvbmVudDogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHRoaXMuem9uZS5ydW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIGNvbnN0IGNvbXBvbmVudFJlZiA9IHRoaXMuZWxSZWZNYXAuZ2V0KGNvbXBvbmVudCk7XG4gICAgICAgIGlmIChjb21wb25lbnRSZWYpIHtcbiAgICAgICAgICBjb21wb25lbnRSZWYuZGVzdHJveSgpO1xuICAgICAgICAgIHRoaXMuZWxSZWZNYXAuZGVsZXRlKGNvbXBvbmVudCk7XG4gICAgICAgICAgY29uc3QgdW5iaW5kRXZlbnRzID0gdGhpcy5lbEV2ZW50c01hcC5nZXQoY29tcG9uZW50KTtcbiAgICAgICAgICBpZiAodW5iaW5kRXZlbnRzKSB7XG4gICAgICAgICAgICB1bmJpbmRFdmVudHMoKTtcbiAgICAgICAgICAgIHRoaXMuZWxFdmVudHNNYXAuZGVsZXRlKGNvbXBvbmVudCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBjb25zdCBhdHRhY2hWaWV3ID0gKFxuICB6b25lOiBOZ1pvbmUsXG4gIGVudmlyb25tZW50SW5qZWN0b3I6IEVudmlyb25tZW50SW5qZWN0b3IsXG4gIGluamVjdG9yOiBJbmplY3RvcixcbiAgYXBwbGljYXRpb25SZWY6IEFwcGxpY2F0aW9uUmVmLFxuICBlbFJlZk1hcDogV2Vha01hcDxIVE1MRWxlbWVudCwgQ29tcG9uZW50UmVmPGFueT4+LFxuICBlbEV2ZW50c01hcDogV2Vha01hcDxIVE1MRWxlbWVudCwgKCkgPT4gdm9pZD4sXG4gIGNvbnRhaW5lcjogYW55LFxuICBjb21wb25lbnQ6IGFueSxcbiAgcGFyYW1zOiBhbnksXG4gIGNzc0NsYXNzZXM6IHN0cmluZ1tdIHwgdW5kZWZpbmVkLFxuICBlbGVtZW50UmVmZXJlbmNlS2V5OiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gIGVuYWJsZVNpZ25hbHNTdXBwb3J0OiBib29sZWFuIHwgdW5kZWZpbmVkXG4pOiBhbnkgPT4ge1xuICAvKipcbiAgICogV3JhcHMgdGhlIGluamVjdG9yIHdpdGggYSBjdXN0b20gaW5qZWN0b3IgdGhhdFxuICAgKiBwcm92aWRlcyBOYXZQYXJhbXMgdG8gdGhlIGNvbXBvbmVudC5cbiAgICpcbiAgICogTmF2UGFyYW1zIGlzIGEgbGVnYWN5IGZlYXR1cmUgZnJvbSBJb25pYyB2MyB0aGF0IGFsbG93c1xuICAgKiBBbmd1bGFyIGRldmVsb3BlcnMgdG8gcHJvdmlkZSBkYXRhIHRvIGEgY29tcG9uZW50XG4gICAqIGFuZCBhY2Nlc3MgaXQgYnkgcHJvdmlkaW5nIE5hdlBhcmFtcyBhcyBhIGRlcGVuZGVuY3lcbiAgICogaW4gdGhlIGNvbnN0cnVjdG9yLlxuICAgKlxuICAgKiBUaGUgbW9kZXJuIGFwcHJvYWNoIGlzIHRvIGFjY2VzcyB0aGUgZGF0YSBkaXJlY3RseVxuICAgKiBmcm9tIHRoZSBjb21wb25lbnQncyBjbGFzcyBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0IHByb3ZpZGVycyA9IGdldFByb3ZpZGVycyhwYXJhbXMpO1xuXG4gIC8vIElmIHRoaXMgaXMgYW4gaW9uLW1vZGFsLCBwcm92aWRlIHRoZSBtb2RhbCBlbGVtZW50IGFzIGFuIGluamVjdGFibGVcbiAgLy8gc28gY29tcG9uZW50cyBpbnNpZGUgdGhlIG1vZGFsIGNhbiBpbmplY3QgaXQgZGlyZWN0bHlcbiAgaWYgKGNvbnRhaW5lci50YWdOYW1lLnRvTG93ZXJDYXNlKCkgPT09ICdpb24tbW9kYWwnKSB7XG4gICAgcHJvdmlkZXJzLnB1c2goe1xuICAgICAgcHJvdmlkZTogSW9uTW9kYWxUb2tlbixcbiAgICAgIHVzZVZhbHVlOiBjb250YWluZXIsXG4gICAgfSk7XG4gIH1cblxuICBjb25zdCBjaGlsZEluamVjdG9yID0gSW5qZWN0b3IuY3JlYXRlKHtcbiAgICBwcm92aWRlcnMsXG4gICAgcGFyZW50OiBpbmplY3RvcixcbiAgfSk7XG5cbiAgY29uc3QgY29tcG9uZW50UmVmID0gY3JlYXRlQ29tcG9uZW50PGFueT4oY29tcG9uZW50LCB7XG4gICAgZW52aXJvbm1lbnRJbmplY3RvcixcbiAgICBlbGVtZW50SW5qZWN0b3I6IGNoaWxkSW5qZWN0b3IsXG4gIH0pO1xuXG4gIGNvbnN0IGluc3RhbmNlID0gY29tcG9uZW50UmVmLmluc3RhbmNlO1xuICBjb25zdCBob3N0RWxlbWVudCA9IGNvbXBvbmVudFJlZi5sb2NhdGlvbi5uYXRpdmVFbGVtZW50O1xuXG4gIGlmIChwYXJhbXMpIHtcbiAgICAvKipcbiAgICAgKiBGb3IgbW9kYWxzIGFuZCBwb3BvdmVycywgYSByZWZlcmVuY2UgdG8gdGhlIGNvbXBvbmVudCBpc1xuICAgICAqIGFkZGVkIHRvIGBwYXJhbXNgIGR1cmluZyB0aGUgY2FsbCB0byBhdHRhY2hWaWV3VG9Eb20uIElmXG4gICAgICogYSByZWZlcmVuY2UgdXNpbmcgdGhpcyBuYW1lIGlzIGFscmVhZHkgc2V0LCB0aGlzIG1lYW5zXG4gICAgICogdGhlIGFwcCBpcyB0cnlpbmcgdG8gdXNlIHRoZSBuYW1lIGFzIGEgY29tcG9uZW50IHByb3AsXG4gICAgICogd2hpY2ggd2lsbCBjYXVzZSBjb2xsaXNpb25zLlxuICAgICAqL1xuICAgIGlmIChlbGVtZW50UmVmZXJlbmNlS2V5ICYmIGluc3RhbmNlW2VsZW1lbnRSZWZlcmVuY2VLZXldICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgIGBbSW9uaWMgRXJyb3JdOiAke2VsZW1lbnRSZWZlcmVuY2VLZXl9IGlzIGEgcmVzZXJ2ZWQgcHJvcGVydHkgd2hlbiB1c2luZyAke2NvbnRhaW5lci50YWdOYW1lLnRvTG93ZXJDYXNlKCl9LiBSZW5hbWUgb3IgcmVtb3ZlIHRoZSBcIiR7ZWxlbWVudFJlZmVyZW5jZUtleX1cIiBwcm9wZXJ0eSBmcm9tICR7XG4gICAgICAgICAgY29tcG9uZW50Lm5hbWVcbiAgICAgICAgfS5gXG4gICAgICApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEFuZ3VsYXIgMTQuMSBhZGRlZCBzdXBwb3J0IGZvciBzZXRJbnB1dFxuICAgICAqIHNvIHdlIG5lZWQgdG8gZmFsbCBiYWNrIHRvIE9iamVjdC5hc3NpZ25cbiAgICAgKiBmb3IgQW5ndWxhciAxNC4wLlxuICAgICAqL1xuICAgIGlmIChlbmFibGVTaWduYWxzU3VwcG9ydCA9PT0gdHJ1ZSAmJiBjb21wb25lbnRSZWYuc2V0SW5wdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgeyBtb2RhbCwgcG9wb3ZlciwgLi4ub3RoZXJQYXJhbXMgfSA9IHBhcmFtcztcbiAgICAgIC8qKlxuICAgICAgICogQW55IGtleS92YWx1ZSBwYWlycyBzZXQgaW4gY29tcG9uZW50UHJvcHNcbiAgICAgICAqIG11c3QgYmUgc2V0IGFzIGlucHV0cyBvbiB0aGUgY29tcG9uZW50IGluc3RhbmNlLlxuICAgICAgICovXG4gICAgICBmb3IgKGNvbnN0IGtleSBpbiBvdGhlclBhcmFtcykge1xuICAgICAgICBjb21wb25lbnRSZWYuc2V0SW5wdXQoa2V5LCBvdGhlclBhcmFtc1trZXldKTtcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBVc2luZyBzZXRJbnB1dCB3aWxsIGNhdXNlIGFuIGVycm9yIHdoZW5cbiAgICAgICAqIHNldHRpbmcgbW9kYWwvcG9wb3ZlciBvbiBhIGNvbXBvbmVudCB0aGF0XG4gICAgICAgKiBkb2VzIG5vdCBkZWZpbmUgdGhlbSBhcyBhbiBpbnB1dC4gRm9yIGJhY2t3YXJkc1xuICAgICAgICogY29tcGF0aWJpbGl0eSBwdXJwb3NlcyB3ZSBmYWxsIGJhY2sgdG8gdXNpbmdcbiAgICAgICAqIE9iamVjdC5hc3NpZ24gZm9yIHRoZXNlIHByb3BlcnRpZXMuXG4gICAgICAgKi9cbiAgICAgIGlmIChtb2RhbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24oaW5zdGFuY2UsIHsgbW9kYWwgfSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChwb3BvdmVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbihpbnN0YW5jZSwgeyBwb3BvdmVyIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBPYmplY3QuYXNzaWduKGluc3RhbmNlLCBwYXJhbXMpO1xuICAgIH1cbiAgfVxuICBpZiAoY3NzQ2xhc3Nlcykge1xuICAgIGZvciAoY29uc3QgY3NzQ2xhc3Mgb2YgY3NzQ2xhc3Nlcykge1xuICAgICAgaG9zdEVsZW1lbnQuY2xhc3NMaXN0LmFkZChjc3NDbGFzcyk7XG4gICAgfVxuICB9XG4gIGNvbnN0IHVuYmluZEV2ZW50cyA9IGJpbmRMaWZlY3ljbGVFdmVudHMoem9uZSwgaW5zdGFuY2UsIGhvc3RFbGVtZW50KTtcbiAgY29udGFpbmVyLmFwcGVuZENoaWxkKGhvc3RFbGVtZW50KTtcblxuICBhcHBsaWNhdGlvblJlZi5hdHRhY2hWaWV3KGNvbXBvbmVudFJlZi5ob3N0Vmlldyk7XG5cbiAgZWxSZWZNYXAuc2V0KGhvc3RFbGVtZW50LCBjb21wb25lbnRSZWYpO1xuICBlbEV2ZW50c01hcC5zZXQoaG9zdEVsZW1lbnQsIHVuYmluZEV2ZW50cyk7XG4gIHJldHVybiBob3N0RWxlbWVudDtcbn07XG5cbmNvbnN0IExJRkVDWUNMRVMgPSBbXG4gIExJRkVDWUNMRV9XSUxMX0VOVEVSLFxuICBMSUZFQ1lDTEVfRElEX0VOVEVSLFxuICBMSUZFQ1lDTEVfV0lMTF9MRUFWRSxcbiAgTElGRUNZQ0xFX0RJRF9MRUFWRSxcbiAgTElGRUNZQ0xFX1dJTExfVU5MT0FELFxuXTtcblxuZXhwb3J0IGNvbnN0IGJpbmRMaWZlY3ljbGVFdmVudHMgPSAoem9uZTogTmdab25lLCBpbnN0YW5jZTogYW55LCBlbGVtZW50OiBIVE1MRWxlbWVudCk6ICgoKSA9PiB2b2lkKSA9PiB7XG4gIHJldHVybiB6b25lLnJ1bigoKSA9PiB7XG4gICAgY29uc3QgdW5yZWdpc3RlcnMgPSBMSUZFQ1lDTEVTLmZpbHRlcigoZXZlbnROYW1lKSA9PiB0eXBlb2YgaW5zdGFuY2VbZXZlbnROYW1lXSA9PT0gJ2Z1bmN0aW9uJykubWFwKChldmVudE5hbWUpID0+IHtcbiAgICAgIGNvbnN0IGhhbmRsZXIgPSAoZXY6IGFueSkgPT4gaW5zdGFuY2VbZXZlbnROYW1lXShldi5kZXRhaWwpO1xuICAgICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG4gICAgICByZXR1cm4gKCkgPT4gZWxlbWVudC5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG4gICAgfSk7XG4gICAgcmV0dXJuICgpID0+IHVucmVnaXN0ZXJzLmZvckVhY2goKGZuKSA9PiBmbigpKTtcbiAgfSk7XG59O1xuXG5jb25zdCBOYXZQYXJhbXNUb2tlbiA9IG5ldyBJbmplY3Rpb25Ub2tlbjxhbnk+KCdOYXZQYXJhbXNUb2tlbicpO1xuXG5jb25zdCBnZXRQcm92aWRlcnMgPSAocGFyYW1zOiB7IFtrZXk6IHN0cmluZ106IGFueSB9KSA9PiB7XG4gIHJldHVybiBbXG4gICAge1xuICAgICAgcHJvdmlkZTogTmF2UGFyYW1zVG9rZW4sXG4gICAgICB1c2VWYWx1ZTogcGFyYW1zLFxuICAgIH0sXG4gICAge1xuICAgICAgcHJvdmlkZTogTmF2UGFyYW1zLFxuICAgICAgdXNlRmFjdG9yeTogcHJvdmlkZU5hdlBhcmFtc0luamVjdGFibGUsXG4gICAgICBkZXBzOiBbTmF2UGFyYW1zVG9rZW5dLFxuICAgIH0sXG4gIF07XG59O1xuXG5jb25zdCBwcm92aWRlTmF2UGFyYW1zSW5qZWN0YWJsZSA9IChwYXJhbXM6IHsgW2tleTogc3RyaW5nXTogYW55IH0pID0+IHtcbiAgcmV0dXJuIG5ldyBOYXZQYXJhbXMocGFyYW1zKTtcbn07XG4iXX0=