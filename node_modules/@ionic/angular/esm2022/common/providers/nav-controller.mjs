import { Injectable, Optional } from '@angular/core';
import { NavigationStart } from '@angular/router';
import * as i0 from "@angular/core";
import * as i1 from "./platform";
import * as i2 from "@angular/common";
import * as i3 from "@angular/router";
class NavController {
    location;
    serializer;
    router;
    topOutlet;
    direction = DEFAULT_DIRECTION;
    animated = DEFAULT_ANIMATED;
    animationBuilder;
    guessDirection = 'forward';
    guessAnimation;
    lastNavId = -1;
    constructor(platform, location, serializer, router) {
        this.location = location;
        this.serializer = serializer;
        this.router = router;
        // Subscribe to router events to detect direction
        if (router) {
            router.events.subscribe((ev) => {
                if (ev instanceof NavigationStart) {
                    // restoredState is set if the browser back/forward button is used
                    const id = ev.restoredState ? ev.restoredState.navigationId : ev.id;
                    this.guessDirection = this.guessAnimation = id < this.lastNavId ? 'back' : 'forward';
                    this.lastNavId = this.guessDirection === 'forward' ? ev.id : id;
                }
            });
        }
        // Subscribe to backButton events
        platform.backButton.subscribeWithPriority(0, (processNextHandler) => {
            this.pop();
            processNextHandler();
        });
    }
    /**
     * This method uses Angular's [Router](https://angular.io/api/router/Router) under the hood,
     * it's equivalent to calling `this.router.navigateByUrl()`, but it's explicit about the **direction** of the transition.
     *
     * Going **forward** means that a new page is going to be pushed to the stack of the outlet (ion-router-outlet),
     * and that it will show a "forward" animation by default.
     *
     * Navigating forward can also be triggered in a declarative manner by using the `[routerDirection]` directive:
     *
     * ```html
     * <a routerLink="/path/to/page" routerDirection="forward">Link</a>
     * ```
     */
    navigateForward(url, options = {}) {
        this.setDirection('forward', options.animated, options.animationDirection, options.animation);
        return this.navigate(url, options);
    }
    /**
     * This method uses Angular's [Router](https://angular.io/api/router/Router) under the hood,
     * it's equivalent to calling:
     *
     * ```ts
     * this.navController.setDirection('back');
     * this.router.navigateByUrl(path);
     * ```
     *
     * Going **back** means that all the pages in the stack until the navigated page is found will be popped,
     * and that it will show a "back" animation by default.
     *
     * Navigating back can also be triggered in a declarative manner by using the `[routerDirection]` directive:
     *
     * ```html
     * <a routerLink="/path/to/page" routerDirection="back">Link</a>
     * ```
     */
    navigateBack(url, options = {}) {
        this.setDirection('back', options.animated, options.animationDirection, options.animation);
        return this.navigate(url, options);
    }
    /**
     * This method uses Angular's [Router](https://angular.io/api/router/Router) under the hood,
     * it's equivalent to calling:
     *
     * ```ts
     * this.navController.setDirection('root');
     * this.router.navigateByUrl(path);
     * ```
     *
     * Going **root** means that all existing pages in the stack will be removed,
     * and the navigated page will become the single page in the stack.
     *
     * Navigating root can also be triggered in a declarative manner by using the `[routerDirection]` directive:
     *
     * ```html
     * <a routerLink="/path/to/page" routerDirection="root">Link</a>
     * ```
     */
    navigateRoot(url, options = {}) {
        this.setDirection('root', options.animated, options.animationDirection, options.animation);
        return this.navigate(url, options);
    }
    /**
     * Same as [Location](https://angular.io/api/common/Location)'s back() method.
     * It will use the standard `window.history.back()` under the hood, but featuring a `back` animation
     * by default.
     */
    back(options = { animated: true, animationDirection: 'back' }) {
        this.setDirection('back', options.animated, options.animationDirection, options.animation);
        return this.location.back();
    }
    /**
     * This methods goes back in the context of Ionic's stack navigation.
     *
     * It recursively finds the top active `ion-router-outlet` and calls `pop()`.
     * This is the recommended way to go back when you are using `ion-router-outlet`.
     *
     * Resolves to `true` if it was able to pop.
     */
    async pop() {
        let outlet = this.topOutlet;
        while (outlet) {
            if (await outlet.pop()) {
                return true;
            }
            else {
                outlet = outlet.parentOutlet;
            }
        }
        return false;
    }
    /**
     * This methods specifies the direction of the next navigation performed by the Angular router.
     *
     * `setDirection()` does not trigger any transition, it just sets some flags to be consumed by `ion-router-outlet`.
     *
     * It's recommended to use `navigateForward()`, `navigateBack()` and `navigateRoot()` instead of `setDirection()`.
     */
    setDirection(direction, animated, animationDirection, animationBuilder) {
        this.direction = direction;
        this.animated = getAnimation(direction, animated, animationDirection);
        this.animationBuilder = animationBuilder;
    }
    /**
     * @internal
     */
    setTopOutlet(outlet) {
        this.topOutlet = outlet;
    }
    /**
     * @internal
     */
    consumeTransition() {
        let direction = 'root';
        let animation;
        const animationBuilder = this.animationBuilder;
        if (this.direction === 'auto') {
            direction = this.guessDirection;
            animation = this.guessAnimation;
        }
        else {
            animation = this.animated;
            direction = this.direction;
        }
        this.direction = DEFAULT_DIRECTION;
        this.animated = DEFAULT_ANIMATED;
        this.animationBuilder = undefined;
        return {
            direction,
            animation,
            animationBuilder,
        };
    }
    navigate(url, options) {
        if (Array.isArray(url)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return this.router.navigate(url, options);
        }
        else {
            /**
             * navigateByUrl ignores any properties that
             * would change the url, so things like queryParams
             * would be ignored unless we create a url tree
             * More Info: https://github.com/angular/angular/issues/18798
             */
            const urlTree = this.serializer.parse(url.toString());
            if (options.queryParams !== undefined) {
                urlTree.queryParams = { ...options.queryParams };
            }
            if (options.fragment !== undefined) {
                urlTree.fragment = options.fragment;
            }
            /**
             * `navigateByUrl` will still apply `NavigationExtras` properties
             * that do not modify the url, such as `replaceUrl` which is why
             * `options` is passed in here.
             */
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return this.router.navigateByUrl(urlTree, options);
        }
    }
    /** @nocollapse */ static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: NavController, deps: [{ token: i1.Platform }, { token: i2.Location }, { token: i3.UrlSerializer }, { token: i3.Router, optional: true }], target: i0.ɵɵFactoryTarget.Injectable });
    /** @nocollapse */ static ɵprov = i0.ɵɵngDeclareInjectable({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: NavController, providedIn: 'root' });
}
export { NavController };
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: NavController, decorators: [{
            type: Injectable,
            args: [{
                    providedIn: 'root',
                }]
        }], ctorParameters: function () { return [{ type: i1.Platform }, { type: i2.Location }, { type: i3.UrlSerializer }, { type: i3.Router, decorators: [{
                    type: Optional
                }] }]; } });
const getAnimation = (direction, animated, animationDirection) => {
    if (animated === false) {
        return undefined;
    }
    if (animationDirection !== undefined) {
        return animationDirection;
    }
    if (direction === 'forward' || direction === 'back') {
        return direction;
    }
    else if (direction === 'root' && animated === true) {
        return 'forward';
    }
    return undefined;
};
const DEFAULT_DIRECTION = 'auto';
const DEFAULT_ANIMATED = undefined;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmF2LWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9jb21tb24vc3JjL3Byb3ZpZGVycy9uYXYtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFDQSxPQUFPLEVBQUUsVUFBVSxFQUFFLFFBQVEsRUFBRSxNQUFNLGVBQWUsQ0FBQztBQUNyRCxPQUFPLEVBQW9ELGVBQWUsRUFBRSxNQUFNLGlCQUFpQixDQUFDOzs7OztBQWVwRyxNQUdhLGFBQWE7SUFXZDtJQUNBO0lBQ1k7SUFaZCxTQUFTLENBQW1CO0lBQzVCLFNBQVMsR0FBeUMsaUJBQWlCLENBQUM7SUFDcEUsUUFBUSxHQUFrQixnQkFBZ0IsQ0FBQztJQUMzQyxnQkFBZ0IsQ0FBb0I7SUFDcEMsY0FBYyxHQUFvQixTQUFTLENBQUM7SUFDNUMsY0FBYyxDQUFnQjtJQUM5QixTQUFTLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFFdkIsWUFDRSxRQUFrQixFQUNWLFFBQWtCLEVBQ2xCLFVBQXlCLEVBQ2IsTUFBZTtRQUYzQixhQUFRLEdBQVIsUUFBUSxDQUFVO1FBQ2xCLGVBQVUsR0FBVixVQUFVLENBQWU7UUFDYixXQUFNLEdBQU4sTUFBTSxDQUFTO1FBRW5DLGlEQUFpRDtRQUNqRCxJQUFJLE1BQU0sRUFBRTtZQUNWLE1BQU0sQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxFQUFFLEVBQUU7Z0JBQzdCLElBQUksRUFBRSxZQUFZLGVBQWUsRUFBRTtvQkFDakMsa0VBQWtFO29CQUNsRSxNQUFNLEVBQUUsR0FBRyxFQUFFLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQztvQkFDcEUsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsY0FBYyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FB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Q2xEO1lBRUQsSUFBSSxPQUFPLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRTtnQkFDbEMsT0FBTyxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFDO2FBQ3JDO1lBRUQ7Ozs7ZUFJRztZQUNILG9FQUFvRTtZQUNwRSxPQUFPLElBQUksQ0FBQyxNQUFPLENBQUMsYUFBYSxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztTQUNyRDtJQUNILENBQUM7MkhBdE5VLGFBQWE7K0hBQWIsYUFBYSxjQUZaLE1BQU07O1NBRVAsYUFBYTs0RkFBYixhQUFhO2tCQUh6QixVQUFVO21CQUFDO29CQUNWLFVBQVUsRUFBRSxNQUFNO2lCQUNuQjs7MEJBY0ksUUFBUTs7QUE0TWIsTUFBTSxZQUFZLEdBQUcsQ0FDbkIsU0FBMEIsRUFDMUIsUUFBNkIsRUFDN0Isa0JBQWtELEVBQ3hCLEVBQUU7SUFDNUIsSUFBSSxRQUFRLEtBQUssS0FBSyxFQUFFO1FBQ3RCLE9BQU8sU0FBUyxDQUFDO0tBQ2xCO0lBQ0QsSUFBSSxrQkFBa0IsS0FBSyxTQUFTLEVBQUU7UUFDcEMsT0FBTyxrQkFBa0IsQ0FBQztLQUMzQjtJQUNELElBQUksU0FBUyxLQUFLLFNBQVMsSUFBSSxTQUFTLEtBQUssTUFBTSxFQUFFO1FBQ25ELE9BQU8sU0FBUyxDQUFDO0tBQ2xCO1NBQU0sSUFBSSxTQUFTLEtBQUssTUFBTSxJQUFJLFFBQVEsS0FBSyxJQUFJLEVBQUU7UUFDcEQsT0FBTyxTQUFTLENBQUM7S0FDbEI7SUFDRCxPQUFPLFNBQVMsQ0FBQztBQUNuQixDQUFDLENBQUM7QUFFRixNQUFNLGlCQUFpQixHQUFHLE1BQU0sQ0FBQztBQUNqQyxNQUFNLGdCQUFnQixHQUFHLFNBQVMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IExvY2F0aW9uIH0gZnJvbSAnQGFuZ3VsYXIvY29tbW9uJztcbmltcG9ydCB7IEluamVjdGFibGUsIE9wdGlvbmFsIH0gZnJvbSAnQGFuZ3VsYXIvY29yZSc7XG5pbXBvcnQgeyBOYXZpZ2F0aW9uRXh0cmFzLCBSb3V0ZXIsIFVybFNlcmlhbGl6ZXIsIFVybFRyZWUsIE5hdmlnYXRpb25TdGFydCB9IGZyb20gJ0Bhbmd1bGFyL3JvdXRlcic7XG5pbXBvcnQgdHlwZSB7IEFuaW1hdGlvbkJ1aWxkZXIsIE5hdkRpcmVjdGlvbiwgUm91dGVyRGlyZWN0aW9uIH0gZnJvbSAnQGlvbmljL2NvcmUvY29tcG9uZW50cyc7XG5cbmltcG9ydCB7IElvblJvdXRlck91dGxldCB9IGZyb20gJy4uL2RpcmVjdGl2ZXMvbmF2aWdhdGlvbi9yb3V0ZXItb3V0bGV0JztcblxuaW1wb3J0IHsgUGxhdGZvcm0gfSBmcm9tICcuL3BsYXRmb3JtJztcblxuZXhwb3J0IGludGVyZmFjZSBBbmltYXRpb25PcHRpb25zIHtcbiAgYW5pbWF0ZWQ/OiBib29sZWFuO1xuICBhbmltYXRpb24/OiBBbmltYXRpb25CdWlsZGVyO1xuICBhbmltYXRpb25EaXJlY3Rpb24/OiAnZm9yd2FyZCcgfCAnYmFjayc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTmF2aWdhdGlvbk9wdGlvbnMgZXh0ZW5kcyBOYXZpZ2F0aW9uRXh0cmFzLCBBbmltYXRpb25PcHRpb25zIHt9XG5cbkBJbmplY3RhYmxlKHtcbiAgcHJvdmlkZWRJbjogJ3Jvb3QnLFxufSlcbmV4cG9ydCBjbGFzcyBOYXZDb250cm9sbGVyIHtcbiAgcHJpdmF0ZSB0b3BPdXRsZXQ/OiBJb25Sb3V0ZXJPdXRsZXQ7XG4gIHByaXZhdGUgZGlyZWN0aW9uOiAnZm9yd2FyZCcgfCAnYmFjaycgfCAncm9vdCcgfCAnYXV0bycgPSBERUZBVUxUX0RJUkVDVElPTjtcbiAgcHJpdmF0ZSBhbmltYXRlZD86IE5hdkRpcmVjdGlvbiA9IERFRkFVTFRfQU5JTUFURUQ7XG4gIHByaXZhdGUgYW5pbWF0aW9uQnVpbGRlcj86IEFuaW1hdGlvbkJ1aWxkZXI7XG4gIHByaXZhdGUgZ3Vlc3NEaXJlY3Rpb246IFJvdXRlckRpcmVjdGlvbiA9ICdmb3J3YXJkJztcbiAgcHJpdmF0ZSBndWVzc0FuaW1hdGlvbj86IE5hdkRpcmVjdGlvbjtcbiAgcHJpdmF0ZSBsYXN0TmF2SWQgPSAtMTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwbGF0Zm9ybTogUGxhdGZvcm0sXG4gICAgcHJpdmF0ZSBsb2NhdGlvbjogTG9jYXRpb24sXG4gICAgcHJpdmF0ZSBzZXJpYWxpemVyOiBVcmxTZXJpYWxpemVyLFxuICAgIEBPcHRpb25hbCgpIHByaXZhdGUgcm91dGVyPzogUm91dGVyXG4gICkge1xuICAgIC8vIFN1YnNjcmliZSB0byByb3V0ZXIgZXZlbnRzIHRvIGRldGVjdCBkaXJlY3Rpb25cbiAgICBpZiAocm91dGVyKSB7XG4gICAgICByb3V0ZXIuZXZlbnRzLnN1YnNjcmliZSgoZXYpID0+IHtcbiAgICAgICAgaWYgKGV2IGluc3RhbmNlb2YgTmF2aWdhdGlvblN0YXJ0KSB7XG4gICAgICAgICAgLy8gcmVzdG9yZWRTdGF0ZSBpcyBzZXQgaWYgdGhlIGJyb3dzZXIgYmFjay9mb3J3YXJkIGJ1dHRvbiBpcyB1c2VkXG4gICAgICAgICAgY29uc3QgaWQgPSBldi5yZXN0b3JlZFN0YXRlID8gZXYucmVzdG9yZWRTdGF0ZS5uYXZpZ2F0aW9uSWQgOiBldi5pZDtcbiAgICAgICAgICB0aGlzLmd1ZXNzRGlyZWN0aW9uID0gdGhpcy5ndWVzc0FuaW1hdGlvbiA9IGlkIDwgdGhpcy5sYXN0TmF2SWQgPyAnYmFjaycgOiAnZm9yd2FyZCc7XG4gICAgICAgICAgdGhpcy5sYXN0TmF2SWQgPSB0aGlzLmd1ZXNzRGlyZWN0aW9uID09PSAnZm9yd2FyZCcgPyBldi5pZCA6IGlkO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBTdWJzY3JpYmUgdG8gYmFja0J1dHRvbiBldmVudHNcbiAgICBwbGF0Zm9ybS5iYWNrQnV0dG9uLnN1YnNjcmliZVdpdGhQcmlvcml0eSgwLCAocHJvY2Vzc05leHRIYW5kbGVyKSA9PiB7XG4gICAgICB0aGlzLnBvcCgpO1xuICAgICAgcHJvY2Vzc05leHRIYW5kbGVyKCk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogVGhpcyBtZXRob2QgdXNlcyBBbmd1bGFyJ3MgW1JvdXRlcl0oaHR0cHM6Ly9hbmd1bGFyLmlvL2FwaS9yb3V0ZXIvUm91dGVyKSB1bmRlciB0aGUgaG9vZCxcbiAgICogaXQncyBlcXVpdmFsZW50IHRvIGNhbGxpbmcgYHRoaXMucm91dGVyLm5hdmlnYXRlQnlVcmwoKWAsIGJ1dCBpdCdzIGV4cGxpY2l0IGFib3V0IHRoZSAqKmRpcmVjdGlvbioqIG9mIHRoZSB0cmFuc2l0aW9uLlxuICAgKlxuICAgKiBHb2luZyAqKmZvcndhcmQqKiBtZWFucyB0aGF0IGEgbmV3IHBhZ2UgaXMgZ29pbmcgdG8gYmUgcHVzaGVkIHRvIHRoZSBzdGFjayBvZiB0aGUgb3V0bGV0IChpb24tcm91dGVyLW91dGxldCksXG4gICAqIGFuZCB0aGF0IGl0IHdpbGwgc2hvdyBhIFwiZm9yd2FyZFwiIGFuaW1hdGlvbiBieSBkZWZhdWx0LlxuICAgKlxuICAgKiBOYXZpZ2F0aW5nIGZvcndhcmQgY2FuIGFsc28gYmUgdHJpZ2dlcmVkIGluIGEgZGVjbGFyYXRpdmUgbWFubmVyIGJ5IHVzaW5nIHRoZSBgW3JvdXRlckRpcmVjdGlvbl1gIGRpcmVjdGl2ZTpcbiAgICpcbiAgICogYGBgaHRtbFxuICAgKiA8YSByb3V0ZXJMaW5rPVwiL3BhdGgvdG8vcGFnZVwiIHJvdXRlckRpcmVjdGlvbj1cImZvcndhcmRcIj5MaW5rPC9hPlxuICAgKiBgYGBcbiAgICovXG4gIG5hdmlnYXRlRm9yd2FyZCh1cmw6IHN0cmluZyB8IFVybFRyZWUgfCBhbnlbXSwgb3B0aW9uczogTmF2aWdhdGlvbk9wdGlvbnMgPSB7fSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRoaXMuc2V0RGlyZWN0aW9uKCdmb3J3YXJkJywgb3B0aW9ucy5hbmltYXRlZCwgb3B0aW9ucy5hbmltYXRpb25EaXJlY3Rpb24sIG9wdGlvbnMuYW5pbWF0aW9uKTtcbiAgICByZXR1cm4gdGhpcy5uYXZpZ2F0ZSh1cmwsIG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoaXMgbWV0aG9kIHVzZXMgQW5ndWxhcidzIFtSb3V0ZXJdKGh0dHBzOi8vYW5ndWxhci5pby9hcGkvcm91dGVyL1JvdXRlcikgdW5kZXIgdGhlIGhvb2QsXG4gICAqIGl0J3MgZXF1aXZhbGVudCB0byBjYWxsaW5nOlxuICAgKlxuICAgKiBgYGB0c1xuICAgKiB0aGlzLm5hdkNvbnRyb2xsZXIuc2V0RGlyZWN0aW9uKCdiYWNrJyk7XG4gICAqIHRoaXMucm91dGVyLm5hdmlnYXRlQnlVcmwocGF0aCk7XG4gICAqIGBgYFxuICAgKlxuICAgKiBHb2luZyAqKmJhY2sqKiBtZWFucyB0aGF0IGFsbCB0aGUgcGFnZXMgaW4gdGhlIHN0YWNrIHVudGlsIHRoZSBuYXZpZ2F0ZWQgcGFnZSBpcyBmb3VuZCB3aWxsIGJlIHBvcHBlZCxcbiAgICogYW5kIHRoYXQgaXQgd2lsbCBzaG93IGEgXCJiYWNrXCIgYW5pbWF0aW9uIGJ5IGRlZmF1bHQuXG4gICAqXG4gICAqIE5hdmlnYXRpbmcgYmFjayBjYW4gYWxzbyBiZSB0cmlnZ2VyZWQgaW4gYSBkZWNsYXJhdGl2ZSBtYW5uZXIgYnkgdXNpbmcgdGhlIGBbcm91dGVyRGlyZWN0aW9uXWAgZGlyZWN0aXZlOlxuICAgKlxuICAgKiBgYGBodG1sXG4gICAqIDxhIHJvdXRlckxpbms9XCIvcGF0aC90by9wYWdlXCIgcm91dGVyRGlyZWN0aW9uPVwiYmFja1wiPkxpbms8L2E+XG4gICAqIGBgYFxuICAgKi9cbiAgbmF2aWdhdGVCYWNrKHVybDogc3RyaW5nIHwgVXJsVHJlZSB8IGFueVtdLCBvcHRpb25zOiBOYXZpZ2F0aW9uT3B0aW9ucyA9IHt9KTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdGhpcy5zZXREaXJlY3Rpb24oJ2JhY2snLCBvcHRpb25zLmFuaW1hdGVkLCBvcHRpb25zLmFuaW1hdGlvbkRpcmVjdGlvbiwgb3B0aW9ucy5hbmltYXRpb24pO1xuICAgIHJldHVybiB0aGlzLm5hdmlnYXRlKHVybCwgb3B0aW9ucyk7XG4gIH1cblxuICAvKipcbiAgICogVGhpcyBtZXRob2QgdXNlcyBBbmd1bGFyJ3MgW1JvdXRlcl0oaHR0cHM6Ly9hbmd1bGFyLmlvL2FwaS9yb3V0ZXIvUm91dGVyKSB1bmRlciB0aGUgaG9vZCxcbiAgICogaXQncyBlcXVpdmFsZW50IHRvIGNhbGxpbmc6XG4gICAqXG4gICAqIGBgYHRzXG4gICAqIHRoaXMubmF2Q29udHJvbGxlci5zZXREaXJlY3Rpb24oJ3Jvb3QnKTtcbiAgICogdGhpcy5yb3V0ZXIubmF2aWdhdGVCeVVybChwYXRoKTtcbiAgICogYGBgXG4gICAqXG4gICAqIEdvaW5nICoqcm9vdCoqIG1lYW5zIHRoYXQgYWxsIGV4aXN0aW5nIHBhZ2VzIGluIHRoZSBzdGFjayB3aWxsIGJlIHJlbW92ZWQsXG4gICAqIGFuZCB0aGUgbmF2aWdhdGVkIHBhZ2Ugd2lsbCBiZWNvbWUgdGhlIHNpbmdsZSBwYWdlIGluIHRoZSBzdGFjay5cbiAgICpcbiAgICogTmF2aWdhdGluZyByb290IGNhbiBhbHNvIGJlIHRyaWdnZXJlZCBpbiBhIGRlY2xhcmF0aXZlIG1hbm5lciBieSB1c2luZyB0aGUgYFtyb3V0ZXJEaXJlY3Rpb25dYCBkaXJlY3RpdmU6XG4gICAqXG4gICAqIGBgYGh0bWxcbiAgICogPGEgcm91dGVyTGluaz1cIi9wYXRoL3RvL3BhZ2VcIiByb3V0ZXJEaXJlY3Rpb249XCJyb290XCI+TGluazwvYT5cbiAgICogYGBgXG4gICAqL1xuICBuYXZpZ2F0ZVJvb3QodXJsOiBzdHJpbmcgfCBVcmxUcmVlIHwgYW55W10sIG9wdGlvbnM6IE5hdmlnYXRpb25PcHRpb25zID0ge30pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0aGlzLnNldERpcmVjdGlvbigncm9vdCcsIG9wdGlvbnMuYW5pbWF0ZWQsIG9wdGlvbnMuYW5pbWF0aW9uRGlyZWN0aW9uLCBvcHRpb25zLmFuaW1hdGlvbik7XG4gICAgcmV0dXJuIHRoaXMubmF2aWdhdGUodXJsLCBvcHRpb25zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTYW1lIGFzIFtMb2NhdGlvbl0oaHR0cHM6Ly9hbmd1bGFyLmlvL2FwaS9jb21tb24vTG9jYXRpb24pJ3MgYmFjaygpIG1ldGhvZC5cbiAgICogSXQgd2lsbCB1c2UgdGhlIHN0YW5kYXJkIGB3aW5kb3cuaGlzdG9yeS5iYWNrKClgIHVuZGVyIHRoZSBob29kLCBidXQgZmVhdHVyaW5nIGEgYGJhY2tgIGFuaW1hdGlvblxuICAgKiBieSBkZWZhdWx0LlxuICAgKi9cbiAgYmFjayhvcHRpb25zOiBBbmltYXRpb25PcHRpb25zID0geyBhbmltYXRlZDogdHJ1ZSwgYW5pbWF0aW9uRGlyZWN0aW9uOiAnYmFjaycgfSk6IHZvaWQge1xuICAgIHRoaXMuc2V0RGlyZWN0aW9uKCdiYWNrJywgb3B0aW9ucy5hbmltYXRlZCwgb3B0aW9ucy5hbmltYXRpb25EaXJlY3Rpb24sIG9wdGlvbnMuYW5pbWF0aW9uKTtcbiAgICByZXR1cm4gdGhpcy5sb2NhdGlvbi5iYWNrKCk7XG4gIH1cblxuICAvKipcbiAgICogVGhpcyBtZXRob2RzIGdvZXMgYmFjayBpbiB0aGUgY29udGV4dCBvZiBJb25pYydzIHN0YWNrIG5hdmlnYXRpb24uXG4gICAqXG4gICAqIEl0IHJlY3Vyc2l2ZWx5IGZpbmRzIHRoZSB0b3AgYWN0aXZlIGBpb24tcm91dGVyLW91dGxldGAgYW5kIGNhbGxzIGBwb3AoKWAuXG4gICAqIFRoaXMgaXMgdGhlIHJlY29tbWVuZGVkIHdheSB0byBnbyBiYWNrIHdoZW4geW91IGFyZSB1c2luZyBgaW9uLXJvdXRlci1vdXRsZXRgLlxuICAgKlxuICAgKiBSZXNvbHZlcyB0byBgdHJ1ZWAgaWYgaXQgd2FzIGFibGUgdG8gcG9wLlxuICAgKi9cbiAgYXN5bmMgcG9wKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGxldCBvdXRsZXQgPSB0aGlzLnRvcE91dGxldDtcblxuICAgIHdoaWxlIChvdXRsZXQpIHtcbiAgICAgIGlmIChhd2FpdCBvdXRsZXQucG9wKCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvdXRsZXQgPSBvdXRsZXQucGFyZW50T3V0bGV0O1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGlzIG1ldGhvZHMgc3BlY2lmaWVzIHRoZSBkaXJlY3Rpb24gb2YgdGhlIG5leHQgbmF2aWdhdGlvbiBwZXJmb3JtZWQgYnkgdGhlIEFuZ3VsYXIgcm91dGVyLlxuICAgKlxuICAgKiBgc2V0RGlyZWN0aW9uKClgIGRvZXMgbm90IHRyaWdnZXIgYW55IHRyYW5zaXRpb24sIGl0IGp1c3Qgc2V0cyBzb21lIGZsYWdzIHRvIGJlIGNvbnN1bWVkIGJ5IGBpb24tcm91dGVyLW91dGxldGAuXG4gICAqXG4gICAqIEl0J3MgcmVjb21tZW5kZWQgdG8gdXNlIGBuYXZpZ2F0ZUZvcndhcmQoKWAsIGBuYXZpZ2F0ZUJhY2soKWAgYW5kIGBuYXZpZ2F0ZVJvb3QoKWAgaW5zdGVhZCBvZiBgc2V0RGlyZWN0aW9uKClgLlxuICAgKi9cbiAgc2V0RGlyZWN0aW9uKFxuICAgIGRpcmVjdGlvbjogUm91dGVyRGlyZWN0aW9uLFxuICAgIGFuaW1hdGVkPzogYm9vbGVhbixcbiAgICBhbmltYXRpb25EaXJlY3Rpb24/OiAnZm9yd2FyZCcgfCAnYmFjaycsXG4gICAgYW5pbWF0aW9uQnVpbGRlcj86IEFuaW1hdGlvbkJ1aWxkZXJcbiAgKTogdm9pZCB7XG4gICAgdGhpcy5kaXJlY3Rpb24gPSBkaXJlY3Rpb247XG4gICAgdGhpcy5hbmltYXRlZCA9IGdldEFuaW1hdGlvbihkaXJlY3Rpb24sIGFuaW1hdGVkLCBhbmltYXRpb25EaXJlY3Rpb24pO1xuICAgIHRoaXMuYW5pbWF0aW9uQnVpbGRlciA9IGFuaW1hdGlvbkJ1aWxkZXI7XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBzZXRUb3BPdXRsZXQob3V0bGV0OiBJb25Sb3V0ZXJPdXRsZXQpOiB2b2lkIHtcbiAgICB0aGlzLnRvcE91dGxldCA9IG91dGxldDtcbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIGNvbnN1bWVUcmFuc2l0aW9uKCk6IHtcbiAgICBkaXJlY3Rpb246IFJvdXRlckRpcmVjdGlvbjtcbiAgICBhbmltYXRpb246IE5hdkRpcmVjdGlvbiB8IHVuZGVmaW5lZDtcbiAgICBhbmltYXRpb25CdWlsZGVyOiBBbmltYXRpb25CdWlsZGVyIHwgdW5kZWZpbmVkO1xuICB9IHtcbiAgICBsZXQgZGlyZWN0aW9uOiBSb3V0ZXJEaXJlY3Rpb24gPSAncm9vdCc7XG4gICAgbGV0IGFuaW1hdGlvbjogTmF2RGlyZWN0aW9uIHwgdW5kZWZpbmVkO1xuICAgIGNvbnN0IGFuaW1hdGlvbkJ1aWxkZXIgPSB0aGlzLmFuaW1hdGlvbkJ1aWxkZXI7XG5cbiAgICBpZiAodGhpcy5kaXJlY3Rpb24gPT09ICdhdXRvJykge1xuICAgICAgZGlyZWN0aW9uID0gdGhpcy5ndWVzc0RpcmVjdGlvbjtcbiAgICAgIGFuaW1hdGlvbiA9IHRoaXMuZ3Vlc3NBbmltYXRpb247XG4gICAgfSBlbHNlIHtcbiAgICAgIGFuaW1hdGlvbiA9IHRoaXMuYW5pbWF0ZWQ7XG4gICAgICBkaXJlY3Rpb24gPSB0aGlzLmRpcmVjdGlvbjtcbiAgICB9XG4gICAgdGhpcy5kaXJlY3Rpb24gPSBERUZBVUxUX0RJUkVDVElPTjtcbiAgICB0aGlzLmFuaW1hdGVkID0gREVGQVVMVF9BTklNQVRFRDtcbiAgICB0aGlzLmFuaW1hdGlvbkJ1aWxkZXIgPSB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGlyZWN0aW9uLFxuICAgICAgYW5pbWF0aW9uLFxuICAgICAgYW5pbWF0aW9uQnVpbGRlcixcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBuYXZpZ2F0ZSh1cmw6IHN0cmluZyB8IFVybFRyZWUgfCBhbnlbXSwgb3B0aW9uczogTmF2aWdhdGlvbk9wdGlvbnMpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh1cmwpKSB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgICAgcmV0dXJuIHRoaXMucm91dGVyIS5uYXZpZ2F0ZSh1cmwsIG9wdGlvbnMpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvKipcbiAgICAgICAqIG5hdmlnYXRlQnlVcmwgaWdub3JlcyBhbnkgcHJvcGVydGllcyB0aGF0XG4gICAgICAgKiB3b3VsZCBjaGFuZ2UgdGhlIHVybCwgc28gdGhpbmdzIGxpa2UgcXVlcnlQYXJhbXNcbiAgICAgICAqIHdvdWxkIGJlIGlnbm9yZWQgdW5sZXNzIHdlIGNyZWF0ZSBhIHVybCB0cmVlXG4gICAgICAgKiBNb3JlIEluZm86IGh0dHBzOi8vZ2l0aHViLmNvbS9hbmd1bGFyL2FuZ3VsYXIvaXNzdWVzLzE4Nzk4XG4gICAgICAgKi9cbiAgICAgIGNvbnN0IHVybFRyZWUgPSB0aGlzLnNlcmlhbGl6ZXIucGFyc2UodXJsLnRvU3RyaW5nKCkpO1xuXG4gICAgICBpZiAob3B0aW9ucy5xdWVyeVBhcmFtcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHVybFRyZWUucXVlcnlQYXJhbXMgPSB7IC4uLm9wdGlvbnMucXVlcnlQYXJhbXMgfTtcbiAgICAgIH1cblxuICAgICAgaWYgKG9wdGlvbnMuZnJhZ21lbnQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB1cmxUcmVlLmZyYWdtZW50ID0gb3B0aW9ucy5mcmFnbWVudDtcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBgbmF2aWdhdGVCeVVybGAgd2lsbCBzdGlsbCBhcHBseSBgTmF2aWdhdGlvbkV4dHJhc2AgcHJvcGVydGllc1xuICAgICAgICogdGhhdCBkbyBub3QgbW9kaWZ5IHRoZSB1cmwsIHN1Y2ggYXMgYHJlcGxhY2VVcmxgIHdoaWNoIGlzIHdoeVxuICAgICAgICogYG9wdGlvbnNgIGlzIHBhc3NlZCBpbiBoZXJlLlxuICAgICAgICovXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgICAgcmV0dXJuIHRoaXMucm91dGVyIS5uYXZpZ2F0ZUJ5VXJsKHVybFRyZWUsIG9wdGlvbnMpO1xuICAgIH1cbiAgfVxufVxuXG5jb25zdCBnZXRBbmltYXRpb24gPSAoXG4gIGRpcmVjdGlvbjogUm91dGVyRGlyZWN0aW9uLFxuICBhbmltYXRlZDogYm9vbGVhbiB8IHVuZGVmaW5lZCxcbiAgYW5pbWF0aW9uRGlyZWN0aW9uOiAnZm9yd2FyZCcgfCAnYmFjaycgfCB1bmRlZmluZWRcbik6IE5hdkRpcmVjdGlvbiB8IHVuZGVmaW5lZCA9PiB7XG4gIGlmIChhbmltYXRlZCA9PT0gZmFsc2UpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmIChhbmltYXRpb25EaXJlY3Rpb24gIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBhbmltYXRpb25EaXJlY3Rpb247XG4gIH1cbiAgaWYgKGRpcmVjdGlvbiA9PT0gJ2ZvcndhcmQnIHx8IGRpcmVjdGlvbiA9PT0gJ2JhY2snKSB7XG4gICAgcmV0dXJuIGRpcmVjdGlvbjtcbiAgfSBlbHNlIGlmIChkaXJlY3Rpb24gPT09ICdyb290JyAmJiBhbmltYXRlZCA9PT0gdHJ1ZSkge1xuICAgIHJldHVybiAnZm9yd2FyZCc7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbmNvbnN0IERFRkFVTFRfRElSRUNUSU9OID0gJ2F1dG8nO1xuY29uc3QgREVGQVVMVF9BTklNQVRFRCA9IHVuZGVmaW5lZDtcbiJdfQ==