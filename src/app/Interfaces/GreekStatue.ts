export type StatueLevel = 'rough' | 'outlined' | 'detailed' | 'polished' | 'gilded' | 'divine';
export type StatueCategory = 'strength' | 'endurance' | 'consistency' | 'progress' | 'social' | 'milestone';

export interface StatueTier {
  level: StatueLevel;
  threshold: number; // The value needed to achieve this tier
  color: string;
  gradientStart: string;
  gradientEnd: string;
  displayName: string;
  carvingProgress: number; // 0-100 percentage of statue carved
}

export interface GreekStatue {
  id: string;
  godName: string; // Name of the Greek god
  title: string; // e.g., "God of Strength", "Goddess of Victory"
  icon: string; // ionicon name
  customIcon?: string; // Optional custom image path
  description: string;
  category: StatueCategory;
  metric: string; // What we're measuring (e.g., 'totalWeight', 'workoutStreak', 'sessionCount')
  unit: string; // Unit of measurement (e.g., 'lbs', 'sessions', 'days')
  mythology: string; // Brief mythological description
  
  // Tier thresholds - representing carving stages
  tiers: {
    rough: number;      // Initial rough stone cut
    outlined: number;   // Basic outline visible
    detailed: number;   // Details being carved
    polished: number;   // Smoothed and refined
    gilded: number;     // Adorned with gold
    divine: number;     // Completed divine masterpiece
  };
  
  // Current user stats (populated at runtime)
  currentValue?: number;
  currentLevel?: StatueLevel;
  percentile?: number; // Top X% of users
  nextTierValue?: number; // Value needed for next tier
  progressToNext?: number; // 0-100 percentage progress to next tier
}

export const STATUE_TIER_CONFIG: Record<StatueLevel, StatueTier> = {
  rough: {
    level: 'rough',
    threshold: 0,
    color: '#5C4F42',
    gradientStart: '#6B5A47',
    gradientEnd: '#3E3530',
    displayName: 'Rough Stone',
    carvingProgress: 10
  },
  outlined: {
    level: 'outlined',
    threshold: 1,
    color: '#8B7355',
    gradientStart: '#A0826D',
    gradientEnd: '#6B5A47',
    displayName: 'Outlined',
    carvingProgress: 30
  },
  detailed: {
    level: 'detailed',
    threshold: 2,
    color: '#B8A898',
    gradientStart: '#C9BCAC',
    gradientEnd: '#9A8A7A',
    displayName: 'Detailed',
    carvingProgress: 50
  },
  polished: {
    level: 'polished',
    threshold: 3,
    color: '#F5E6D3',
    gradientStart: '#FFFEF9',
    gradientEnd: '#E5D6C1',
    displayName: 'Polished Marble',
    carvingProgress: 70
  },
  gilded: {
    level: 'gilded',
    threshold: 4,
    color: '#D4AF37',
    gradientStart: '#FFD700',
    gradientEnd: '#B8941A',
    displayName: 'Gold Adorned',
    carvingProgress: 90
  },
  divine: {
    level: 'divine',
    threshold: 5,
    color: '#FFE9A0',
    gradientStart: '#FFFEF9',
    gradientEnd: '#FFD700',
    displayName: 'Divine Masterpiece',
    carvingProgress: 100
  }
};

export const GREEK_STATUES: GreekStatue[] = [
  {
    id: 'heracles-strength',
    godName: 'Heracles',
    title: 'God of Strength',
    icon: 'barbell',

    description: 'Total weight lifted across all exercises',
    mythology: 'Son of Zeus, known for his incredible strength and twelve labors',
    category: 'strength',
    metric: 'totalWeightLifted',
    unit: 'lbs',
    tiers: {
      rough: 50000,      // 50k lbs
      outlined: 150000,  // 150k lbs
      detailed: 500000,  // 500k lbs
      polished: 1000000, // 1M lbs
      gilded: 2500000,   // 2.5M lbs
      divine: 5000000    // 5M lbs
    }
  },
  {
    id: 'ares-warrior',
    godName: 'Ares',
    title: 'God of War',
    icon: 'shield',

    description: 'Total completed workout sessions',
    mythology: 'God of war and courage, representing the warrior spirit',
    category: 'consistency',
    metric: 'totalSessions',
    unit: 'sessions',
    tiers: {
      rough: 25,
      outlined: 100,
      detailed: 250,
      polished: 500,
      gilded: 1000,
      divine: 2000
    }
  },
  {
    id: 'hestia-eternal-flame',
    godName: 'Hestia',
    title: 'Goddess of the Eternal Flame',
    icon: 'flame',
    description: 'Longest consecutive days with workouts',
    mythology: 'Keeper of the eternal flame, representing unwavering dedication',
    category: 'consistency',
    metric: 'longestStreak',
    unit: 'days',
    tiers: {
      rough: 7,
      outlined: 30,
      detailed: 90,
      polished: 180,
      gilded: 365,
      divine: 730
    }
  },
  {
    id: 'hermes-swiftness',
    godName: 'Hermes',
    title: 'God of Swiftness',
    icon: 'flash',

    description: 'Total cardio time logged',
    mythology: 'Swift messenger of the gods, master of speed and endurance',
    category: 'endurance',
    metric: 'totalCardioMinutes',
    unit: 'hours',
    tiers: {
      rough: 600,      // 10 hours
      outlined: 3000,  // 50 hours
      detailed: 9000,  // 150 hours
      polished: 18000, // 300 hours
      gilded: 36000,   // 600 hours
      divine: 60000    // 1000 hours
    }
  },
  {
    id: 'nike-victory',
    godName: 'Nike',
    title: 'Goddess of Victory',
    icon: 'ribbon',

    description: 'Personal records set',
    mythology: 'Winged goddess of victory, celebrating triumph and achievement',
    category: 'progress',
    metric: 'personalRecords',
    unit: 'PRs',
    tiers: {
      rough: 5,
      outlined: 15,
      detailed: 30,
      polished: 50,
      gilded: 100,
      divine: 200
    }
  },
  {
    id: 'eos-dawn',
    godName: 'Eos',
    title: 'Goddess of the Dawn',
    icon: 'sunny',
    description: 'Workouts completed before 7 AM',
    mythology: 'Goddess who brings the dawn, celebrating early risers',
    category: 'consistency',
    metric: 'earlyWorkouts',
    unit: 'sessions',
    tiers: {
      rough: 10,
      outlined: 50,
      detailed: 100,
      polished: 200,
      gilded: 365,
      divine: 730
    }
  },
  {
    id: 'dionysus-fellowship',
    godName: 'Dionysus',
    title: 'God of Fellowship',
    icon: 'beer',

    description: 'Group workouts or partner sessions',
    mythology: 'God of celebration and community, bringing people together',
    category: 'social',
    metric: 'groupSessions',
    unit: 'sessions',
    tiers: {
      rough: 10,
      outlined: 25,
      detailed: 50,
      polished: 100,
      gilded: 250,
      divine: 500
    }
  },
  {
    id: 'apollo-transformation',
    godName: 'Apollo',
    title: 'God of Perfection',
    icon: 'sparkles',

    description: 'Body weight change achieved',
    mythology: 'God of beauty and perfection, representing physical transformation',
    category: 'progress',
    metric: 'weightChange',
    unit: 'lbs',
    tiers: {
      rough: 10,
      outlined: 25,
      detailed: 50,
      polished: 75,
      gilded: 100,
      divine: 150
    }
  },
  {
    id: 'chronos-time',
    godName: 'Chronos',
    title: 'God of Time',
    icon: 'hourglass',

    description: 'Days with logged activity',
    mythology: 'Personification of time, rewarding consistent dedication',
    category: 'milestone',
    metric: 'activeDays',
    unit: 'days',
    tiers: {
      rough: 30,
      outlined: 100,
      detailed: 250,
      polished: 500,
      gilded: 1000,
      divine: 2000
    }
  },
  {
    id: 'atlas-burden',
    godName: 'Atlas',
    title: 'Titan Bearer of Burdens',
    icon: 'fitness',
    customIcon: 'assets/icons/atlas-svgrepo-com.svg',
    description: 'Highest single-rep max',
    mythology: 'Titan who bears the weight of the heavens on his shoulders',
    category: 'strength',
    metric: 'maxSingleLift',
    unit: 'lbs',
    tiers: {
      rough: 135,
      outlined: 225,
      detailed: 315,
      polished: 405,
      gilded: 500,
      divine: 600
    }
  },
  // Trainer-specific statues
  {
    id: 'zeus-mentor',
    godName: 'Zeus',
    title: 'King of Olympus - Master Mentor',
    icon: 'people',
    description: 'Total clients trained',
    mythology: 'King of the gods, guiding others to greatness',
    category: 'milestone',
    metric: 'totalClients',
    unit: 'clients',
    tiers: {
      rough: 5,
      outlined: 15,
      detailed: 30,
      polished: 50,
      gilded: 100,
      divine: 200
    }
  },
  {
    id: 'athena-wisdom',
    godName: 'Athena',
    title: 'Goddess of Wisdom',
    icon: 'school',
    description: 'Total training sessions completed',
    mythology: 'Goddess of wisdom and strategic warfare',
    category: 'consistency',
    metric: 'totalTrainingSessions',
    unit: 'sessions',
    tiers: {
      rough: 50,
      outlined: 200,
      detailed: 500,
      polished: 1000,
      gilded: 2500,
      divine: 5000
    }
  },
  {
    id: 'hermes-prosperity',
    godName: 'Hermes',
    title: 'God of Commerce',
    icon: 'cash',
    description: 'Total revenue generated',
    mythology: 'Messenger god and patron of commerce and trade',
    category: 'milestone',
    metric: 'totalRevenue',
    unit: '$',
    tiers: {
      rough: 1000,
      outlined: 5000,
      detailed: 15000,
      polished: 50000,
      gilded: 100000,
      divine: 250000
    }
  }
];


// Helper function to calculate statue level based on current value
export function calculateStatueLevel(statue: GreekStatue, currentValue: number): StatueLevel | null {
  if (currentValue >= statue.tiers.divine) return 'divine';
  if (currentValue >= statue.tiers.gilded) return 'gilded';
  if (currentValue >= statue.tiers.polished) return 'polished';
  if (currentValue >= statue.tiers.detailed) return 'detailed';
  if (currentValue >= statue.tiers.outlined) return 'outlined';
  if (currentValue >= statue.tiers.rough) return 'rough';
  return null;
}

// Helper function to calculate carving progress to next tier
export function calculateCarvingProgress(statue: GreekStatue, currentValue: number): {
  currentLevel: StatueLevel | null;
  nextLevel: StatueLevel | null;
  nextTierValue: number | null;
  progressPercentage: number;
  carvingPercentage: number; // Overall statue carving completion
} {
  const currentLevel = calculateStatueLevel(statue, currentValue);
  
  if (!currentLevel) {
    return {
      currentLevel: null,
      nextLevel: 'rough',
      nextTierValue: statue.tiers.rough,
      progressPercentage: (currentValue / statue.tiers.rough) * 100,
      carvingPercentage: (currentValue / statue.tiers.rough) * 10 // 0-10% for pre-rough stage
    };
  }

  const tierOrder: StatueLevel[] = ['rough', 'outlined', 'detailed', 'polished', 'gilded', 'divine'];
  const currentIndex = tierOrder.indexOf(currentLevel);
  
  if (currentIndex === tierOrder.length - 1) {
    // Already at max tier - fully carved divine statue
    return {
      currentLevel,
      nextLevel: null,
      nextTierValue: null,
      progressPercentage: 100,
      carvingPercentage: 100
    };
  }

  const nextLevel = tierOrder[currentIndex + 1];
  const nextTierValue = statue.tiers[nextLevel];
  const currentTierValue = statue.tiers[currentLevel];
  
  const progressPercentage = ((currentValue - currentTierValue) / (nextTierValue - currentTierValue)) * 100;
  
  // Calculate overall carving percentage based on current tier
  const currentTierConfig = STATUE_TIER_CONFIG[currentLevel];
  const nextTierConfig = STATUE_TIER_CONFIG[nextLevel];
  const carvingPercentage = currentTierConfig.carvingProgress + 
    ((nextTierConfig.carvingProgress - currentTierConfig.carvingProgress) * progressPercentage / 100);

  return {
    currentLevel,
    nextLevel,
    nextTierValue,
    progressPercentage: Math.min(100, Math.max(0, progressPercentage)),
    carvingPercentage: Math.min(100, Math.max(0, carvingPercentage))
  };
}

// Get carving stage description based on level
export function getCarvingStageDescription(level: StatueLevel | null): string {
  if (!level) return 'Unmarked stone block';
  
  const descriptions: Record<StatueLevel, string> = {
    rough: 'Rough stone cut from the quarry',
    outlined: 'Basic form emerging from the marble',
    detailed: 'Features and details being carved',
    polished: 'Smoothed to perfection',
    gilded: 'Adorned with gold and precious materials',
    divine: 'A masterpiece worthy of Olympus'
  };
  
  return descriptions[level];
}
