export type BadgeLevel = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master';
export type BadgeCategory = 'strength' | 'endurance' | 'consistency' | 'progress' | 'social' | 'milestone';

export interface BadgeTier {
  level: BadgeLevel;
  threshold: number; // The value needed to achieve this tier
  color: string;
  gradientStart: string;
  gradientEnd: string;
  displayName: string;
}

export interface AchievementBadge {
  id: string;
  name: string;
  icon: string; // ionicon name
  description: string;
  category: BadgeCategory;
  metric: string; // What we're measuring (e.g., 'totalWeight', 'workoutStreak', 'sessionCount')
  unit: string; // Unit of measurement (e.g., 'lbs', 'sessions', 'days')
  
  // Tier thresholds
  tiers: {
    bronze: number;
    silver: number;
    gold: number;
    platinum: number;
    diamond: number;
    master: number;
  };
  
  // Current user stats (populated at runtime)
  currentValue?: number;
  currentLevel?: BadgeLevel;
  percentile?: number; // Top X% of users
  nextTierValue?: number; // Value needed for next tier
  progressToNext?: number; // 0-100 percentage progress to next tier
}

export const BADGE_TIER_CONFIG: Record<BadgeLevel, BadgeTier> = {
  bronze: {
    level: 'bronze',
    threshold: 0,
    color: '#CD7F32',
    gradientStart: '#CD7F32',
    gradientEnd: '#8B5A2B',
    displayName: 'Bronze'
  },
  silver: {
    level: 'silver',
    threshold: 1,
    color: '#C0C0C0',
    gradientStart: '#E8E8E8',
    gradientEnd: '#A8A8A8',
    displayName: 'Silver'
  },
  gold: {
    level: 'gold',
    threshold: 2,
    color: '#FFD700',
    gradientStart: '#FFD700',
    gradientEnd: '#FFA500',
    displayName: 'Gold'
  },
  platinum: {
    level: 'platinum',
    threshold: 3,
    color: '#4ECDC4',
    gradientStart: '#7FFFD4',
    gradientEnd: '#40E0D0',
    displayName: 'Platinum'
  },
  diamond: {
    level: 'diamond',
    threshold: 4,
    color: '#B9F2FF',
    gradientStart: '#B9F2FF',
    gradientEnd: '#4A90E2',
    displayName: 'Diamond'
  },
  master: {
    level: 'master',
    threshold: 5,
    color: '#9C27B0',
    gradientStart: '#CE93D8',
    gradientEnd: '#7B1FA2',
    displayName: 'Master'
  }
};

export const ACHIEVEMENT_BADGES: AchievementBadge[] = [
  {
    id: 'strength-master',
    name: 'Strength Master',
    icon: 'body',
    description: 'Total weight lifted across all exercises',
    category: 'strength',
    metric: 'totalWeightLifted',
    unit: 'lbs',
    tiers: {
      bronze: 50000,      // 50k lbs
      silver: 150000,     // 150k lbs
      gold: 500000,       // 500k lbs
      platinum: 1000000,  // 1M lbs
      diamond: 2500000,   // 2.5M lbs
      master: 5000000     // 5M lbs
    }
  },
  {
    id: 'workout-warrior',
    name: 'Workout Warrior',
    icon: 'shield-checkmark',
    description: 'Total completed workout sessions',
    category: 'consistency',
    metric: 'totalSessions',
    unit: 'sessions',
    tiers: {
      bronze: 25,
      silver: 100,
      gold: 250,
      platinum: 500,
      diamond: 1000,
      master: 2000
    }
  },
  {
    id: 'streak-king',
    name: 'Streak King',
    icon: 'flame',
    description: 'Longest consecutive days with workouts',
    category: 'consistency',
    metric: 'longestStreak',
    unit: 'days',
    tiers: {
      bronze: 7,
      silver: 30,
      gold: 90,
      platinum: 180,
      diamond: 365,
      master: 730
    }
  },
  {
    id: 'endurance-champion',
    name: 'Endurance Champion',
    icon: 'speedometer',
    description: 'Total cardio time logged',
    category: 'endurance',
    metric: 'totalCardioMinutes',
    unit: 'hours',
    tiers: {
      bronze: 600,      // 10 hours
      silver: 3000,     // 50 hours
      gold: 9000,       // 150 hours
      platinum: 18000,  // 300 hours
      diamond: 36000,   // 600 hours
      master: 60000     // 1000 hours
    }
  },
  {
    id: 'pr-crusher',
    name: 'PR Crusher',
    icon: 'trophy',
    description: 'Personal records set',
    category: 'progress',
    metric: 'personalRecords',
    unit: 'PRs',
    tiers: {
      bronze: 5,
      silver: 15,
      gold: 30,
      platinum: 50,
      diamond: 100,
      master: 200
    }
  },
  {
    id: 'early-riser',
    name: 'Early Riser',
    icon: 'sunny',
    description: 'Workouts completed before 7 AM',
    category: 'consistency',
    metric: 'earlyWorkouts',
    unit: 'sessions',
    tiers: {
      bronze: 10,
      silver: 50,
      gold: 100,
      platinum: 200,
      diamond: 365,
      master: 730
    }
  },
  {
    id: 'social-butterfly',
    name: 'Social Butterfly',
    icon: 'people',
    description: 'Group workouts or partner sessions',
    category: 'social',
    metric: 'groupSessions',
    unit: 'sessions',
    tiers: {
      bronze: 10,
      silver: 25,
      gold: 50,
      platinum: 100,
      diamond: 250,
      master: 500
    }
  },
  {
    id: 'transformation',
    name: 'Transformation',
    icon: 'analytics',
    description: 'Body weight change achieved',
    category: 'progress',
    metric: 'weightChange',
    unit: 'lbs',
    tiers: {
      bronze: 10,
      silver: 25,
      gold: 50,
      platinum: 75,
      diamond: 100,
      master: 150
    }
  },
  {
    id: 'century-club',
    name: 'Century Club',
    icon: 'calendar',
    description: 'Days with logged activity',
    category: 'milestone',
    metric: 'activeDays',
    unit: 'days',
    tiers: {
      bronze: 30,
      silver: 100,
      gold: 250,
      platinum: 500,
      diamond: 1000,
      master: 2000
    }
  },
  {
    id: 'heavy-lifter',
    name: 'Heavy Lifter',
    icon: 'barbell',
    description: 'Highest single-rep max',
    category: 'strength',
    metric: 'maxSingleLift',
    unit: 'lbs',
    tiers: {
      bronze: 135,
      silver: 225,
      gold: 315,
      platinum: 405,
      diamond: 500,
      master: 600 
    }
  }
  /*{
    id: 'jerk-master',
    name: 'Jerk Master',
    icon: 'bed',
    description: 'Total jerks performed',
    category: 'strength',
    metric: 'totalJerks',
    unit: 'jerks',
    tiers: {
      bronze: 500,
      silver: 1500,
      gold: 3000,
      platinum: 5000,
      diamond: 7500,
      master: 10000
    }
  }*/
];

// Helper function to calculate badge level based on current value
export function calculateBadgeLevel(badge: AchievementBadge, currentValue: number): BadgeLevel | null {
  if (currentValue >= badge.tiers.master) return 'master';
  if (currentValue >= badge.tiers.diamond) return 'diamond';
  if (currentValue >= badge.tiers.platinum) return 'platinum';
  if (currentValue >= badge.tiers.gold) return 'gold';
  if (currentValue >= badge.tiers.silver) return 'silver';
  if (currentValue >= badge.tiers.bronze) return 'bronze';
  return null;
}

// Helper function to calculate progress to next tier
export function calculateProgressToNextTier(badge: AchievementBadge, currentValue: number): {
  currentLevel: BadgeLevel | null;
  nextLevel: BadgeLevel | null;
  nextTierValue: number | null;
  progressPercentage: number;
} {
  const currentLevel = calculateBadgeLevel(badge, currentValue);
  
  if (!currentLevel) {
    return {
      currentLevel: null,
      nextLevel: 'bronze',
      nextTierValue: badge.tiers.bronze,
      progressPercentage: (currentValue / badge.tiers.bronze) * 100
    };
  }

  const tierOrder: BadgeLevel[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'];
  const currentIndex = tierOrder.indexOf(currentLevel);
  
  if (currentIndex === tierOrder.length - 1) {
    // Already at max tier
    return {
      currentLevel,
      nextLevel: null,
      nextTierValue: null,
      progressPercentage: 100
    };
  }

  const nextLevel = tierOrder[currentIndex + 1];
  const nextTierValue = badge.tiers[nextLevel];
  const currentTierValue = badge.tiers[currentLevel];
  
  const progressPercentage = ((currentValue - currentTierValue) / (nextTierValue - currentTierValue)) * 100;

  return {
    currentLevel,
    nextLevel,
    nextTierValue,
    progressPercentage: Math.min(100, Math.max(0, progressPercentage))
  };
}
