---
name: What To Eat Ah
description: Mobile-first Singapore food swipe deck for fast dinner decisions.
colors:
  ink: "#16130f"
  paper: "#f3ead9"
  paper-low: "#e8dcc4"
  paper-high: "#fff8eb"
  chilli: "#e3452b"
  chilli-deep: "#b8301c"
  pandan: "#1f7a4d"
  gold: "#e8a317"
  muted: "#6b6052"
  line: "#d8c9aa"
  card-dark: "#0d0c0b"
typography:
  display:
    fontFamily: "Archivo, Arial, Helvetica, sans-serif"
    fontSize: "2.12rem"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "0"
  headline:
    fontFamily: "Archivo, Arial, Helvetica, sans-serif"
    fontSize: "clamp(2rem, 9vw, 2.9rem)"
    fontWeight: 900
    lineHeight: 0.98
    letterSpacing: "0"
  body:
    fontFamily: "Instrument Sans, Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0"
  label:
    fontFamily: "Archivo, Arial, Helvetica, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0"
rounded:
  sm: "10px"
  md: "12px"
  lg: "16px"
  card: "24px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "18px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.chilli}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    height: "74px"
    width: "74px"
  button-secondary:
    backgroundColor: "{colors.paper-low}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "62px"
    width: "62px"
  swipe-card:
    backgroundColor: "{colors.card-dark}"
    textColor: "#ffffff"
    rounded: "{rounded.card}"
    width: "min(100%, 360px)"
  filter-bar:
    backgroundColor: "{colors.paper-low}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "12px 14px 14px"
  saved-card:
    backgroundColor: "{colors.paper-high}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px"
---

# Design System: What To Eat Ah

## 1. Overview

**Creative North Star: "Hawker Deck in Hand"**

The visual system should feel like a compact food card stack someone can operate with one thumb while deciding dinner. It borrows the warmth and immediacy of hawker signage without becoming decorative: thick display type, chilli red action energy, pandan green confirmation, and tactile paper-toned controls around a dark video-forward card.

This is product UI, so trust comes from consistency and speed. The deck owns the screen, the action rail stays familiar, and details are available inside the card without breaking the swipe loop. The brand is local and lively, but the surface should still feel shippable on Vercel and reliable enough for a real recommendation flow.

**Key Characteristics:**
- Mobile-first 360px phone-stage layout with a 3:5 swipe deck.
- High-contrast video cards with paper-toned controls and strong action color.
- Dense but legible food metadata, optimized for glance decisions.
- Casual local copy used sparingly in labels, not as visual clutter.

## 2. Colors

The palette is a food-stall signboard wrapped around a restrained product shell: paper neutrals carry most UI, chilli red marks appetite and primary action, pandan green marks saved/positive state, and gold adds selective warmth.

### Primary
- **Chilli Action**: Primary appetite and save color. Use for the main right-swipe action, active decision badges, and the "ah" brand accent.
- **Deep Chilli**: Compact emphasis for values and small labels when full Chilli Action would be too loud.

### Secondary
- **Pandan Confirmation**: Positive state color for shortlist feedback, map affordances, and saved confirmation moments.

### Tertiary
- **Kopi Gold**: Tiny accents, preference headers, quote rules, and warmth inside dark or paper surfaces.

### Neutral
- **Charred Ink**: Main text and dark product panel backgrounds.
- **Makan Paper**: Default page surface and detail-card background.
- **Folded Paper**: Toolbar, filter, and quiet control background.
- **Fresh Paper**: Saved-card and elevated list-item background.
- **Muted Soy**: Secondary copy and metadata.
- **Woven Line**: Borders and dividers.
- **Card Night**: Video-card fallback surface.

### Named Rules

**The Food First Rule.** Color frames the decision loop; it must not compete with the food clip itself.

**The Three-Signal Rule.** Red means appetite/primary action, green means saved/positive, gold means editorial highlight. Do not swap these roles.

## 3. Typography

**Display Font:** Archivo with Arial / Helvetica fallback  
**Body Font:** Instrument Sans with Arial / Helvetica fallback  
**Label Font:** Archivo with Arial / Helvetica fallback

**Character:** Archivo gives the product its hawker-sign confidence; Instrument Sans keeps dense metadata readable. The pairing is blunt, compact, and mobile-native rather than editorial.

### Hierarchy
- **Display** (900, 2.12rem, 0.9 line-height): Brand mark only.
- **Headline** (900, clamp(2rem, 9vw, 2.9rem), 0.98 line-height): Dish titles on swipe cards.
- **Title** (900, 1rem-1.3rem): Venue names, saved items, state-panel headlines.
- **Body** (500-800, 0.86rem-1rem): Metadata, quotes, details, and supporting copy.
- **Label** (900, 0.68rem-0.75rem, uppercase when needed): Filter labels, preference headers, compact UI captions.

### Named Rules

**The Deck Title Rule.** Large typography belongs on the dish name only; controls, labels, and metadata stay compact.

**The No Tracking Rule.** Letter spacing stays at 0. This interface should feel bold, not spaced-out or fashion-editorial.

## 4. Elevation

Depth is tactile but limited. The top swipe card uses one substantial ambient shadow to feel physical; most supporting surfaces use tonal layering and borders instead of extra shadows.

### Shadow Vocabulary
- **Swipe Lift** (`0 18px 40px -12px rgba(40, 25, 10, 0.45)`): Top card only.
- **Action Lift** (`0 6px 16px -4px rgba(40, 25, 10, 0.4)`): Circular action buttons.
- **Toast Lift** (`0 8px 20px rgba(0, 0, 0, 0.3)`): Temporary confirmation toast.
- **Sheet Lift** (`0 -18px 48px rgba(0, 0, 0, 0.2)`): Shortlist bottom sheet.

### Named Rules

**The One Big Shadow Rule.** Only the active swipe card gets the dramatic shadow. Repeated list items and panels use color layers, not stacked drop shadows.

## 5. Components

### Buttons
- **Shape:** Circular action buttons use full pills; small icon buttons use confident soft rectangles.
- **Primary:** The save button is Chilli Action on white text, 74px square, centered in the action rail.
- **Secondary:** Nope is white with Chilli Action icon; undo/details are Folded Paper with Charred Ink.
- **Hover / Focus:** Keep state transitions short. Add visible focus rings when editing this system further.

### Chips
- **Style:** Overlay chips use translucent white with blur on video; detail chips use Folded Paper with Charred Ink.
- **State:** Chips summarize evidence only. They are not decoration and should not become a tag cloud.

### Cards / Containers
- **Corner Style:** Swipe cards are extra-rounded for a handheld card feel; saved cards and detail facts are tighter.
- **Background:** Video cards use Card Night; detail layers use Makan Paper; saved cards use Fresh Paper.
- **Shadow Strategy:** Use Swipe Lift only for the active swipe card.
- **Border:** Woven Line borders are allowed on quiet surfaces; never use colored side stripes.
- **Internal Padding:** 14px-22px depending on density and thumb distance.

### Inputs / Fields
- **Style:** The distance filter is a single range input with a Pandan-to-Gold track and Charred Ink thumb.
- **Focus:** Keep the native affordance visible or replace it with an equally clear focus outline.
- **Error / Disabled:** Disabled action buttons use opacity reduction and no pointer affordance; future errors should use inline state panels, not blocking modals.

### Navigation
- **Style:** No global navigation for the MVP. The top bar holds brand and shortlist count; the bottom rail holds actions.
- **Mobile Treatment:** Controls stay within the 360px phone stage and respect safe-area padding.

### Swipe Deck

The deck is the signature component. Only the active card plays video; the next cards are poster previews. Horizontal motion decides left/right, while vertical scroll reveals the detail layer inside the card.

### Shortlist Sheet

The shortlist is a bottom drawer, not a route change. It uses saved-card list items with thumbnail, dish, venue, distance/rating text, and one map icon action.

## 6. Do's and Don'ts

### Do:
- **Do** keep the first viewport focused on the active swipe deck and thumb actions.
- **Do** use Chilli Action, Pandan Confirmation, and Kopi Gold in their assigned roles.
- **Do** omit nullable quote, price, and rating fields cleanly when they are missing.
- **Do** keep touch targets at least 42px, with primary swipe action larger than secondary actions.
- **Do** preserve button fallbacks for every gesture.

### Don't:
- **Don't** turn the app into a marketing landing page, admin console, or decorative restaurant directory.
- **Don't** use generic delivery-app UI, beige foodie-blog editorial styling, dark purple SaaS gradients, influencer marketplace dashboards, or a full TikTok clone.
- **Don't** add side-stripe borders, gradient text, glassmorphism, or repeated identical card grids.
- **Don't** let decorative motion delay the swipe loop.
- **Don't** make empty boxes for missing data.
