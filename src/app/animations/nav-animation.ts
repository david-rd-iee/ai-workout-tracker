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
  const enteringIsTabs = containsSelector(enteringEl, 'app-tabs');
  const leavingIsTabs = containsSelector(leavingEl, 'app-tabs');

  const isProfileToWorkoutTransition =
    !isBack && leavingIsProfile && (enteringIsWorkoutChatbot || enteringIsTabs);
  const isWorkoutToProfileTransition =
    isBack && enteringIsProfile && (leavingIsWorkoutChatbot || leavingIsTabs);
  const isProfileWorkoutTransition =
    isProfileToWorkoutTransition || isWorkoutToProfileTransition;
  const isProfileGroupsTransition =
    (enteringIsProfile && leavingIsGroups) ||
    (leavingIsProfile && enteringIsGroups);

  // Use vertical animation for any transition that enters or leaves profile.
  const useProfileVerticalTransition =
    (enteringIsProfile || leavingIsProfile) && !isProfileGroupsTransition;

  //duration keep at 620, I like it
  const rootAnimation = createAnimation().duration(620).easing('cubic-bezier(0.32, 0.72, 0, 1)');
  const enteringAnimation = createAnimation().addElement(enteringEl);
  const leavingAnimation = leavingEl ? createAnimation().addElement(leavingEl) : createAnimation();

  // Ionic marks entering pages as invisible; remove it before animating
  // to avoid a black flash while the leaving page moves away.
  enteringAnimation.beforeRemoveClass('ion-page-invisible');

  if (useProfileVerticalTransition) {
    if (isProfileWorkoutTransition) {
      if (isBack) {
        // Workout -> Profile: profile stays on top and slides down.
        enteringAnimation
          .beforeStyles({ transform: 'translateY(-100%)', opacity: '1', 'z-index': '101' })
          .fromTo('transform', 'translateY(-100%)', 'translateY(0)')
          .fromTo('opacity', '1', '1')
          .afterClearStyles(['transform', 'opacity', 'z-index']);

        leavingAnimation
          .beforeStyles({ transform: 'translateY(0)', opacity: '1' })
          .fromTo('opacity', '1', '1')
          .afterClearStyles(['transform', 'opacity', 'z-index']);
      } else {
        // Profile -> Workout: profile stays on top and slides up.
        enteringAnimation
          .beforeStyles({ transform: 'translateY(0)', opacity: '1' })
          .fromTo('opacity', '1', '1')
          .afterClearStyles(['transform', 'opacity']);

        leavingAnimation
          .beforeStyles({ transform: 'translateY(0)', opacity: '1', 'z-index': '101' })
          .fromTo('transform', 'translateY(0)', 'translateY(-100%)')
          .afterClearStyles(['transform', 'opacity', 'z-index']);
      }

      return rootAnimation.addAnimation([enteringAnimation, leavingAnimation]);
    }

    if (isBack) {
      enteringAnimation
        .beforeStyles({ transform: 'translateY(0)', opacity: '1' })
        .fromTo('opacity', '1', '1')
        .afterClearStyles(['transform', 'opacity']);

      leavingAnimation
        .beforeStyles({ transform: 'translateY(0)', opacity: '1' })
        .fromTo('transform', 'translateY(0)', 'translateY(-100%)')
        .afterClearStyles(['transform', 'opacity']);
    } else {
      enteringAnimation
        .beforeStyles({ transform: 'translateY(-100%)', opacity: '1' })
        .fromTo('transform', 'translateY(-100%)', 'translateY(0)')
        .fromTo('opacity', '1', '1')
        .afterClearStyles(['transform', 'opacity']);

      leavingAnimation
        .beforeStyles({ transform: 'translateY(0)', opacity: '1' })
        .afterClearStyles(['transform', 'opacity']);
    }

    return rootAnimation.addAnimation([enteringAnimation, leavingAnimation]);
  }

  // Fallback transition for non-profile routes
  if (isBack) {
    enteringAnimation
      .beforeStyles({ transform: 'translateX(-30%)', opacity: '0.95' })
      .fromTo('transform', 'translateX(-30%)', 'translateX(0)')
      .fromTo('opacity', '0.95', '1')
      .afterClearStyles(['transform', 'opacity']);

    leavingAnimation
      .beforeStyles({ transform: 'translateX(0)', opacity: '1' })
      .fromTo('transform', 'translateX(0)', 'translateX(100%)')
      .fromTo('opacity', '1', '1')
      .afterClearStyles(['transform', 'opacity']);
  } else {
    enteringAnimation
      .beforeStyles({ transform: 'translateX(100%)', opacity: '1' })
      .fromTo('transform', 'translateX(100%)', 'translateX(0)')
      .afterClearStyles(['transform', 'opacity']);

    leavingAnimation
      .beforeStyles({ transform: 'translateX(0)', opacity: '1' })
      .fromTo('transform', 'translateX(0)', 'translateX(-30%)')
      .fromTo('opacity', '1', '0.95')
      .afterClearStyles(['transform', 'opacity']);
  }

  return rootAnimation.addAnimation([enteringAnimation, leavingAnimation]);
};
