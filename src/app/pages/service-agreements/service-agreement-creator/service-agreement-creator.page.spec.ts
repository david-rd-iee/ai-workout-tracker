import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ServiceAgreementCreatorPage } from './service-agreement-creator.page';

describe('ServiceAgreementCreatorPage', () => {
  let component: ServiceAgreementCreatorPage;
  let fixture: ComponentFixture<ServiceAgreementCreatorPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ServiceAgreementCreatorPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
