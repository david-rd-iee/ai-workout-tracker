import { TestBed } from '@angular/core/testing';
import { HomePage } from './home.page';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Router } from '@angular/router';

describe('HomePage - Widget Configuration', () => {
  let homePage: HomePage;

  // Mock Firebase services
  const mockAuth = {
    currentUser: null
  };
  
  const mockFirestore = {};
  const mockRouter = { navigate: jasmine.createSpy('navigate') };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        HomePage,
        { provide: Auth, useValue: mockAuth },
        { provide: Firestore, useValue: mockFirestore },
        { provide: Router, useValue: mockRouter }
      ]
    });

    // Create instance using TestBed injection context
    homePage = TestBed.inject(HomePage);
  });

  it('should enable default widgets when no config exists', () => {
    homePage.homeConfig = null;
    
    expect(homePage.isWidgetEnabled('welcome')).toBe(true);
    expect(homePage.isWidgetEnabled('streak')).toBe(true);
    expect(homePage.isWidgetEnabled('next-workout')).toBe(true);
    expect(homePage.isWidgetEnabled('upcoming-session')).toBe(true);
  });

  it('should disable non-default widgets when no config exists', () => {
    homePage.homeConfig = null;
    
    expect(homePage.isWidgetEnabled('custom-widget')).toBe(false);
    expect(homePage.isWidgetEnabled('nonexistent')).toBe(false);
  });

  it('should respect custom widget configuration', () => {
    homePage.homeConfig = {
      clientId: 'test123',
      widgets: [
        { id: 'welcome', name: 'Welcome', enabled: false, order: 1 },
        { id: 'streak', name: 'Streak', enabled: true, order: 2 },
        { id: 'custom-widget', name: 'Custom', enabled: true, order: 3 }
      ],
      customMessage: 'Test message'
    };
    
    expect(homePage.isWidgetEnabled('welcome')).toBe(false);
    expect(homePage.isWidgetEnabled('streak')).toBe(true);
    expect(homePage.isWidgetEnabled('custom-widget')).toBe(true);
  });

  it('should return false for widgets not in config array', () => {
    homePage.homeConfig = {
      clientId: 'test123',
      widgets: [
        { id: 'streak', name: 'Streak', enabled: true, order: 1 }
      ]
    };
    
    expect(homePage.isWidgetEnabled('next-workout')).toBe(false);
  });

  it('should handle empty widget array in config', () => {
    homePage.homeConfig = {
      clientId: 'test123',
      widgets: []
    };
    
    expect(homePage.isWidgetEnabled('welcome')).toBe(false);
    expect(homePage.isWidgetEnabled('streak')).toBe(false);
  });

  it('should return correct widget order when config exists', () => {
    homePage.homeConfig = {
      clientId: 'test123',
      widgets: [
        { id: 'streak', name: 'Streak', enabled: true, order: 5 },
        { id: 'welcome', name: 'Welcome', enabled: true, order: 1 }
      ]
    };
    
    expect(homePage.getWidgetOrder('welcome')).toBe(1);
    expect(homePage.getWidgetOrder('streak')).toBe(5);
  });

  it('should return 999 for widget order when no config exists', () => {
    homePage.homeConfig = null;
    
    expect(homePage.getWidgetOrder('welcome')).toBe(999);
  });

  it('should return 999 for widget order when widget not in config', () => {
    homePage.homeConfig = {
      clientId: 'test123',
      widgets: [
        { id: 'streak', name: 'Streak', enabled: true, order: 1 }
      ]
    };
    
    expect(homePage.getWidgetOrder('nonexistent')).toBe(999);
  });

  it('should correctly identify default widgets', () => {
    homePage.homeConfig = null;
    const defaultWidgets = ['welcome', 'streak', 'next-workout', 'upcoming-session'];
    
    defaultWidgets.forEach(widgetId => {
      expect(homePage.isWidgetEnabled(widgetId)).toBe(true, `${widgetId} should be enabled by default`);
    });
  });
});
