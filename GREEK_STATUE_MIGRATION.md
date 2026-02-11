# Greek God Statue System - Migration Guide

## Overview
The badge system has been transformed into a Greek mythology-themed statue carving system. Instead of earning badges with traditional tiers (bronze, silver, gold, etc.), users now carve statues of Greek gods with progressive stages representing the mastery of different fitness achievements.

## Core Concept
Users "carve out" statues of Greek gods as they progress in their fitness journey. Each statue represents a different aspect of fitness, and the carving progresses through these stages:

1. **Rough Stone** (10% carved) - Initial rough cut from the quarry
2. **Outlined** (30% carved) - Basic form emerging from the marble
3. **Detailed** (50% carved) - Features and details being carved
4. **Polished Marble** (70% carved) - Smoothed to perfection
5. **Gold Adorned** (90% carved) - Adorned with gold and precious materials
6. **Divine Masterpiece** (100% carved) - A masterpiece worthy of Olympus

## Greek Gods & Their Domains

### Strength Category
- **Heracles** - God of Strength (Total weight lifted)
- **Atlas** - Titan Bearer of Burdens (Highest single-rep max)

### Endurance Category
- **Hermes** - God of Swiftness (Total cardio time)

### Consistency Category
- **Ares** - God of War (Total workout sessions)
- **Hestia** - Goddess of the Eternal Flame (Longest workout streak)
- **Eos** - Goddess of the Dawn (Early morning workouts)

### Progress Category
- **Nike** - Goddess of Victory (Personal records)
- **Apollo** - God of Perfection (Body transformation)

### Social Category
- **Dionysus** - God of Fellowship (Group workouts)

### Milestone Category
- **Chronos** - God of Time (Active days logged)

## New Files Created

### Interfaces
- `src/app/Interfaces/GreekStatue.ts` - Main statue interface and configurations
  - Replaces: `Badge.ts` (old file still exists for backwards compatibility)
  
### Models
- `src/app/models/user-statues.model.ts` - User statue progress data model
- `src/app/models/user-badges.model.ts` - Updated to support both systems

### Components
- `src/app/components/greek-statue/` - New statue display component
  - `greek-statue.component.ts`
  - `greek-statue.component.html`
  - `greek-statue.component.scss`
  
- `src/app/components/statue-selector/` - New statue selection component
  - `statue-selector.component.ts`
  - `statue-selector.component.html`
  - `statue-selector.component.scss`

## Key Features

### Visual Progress
- Circular progress ring showing overall carving completion
- Color-coded stages from stone to divine
- Stage-specific icons (hammer for rough stages, star for divine)

### Enhanced Display
- God name and title prominently displayed
- Mythological description for context
- Carving stage description
- Visual feedback with progress rings and gradients

### Backwards Compatibility
- Old badge interfaces still exist
- UserBadgesDoc extends UserStatuesDoc for compatibility
- Services can gradually migrate to new terminology

## Migration Steps for Services

1. **Import Updates**
   ```typescript
   // Old
   import { AchievementBadge, ACHIEVEMENT_BADGES } from '../interfaces/Badge';
   
   // New
   import { GreekStatue, GREEK_STATUES } from '../interfaces/GreekStatue';
   ```

2. **Component Updates**
   ```typescript
   // Old
   import { AchievementBadgeComponent } from '../components/achievement-badge/achievement-badge.component';
   
   // New
   import { GreekStatueComponent } from '../components/greek-statue/greek-statue.component';
   ```

3. **Data Model Updates**
   ```typescript
   // Old
   displayBadgeIds: string[]
   
   // New (backwards compatible)
   displayStatueIds: string[]
   ```

## Usage Examples

### Displaying a Statue
```html
<app-greek-statue 
  [statue]="statue" 
  [showProgress]="true"
  size="medium"
></app-greek-statue>
```

### Opening Statue Selector
```typescript
const modal = await this.modalCtrl.create({
  component: StatueSelectorComponent,
  componentProps: {
    carvedStatues: this.userStatues,
    selectedStatueIds: this.displayStatueIds,
    maxDisplayStatues: 3
  }
});

await modal.present();
const { data, role } = await modal.onWillDismiss();

if (role === 'confirm') {
  this.displayStatueIds = data;
}
```

## Terminology Changes

| Old Term | New Term |
|----------|----------|
| Badge | Statue |
| Earned Badge | Carved Statue |
| Badge Level | Carving Stage |
| Bronze/Silver/Gold/etc. | Rough/Outlined/Detailed/Polished/Gilded/Divine |
| Unlock Badge | Begin Carving |
| Badge Progress | Carving Progress |
| Display Badges | Showcase Statues |

## Design Philosophy

The new system emphasizes:
1. **Artistry** - Progress is depicted as creating art, not just collecting items
2. **Mythology** - Each achievement tied to a Greek god with relevant domain
3. **Gradual Mastery** - Carving stages show incremental progress visually
4. **Epic Feel** - Language and visuals evoke grandeur and achievement

## Next Steps

To fully migrate your application:
1. Update service files to use new statue imports
2. Replace achievement-badge components with greek-statue components
3. Update Firestore collections (optional - backwards compatible)
4. Update UI text to use statue terminology
5. Test the new components with existing data

## Visual Enhancements

The statue system includes several visual improvements:
- Circular progress rings showing carving completion
- Stone-to-marble-to-gold color progression
- Carving stage indicators
- Enhanced mythology tooltips
- More immersive achievement display
