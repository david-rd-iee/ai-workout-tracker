import { Injector, Injectable, EnvironmentInjector, inject } from '@angular/core';
import { AngularDelegate, OverlayBaseController } from '@ionic/angular/common';
import { modalController } from '@ionic/core';
import * as i0 from "@angular/core";
class ModalController extends OverlayBaseController {
    angularDelegate = inject(AngularDelegate);
    injector = inject(Injector);
    environmentInjector = inject(EnvironmentInjector);
    constructor() {
        super(modalController);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kYWwtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9wcm92aWRlcnMvbW9kYWwtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLEVBQUUsTUFBTSxlQUFlLENBQUM7QUFDbEYsT0FBTyxFQUFFLGVBQWUsRUFBRSxxQkFBcUIsRUFBRSxNQUFNLHVCQUF1QixDQUFDO0FBRS9FLE9BQU8sRUFBRSxlQUFlLEVBQUUsTUFBTSxhQUFhLENBQUM7O0FBRTlDLE1BQ2EsZUFBZ0IsU0FBUSxxQkFBd0Q7SUFDbkYsZUFBZSxHQUFHLE1BQU0sQ0FBQyxlQUFlLENBQUMsQ0FBQztJQUMxQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQzVCLG1CQUFtQixHQUFHLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO0lBRTFEO1FBQ0UsS0FBSyxDQUFDLGVBQWUsQ0FBQyxDQUFDO0lBQ3pCLENBQUM7SUFFRCxNQUFNLENBQUMsSUFBa0I7UUFDdkIsT0FBTyxLQUFLLENBQUMsTUFBTSxDQUFDO1lBQ2xCLEdBQUcsSUFBSTtZQUNQLFFBQVEsRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUM7U0FDeEYsQ0FBQyxDQUFDO0lBQ0wsQ0FBQzsySEFkVSxlQUFlOytIQUFmLGVBQWU7O1NBQWYsZUFBZTs0RkFBZixlQUFlO2tCQUQzQixVQUFVIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSW5qZWN0b3IsIEluamVjdGFibGUsIEVudmlyb25tZW50SW5qZWN0b3IsIGluamVjdCB9IGZyb20gJ0Bhbmd1bGFyL2NvcmUnO1xuaW1wb3J0IHsgQW5ndWxhckRlbGVnYXRlLCBPdmVybGF5QmFzZUNvbnRyb2xsZXIgfSBmcm9tICdAaW9uaWMvYW5ndWxhci9jb21tb24nO1xuaW1wb3J0IHR5cGUgeyBNb2RhbE9wdGlvbnMgfSBmcm9tICdAaW9uaWMvY29yZSc7XG5pbXBvcnQgeyBtb2RhbENvbnRyb2xsZXIgfSBmcm9tICdAaW9uaWMvY29yZSc7XG5cbkBJbmplY3RhYmxlKClcbmV4cG9ydCBjbGFzcyBNb2RhbENvbnRyb2xsZXIgZXh0ZW5kcyBPdmVybGF5QmFzZUNvbnRyb2xsZXI8TW9kYWxPcHRpb25zLCBIVE1MSW9uTW9kYWxFbGVtZW50PiB7XG4gIHByaXZhdGUgYW5ndWxhckRlbGVnYXRlID0gaW5qZWN0KEFuZ3VsYXJEZWxlZ2F0ZSk7XG4gIHByaXZhdGUgaW5qZWN0b3IgPSBpbmplY3QoSW5qZWN0b3IpO1xuICBwcml2YXRlIGVudmlyb25tZW50SW5qZWN0b3IgPSBpbmplY3QoRW52aXJvbm1lbnRJbmplY3Rvcik7XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIobW9kYWxDb250cm9sbGVyKTtcbiAgfVxuXG4gIGNyZWF0ZShvcHRzOiBNb2RhbE9wdGlvbnMpOiBQcm9taXNlPEhUTUxJb25Nb2RhbEVsZW1lbnQ+IHtcbiAgICByZXR1cm4gc3VwZXIuY3JlYXRlKHtcbiAgICAgIC4uLm9wdHMsXG4gICAgICBkZWxlZ2F0ZTogdGhpcy5hbmd1bGFyRGVsZWdhdGUuY3JlYXRlKHRoaXMuZW52aXJvbm1lbnRJbmplY3RvciwgdGhpcy5pbmplY3RvciwgJ21vZGFsJyksXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==