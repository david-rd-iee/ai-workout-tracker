# Badge to Greek Statue Mapping

## Quick Reference Table

| Old Badge Name | New Greek God | Statue ID | Category | Metric |
|---------------|---------------|-----------|----------|--------|
| Strength Master | Heracles - God of Strength | `heracles-strength` | strength | Total weight lifted |
| Workout Warrior | Ares - God of War | `ares-warrior` | consistency | Total sessions |
| Streak King | Hestia - Goddess of the Eternal Flame | `hestia-eternal-flame` | consistency | Longest streak |
| Endurance Champion | Hermes - God of Swiftness | `hermes-swiftness` | endurance | Cardio time |
| PR Crusher | Nike - Goddess of Victory | `nike-victory` | progress | Personal records |
| Early Riser | Eos - Goddess of the Dawn | `eos-dawn` | consistency | Early workouts |
| Social Butterfly | Dionysus - God of Fellowship | `dionysus-fellowship` | social | Group sessions |
| Transformation | Apollo - God of Perfection | `apollo-transformation` | progress | Weight change |
| Century Club | Chronos - God of Time | `chronos-time` | milestone | Active days |
| Heavy Lifter | Atlas - Titan Bearer of Burdens | `atlas-burden` | strength | Max single lift |

## Tier Level Mapping

| Old Badge Level | New Carving Stage | Color Theme | Progress % |
|----------------|-------------------|-------------|------------|
| Bronze | Rough Stone | Brown stone (#8B7355) | 10% |
| Silver | Outlined | Light stone (#B8A898) | 30% |
| Gold | Detailed | Cream stone (#D4C5B0) | 50% |
| Platinum | Polished Marble | White marble (#F5E6D3) | 70% |
| Diamond | Gold Adorned | Golden (#FFD700) | 90% |
| Master | Divine Masterpiece | Divine glow (#E8F4FF) | 100% |

## Threshold Values Unchanged

All progression thresholds remain the same between the old badge system and new statue system. Only the presentation and theming have changed.

## Visual Differences

### Old Badge System
- Traditional medal/trophy icons
- Standard tier badges (bronze, silver, gold medals)
- Simple progress bars
- Generic achievement names

### New Greek Statue System
- Mythology-themed icons representing each god
- Carving stage indicators (hammer, chisel, star)
- Circular progress rings showing carving completion
- Greek god names with mythological context
- Enhanced visual feedback with stone-to-divine progression
- Carving stage descriptions

## Component Usage Comparison

### Old Way (Badge System)
```html
<app-achievement-badge 
  [badge]="achievementBadge" 
  [showProgress]="true"
  size="medium">
</app-achievement-badge>
```

### New Way (Statue System)
```html
<app-greek-statue 
  [statue]="greekStatue" 
  [showProgress]="true"
  size="medium">
</app-greek-statue>
```

## Data Structure Compatibility

### Firestore Documents
Both systems are compatible. You can use either:

**Legacy (badges):**
```typescript
{
  userId: "user123",
  values: {
    "strength-master": 75000,
    "workout-warrior": 150
  },
  displayBadgeIds: ["strength-master"]
}
```

**New (statues):**
```typescript
{
  userId: "user123",
  values: {
    "heracles-strength": 75000,
    "ares-warrior": 150
  },
  displayStatueIds: ["heracles-strength"]
}
```

## Migration Notes

1. **No database migration required** - The system is backwards compatible
2. **IDs have changed** - New statue IDs use Greek god names instead of achievement names
3. **Display field name** - `displayBadgeIds` → `displayStatueIds` (both supported)
4. **Visual only** - All metrics and thresholds remain identical
