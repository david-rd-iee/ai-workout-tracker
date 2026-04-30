import { Animation, AnimationBuilder, createAnimation } from '@ionic/core';

function getIonPageElement(element: HTMLElement): HTMLElement {
  if (!element) return element;
  if (element.classList.contains('ion-page')) return element;

  const page = element.querySelector(':scope > .ion-page');
  return (page as HTMLElement) ?? element;
}

function containsSelector(element: HTMLElement | undefined, selector: string): boolean {
  if (!element) return false;
  if (element.matches(selector)) return true;
  return !!element.querySelector(selector);
}

function isTabsTransition(baseEl: any): boolean {
  if (!(baseEl instanceof HTMLElement)) {
    return false;
  }

  return (
    !!baseEl.closest('ion-tabs') ||
    baseEl.hasAttribute('tabs') ||
    baseEl.getAttribute('name') === 'tabs'
  );
}

export const appNavAnimation: AnimationBuilder = (baseEl: any, opts: any): Animation => {
  const enteringEl = getIonPageElement(opts.enteringEl);
  const leavingEl = opts.leavingEl ? getIonPageElement(opts.leavingEl) : undefined;
  const isBack = opts.direction === 'back';
  const slowTransitionDurationMs = 560;

  const enteringAnimation = createAnimation().addElement(enteringEl);
  const leavingAnimation = leavingEl ? createAnimation().addElement(leavingEl) : createAnimation();

  // Ionic marks entering pages as invisible; remove it before animating
  // to avoid a black flash while the leaving page moves away.
  enteringAnimation.beforeRemoveClass('ion-page-invisible');

  // Tab switches should be instant and consistent.
  if (isTabsTransition(baseEl)) {
    enteringAnimation
      .beforeStyles({ transform: 'translate3d(0, 0, 0)', opacity: '1' })
      .afterClearStyles(['transform', 'opacity']);

    leavingAnimation
      .beforeStyles({ transform: 'translate3d(0, 0, 0)', opacity: '1' })
      .afterClearStyles(['transform', 'opacity']);

    return createAnimation()
      .duration(0)
      .easing('linear')
      .addAnimation([enteringAnimation, leavingAnimation]);
  }

  const enteringIsProfile = containsSelector(enteringEl, 'app-profile-user');
  const leavingIsProfile = containsSelector(leavingEl, 'app-profile-user');
  const enteringIsClientPayments = containsSelector(enteringEl, 'app-client-payments');
  const leavingIsClientPayments = containsSelector(leavingEl, 'app-client-payments');
  const enteringIsClientFindTrainer = containsSelector(enteringEl, 'app-client-find-trainer');
  const leavingIsClientFindTrainer = containsSelector(leavingEl, 'app-client-find-trainer');
  const enteringIsRegionalLeaderboard = containsSelector(enteringEl, 'app-regional-leaderboard');
  const leavingIsRegionalLeaderboard = containsSelector(leavingEl, 'app-regional-leaderboard');
  const enteringIsCamera = containsSelector(enteringEl, 'app-camera');
  const leavingIsCamera = containsSelector(leavingEl, 'app-camera');
  const enteringIsGroups = containsSelector(enteringEl, 'app-groups');
  const leavingIsGroups = containsSelector(leavingEl, 'app-groups');
  const enteringIsWorkoutChatbot = containsSelector(enteringEl, 'app-workout-chatbot');
  const leavingIsWorkoutChatbot = containsSelector(leavingEl, 'app-workout-chatbot');
  const enteringIsLoggingMethodRoutes = containsSelector(enteringEl, 'app-logging-method-routes');
  const leavingIsLoggingMethodRoutes = containsSelector(leavingEl, 'app-logging-method-routes');
  const enteringIsWorkoutHistory = containsSelector(enteringEl, 'app-workout-history');
  const leavingIsWorkoutHistory = containsSelector(leavingEl, 'app-workout-history');
  const enteringIsHome = containsSelector(enteringEl, 'app-home');
  const leavingIsWorkoutSummary = containsSelector(leavingEl, 'app-workout-summary');
  const isProfileHorizontalTransition =
    (
      enteringIsProfile &&
      (
        leavingIsGroups ||
        leavingIsClientPayments ||
        leavingIsClientFindTrainer ||
        leavingIsRegionalLeaderboard ||
        leavingIsCamera ||
        leavingIsWorkoutChatbot ||
        leavingIsLoggingMethodRoutes ||
        leavingIsWorkoutHistory
      )
    ) ||
    (
      leavingIsProfile &&
      (
        enteringIsGroups ||
        enteringIsClientPayments ||
        enteringIsClientFindTrainer ||
        enteringIsRegionalLeaderboard ||
        enteringIsCamera ||
        enteringIsWorkoutChatbot ||
        enteringIsLoggingMethodRoutes ||
        enteringIsWorkoutHistory
      )
    );
  const isProfileWorkoutHistoryTransition =
    (enteringIsProfile && leavingIsWorkoutHistory) ||
    (leavingIsProfile && enteringIsWorkoutHistory);
  const isSummaryToHomeTransition =
    !isBack && leavingIsWorkoutSummary && enteringIsHome;

  // Use vertical animation for any transition that enters or leaves profile.
  const useProfileVerticalTransition =
    (enteringIsProfile || leavingIsProfile) && !isProfileHorizontalTransition;
  const useWorkoutHistoryVerticalTransition =
    (enteringIsWorkoutHistory || leavingIsWorkoutHistory) && !isProfileWorkoutHistoryTransition;

  const rootAnimation = createAnimation()
    .duration(slowTransitionDurationMs)
    .easing('cubic-bezier(0.32, 0.72, 0, 1)');

  if (isSummaryToHomeTransition) {
    enteringAnimation
      .beforeStyles({ transform: 'translateY(100%)', opacity: '1' })
      .fromTo('transform', 'translateY(100%)', 'translateY(0)')
      .afterClearStyles(['transform', 'opacity']);

    leavingAnimation
      .beforeStyles({ transform: 'translateY(0)', opacity: '1' })
      .fromTo('opacity', '1', '1')
      .afterClearStyles(['transform', 'opacity']);

    return rootAnimation.addAnimation([enteringAnimation, leavingAnimation]);
  }

  if (useProfileVerticalTransition) {
    if (isBack) {
      enteringAnimation
        .beforeStyles({ transform: 'translate3d(0, 0, 0)', opacity: '1' })
        .afterClearStyles(['transform', 'opacity']);

      leavingAnimation
        .beforeStyles({ transform: 'translate3d(0, 0, 0)', opacity: '1' })
        .fromTo('transform', 'translate3d(0, 0, 0)', 'translate3d(0, -100%, 0)')
        .afterClearStyles(['transform', 'opacity']);
    } else {
      enteringAnimation
        .beforeStyles({ transform: 'translate3d(0, -100%, 0)', opacity: '1' })
        .fromTo('transform', 'translate3d(0, -100%, 0)', 'translate3d(0, 0, 0)')
        .afterClearStyles(['transform', 'opacity']);

      leavingAnimation
        .beforeStyles({ transform: 'translate3d(0, 0, 0)', opacity: '1' })
        .afterClearStyles(['transform', 'opacity']);
    }

    return rootAnimation.addAnimation([enteringAnimation, leavingAnimation]);
  }

  if (useWorkoutHistoryVerticalTransition) {
    if (isBack) {
      enteringAnimation
        .beforeStyles({ transform: 'translate3d(0, 0, 0)', opacity: '1' })
        .afterClearStyles(['transform', 'opacity']);

      leavingAnimation
        .beforeStyles({ transform: 'translate3d(0, 0, 0)', opacity: '1' })
        .fromTo('transform', 'translate3d(0, 0, 0)', 'translate3d(0, 100%, 0)')
        .afterClearStyles(['transform', 'opacity']);
    } else {
      enteringAnimation
        .beforeStyles({ transform: 'translate3d(0, 100%, 0)', opacity: '1' })
        .fromTo('transform', 'translate3d(0, 100%, 0)', 'translate3d(0, 0, 0)')
        .afterClearStyles(['transform', 'opacity']);

      leavingAnimation
        .beforeStyles({ transform: 'translate3d(0, 0, 0)', opacity: '1' })
        .afterClearStyles(['transform', 'opacity']);
    }

    return rootAnimation.addAnimation([enteringAnimation, leavingAnimation]);
  }

  // Fallback transition for non-profile routes
  if (isBack) {
    enteringAnimation
      .beforeStyles({ transform: 'translate3d(-30%, 0, 0)', opacity: '0.95' })
      .fromTo('transform', 'translate3d(-30%, 0, 0)', 'translate3d(0, 0, 0)')
      .fromTo('opacity', '0.95', '1')
      .afterClearStyles(['transform', 'opacity']);

    leavingAnimation
      .beforeStyles({ transform: 'translate3d(0, 0, 0)', opacity: '1' })
      .fromTo('transform', 'translate3d(0, 0, 0)', 'translate3d(100%, 0, 0)')
      .afterClearStyles(['transform', 'opacity']);
  } else {
    enteringAnimation
      .beforeStyles({ transform: 'translate3d(100%, 0, 0)', opacity: '1' })
      .fromTo('transform', 'translate3d(100%, 0, 0)', 'translate3d(0, 0, 0)')
      .afterClearStyles(['transform', 'opacity']);

    leavingAnimation
      .beforeStyles({ transform: 'translate3d(0, 0, 0)', opacity: '1' })
      .fromTo('transform', 'translate3d(0, 0, 0)', 'translate3d(-30%, 0, 0)')
      .fromTo('opacity', '1', '0.95')
      .afterClearStyles(['transform', 'opacity']);
  }

  return rootAnimation.addAnimation([enteringAnimation, leavingAnimation]);
};
