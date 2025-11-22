import { Directive, ElementRef, EventEmitter, HostListener, Output, ViewChild, } from '@angular/core';
import * as i0 from "@angular/core";
import * as i1 from "../../providers/nav-controller";
class IonTabs {
    navCtrl;
    tabsInner;
    /**
     * Emitted before the tab view is changed.
     */
    ionTabsWillChange = new EventEmitter();
    /**
     * Emitted after the tab view is changed.
     */
    ionTabsDidChange = new EventEmitter();
    tabBarSlot = 'bottom';
    hasTab = false;
    selectedTab;
    leavingTab;
    constructor(navCtrl) {
        this.navCtrl = navCtrl;
    }
    ngAfterViewInit() {
        /**
         * Developers must pass at least one ion-tab
         * inside of ion-tabs if they want to use a
         * basic tab-based navigation without the
         * history stack or URL updates associated
         * with the router.
         */
        const firstTab = this.tabs.length > 0 ? this.tabs.first : undefined;
        if (firstTab) {
            this.hasTab = true;
            this.setActiveTab(firstTab.tab);
            this.tabSwitch();
        }
    }
    ngAfterContentInit() {
        this.detectSlotChanges();
    }
    ngAfterContentChecked() {
        this.detectSlotChanges();
    }
    /**
     * @internal
     */
    onStackWillChange({ enteringView, tabSwitch }) {
        const stackId = enteringView.stackId;
        if (tabSwitch && stackId !== undefined) {
            this.ionTabsWillChange.emit({ tab: stackId });
        }
    }
    /**
     * @internal
     */
    onStackDidChange({ enteringView, tabSwitch }) {
        const stackId = enteringView.stackId;
        if (tabSwitch && stackId !== undefined) {
            if (this.tabBar) {
                this.tabBar.selectedTab = stackId;
            }
            this.ionTabsDidChange.emit({ tab: stackId });
        }
    }
    /**
     * When a tab button is clicked, there are several scenarios:
     * 1. If the selected tab is currently active (the tab button has been clicked
     *    again), then it should go to the root view for that tab.
     *
     *   a. Get the saved root view from the router outlet. If the saved root view
     *      matches the tabRootUrl, set the route view to this view including the
     *      navigation extras.
     *   b. If the saved root view from the router outlet does
     *      not match, navigate to the tabRootUrl. No navigation extras are
     *      included.
     *
     * 2. If the current tab tab is not currently selected, get the last route
     *    view from the router outlet.
     *
     *   a. If the last route view exists, navigate to that view including any
     *      navigation extras
     *   b. If the last route view doesn't exist, then navigate
     *      to the default tabRootUrl
     */
    select(tabOrEvent) {
        const isTabString = typeof tabOrEvent === 'string';
        const tab = isTabString ? tabOrEvent : tabOrEvent.detail.tab;
        /**
         * If the tabs are not using the router, then
         * the tab switch logic is handled by the tabs
         * component itself.
         */
        if (this.hasTab) {
            this.setActiveTab(tab);
            this.tabSwitch();
            return;
        }
        const alreadySelected = this.outlet.getActiveStackId() === tab;
        const tabRootUrl = `${this.outlet.tabsPrefix}/${tab}`;
        /**
         * If this is a nested tab, prevent the event
         * from bubbling otherwise the outer tabs
         * will respond to this event too, causing
         * the app to get directed to the wrong place.
         */
        if (!isTabString) {
            tabOrEvent.stopPropagation();
        }
        if (alreadySelected) {
            const activeStackId = this.outlet.getActiveStackId();
            const activeView = this.outlet.getLastRouteView(activeStackId);
            // If on root tab, do not navigate to root tab again
            if (activeView?.url === tabRootUrl) {
                return;
            }
            const rootView = this.outlet.getRootView(tab);
            const navigationExtras = rootView && tabRootUrl === rootView.url && rootView.savedExtras;
            return this.navCtrl.navigateRoot(tabRootUrl, {
                ...navigationExtras,
                animated: true,
                animationDirection: 'back',
            });
        }
        else {
            const lastRoute = this.outlet.getLastRouteView(tab);
            /**
             * If there is a lastRoute, goto that, otherwise goto the fallback url of the
             * selected tab
             */
            const url = lastRoute?.url || tabRootUrl;
            const navigationExtras = lastRoute?.savedExtras;
            return this.navCtrl.navigateRoot(url, {
                ...navigationExtras,
                animated: true,
                animationDirection: 'back',
            });
        }
    }
    setActiveTab(tab) {
        const tabs = this.tabs;
        const selectedTab = tabs.find((t) => t.tab === tab);
        if (!selectedTab) {
            console.error(`[Ionic Error]: Tab with id: "${tab}" does not exist`);
            return;
        }
        this.leavingTab = this.selectedTab;
        this.selectedTab = selectedTab;
        this.ionTabsWillChange.emit({ tab });
        selectedTab.el.active = true;
    }
    tabSwitch() {
        const { selectedTab, leavingTab } = this;
        if (this.tabBar && selectedTab) {
            this.tabBar.selectedTab = selectedTab.tab;
        }
        if (leavingTab?.tab !== selectedTab?.tab) {
            if (leavingTab?.el) {
                leavingTab.el.active = false;
            }
        }
        if (selectedTab) {
            this.ionTabsDidChange.emit({ tab: selectedTab.tab });
        }
    }
    getSelected() {
        if (this.hasTab) {
            return this.selectedTab?.tab;
        }
        return this.outlet.getActiveStackId();
    }
    /**
     * Detects changes to the slot attribute of the tab bar.
     *
     * If the slot attribute has changed, then the tab bar
     * should be relocated to the new slot position.
     */
    detectSlotChanges() {
        this.tabBars.forEach((tabBar) => {
            // el is a protected attribute from the generated component wrapper
            const currentSlot = tabBar.el.getAttribute('slot');
            if (currentSlot !== this.tabBarSlot) {
                this.tabBarSlot = currentSlot;
                this.relocateTabBar();
            }
        });
    }
    /**
     * Relocates the tab bar to the new slot position.
     */
    relocateTabBar() {
        /**
         * `el` is a protected attribute from the generated component wrapper.
         * To avoid having to manually create the wrapper for tab bar, we
         * cast the tab bar to any and access the protected attribute.
         */
        const tabBar = this.tabBar.el;
        if (this.tabBarSlot === 'top') {
            /**
             * A tab bar with a slot of "top" should be inserted
             * at the top of the container.
             */
            this.tabsInner.nativeElement.before(tabBar);
        }
        else {
            /**
             * A tab bar with a slot of "bottom" or without a slot
             * should be inserted at the end of the container.
             */
            this.tabsInner.nativeElement.after(tabBar);
        }
    }
    /** @nocollapse */ static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: IonTabs, deps: [{ token: i1.NavController }], target: i0.ɵɵFactoryTarget.Directive });
    /** @nocollapse */ static ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "16.2.12", type: IonTabs, selector: "ion-tabs", outputs: { ionTabsWillChange: "ionTabsWillChange", ionTabsDidChange: "ionTabsDidChange" }, host: { listeners: { "ionTabButtonClick": "select($event)" } }, viewQueries: [{ propertyName: "tabsInner", first: true, predicate: ["tabsInner"], descendants: true, read: ElementRef, static: true }], ngImport: i0 });
}
export { IonTabs };
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: IonTabs, decorators: [{
            type: Directive,
            args: [{
                    selector: 'ion-tabs',
                }]
        }], ctorParameters: function () { return [{ type: i1.NavController }]; }, propDecorators: { tabsInner: [{
                type: ViewChild,
                args: ['tabsInner', { read: ElementRef, static: true }]
            }], ionTabsWillChange: [{
                type: Output
            }], ionTabsDidChange: [{
                type: Output
            }], select: [{
                type: HostListener,
                args: ['ionTabButtonClick', ['$event']]
            }] } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFicy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL2NvbW1vbi9zcmMvZGlyZWN0aXZlcy9uYXZpZ2F0aW9uL3RhYnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUdMLFNBQVMsRUFDVCxVQUFVLEVBQ1YsWUFBWSxFQUNaLFlBQVksRUFDWixNQUFNLEVBQ04sU0FBUyxHQUdWLE1BQU0sZUFBZSxDQUFDOzs7QUFNdkIsTUFJc0IsT0FBTztJQTJCUDtJQWpCd0MsU0FBUyxDQUE2QjtJQUVsRzs7T0FFRztJQUNPLGlCQUFpQixHQUFHLElBQUksWUFBWSxFQUFtQixDQUFDO0lBQ2xFOztPQUVHO0lBQ08sZ0JBQWdCLEdBQUcsSUFBSSxZQUFZLEVBQW1CLENBQUM7SUFFekQsVUFBVSxHQUFHLFFBQVEsQ0FBQztJQUV0QixNQUFNLEdBQUcsS0FBSyxDQUFDO0lBQ2YsV0FBVyxDQUFtQjtJQUM5QixVQUFVLENBQU87SUFFekIsWUFBb0IsT0FBc0I7UUFBdEIsWUFBTyxHQUFQLE9BQU8sQ0FBZTtJQUFHLENBQUM7SUFFOUMsZUFBZTtRQUNiOzs7Ozs7V0FNRztRQUNILE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztRQUVwRSxJQUFJLFFBQVEsRUFBRTtZQUNaLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO1lBQ25CLElBQUksQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ2hDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztTQUNsQjtJQUNILENBQUM7SUFFRCxrQkFBa0I7UUFDaEIsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELHFCQUFxQjtRQUNuQixJQUFJLENBQUMsaUJBQWlC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O2tCQUo1QixTQUFTO21CQUFDO29CQUNULFFBQVEsRUFBRSxVQUFVO2lCQUNyQjtvR0FZNkQsU0FBUztzQkFBcEUsU0FBUzt1QkFBQyxXQUFXLEVBQUUsRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUU7Z0JBS2hELGlCQUFpQjtzQkFBMUIsTUFBTTtnQkFJRyxnQkFBZ0I7c0JBQXpCLE1BQU07Z0JBK0VQLE1BQU07c0JBREwsWUFBWTt1QkFBQyxtQkFBbUIsRUFBRSxDQUFDLFFBQVEsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIEFmdGVyQ29udGVudENoZWNrZWQsXG4gIEFmdGVyQ29udGVudEluaXQsXG4gIERpcmVjdGl2ZSxcbiAgRWxlbWVudFJlZixcbiAgRXZlbnRFbWl0dGVyLFxuICBIb3N0TGlzdGVuZXIsXG4gIE91dHB1dCxcbiAgVmlld0NoaWxkLFxuICBBZnRlclZpZXdJbml0LFxuICBRdWVyeUxpc3QsXG59IGZyb20gJ0Bhbmd1bGFyL2NvcmUnO1xuXG5pbXBvcnQgeyBOYXZDb250cm9sbGVyIH0gZnJvbSAnLi4vLi4vcHJvdmlkZXJzL25hdi1jb250cm9sbGVyJztcblxuaW1wb3J0IHsgU3RhY2tEaWRDaGFuZ2VFdmVudCwgU3RhY2tXaWxsQ2hhbmdlRXZlbnQgfSBmcm9tICcuL3N0YWNrLXV0aWxzJztcblxuQERpcmVjdGl2ZSh7XG4gIHNlbGVjdG9yOiAnaW9uLXRhYnMnLFxufSlcbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAYW5ndWxhci1lc2xpbnQvZGlyZWN0aXZlLWNsYXNzLXN1ZmZpeFxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIElvblRhYnMgaW1wbGVtZW50cyBBZnRlclZpZXdJbml0LCBBZnRlckNvbnRlbnRJbml0LCBBZnRlckNvbnRlbnRDaGVja2VkIHtcbiAgLyoqXG4gICAqIE5vdGU6IFRoZXNlIG11c3QgYmUgcmVkZWNsYXJlZCBvbiBlYWNoIGNoaWxkIGNsYXNzIHNpbmNlIGl0IG5lZWRzXG4gICAqIGFjY2VzcyB0byBnZW5lcmF0ZWQgY29tcG9uZW50cyBzdWNoIGFzIElvblJvdXRlck91dGxldCBhbmQgSW9uVGFiQmFyLlxuICAgKi9cbiAgYWJzdHJhY3Qgb3V0bGV0OiBhbnk7XG4gIGFic3RyYWN0IHRhYkJhcjogYW55O1xuICBhYnN0cmFjdCB0YWJCYXJzOiBRdWVyeUxpc3Q8YW55PjtcbiAgYWJzdHJhY3QgdGFiczogUXVlcnlMaXN0PGFueT47XG5cbiAgQFZpZXdDaGlsZCgndGFic0lubmVyJywgeyByZWFkOiBFbGVtZW50UmVmLCBzdGF0aWM6IHRydWUgfSkgdGFic0lubmVyOiBFbGVtZW50UmVmPEhUTUxEaXZFbGVtZW50PjtcblxuICAvKipcbiAgICogRW1pdHRlZCBiZWZvcmUgdGhlIHRhYiB2aWV3IGlzIGNoYW5nZWQuXG4gICAqL1xuICBAT3V0cHV0KCkgaW9uVGFic1dpbGxDaGFuZ2UgPSBuZXcgRXZlbnRFbWl0dGVyPHsgdGFiOiBzdHJpbmcgfT4oKTtcbiAgLyoqXG4gICAqIEVtaXR0ZWQgYWZ0ZXIgdGhlIHRhYiB2aWV3IGlzIGNoYW5nZWQuXG4gICAqL1xuICBAT3V0cHV0KCkgaW9uVGFic0RpZENoYW5nZSA9IG5ldyBFdmVudEVtaXR0ZXI8eyB0YWI6IHN0cmluZyB9PigpO1xuXG4gIHByaXZhdGUgdGFiQmFyU2xvdCA9ICdib3R0b20nO1xuXG4gIHByaXZhdGUgaGFzVGFiID0gZmFsc2U7XG4gIHByaXZhdGUgc2VsZWN0ZWRUYWI/OiB7IHRhYjogc3RyaW5nIH07XG4gIHByaXZhdGUgbGVhdmluZ1RhYj86IGFueTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIG5hdkN0cmw6IE5hdkNvbnRyb2xsZXIpIHt9XG5cbiAgbmdBZnRlclZpZXdJbml0KCk6IHZvaWQge1xuICAgIC8qKlxuICAgICAqIERldmVsb3BlcnMgbXVzdCBwYXNzIGF0IGxlYXN0IG9uZSBpb24tdGFiXG4gICAgICogaW5zaWRlIG9mIGlvbi10YWJzIGlmIHRoZXkgd2FudCB0byB1c2UgYVxuICAgICAqIGJhc2ljIHRhYi1iYXNlZCBuYXZpZ2F0aW9uIHdpdGhvdXQgdGhlXG4gICAgICogaGlzdG9yeSBzdGFjayBvciBVUkwgdXBkYXRlcyBhc3NvY2lhdGVkXG4gICAgICogd2l0aCB0aGUgcm91dGVyLlxuICAgICAqL1xuICAgIGNvbnN0IGZpcnN0VGFiID0gdGhpcy50YWJzLmxlbmd0aCA+IDAgPyB0aGlzLnRhYnMuZmlyc3QgOiB1bmRlZmluZWQ7XG5cbiAgICBpZiAoZmlyc3RUYWIpIHtcbiAgICAgIHRoaXMuaGFzVGFiID0gdHJ1ZTtcbiAgICAgIHRoaXMuc2V0QWN0aXZlVGFiKGZpcnN0VGFiLnRhYik7XG4gICAgICB0aGlzLnRhYlN3aXRjaCgpO1xuICAgIH1cbiAgfVxuXG4gIG5nQWZ0ZXJDb250ZW50SW5pdCgpOiB2b2lkIHtcbiAgICB0aGlzLmRldGVjdFNsb3RDaGFuZ2VzKCk7XG4gIH1cblxuICBuZ0FmdGVyQ29udGVudENoZWNrZWQoKTogdm9pZCB7XG4gICAgdGhpcy5kZXRlY3RTbG90Q2hhbmdlcygpO1xuICB9XG5cbiAgLyoqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgb25TdGFja1dpbGxDaGFuZ2UoeyBlbnRlcmluZ1ZpZXcsIHRhYlN3aXRjaCB9OiBTdGFja1dpbGxDaGFuZ2VFdmVudCk6IHZvaWQge1xuICAgIGNvbnN0IHN0YWNrSWQgPSBlbnRlcmluZ1ZpZXcuc3RhY2tJZDtcbiAgICBpZiAodGFiU3dpdGNoICYmIHN0YWNrSWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5pb25UYWJzV2lsbENoYW5nZS5lbWl0KHsgdGFiOiBzdGFja0lkIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIG9uU3RhY2tEaWRDaGFuZ2UoeyBlbnRlcmluZ1ZpZXcsIHRhYlN3aXRjaCB9OiBTdGFja0RpZENoYW5nZUV2ZW50KTogdm9pZCB7XG4gICAgY29uc3Qgc3RhY2tJZCA9IGVudGVyaW5nVmlldy5zdGFja0lkO1xuICAgIGlmICh0YWJTd2l0Y2ggJiYgc3RhY2tJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAodGhpcy50YWJCYXIpIHtcbiAgICAgICAgdGhpcy50YWJCYXIuc2VsZWN0ZWRUYWIgPSBzdGFja0lkO1xuICAgICAgfVxuICAgICAgdGhpcy5pb25UYWJzRGlkQ2hhbmdlLmVtaXQoeyB0YWI6IHN0YWNrSWQgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZW4gYSB0YWIgYnV0dG9uIGlzIGNsaWNrZWQsIHRoZXJlIGFyZSBzZXZlcmFsIHNjZW5hcmlvczpcbiAgICogMS4gSWYgdGhlIHNlbGVjdGVkIHRhYiBpcyBjdXJyZW50bHkgYWN0aXZlICh0aGUgdGFiIGJ1dHRvbiBoYXMgYmVlbiBjbGlja2VkXG4gICAqICAgIGFnYWluKSwgdGhlbiBpdCBzaG91bGQgZ28gdG8gdGhlIHJvb3QgdmlldyBmb3IgdGhhdCB0YWIuXG4gICAqXG4gICAqICAgYS4gR2V0IHRoZSBzYXZlZCByb290IHZpZXcgZnJvbSB0aGUgcm91dGVyIG91dGxldC4gSWYgdGhlIHNhdmVkIHJvb3Qgdmlld1xuICAgKiAgICAgIG1hdGNoZXMgdGhlIHRhYlJvb3RVcmwsIHNldCB0aGUgcm91dGUgdmlldyB0byB0aGlzIHZpZXcgaW5jbHVkaW5nIHRoZVxuICAgKiAgICAgIG5hdmlnYXRpb24gZXh0cmFzLlxuICAgKiAgIGIuIElmIHRoZSBzYXZlZCByb290IHZpZXcgZnJvbSB0aGUgcm91dGVyIG91dGxldCBkb2VzXG4gICAqICAgICAgbm90IG1hdGNoLCBuYXZpZ2F0ZSB0byB0aGUgdGFiUm9vdFVybC4gTm8gbmF2aWdhdGlvbiBleHRyYXMgYXJlXG4gICAqICAgICAgaW5jbHVkZWQuXG4gICAqXG4gICAqIDIuIElmIHRoZSBjdXJyZW50IHRhYiB0YWIgaXMgbm90IGN1cnJlbnRseSBzZWxlY3RlZCwgZ2V0IHRoZSBsYXN0IHJvdXRlXG4gICAqICAgIHZpZXcgZnJvbSB0aGUgcm91dGVyIG91dGxldC5cbiAgICpcbiAgICogICBhLiBJZiB0aGUgbGFzdCByb3V0ZSB2aWV3IGV4aXN0cywgbmF2aWdhdGUgdG8gdGhhdCB2aWV3IGluY2x1ZGluZyBhbnlcbiAgICogICAgICBuYXZpZ2F0aW9uIGV4dHJhc1xuICAgKiAgIGIuIElmIHRoZSBsYXN0IHJvdXRlIHZpZXcgZG9lc24ndCBleGlzdCwgdGhlbiBuYXZpZ2F0ZVxuICAgKiAgICAgIHRvIHRoZSBkZWZhdWx0IHRhYlJvb3RVcmxcbiAgICovXG4gIEBIb3N0TGlzdGVuZXIoJ2lvblRhYkJ1dHRvbkNsaWNrJywgWyckZXZlbnQnXSlcbiAgc2VsZWN0KHRhYk9yRXZlbnQ6IHN0cmluZyB8IEN1c3RvbUV2ZW50KTogUHJvbWlzZTxib29sZWFuPiB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgaXNUYWJTdHJpbmcgPSB0eXBlb2YgdGFiT3JFdmVudCA9PT0gJ3N0cmluZyc7XG4gICAgY29uc3QgdGFiID0gaXNUYWJTdHJpbmcgPyB0YWJPckV2ZW50IDogKHRhYk9yRXZlbnQgYXMgQ3VzdG9tRXZlbnQpLmRldGFpbC50YWI7XG5cbiAgICAvKipcbiAgICAgKiBJZiB0aGUgdGFicyBhcmUgbm90IHVzaW5nIHRoZSByb3V0ZXIsIHRoZW5cbiAgICAgKiB0aGUgdGFiIHN3aXRjaCBsb2dpYyBpcyBoYW5kbGVkIGJ5IHRoZSB0YWJzXG4gICAgICogY29tcG9uZW50IGl0c2VsZi5cbiAgICAgKi9cbiAgICBpZiAodGhpcy5oYXNUYWIpIHtcbiAgICAgIHRoaXMuc2V0QWN0aXZlVGFiKHRhYik7XG4gICAgICB0aGlzLnRhYlN3aXRjaCgpO1xuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgYWxyZWFkeVNlbGVjdGVkID0gdGhpcy5vdXRsZXQuZ2V0QWN0aXZlU3RhY2tJZCgpID09PSB0YWI7XG4gICAgY29uc3QgdGFiUm9vdFVybCA9IGAke3RoaXMub3V0bGV0LnRhYnNQcmVmaXh9LyR7dGFifWA7XG5cbiAgICAvKipcbiAgICAgKiBJZiB0aGlzIGlzIGEgbmVzdGVkIHRhYiwgcHJldmVudCB0aGUgZXZlbnRcbiAgICAgKiBmcm9tIGJ1YmJsaW5nIG90aGVyd2lzZSB0aGUgb3V0ZXIgdGFic1xuICAgICAqIHdpbGwgcmVzcG9uZCB0byB0aGlzIGV2ZW50IHRvbywgY2F1c2luZ1xuICAgICAqIHRoZSBhcHAgdG8gZ2V0IGRpcmVjdGVkIHRvIHRoZSB3cm9uZyBwbGFjZS5cbiAgICAgKi9cbiAgICBpZiAoIWlzVGFiU3RyaW5nKSB7XG4gICAgICAodGFiT3JFdmVudCBhcyBDdXN0b21FdmVudCkuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgfVxuXG4gICAgaWYgKGFscmVhZHlTZWxlY3RlZCkge1xuICAgICAgY29uc3QgYWN0aXZlU3RhY2tJZCA9IHRoaXMub3V0bGV0LmdldEFjdGl2ZVN0YWNrSWQoKTtcbiAgICAgIGNvbnN0IGFjdGl2ZVZpZXcgPSB0aGlzLm91dGxldC5nZXRMYXN0Um91dGVWaWV3KGFjdGl2ZVN0YWNrSWQpO1xuXG4gICAgICAvLyBJZiBvbiByb290IHRhYiwgZG8gbm90IG5hdmlnYXRlIHRvIHJvb3QgdGFiIGFnYWluXG4gICAgICBpZiAoYWN0aXZlVmlldz8udXJsID09PSB0YWJSb290VXJsKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgcm9vdFZpZXcgPSB0aGlzLm91dGxldC5nZXRSb290Vmlldyh0YWIpO1xuICAgICAgY29uc3QgbmF2aWdhdGlvbkV4dHJhcyA9IHJvb3RWaWV3ICYmIHRhYlJvb3RVcmwgPT09IHJvb3RWaWV3LnVybCAmJiByb290Vmlldy5zYXZlZEV4dHJhcztcbiAgICAgIHJldHVybiB0aGlzLm5hdkN0cmwubmF2aWdhdGVSb290KHRhYlJvb3RVcmwsIHtcbiAgICAgICAgLi4ubmF2aWdhdGlvbkV4dHJhcyxcbiAgICAgICAgYW5pbWF0ZWQ6IHRydWUsXG4gICAgICAgIGFuaW1hdGlvbkRpcmVjdGlvbjogJ2JhY2snLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGxhc3RSb3V0ZSA9IHRoaXMub3V0bGV0LmdldExhc3RSb3V0ZVZpZXcodGFiKTtcbiAgICAgIC8qKlxuICAgICAgICogSWYgdGhlcmUgaXMgYSBsYXN0Um91dGUsIGdvdG8gdGhhdCwgb3RoZXJ3aXNlIGdvdG8gdGhlIGZhbGxiYWNrIHVybCBvZiB0aGVcbiAgICAgICAqIHNlbGVjdGVkIHRhYlxuICAgICAgICovXG4gICAgICBjb25zdCB1cmwgPSBsYXN0Um91dGU/LnVybCB8fCB0YWJSb290VXJsO1xuICAgICAgY29uc3QgbmF2aWdhdGlvbkV4dHJhcyA9IGxhc3RSb3V0ZT8uc2F2ZWRFeHRyYXM7XG5cbiAgICAgIHJldHVybiB0aGlzLm5hdkN0cmwubmF2aWdhdGVSb290KHVybCwge1xuICAgICAgICAuLi5uYXZpZ2F0aW9uRXh0cmFzLFxuICAgICAgICBhbmltYXRlZDogdHJ1ZSxcbiAgICAgICAgYW5pbWF0aW9uRGlyZWN0aW9uOiAnYmFjaycsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHNldEFjdGl2ZVRhYih0YWI6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IHRhYnMgPSB0aGlzLnRhYnM7XG4gICAgY29uc3Qgc2VsZWN0ZWRUYWIgPSB0YWJzLmZpbmQoKHQ6IGFueSkgPT4gdC50YWIgPT09IHRhYik7XG5cbiAgICBpZiAoIXNlbGVjdGVkVGFiKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGBbSW9uaWMgRXJyb3JdOiBUYWIgd2l0aCBpZDogXCIke3RhYn1cIiBkb2VzIG5vdCBleGlzdGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMubGVhdmluZ1RhYiA9IHRoaXMuc2VsZWN0ZWRUYWI7XG4gICAgdGhpcy5zZWxlY3RlZFRhYiA9IHNlbGVjdGVkVGFiO1xuXG4gICAgdGhpcy5pb25UYWJzV2lsbENoYW5nZS5lbWl0KHsgdGFiIH0pO1xuXG4gICAgc2VsZWN0ZWRUYWIuZWwuYWN0aXZlID0gdHJ1ZTtcbiAgfVxuXG4gIHByaXZhdGUgdGFiU3dpdGNoKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgc2VsZWN0ZWRUYWIsIGxlYXZpbmdUYWIgfSA9IHRoaXM7XG5cbiAgICBpZiAodGhpcy50YWJCYXIgJiYgc2VsZWN0ZWRUYWIpIHtcbiAgICAgIHRoaXMudGFiQmFyLnNlbGVjdGVkVGFiID0gc2VsZWN0ZWRUYWIudGFiO1xuICAgIH1cblxuICAgIGlmIChsZWF2aW5nVGFiPy50YWIgIT09IHNlbGVjdGVkVGFiPy50YWIpIHtcbiAgICAgIGlmIChsZWF2aW5nVGFiPy5lbCkge1xuICAgICAgICBsZWF2aW5nVGFiLmVsLmFjdGl2ZSA9IGZhbHNlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzZWxlY3RlZFRhYikge1xuICAgICAgdGhpcy5pb25UYWJzRGlkQ2hhbmdlLmVtaXQoeyB0YWI6IHNlbGVjdGVkVGFiLnRhYiB9KTtcbiAgICB9XG4gIH1cblxuICBnZXRTZWxlY3RlZCgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGlmICh0aGlzLmhhc1RhYikge1xuICAgICAgcmV0dXJuIHRoaXMuc2VsZWN0ZWRUYWI/LnRhYjtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5vdXRsZXQuZ2V0QWN0aXZlU3RhY2tJZCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIERldGVjdHMgY2hhbmdlcyB0byB0aGUgc2xvdCBhdHRyaWJ1dGUgb2YgdGhlIHRhYiBiYXIuXG4gICAqXG4gICAqIElmIHRoZSBzbG90IGF0dHJpYnV0ZSBoYXMgY2hhbmdlZCwgdGhlbiB0aGUgdGFiIGJhclxuICAgKiBzaG91bGQgYmUgcmVsb2NhdGVkIHRvIHRoZSBuZXcgc2xvdCBwb3NpdGlvbi5cbiAgICovXG4gIHByaXZhdGUgZGV0ZWN0U2xvdENoYW5nZXMoKTogdm9pZCB7XG4gICAgdGhpcy50YWJCYXJzLmZvckVhY2goKHRhYkJhcjogYW55KSA9PiB7XG4gICAgICAvLyBlbCBpcyBhIHByb3RlY3RlZCBhdHRyaWJ1dGUgZnJvbSB0aGUgZ2VuZXJhdGVkIGNvbXBvbmVudCB3cmFwcGVyXG4gICAgICBjb25zdCBjdXJyZW50U2xvdCA9IHRhYkJhci5lbC5nZXRBdHRyaWJ1dGUoJ3Nsb3QnKTtcblxuICAgICAgaWYgKGN1cnJlbnRTbG90ICE9PSB0aGlzLnRhYkJhclNsb3QpIHtcbiAgICAgICAgdGhpcy50YWJCYXJTbG90ID0gY3VycmVudFNsb3Q7XG4gICAgICAgIHRoaXMucmVsb2NhdGVUYWJCYXIoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxvY2F0ZXMgdGhlIHRhYiBiYXIgdG8gdGhlIG5ldyBzbG90IHBvc2l0aW9uLlxuICAgKi9cbiAgcHJpdmF0ZSByZWxvY2F0ZVRhYkJhcigpOiB2b2lkIHtcbiAgICAvKipcbiAgICAgKiBgZWxgIGlzIGEgcHJvdGVjdGVkIGF0dHJpYnV0ZSBmcm9tIHRoZSBnZW5lcmF0ZWQgY29tcG9uZW50IHdyYXBwZXIuXG4gICAgICogVG8gYXZvaWQgaGF2aW5nIHRvIG1hbnVhbGx5IGNyZWF0ZSB0aGUgd3JhcHBlciBmb3IgdGFiIGJhciwgd2VcbiAgICAgKiBjYXN0IHRoZSB0YWIgYmFyIHRvIGFueSBhbmQgYWNjZXNzIHRoZSBwcm90ZWN0ZWQgYXR0cmlidXRlLlxuICAgICAqL1xuICAgIGNvbnN0IHRhYkJhciA9ICh0aGlzLnRhYkJhciBhcyBhbnkpLmVsIGFzIEhUTUxFbGVtZW50O1xuXG4gICAgaWYgKHRoaXMudGFiQmFyU2xvdCA9PT0gJ3RvcCcpIHtcbiAgICAgIC8qKlxuICAgICAgICogQSB0YWIgYmFyIHdpdGggYSBzbG90IG9mIFwidG9wXCIgc2hvdWxkIGJlIGluc2VydGVkXG4gICAgICAgKiBhdCB0aGUgdG9wIG9mIHRoZSBjb250YWluZXIuXG4gICAgICAgKi9cbiAgICAgIHRoaXMudGFic0lubmVyLm5hdGl2ZUVsZW1lbnQuYmVmb3JlKHRhYkJhcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8qKlxuICAgICAgICogQSB0YWIgYmFyIHdpdGggYSBzbG90IG9mIFwiYm90dG9tXCIgb3Igd2l0aG91dCBhIHNsb3RcbiAgICAgICAqIHNob3VsZCBiZSBpbnNlcnRlZCBhdCB0aGUgZW5kIG9mIHRoZSBjb250YWluZXIuXG4gICAgICAgKi9cbiAgICAgIHRoaXMudGFic0lubmVyLm5hdGl2ZUVsZW1lbnQuYWZ0ZXIodGFiQmFyKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==