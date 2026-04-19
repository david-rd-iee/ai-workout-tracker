# UI Style Guide (Neomorphic Blue)

## Purpose
Use this guide for pages that should match the current Home/Profile neumorphic language.  
It documents the exact tokens and patterns currently implemented.

## Source of truth
- `src/app/pages/profile-user/profile-user.page.scss`
- `src/app/pages/profile-user/profile-user.page.html`
- `src/app/pages/home/home.page.scss`
- `src/app/components/header/header.component.scss`
- `src/app/components/header/header.component.html`
- `src/app/pages/tabs/tabs.page.scss`

## Visual direction
- Soft raised neumorphic surfaces (not high-contrast cards)
- Cool blue-gray base with clean blue accents (no purple cast)
- Subtle atmospheric gradients for depth
- Rounded geometry with gentle, diffuse shadows

## Core tokens

### Color
| Token | Value | Usage |
|---|---|---|
| Page background | `#dbe3f0` | `ion-content` base on profile-style pages |
| Surface high | `#f1f5fc` | Raised surface gradient start |
| Surface | `#e8eef8` | Raised surface gradient end |
| Text primary | `#5a6880` | Titles and main labels |
| Text muted | `#8b9ab0` | Secondary/supporting text |
| Accent blue (light) | `#6f9eff` | Active fills, secondary accent |
| Accent blue (primary) | `#2e6ef5` | Icons, emphasis, key actions |
| Header translucent bg | `rgba(231, 237, 245, 0.44)` | Header shell |
| Header toolbar bg | `rgba(231, 237, 245, 0.82)` | Header body |

### Page gradient
```scss
.background-gradient {
  background:
    radial-gradient(circle at 14% -4%, rgba(255, 255, 255, 0.84) 0, rgba(255, 255, 255, 0) 36%),
    radial-gradient(circle at 86% 8%, rgba(160, 179, 219, 0.34) 0, rgba(160, 179, 219, 0) 42%),
    linear-gradient(145deg, #d5deeb 0%, #e8eef8 48%, #dbe4f1 100%);
}
```

### Shadows
Raised surface:
```scss
box-shadow:
  14px 14px 28px -14px rgba(184, 196, 214, 0.88),
  -12px -12px 24px -14px rgba(249, 252, 255, 0.95);
```

Inset surface:
```scss
box-shadow:
  inset 7px 7px 12px -10px rgba(184, 196, 214, 0.9),
  inset -7px -7px 12px -10px rgba(249, 252, 255, 0.95);
```

### Radius
| Type | Value |
|---|---|
| Large card | `26px` |
| Medium card/button | `22px` |
| Inset well | `18px` to `20px` |
| Round icon button | `50%` |
| Pills/chips | `999px` |

### Spacing
| Token | Value |
|---|---|
| Desktop container horizontal | `16px` |
| Mobile container horizontal | `14px` |
| Profile top offset | `10px` |
| Standard section stack gap | `14px` to `18px` |
| Card inner content | `16px` to `20px` |

## Typography
| Role | Value |
|---|---|
| Profile name | `44px` desktop, `36px` mobile, weight `680` |
| Card title | `~1.1rem`, weight `680` |
| Body muted | `0.8rem` to `0.95rem` |
| Action row text | `16px`, weight `700` |
| Header title base | `calc(1.5rem + 0.5vw)` |
| Header title ATLAS | `clamp(2.15rem, 5.1vw, 2.95rem)` |

## Reusable SCSS primitives
```scss
@mixin neo-raised($radius: 22px) {
  background: linear-gradient(145deg, #f1f5fc, #e8eef8);
  border-radius: $radius;
  border: 1px solid rgba(255, 255, 255, 0.78);
  box-shadow:
    14px 14px 28px -14px rgba(184, 196, 214, 0.88),
    -12px -12px 24px -14px rgba(249, 252, 255, 0.95);
}

@mixin neo-inset($radius: 18px) {
  background: linear-gradient(145deg, #edf2fb, #e4ebf7);
  border-radius: $radius;
  border: 1px solid rgba(255, 255, 255, 0.56);
  box-shadow:
    inset 7px 7px 12px -10px rgba(184, 196, 214, 0.9),
    inset -7px -7px 12px -10px rgba(249, 252, 255, 0.95);
}
```

## Layout pattern
For profile-style pages, keep content spacing as-is and apply visual treatment only:

```html
<app-header [transparent]="true" [neoBlend]="true" ...></app-header>
<ion-content [fullscreen]="true" class="page-content">
  <div class="background-gradient"></div>
  <div class="page-container">
    <!-- existing layout -->
  </div>
</ion-content>
```

```scss
.page-content { --background: #dbe3f0; position: relative; }
.background-gradient { position: absolute; inset: 0; pointer-events: none; }
.page-container { position: relative; z-index: 1; padding: 16px; padding-top: 10px; }

@media (max-width: 768px) {
  .page-container { padding: 14px; padding-top: 10px; }
}
```

## Header spec
- Use `neoBlend` on pages in this style family.
- Header action icons should use primary accent blue (`#2e6ef5`).
- Header title remains non-interactive (`pointer-events: none`).
- Preserve existing header sizing and structure; style only.

## Component recipes

### Raised cards
- Use `neo-raised`.
- Typical radii: `22px` to `26px`.
- Avoid hard borders or dark outlines.

### Profile hero card
- Use the same `neo-raised` surface treatment as other raised blocks (`26px` radius).
- Keep the shared raised border/shadow treatment (do not zero out card border).
- Do **not** add outline rings/pseudo-element edge borders.
- Edge definition should come from the raised shadow + gradient only.

### Inset wells
- Avatar shells, progress tracks, and inner stats wells use `neo-inset`.
- Keep inset contrast soft and diffuse.

### Action rows and icon wells
- Rows: raised surfaces with subtle active press transform.
- Right-side icons should sit in circular mini-wells:
  - `34px` by `34px`
  - light raised background
  - icon color `#2e6ef5`

### Primary blue actions
- Buttons (e.g. customize CTA) should use:
  - default: `linear-gradient(145deg, #79a8ff, #2e6ef5)`
  - hover: `linear-gradient(145deg, #8eb6ff, #4a83f8)`
  - active: `linear-gradient(145deg, #5f95fd, #2461e4)`

### Progress
- Track background: `rgba(143, 159, 184, 0.2)`
- Fill gradient: `linear-gradient(90deg, #79a8ff 0%, #2e6ef5 100%)`

## Motion and interaction
- Raised press response:
  - `transform: translateY(1px) scale(0.997)`
  - slightly reduced/shallower shadows
- Transition timing:
  - cards/buttons: `~160ms` to `180ms`

## Do / avoid

### Do
- Keep blue accents consistent with header settings icon tone.
- Maintain soft contrast and diffuse lighting.
- Reuse tokens/mixins instead of ad-hoc shadows.

### Avoid
- Purple-led accent drift for icons/buttons.
- Outline rings around hero surfaces.
- Flat cards without raised/inset depth treatment.

## Adoption checklist
- Apply `neoBlend` header where this style is used.
- Add page background + atmospheric gradient.
- Use `neo-raised` and `neo-inset` primitives consistently.
- Keep existing page spacing/layout unless explicitly changing layout.
- Verify icons/buttons stay in the blue accent family (`#2e6ef5`-led).
