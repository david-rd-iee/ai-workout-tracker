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

export const appNavAnimation: AnimationBuilder = (_baseEl: any, opts: any): Animation => {
  const enteringEl = getIonPageElement(opts.enteringEl);
  const leavingEl = opts.leavingEl ? getIonPageElement(opts.leavingEl) : undefined;
  const isBack = opts.direction === 'back';

  const enteringIsProfile = containsSelector(enteringEl, 'app-profile-user');
  const leavingIsProfile = containsSelector(leavingEl, 'app-profile-user');
  const enteringIsGroups = containsSelector(enteringEl, 'app-groups');
  const leavingIsGroups = containsSelector(leavingEl, 'app-groups');
  const enteringIsWorkoutChatbot = containsSelector(enteringEl, 'app-workout-chatbot');
  const leavingIsWorkoutChatbot = containsSelector(leavingEl, 'app-workout-chatbot');
  const enteringIsLoggingMethodRoutes = containsSelector(enteringEl, 'app-logging-method-routes');
  const leavingIsLoggingMethodRoutes = containsSelector(leavingEl, 'app-logging-method-routes');
  const enteringIsWorkoutHistory = containsSelector(enteringEl, 'app-workout-history');
  const leavingIsWorkoutHistory = containsSelector(leavingEl, 'app-workout-history');
  const enteringIsClientWorkoutAnalysis = containsSelector(enteringEl, 'app-client-workout-analysis');
  const leavingIsClientWorkoutAnalysis = containsSelector(leavingEl, 'app-client-workout-analysis');
  const enteringIsHome = containsSelector(enteringEl, 'app-home');
  const leavingIsWorkoutSummary = containsSelector(leavingEl, 'app-workout-summary');
  const isProfileHorizontalTransition =
    (
      enteringIsProfile &&
      (leavingIsGroups || leavingIsWorkoutChatbot || leavingIsLoggingMethodRoutes || leavingIsClientWorkoutAnalysis)
    ) ||
    (
      leavingIsProfile &&
      (enteringIsGroups || enteringIsWorkoutChatbot || enteringIsLoggingMethodRoutes || enteringIsClientWorkoutAnalysis)
    );
  const isSummaryToHomeTransition =
    !isBack && leavingIsWorkoutSummary && enteringIsHome;

  // Use vertical animation for any transition that enters or leaves profile.
  const useProfileVerticalTransition =
    (enteringIsProfile || leavingIsProfile) && !isProfileHorizontalTransition;
  const useWorkoutHistoryVerticalTransition =
    enteringIsWorkoutHistory || leavingIsWorkoutHistory;

  const rootAnimation = createAnimation().duration(420).easing('cubic-bezier(0.32, 0.72, 0, 1)');
  const enteringAnimation = createAnimation().addElement(enteringEl);
  const leavingAnimation = leavingEl ? createAnimation().addElement(leavingEl) : createAnimation();

  // Ionic marks entering pages as invisible; remove it before animating
  // to avoid a black flash while the leaving page moves away.
  enteringAnimation.beforeRemoveClass('ion-page-invisible');

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
