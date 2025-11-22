import { Injector, Injectable, EnvironmentInjector, inject } from '@angular/core';
import { AngularDelegate, OverlayBaseController } from '@ionic/angular/common';
import { modalController } from '@ionic/core/components';
import { defineCustomElement } from '@ionic/core/components/ion-modal.js';
import * as i0 from "@angular/core";
class ModalController extends OverlayBaseController {
    angularDelegate = inject(AngularDelegate);
    injector = inject(Injector);
    environmentInjector = inject(EnvironmentInjector);
    constructor() {
        super(modalController);
        defineCustomElement();
    }
    create(opts) {
        return super.create({
            ...opts,
            delegate: this.angularDelegate.create(this.environmentInjector, this.injector, 'modal'),
        });
    }
    /** @nocollapse */ static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: ModalController, deps: [], target: i0.ɵɵFactoryTarget.Injectable });
    /** @nocollapse */ static ɵprov = i0.ɵɵngDeclareInjectable({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: ModalController });
}
export { ModalController };
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "16.2.12", ngImport: i0, type: ModalController, decorators: [{
            type: Injectable
        }], ctorParameters: function () { return []; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kYWwtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3N0YW5kYWxvbmUvc3JjL3Byb3ZpZGVycy9tb2RhbC1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sRUFBRSxNQUFNLGVBQWUsQ0FBQztBQUNsRixPQUFPLEVBQUUsZUFBZSxFQUFFLHFCQUFxQixFQUFFLE1BQU0sdUJBQXVCLENBQUM7QUFFL0UsT0FBTyxFQUFFLGVBQWUsRUFBRSxNQUFNLHdCQUF3QixDQUFDO0FBQ3pELE9BQU8sRUFBRSxtQkFBbUIsRUFBRSxNQUFNLHFDQUFxQyxDQUFDOztBQUUxRSxNQUNhLGVBQWdCLFNBQVEscUJBQXdEO0lBQ25GLGVBQWUsR0FBRyxNQUFNLENBQUMsZUFBZSxDQUFDLENBQUM7SUFDMUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUM1QixtQkFBbUIsR0FBRyxNQUFNLENBQUMsbUJBQW1CLENBQUMsQ0FBQztJQUUxRDtRQUNFLEtBQUssQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUN2QixtQkFBbUIsRUFBRSxDQUFDO0lBQ3hCLENBQUM7SUFFRCxNQUFNLENBQUMsSUFBa0I7UUFDdkIsT0FBTyxLQUFLLENBQUMsTUFBTSxDQUFDO1lBQ2xCLEdBQUcsSUFBSTtZQUNQLFFBQVEsRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUM7U0FDeEYsQ0FBQyxDQUFDO0lBQ0wsQ0FBQzsySEFmVSxlQUFlOytIQUFmLGVBQWU7O1NBQWYsZUFBZTs0RkFBZixlQUFlO2tCQUQzQixVQUFVIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSW5qZWN0b3IsIEluamVjdGFibGUsIEVudmlyb25tZW50SW5qZWN0b3IsIGluamVjdCB9IGZyb20gJ0Bhbmd1bGFyL2NvcmUnO1xuaW1wb3J0IHsgQW5ndWxhckRlbGVnYXRlLCBPdmVybGF5QmFzZUNvbnRyb2xsZXIgfSBmcm9tICdAaW9uaWMvYW5ndWxhci9jb21tb24nO1xuaW1wb3J0IHR5cGUgeyBNb2RhbE9wdGlvbnMgfSBmcm9tICdAaW9uaWMvY29yZS9jb21wb25lbnRzJztcbmltcG9ydCB7IG1vZGFsQ29udHJvbGxlciB9IGZyb20gJ0Bpb25pYy9jb3JlL2NvbXBvbmVudHMnO1xuaW1wb3J0IHsgZGVmaW5lQ3VzdG9tRWxlbWVudCB9IGZyb20gJ0Bpb25pYy9jb3JlL2NvbXBvbmVudHMvaW9uLW1vZGFsLmpzJztcblxuQEluamVjdGFibGUoKVxuZXhwb3J0IGNsYXNzIE1vZGFsQ29udHJvbGxlciBleHRlbmRzIE92ZXJsYXlCYXNlQ29udHJvbGxlcjxNb2RhbE9wdGlvbnMsIEhUTUxJb25Nb2RhbEVsZW1lbnQ+IHtcbiAgcHJpdmF0ZSBhbmd1bGFyRGVsZWdhdGUgPSBpbmplY3QoQW5ndWxhckRlbGVnYXRlKTtcbiAgcHJpdmF0ZSBpbmplY3RvciA9IGluamVjdChJbmplY3Rvcik7XG4gIHByaXZhdGUgZW52aXJvbm1lbnRJbmplY3RvciA9IGluamVjdChFbnZpcm9ubWVudEluamVjdG9yKTtcblxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihtb2RhbENvbnRyb2xsZXIpO1xuICAgIGRlZmluZUN1c3RvbUVsZW1lbnQoKTtcbiAgfVxuXG4gIGNyZWF0ZShvcHRzOiBNb2RhbE9wdGlvbnMpOiBQcm9taXNlPEhUTUxJb25Nb2RhbEVsZW1lbnQ+IHtcbiAgICByZXR1cm4gc3VwZXIuY3JlYXRlKHtcbiAgICAgIC4uLm9wdHMsXG4gICAgICBkZWxlZ2F0ZTogdGhpcy5hbmd1bGFyRGVsZWdhdGUuY3JlYXRlKHRoaXMuZW52aXJvbm1lbnRJbmplY3RvciwgdGhpcy5pbmplY3RvciwgJ21vZGFsJyksXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==